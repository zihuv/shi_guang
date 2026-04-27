import { toast } from "sonner";
import { create } from "zustand";
import {
  deleteFile,
  deleteFiles,
  emptyTrash,
  getTrashCount,
  getTrashItems,
  permanentDeleteFile,
  permanentDeleteFiles,
  permanentDeleteFolder,
  permanentDeleteFolders,
  restoreFile,
  restoreFiles,
  restoreFolder,
  restoreFolders,
  type RestoreFilesResult,
} from "@/services/desktop/trash";
import { parseTrashItemList, type TrashItem } from "@/stores/fileTypes";
import { type FolderNode, useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSmartCollectionStore } from "@/stores/smartCollectionStore";

interface FileDeleteUndoAction {
  type: "delete";
  fileIds: number[];
  timestamp: number;
}

interface FolderDeleteUndoAction {
  type: "delete_folder";
  folderId: number;
  folderName: string;
  folderPath: string;
  shouldSelectOnUndo: boolean;
  timestamp: number;
}

type UndoAction = FileDeleteUndoAction | FolderDeleteUndoAction;

interface TrashStore {
  trashItems: TrashItem[];
  trashCount: number;
  undoStack: UndoAction[];
  addFileDeleteToUndoStack: (fileIds: number[]) => Promise<void>;
  addFolderDeleteToUndoStack: (action: {
    folderId: number;
    folderName: string;
    folderPath: string;
    shouldSelectOnUndo: boolean;
  }) => Promise<void>;
  undo: () => Promise<void>;
  clearUndoStack: () => Promise<void>;
  deleteFile: (fileId: number) => Promise<void>;
  deleteFiles: (fileIds: number[]) => Promise<void>;
  loadTrashItems: () => Promise<void>;
  restoreFile: (fileId: number) => Promise<void>;
  restoreFiles: (fileIds: number[]) => Promise<void>;
  restoreFolder: (folderId: number) => Promise<void>;
  restoreFolders: (folderIds: number[]) => Promise<void>;
  permanentDeleteFile: (fileId: number) => Promise<void>;
  permanentDeleteFiles: (fileIds: number[]) => Promise<void>;
  permanentDeleteFolder: (folderId: number) => Promise<void>;
  permanentDeleteFolders: (folderIds: number[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
  loadTrashCount: () => Promise<void>;
}

async function refreshCurrentLibraryState() {
  await useFolderStore.getState().loadFolders();
  const libraryStore = useLibraryQueryStore.getState();
  await libraryStore.runCurrentQuery(libraryStore.selectedFolderId);
  await useSmartCollectionStore.getState().loadStats();
}

function findFolderByPath(folders: FolderNode[], folderPath: string): FolderNode | null {
  for (const folder of folders) {
    if (folder.path === folderPath) {
      return folder;
    }
    const nested = findFolderByPath(folder.children, folderPath);
    if (nested) {
      return nested;
    }
  }
  return null;
}

async function refreshAfterRestoreFolder(restoredPath: string, shouldSelectOnUndo: boolean) {
  await useFolderStore.getState().loadFolders();
  await useSmartCollectionStore.getState().loadStats();
  const libraryStore = useLibraryQueryStore.getState();
  const folderStore = useFolderStore.getState();

  if (shouldSelectOnUndo) {
    const restoredFolder = findFolderByPath(folderStore.folders, restoredPath);
    if (restoredFolder) {
      folderStore.selectFolder(restoredFolder.id);
      libraryStore.setSelectedFolderId(restoredFolder.id);
      await libraryStore.loadFilesInFolder(restoredFolder.id);
      return;
    }
  }

  await libraryStore.runCurrentQuery(libraryStore.selectedFolderId);
}

function notifyRestoreResult(result: RestoreFilesResult, restoredCount: number) {
  if (result.movedToUnclassifiedCount <= 0) {
    return;
  }
  if (restoredCount === 1) {
    toast.success("原文件夹不存在，已恢复到未分类。");
    return;
  }
  toast.success(`${result.movedToUnclassifiedCount} 个文件因原文件夹不存在，已恢复到未分类。`);
}

async function refreshTrashState(store: TrashStore) {
  await store.loadTrashItems();
  await store.loadTrashCount();
}

export const useTrashStore = create<TrashStore>((set, get) => ({
  trashItems: [],
  trashCount: 0,
  undoStack: [],

  addFileDeleteToUndoStack: async (fileIds) => {
    const { undoStack } = get();
    const nextStack = [...undoStack, { type: "delete" as const, fileIds, timestamp: Date.now() }];
    set({ undoStack: nextStack.slice(-50) });
  },

  addFolderDeleteToUndoStack: async ({ folderId, folderName, folderPath, shouldSelectOnUndo }) => {
    const { undoStack } = get();
    const nextStack = [
      ...undoStack,
      {
        type: "delete_folder" as const,
        folderId,
        folderName,
        folderPath,
        shouldSelectOnUndo,
        timestamp: Date.now(),
      },
    ];
    set({ undoStack: nextStack.slice(-50) });
  },

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) {
      return;
    }

    const lastAction = undoStack[undoStack.length - 1];
    if (lastAction.type === "delete") {
      const result = await restoreFiles(lastAction.fileIds);
      notifyRestoreResult(result, lastAction.fileIds.length);
      await refreshCurrentLibraryState();
      await refreshTrashState(get());
    } else {
      const result = await restoreFolder(lastAction.folderId);
      await refreshAfterRestoreFolder(result.restoredPath, lastAction.shouldSelectOnUndo);
      await refreshTrashState(get());
      toast.success(
        result.restoredPath === result.originalPath
          ? `已恢复文件夹“${lastAction.folderName}”。`
          : `已恢复文件夹“${lastAction.folderName}”，并放回可用位置。`,
      );
    }

    set({ undoStack: undoStack.slice(0, -1) });
  },

  clearUndoStack: async () => {
    set({ undoStack: [] });
  },

  deleteFile: async (fileId) => {
    await deleteFile(fileId);
    await get().addFileDeleteToUndoStack([fileId]);
    useSelectionStore.getState().setSelectedFile(null);
    await refreshCurrentLibraryState();
    await get().loadTrashCount();
  },

  deleteFiles: async (fileIds) => {
    await deleteFiles(fileIds);
    await get().addFileDeleteToUndoStack(fileIds);
    useSelectionStore.getState().clearSelection();
    useSelectionStore.getState().setSelectedFile(null);
    await refreshCurrentLibraryState();
    await get().loadTrashCount();
  },

  loadTrashItems: async () => {
    try {
      const items = await getTrashItems();
      set({ trashItems: parseTrashItemList(items) });
    } catch (error) {
      console.error("Failed to load trash items:", error);
    }
  },

  restoreFile: async (fileId) => {
    const result = await restoreFile(fileId);
    notifyRestoreResult(result, 1);
    await refreshCurrentLibraryState();
    await refreshTrashState(get());
  },

  restoreFiles: async (fileIds) => {
    const result = await restoreFiles(fileIds);
    notifyRestoreResult(result, fileIds.length);
    await refreshCurrentLibraryState();
    await refreshTrashState(get());
  },

  restoreFolder: async (folderId) => {
    const result = await restoreFolder(folderId);
    await refreshAfterRestoreFolder(result.restoredPath, false);
    await refreshTrashState(get());
  },

  restoreFolders: async (folderIds) => {
    const results = await restoreFolders(folderIds);
    const lastResult = results.length > 0 ? results[results.length - 1] : null;
    if (lastResult) {
      await refreshAfterRestoreFolder(lastResult.restoredPath, false);
    } else {
      await refreshCurrentLibraryState();
    }
    await refreshTrashState(get());
  },

  permanentDeleteFile: async (fileId) => {
    await permanentDeleteFile(fileId);
    await refreshTrashState(get());
    await useSmartCollectionStore.getState().loadStats();
  },

  permanentDeleteFiles: async (fileIds) => {
    await permanentDeleteFiles(fileIds);
    await refreshTrashState(get());
    await useSmartCollectionStore.getState().loadStats();
  },

  permanentDeleteFolder: async (folderId) => {
    await permanentDeleteFolder(folderId);
    await refreshTrashState(get());
    await refreshCurrentLibraryState();
  },

  permanentDeleteFolders: async (folderIds) => {
    await permanentDeleteFolders(folderIds);
    await refreshTrashState(get());
    await refreshCurrentLibraryState();
  },

  emptyTrash: async () => {
    await emptyTrash();
    await refreshTrashState(get());
    await refreshCurrentLibraryState();
  },

  loadTrashCount: async () => {
    try {
      const count = await getTrashCount();
      set({ trashCount: count });
    } catch (error) {
      console.error("Failed to load trash count:", error);
    }
  },
}));
