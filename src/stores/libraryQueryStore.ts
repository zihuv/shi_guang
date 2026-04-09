import { create } from "zustand"
import { toast } from "sonner"
import { useFilterStore, getSortConfig } from "@/stores/filterStore"
import { useFolderStore } from "@/stores/folderStore"
import { usePreviewStore } from "@/stores/previewStore"
import { useSelectionStore } from "@/stores/selectionStore"
import { useTagStore } from "@/stores/tagStore"
import {
  analyzeFileMetadata as analyzeFileMetadataCommand,
  extractColor,
  exportFile,
  filterFiles as filterFilesCommand,
  getAllFiles,
  getFile,
  getFilesInFolder,
  updateFileMetadata,
  updateFileName,
} from "@/services/tauri/files"
import { copyFiles, moveFile, moveFiles } from "@/services/tauri/system"
import {
  addTagToFile as addTagToFileCommand,
  removeTagFromFile as removeTagFromFileCommand,
} from "@/services/tauri/tags"
import { buildFileFilterPayload, hasStructuredFilters } from "@/features/filters/schema"
import { getErrorMessage } from "@/services/tauri/core"
import {
  parseFile,
  parseFileList,
  type FileItem,
  type PaginatedFilesResponse,
  type VisualSearchDebugScore,
} from "@/stores/fileTypes"

interface LibraryPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface FilterFilesInput {
  query?: string
  naturalLanguageQuery?: string
  folderId?: number | null
}

interface LibraryQueryStore {
  files: FileItem[]
  selectedFolderId: number | null
  searchQuery: string
  isLoading: boolean
  pagination: LibraryPagination
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  resetPage: () => void
  setSearchQuery: (query: string) => void
  setSelectedFolderId: (folderId: number | null) => void
  loadFiles: () => Promise<void>
  loadFilesInFolder: (folderId: number | null) => Promise<void>
  searchFiles: (query: string) => Promise<void>
  runCurrentQuery: (folderIdOverride?: number | null) => Promise<void>
  filterFiles: (filter?: FilterFilesInput) => Promise<void>
  addTagToFile: (fileId: number, tagId: number) => Promise<void>
  removeTagFromFile: (fileId: number, tagId: number) => Promise<void>
  updateFileMetadata: (
    fileId: number,
    rating: number,
    description: string,
    sourceUrl: string,
  ) => Promise<void>
  moveFile: (fileId: number, targetFolderId: number | null) => Promise<void>
  moveFiles: (fileIds: number[], targetFolderId: number | null) => Promise<void>
  copyFiles: (fileIds: number[], targetFolderId: number | null) => Promise<void>
  extractColor: (fileId: number) => Promise<string>
  exportFile: (fileId: number) => Promise<string>
  updateFileName: (fileId: number, newName: string) => Promise<void>
  analyzeFileMetadata: (fileId: number, imageDataUrl?: string) => Promise<FileItem>
}

let fileListRequestId = 0
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

function getCurrentSortConfig() {
  return getSortConfig(useFilterStore.getState().criteria)
}

function applyPaginatedFilesResult(
  result: PaginatedFilesResponse,
  requestId: number,
  set: (partial: Partial<LibraryQueryStore>) => void,
) {
  if (requestId !== fileListRequestId) {
    return false
  }

  const parsedFiles = parseFileList(result.files)
  useSelectionStore.getState().reconcileVisibleSelection(parsedFiles)

  set({
    files: parsedFiles,
    isLoading: false,
    pagination: {
      page: result.page,
      pageSize: result.page_size,
      total: result.total,
      totalPages: result.total_pages,
    },
  })

  return true
}

function roundDebugScore(score: number) {
  return Number(score.toFixed(6))
}

function getAscendingPercentile(scores: number[], percentile: number) {
  const index = Math.max(0, Math.ceil(scores.length * percentile) - 1)
  return scores[Math.min(index, scores.length - 1)] ?? 0
}

function buildPageScoreSummary(debugScores: VisualSearchDebugScore[]) {
  const scores = debugScores
    .map((entry) => entry.score)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  if (!scores.length) {
    return null
  }

  return {
    count: scores.length,
    top: scores[scores.length - 1],
    p90: getAscendingPercentile(scores, 0.90),
    p50: getAscendingPercentile(scores, 0.50),
    min: scores[0],
  }
}

function logVisualSearchDebugScores(
  result: PaginatedFilesResponse,
  naturalLanguageQuery?: string,
) {
  const query = naturalLanguageQuery?.trim()
  if (!query) {
    return
  }

  const debugScores = result.debugScores ?? []
  if (!debugScores.length) {
    console.info("[visual-search] no debug scores received", {
      query,
      page: result.page,
      total: result.total,
    })
    return
  }

  const pageScoreSummary = debugScores?.length
    ? buildPageScoreSummary(debugScores)
    : null
  if (!pageScoreSummary) {
    return
  }

  console.info("[visual-search] score distribution", {
    query,
    scope: "currentPage",
    count: pageScoreSummary.count,
    top: roundDebugScore(pageScoreSummary.top),
    p90: roundDebugScore(pageScoreSummary.p90),
    p50: roundDebugScore(pageScoreSummary.p50),
    min: roundDebugScore(pageScoreSummary.min),
  })

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
  })
  console.table(
    debugScores.map((entry, index) => ({
      rank: index + 1 + (result.page - 1) * result.page_size,
      fileId: entry.fileId,
      name: entry.name,
      score: roundDebugScore(entry.score),
    })),
  )
}

async function refreshFolders() {
  await useFolderStore.getState().loadFolders()
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
  }))

  const { selectedFile } = useSelectionStore.getState()
  if (selectedFile?.id === updatedFile.id) {
    useSelectionStore.getState().setSelectedFile(updatedFile)
  }

  usePreviewStore.setState((state) => ({
    previewFiles: state.previewFiles.map((file) =>
      file.id === updatedFile.id ? updatedFile : file,
    ),
  }))
}

export const useLibraryQueryStore = create<LibraryQueryStore>((set, get) => ({
  files: [],
  selectedFolderId: null,
  searchQuery: "",
  isLoading: false,
  pagination: {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
  },

  setPage: (page) => {
    set((state) => ({ pagination: { ...state.pagination, page } }))
    void get().runCurrentQuery()
  },

  setPageSize: (pageSize) => {
    set((state) => ({ pagination: { ...state.pagination, pageSize, page: 1 } }))
    void get().runCurrentQuery()
  },

  resetPage: () => {
    set((state) => ({ pagination: { ...state.pagination, page: 1 } }))
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query })
    useFilterStore.getState().setSearchQuery(query)
    get().resetPage()

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
    }

    searchDebounceTimer = setTimeout(() => {
      void get().runCurrentQuery()
    }, 250)
  },

  setSelectedFolderId: (folderId) => set({ selectedFolderId: folderId }),

  loadFiles: async () => {
    const { pagination } = get()
    const { sortBy, sortDirection } = getCurrentSortConfig()
    const requestId = ++fileListRequestId
    set({ isLoading: true })

    try {
      const result = await getAllFiles({
        page: pagination.page,
        pageSize: pagination.pageSize,
        sortBy,
        sortDirection,
      })
      applyPaginatedFilesResult(result, requestId, set)
    } catch (error) {
      console.error("Failed to load files:", error)
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  loadFilesInFolder: async (folderId) => {
    set({ selectedFolderId: folderId })
    const criteria = useFilterStore.getState().criteria
    if (hasStructuredFilters(criteria) || get().searchQuery.trim()) {
      await get().runCurrentQuery(folderId)
      return
    }

    const { pagination } = get()
    const { sortBy, sortDirection } = getCurrentSortConfig()
    const requestId = ++fileListRequestId
    set({ isLoading: true })

    try {
      const result =
        folderId === null
          ? await getAllFiles({
              page: pagination.page,
              pageSize: pagination.pageSize,
              sortBy,
              sortDirection,
            })
          : await getFilesInFolder({
              folderId,
              page: pagination.page,
              pageSize: pagination.pageSize,
              sortBy,
              sortDirection,
            })

      applyPaginatedFilesResult(result, requestId, set)
    } catch (error) {
      console.error("Failed to load files in folder:", error)
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  searchFiles: async (query) => {
    await get().filterFiles({ naturalLanguageQuery: query })
  },

  runCurrentQuery: async (folderIdOverride) => {
    const { searchQuery, selectedFolderId } = get()
    const criteria = useFilterStore.getState().criteria
    const folderId = folderIdOverride !== undefined ? folderIdOverride : selectedFolderId

    if (hasStructuredFilters(criteria)) {
      await get().filterFiles({
        naturalLanguageQuery: searchQuery || undefined,
        folderId,
      })
      return
    }

    if (searchQuery.trim()) {
      await get().filterFiles({
        naturalLanguageQuery: searchQuery,
        folderId,
      })
      return
    }

    await get().loadFilesInFolder(folderId)
  },

  filterFiles: async (filter) => {
    const { pagination } = get()
    const requestId = ++fileListRequestId
    const criteria = useFilterStore.getState().criteria
    set({ isLoading: true })

    try {
      const result = await filterFilesCommand({
        filter: buildFileFilterPayload({
          criteria,
          fallbackQuery: filter?.query,
          naturalLanguageQuery: filter?.naturalLanguageQuery,
          folderId: filter?.folderId,
        }),
        page: pagination.page,
        pageSize: pagination.pageSize,
      })
      logVisualSearchDebugScores(result, filter?.naturalLanguageQuery)
      applyPaginatedFilesResult(result, requestId, set)
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      console.error("Failed to filter files:", errorMessage)
      const naturalLanguageQuery = filter?.naturalLanguageQuery?.trim()
      if (naturalLanguageQuery) {
        toast.error(errorMessage)
      }
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  addTagToFile: async (fileId, tagId) => {
    await addTagToFileCommand({ fileId, tagId })
    await get().loadFilesInFolder(get().selectedFolderId)
    await useTagStore.getState().loadTags()
  },

  removeTagFromFile: async (fileId, tagId) => {
    await removeTagFromFileCommand({ fileId, tagId })
    await get().loadFilesInFolder(get().selectedFolderId)
    await useTagStore.getState().loadTags()
  },

  updateFileMetadata: async (fileId, rating, description, sourceUrl) => {
    await updateFileMetadata({ fileId, rating, description, sourceUrl })
    const updatedFile = parseFile(await getFile(fileId))
    syncUpdatedFileAcrossStores(updatedFile, set)
  },

  moveFile: async (fileId, targetFolderId) => {
    await moveFile({ fileId, targetFolderId })
    await get().loadFilesInFolder(get().selectedFolderId)
    await refreshFolders()
  },

  moveFiles: async (fileIds, targetFolderId) => {
    await moveFiles({ fileIds, targetFolderId })
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setSelectedFile(null)
    await get().loadFilesInFolder(get().selectedFolderId)
    await refreshFolders()
  },

  copyFiles: async (fileIds, targetFolderId) => {
    await copyFiles({ fileIds, targetFolderId })
    await get().loadFilesInFolder(get().selectedFolderId)
    await refreshFolders()
  },

  extractColor: async (fileId) => {
    const color = await extractColor(fileId)
    const updatedFile = parseFile(await getFile(fileId))
    syncUpdatedFileAcrossStores(updatedFile, set)

    return color
  },

  exportFile: async (fileId) => exportFile(fileId),

  updateFileName: async (fileId, newName) => {
    await updateFileName({ fileId, newName })
    const updatedFile = parseFile(await getFile(fileId))
    syncUpdatedFileAcrossStores(updatedFile, set)
  },

  analyzeFileMetadata: async (fileId, imageDataUrl) => {
    const updatedFile = parseFile(await analyzeFileMetadataCommand(fileId, imageDataUrl))
    syncUpdatedFileAcrossStores(updatedFile, set)
    await useTagStore.getState().loadTags()
    return updatedFile
  },
}))
