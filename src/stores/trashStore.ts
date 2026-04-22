import { create } from "zustand";
import {
  deleteFile,
  deleteFiles,
  emptyTrash,
  getTrashCount,
  getTrashFiles,
  permanentDeleteFile,
  permanentDeleteFiles,
  restoreFile,
  restoreFiles,
} from "@/services/desktop/trash";
import { parseFileList, type FileItem } from "@/stores/fileTypes";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSmartCollectionStore } from "@/stores/smartCollectionStore";

interface UndoAction {
  type: "delete";
  fileIds: number[];
  timestamp: number;
}

interface TrashStore {
  trashFiles: FileItem[];
  trashCount: number;
  undoStack: UndoAction[];
  addToUndoStack: (fileIds: number[]) => void;
  undo: () => Promise<void>;
  clearUndoStack: () => void;
  deleteFile: (fileId: number) => Promise<void>;
  deleteFiles: (fileIds: number[]) => Promise<void>;
  loadTrashFiles: () => Promise<void>;
  restoreFile: (fileId: number) => Promise<void>;
  restoreFiles: (fileIds: number[]) => Promise<void>;
  permanentDeleteFile: (fileId: number) => Promise<void>;
  permanentDeleteFiles: (fileIds: number[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
  loadTrashCount: () => Promise<void>;
}

async function refreshCurrentLibraryState() {
  const selectedFolderId = useLibraryQueryStore.getState().selectedFolderId;
  await useLibraryQueryStore.getState().loadFilesInFolder(selectedFolderId);
  await useFolderStore.getState().loadFolders();
  await useSmartCollectionStore.getState().loadStats();
}

export const useTrashStore = create<TrashStore>((set, get) => ({
  trashFiles: [],
  trashCount: 0,
  undoStack: [],

  addToUndoStack: (fileIds) => {
    const { undoStack } = get();
    const nextStack = [...undoStack, { type: "delete" as const, fileIds, timestamp: Date.now() }];
    if (nextStack.length > 50) {
      nextStack.shift();
    }
    set({ undoStack: nextStack });
  },

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) {
      return;
    }

    const lastAction = undoStack[undoStack.length - 1];
    if (lastAction.type === "delete") {
      await restoreFiles(lastAction.fileIds);
      await refreshCurrentLibraryState();
      await get().loadTrashCount();
    }

    set({ undoStack: undoStack.slice(0, -1) });
  },

  clearUndoStack: () => set({ undoStack: [] }),

  deleteFile: async (fileId) => {
    await deleteFile(fileId);
    get().addToUndoStack([fileId]);
    useSelectionStore.getState().setSelectedFile(null);
    await refreshCurrentLibraryState();
    await get().loadTrashCount();
  },

  deleteFiles: async (fileIds) => {
    await deleteFiles(fileIds);
    get().addToUndoStack(fileIds);
    useSelectionStore.getState().clearSelection();
    useSelectionStore.getState().setSelectedFile(null);
    await refreshCurrentLibraryState();
    await get().loadTrashCount();
  },

  loadTrashFiles: async () => {
    try {
      const files = await getTrashFiles();
      set({ trashFiles: parseFileList(files) });
    } catch (error) {
      console.error("Failed to load trash files:", error);
    }
  },

  restoreFile: async (fileId) => {
    await restoreFile(fileId);
    await get().loadTrashFiles();
    await get().loadTrashCount();
    await refreshCurrentLibraryState();
  },

  restoreFiles: async (fileIds) => {
    await restoreFiles(fileIds);
    await get().loadTrashFiles();
    await get().loadTrashCount();
    await refreshCurrentLibraryState();
  },

  permanentDeleteFile: async (fileId) => {
    await permanentDeleteFile(fileId);
    await get().loadTrashFiles();
    await get().loadTrashCount();
    await useSmartCollectionStore.getState().loadStats();
  },

  permanentDeleteFiles: async (fileIds) => {
    await permanentDeleteFiles(fileIds);
    await get().loadTrashFiles();
    await get().loadTrashCount();
    await useSmartCollectionStore.getState().loadStats();
  },

  emptyTrash: async () => {
    await emptyTrash();
    await get().loadTrashFiles();
    await get().loadTrashCount();
    await useSmartCollectionStore.getState().loadStats();
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
