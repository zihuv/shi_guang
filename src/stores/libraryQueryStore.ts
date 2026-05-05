import { create } from "zustand";
import { toast } from "sonner";
import { useFilterStore } from "@/stores/filterStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSmartCollectionStore } from "@/stores/smartCollectionStore";
import { useTagStore } from "@/stores/tagStore";
import { loadFoldersFromAccess, selectFolderFromAccess } from "@/stores/folderStoreAccess";
import {
  analyzeFileMetadata as analyzeFileMetadataCommand,
  extractColor,
  filterFiles as filterFilesCommand,
  getAllFiles,
  getFile,
  getFilesInFolder,
  touchFileLastAccessed as touchFileLastAccessedCommand,
  updateFileMetadata,
  updateFileName,
} from "@/services/desktop/files";
import { setLastSelectedFolderId } from "@/services/desktop/indexing";
import { copyFiles, moveFile, moveFiles } from "@/services/desktop/system";
import {
  addTagToFile as addTagToFileCommand,
  removeTagFromFile as removeTagFromFileCommand,
} from "@/services/desktop/tags";
import { buildFileFilterPayload, hasStructuredFilters } from "@/features/filters/schema";
import { resolveLibraryQueryFolderId } from "@/stores/libraryQueryModel";
import { getErrorMessage } from "@/services/desktop/core";
import {
  parseFile,
  parseFileList,
  type FileItem,
  type PaginatedFilesResponse,
  type SmartCollectionId,
  type VisualSearchDebugScore,
} from "@/stores/fileTypes";

interface LibraryPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type LibraryPaginationMode = "paged" | "flow";

interface FilterFilesInput {
  query?: string;
  naturalLanguageQuery?: string;
  imageQueryFileId?: number | null;
  folderId?: number | null;
  smartView?: SmartCollectionId | null;
  smartSeed?: number | null;
}

interface ImageQueryFile {
  id: number;
  name: string;
}

interface LibraryQueryStore {
  files: FileItem[];
  selectedFolderId: number | null;
  searchQuery: string;
  aiSearchEnabled: boolean;
  imageQueryFile: ImageQueryFile | null;
  isLoading: boolean;
  pagination: LibraryPagination;
  paginationMode: LibraryPaginationMode;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setPaginationMode: (mode: LibraryPaginationMode) => void;
  resetPage: () => void;
  setSearchQuery: (query: string) => void;
  setAiSearchEnabled: (enabled: boolean) => void;
  searchSimilarToFile: (file: ImageQueryFile) => Promise<void>;
  clearImageQuery: () => void;
  clearTransientQuery: () => void;
  setSelectedFolderId: (folderId: number | null) => void;
  loadFiles: () => Promise<void>;
  loadFilesInFolder: (folderId: number | null) => Promise<void>;
  searchFiles: (query: string) => Promise<void>;
  runCurrentQuery: (folderIdOverride?: number | null) => Promise<void>;
  filterFiles: (filter?: FilterFilesInput) => Promise<void>;
  addTagToFile: (fileId: number, tagId: number) => Promise<void>;
  removeTagFromFile: (fileId: number, tagId: number) => Promise<void>;
  updateFileMetadata: (
    fileId: number,
    rating: number,
    description: string,
    sourceUrl: string,
  ) => Promise<void>;
  moveFile: (fileId: number, targetFolderId: number | null) => Promise<void>;
  moveFiles: (fileIds: number[], targetFolderId: number | null) => Promise<void>;
  copyFiles: (fileIds: number[], targetFolderId: number | null) => Promise<void>;
  extractColor: (fileId: number) => Promise<string>;
  updateFileName: (fileId: number, newName: string) => Promise<void>;
  analyzeFileMetadata: (fileId: number, imageDataUrl?: string) => Promise<FileItem>;
  touchFileLastAccessed: (fileId: number) => Promise<void>;
}

let fileListRequestId = 0;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function getCurrentSortConfig() {
  const { sortBy, sortDirection } = useFilterStore.getState().criteria;
  return { sortBy, sortDirection };
}

function getQueryPagination(pagination: LibraryPagination, mode: LibraryPaginationMode) {
  if (mode === "flow") {
    return {
      page: 1,
      pageSize: 0,
    };
  }

  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

function applyPaginatedFilesResult(
  result: PaginatedFilesResponse,
  requestId: number,
  set: (
    partial:
      | Partial<LibraryQueryStore>
      | ((state: LibraryQueryStore) => Partial<LibraryQueryStore>),
  ) => void,
) {
  if (requestId !== fileListRequestId) {
    return false;
  }

  const parsedFiles = parseFileList(result.files);
  useSelectionStore.getState().reconcileVisibleSelection(parsedFiles);

  set((state) => ({
    files: parsedFiles,
    isLoading: false,
    pagination: {
      page: result.page,
      pageSize: state.paginationMode === "flow" ? state.pagination.pageSize : result.page_size,
      total: result.total,
      totalPages: result.total_pages,
    },
  }));

  return true;
}

function beginFileListLoading(
  set: (
    partial:
      | Partial<LibraryQueryStore>
      | ((state: LibraryQueryStore) => Partial<LibraryQueryStore>),
  ) => void,
  options?: {
    clearFiles?: boolean;
    selectedFolderId?: number | null;
  },
) {
  set((state) => {
    const nextState: Partial<LibraryQueryStore> = {
      isLoading: true,
    };

    if (options && "selectedFolderId" in options) {
      nextState.selectedFolderId = options.selectedFolderId ?? null;
    }

    if (options?.clearFiles) {
      nextState.files = [];
      nextState.pagination = {
        ...state.pagination,
        total: 0,
        totalPages: 0,
      };
    }

    return nextState;
  });
}

function roundDebugScore(score: number) {
  return Number(score.toFixed(6));
}

function getAscendingPercentile(scores: number[], percentile: number) {
  const index = Math.max(0, Math.ceil(scores.length * percentile) - 1);
  return scores[Math.min(index, scores.length - 1)] ?? 0;
}

function buildPageScoreSummary(debugScores: VisualSearchDebugScore[]) {
  const scores = debugScores
    .map((entry) => entry.score)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  if (!scores.length) {
    return null;
  }

  return {
    count: scores.length,
    top: scores[scores.length - 1],
    p90: getAscendingPercentile(scores, 0.9),
    p50: getAscendingPercentile(scores, 0.5),
    min: scores[0],
  };
}

function logVisualSearchDebugScores(result: PaginatedFilesResponse, naturalLanguageQuery?: string) {
  const query = naturalLanguageQuery?.trim();
  if (!query) {
    return;
  }

  const debugScores = result.debugScores ?? [];
  if (!debugScores.length) {
    console.info("[visual-search] no debug scores received", {
      query,
      page: result.page,
      total: result.total,
    });
    return;
  }

  const pageScoreSummary = debugScores?.length ? buildPageScoreSummary(debugScores) : null;
  if (!pageScoreSummary) {
    return;
  }

  console.debug("[visual-search] similarity scores", {
    query,
    page: result.page,
    total: result.total,
    results: debugScores.map((entry, index) => ({
      rank: index + 1 + (result.page - 1) * result.page_size,
      fileId: entry.fileId,
      name: entry.name,
      score: roundDebugScore(entry.score),
    })),
  });
  console.table(
    debugScores.map((entry, index) => ({
      rank: index + 1 + (result.page - 1) * result.page_size,
      fileId: entry.fileId,
      name: entry.name,
      score: roundDebugScore(entry.score),
    })),
  );
}

async function refreshFolders() {
  await loadFoldersFromAccess();
}

async function refreshSmartCollections() {
  await useSmartCollectionStore.getState().loadStats();
}

function syncUpdatedFileAcrossStores(
  updatedFile: FileItem,
  set: (
    partial:
      | Partial<LibraryQueryStore>
      | ((state: LibraryQueryStore) => Partial<LibraryQueryStore>),
  ) => void,
) {
  set((state) => ({
    files: state.files.map((file) => (file.id === updatedFile.id ? updatedFile : file)),
  }));

  const { selectedFile } = useSelectionStore.getState();
  if (selectedFile?.id === updatedFile.id) {
    useSelectionStore.getState().setSelectedFile(updatedFile);
  }

  usePreviewStore.setState((state) => ({
    previewFiles: state.previewFiles.map((file) =>
      file.id === updatedFile.id ? updatedFile : file,
    ),
  }));
}

export const useLibraryQueryStore = create<LibraryQueryStore>((set, get) => ({
  files: [],
  selectedFolderId: null,
  searchQuery: "",
  aiSearchEnabled: false,
  imageQueryFile: null,
  isLoading: false,
  pagination: {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
  },
  paginationMode: "paged",

  setPage: (page) => {
    set((state) => ({ pagination: { ...state.pagination, page } }));
    void get().runCurrentQuery();
  },

  setPageSize: (pageSize) => {
    set((state) => ({ pagination: { ...state.pagination, pageSize, page: 1 } }));
    void get().runCurrentQuery();
  },

  setPaginationMode: (mode) => {
    if (get().paginationMode === mode) {
      return;
    }

    set((state) => ({
      paginationMode: mode,
      pagination: {
        ...state.pagination,
        page: 1,
      },
    }));
    void get().runCurrentQuery();
  },

  resetPage: () => {
    set((state) => ({ pagination: { ...state.pagination, page: 1 } }));
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query, imageQueryFile: null });
    useFilterStore.getState().setSearchQuery(query);
    get().resetPage();

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    searchDebounceTimer = setTimeout(() => {
      void get().runCurrentQuery();
    }, 250);
  },

  setAiSearchEnabled: (enabled) => {
    set({ aiSearchEnabled: enabled });
    get().resetPage();

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    void get().runCurrentQuery();
  },

  searchSimilarToFile: async (file) => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    useNavigationStore.getState().openLibrary("all");
    useFilterStore.getState().setFolderId(null);
    selectFolderFromAccess(null);
    useSelectionStore.getState().clearSelection();
    usePreviewStore.getState().closePreview();
    useSelectionStore.getState().setSelectedFile(null);
    set({ imageQueryFile: file, searchQuery: "", selectedFolderId: null });
    useFilterStore.getState().setSearchQuery("");
    get().resetPage();
    await get().runCurrentQuery(null);
  },

  clearImageQuery: () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    set({ imageQueryFile: null, searchQuery: "" });
    useFilterStore.getState().setSearchQuery("");
    get().resetPage();
    void get().runCurrentQuery();
  },

  clearTransientQuery: () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    set({ imageQueryFile: null, searchQuery: "" });
    useFilterStore.getState().setSearchQuery("");
    get().resetPage();
  },

  setSelectedFolderId: (folderId) => set({ selectedFolderId: folderId }),

  loadFiles: async () => {
    const { pagination, paginationMode } = get();
    const queryPagination = getQueryPagination(pagination, paginationMode);
    const { sortBy, sortDirection } = getCurrentSortConfig();
    const requestId = ++fileListRequestId;
    beginFileListLoading(set);

    try {
      const result = await getAllFiles({
        page: queryPagination.page,
        pageSize: queryPagination.pageSize,
        sortBy,
        sortDirection,
      });
      applyPaginatedFilesResult(result, requestId, set);
    } catch (error) {
      console.error("Failed to load files:", error);
      if (requestId === fileListRequestId) {
        set({ isLoading: false });
      }
    }
  },

  loadFilesInFolder: async (folderId) => {
    const previousFolderId = get().selectedFolderId;
    const shouldClearFiles = previousFolderId !== folderId;
    const activeSmartCollection = useNavigationStore.getState().activeSmartCollection;
    const hasSmartCollectionQuery =
      activeSmartCollection !== null && activeSmartCollection !== "all";
    beginFileListLoading(set, {
      clearFiles: shouldClearFiles,
      selectedFolderId: folderId,
    });
    void setLastSelectedFolderId(folderId).catch((error) => {
      console.error("Failed to persist last selected folder:", error);
    });

    const criteria = useFilterStore.getState().criteria;
    if (
      hasStructuredFilters(criteria) ||
      get().searchQuery.trim() ||
      get().imageQueryFile ||
      hasSmartCollectionQuery
    ) {
      await get().runCurrentQuery(folderId);
      return;
    }

    const { pagination, paginationMode } = get();
    const queryPagination = getQueryPagination(pagination, paginationMode);
    const { sortBy, sortDirection } = getCurrentSortConfig();
    const requestId = ++fileListRequestId;

    try {
      const result =
        folderId === null
          ? await getAllFiles({
              page: queryPagination.page,
              pageSize: queryPagination.pageSize,
              sortBy,
              sortDirection,
            })
          : await getFilesInFolder({
              folderId,
              page: queryPagination.page,
              pageSize: queryPagination.pageSize,
              sortBy,
              sortDirection,
            });

      applyPaginatedFilesResult(result, requestId, set);
    } catch (error) {
      console.error("Failed to load files in folder:", error);
      if (requestId === fileListRequestId) {
        set({ isLoading: false });
      }
    }
  },

  searchFiles: async (query) => {
    await get().filterFiles({ query });
  },

  runCurrentQuery: async (folderIdOverride) => {
    const { searchQuery, selectedFolderId, imageQueryFile, aiSearchEnabled } = get();
    const criteria = useFilterStore.getState().criteria;
    const { activeSmartCollection, randomSeed } = useNavigationStore.getState();
    const hasSmartCollectionQuery =
      activeSmartCollection !== null && activeSmartCollection !== "all";
    const folderId = resolveLibraryQueryFolderId({
      activeSmartCollection,
      selectedFolderId,
      folderIdOverride,
    });
    const trimmedSearchQuery = searchQuery.trim();
    const textQuery = imageQueryFile || !trimmedSearchQuery ? undefined : trimmedSearchQuery;
    const fuzzyQuery = aiSearchEnabled ? undefined : textQuery;
    const naturalLanguageQuery = aiSearchEnabled ? textQuery : undefined;

    if (hasStructuredFilters(criteria) || hasSmartCollectionQuery) {
      await get().filterFiles({
        query: fuzzyQuery,
        naturalLanguageQuery,
        imageQueryFileId: imageQueryFile?.id,
        folderId,
        smartView: activeSmartCollection,
        smartSeed: randomSeed,
      });
      return;
    }

    if (imageQueryFile || searchQuery.trim()) {
      await get().filterFiles({
        query: fuzzyQuery,
        naturalLanguageQuery,
        imageQueryFileId: imageQueryFile?.id,
        folderId,
        smartView: activeSmartCollection,
        smartSeed: randomSeed,
      });
      return;
    }

    await get().loadFilesInFolder(folderId);
  },

  filterFiles: async (filter) => {
    const { pagination, paginationMode } = get();
    const queryPagination = getQueryPagination(pagination, paginationMode);
    const requestId = ++fileListRequestId;
    const criteria = useFilterStore.getState().criteria;
    beginFileListLoading(set);

    try {
      const result = await filterFilesCommand({
        filter: buildFileFilterPayload({
          criteria,
          fallbackQuery: filter?.query,
          naturalLanguageQuery: filter?.naturalLanguageQuery,
          imageQueryFileId: filter?.imageQueryFileId,
          folderId: filter?.folderId,
          smartView: filter?.smartView ?? useNavigationStore.getState().activeSmartCollection,
          smartSeed: filter?.smartSeed ?? useNavigationStore.getState().randomSeed,
        }),
        page: queryPagination.page,
        pageSize: queryPagination.pageSize,
      });
      logVisualSearchDebugScores(result, filter?.naturalLanguageQuery);
      applyPaginatedFilesResult(result, requestId, set);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error("Failed to filter files:", errorMessage);
      const naturalLanguageQuery = filter?.naturalLanguageQuery?.trim();
      if (naturalLanguageQuery || filter?.imageQueryFileId) {
        toast.error(errorMessage);
      }
      if (requestId === fileListRequestId) {
        set({ isLoading: false });
      }
    }
  },

  addTagToFile: async (fileId, tagId) => {
    await addTagToFileCommand({ fileId, tagId });
    await get().loadFilesInFolder(get().selectedFolderId);
    await useTagStore.getState().loadTags();
    await refreshSmartCollections();
  },

  removeTagFromFile: async (fileId, tagId) => {
    await removeTagFromFileCommand({ fileId, tagId });
    await get().loadFilesInFolder(get().selectedFolderId);
    await useTagStore.getState().loadTags();
    await refreshSmartCollections();
  },

  updateFileMetadata: async (fileId, rating, description, sourceUrl) => {
    await updateFileMetadata({ fileId, rating, description, sourceUrl });
    const updatedFile = parseFile(await getFile(fileId));
    syncUpdatedFileAcrossStores(updatedFile, set);
  },

  moveFile: async (fileId, targetFolderId) => {
    await moveFile({ fileId, targetFolderId });
    await get().loadFilesInFolder(get().selectedFolderId);
    await refreshFolders();
    await refreshSmartCollections();
  },

  moveFiles: async (fileIds, targetFolderId) => {
    await moveFiles({ fileIds, targetFolderId });
    useSelectionStore.getState().clearSelection();
    useSelectionStore.getState().setSelectedFile(null);
    await get().loadFilesInFolder(get().selectedFolderId);
    await refreshFolders();
    await refreshSmartCollections();
  },

  copyFiles: async (fileIds, targetFolderId) => {
    await copyFiles({ fileIds, targetFolderId });
    await get().loadFilesInFolder(get().selectedFolderId);
    await refreshFolders();
    await refreshSmartCollections();
  },

  extractColor: async (fileId) => {
    const color = await extractColor(fileId);
    const updatedFile = parseFile(await getFile(fileId));
    syncUpdatedFileAcrossStores(updatedFile, set);

    return color;
  },

  updateFileName: async (fileId, newName) => {
    await updateFileName({ fileId, newName });
    const updatedFile = parseFile(await getFile(fileId));
    syncUpdatedFileAcrossStores(updatedFile, set);
  },

  analyzeFileMetadata: async (fileId, imageDataUrl) => {
    const updatedFile = parseFile(await analyzeFileMetadataCommand(fileId, imageDataUrl));
    syncUpdatedFileAcrossStores(updatedFile, set);
    await useTagStore.getState().loadTags();
    return updatedFile;
  },

  touchFileLastAccessed: async (fileId) => {
    await touchFileLastAccessedCommand(fileId);
  },
}));
