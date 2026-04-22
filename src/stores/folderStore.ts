import { create } from "zustand";
import {
  createFolder,
  deleteFolder,
  getFolderTree,
  initDefaultFolder,
  moveFolder as moveFolderDesktop,
  reorderFolders as reorderFoldersDesktop,
  renameFolder,
  type FolderSummary,
} from "@/services/desktop/folders";
import { useLibraryQueryStore } from "./libraryQueryStore";
import { useSmartCollectionStore } from "./smartCollectionStore";

export interface FolderNode {
  id: number;
  name: string;
  path: string;
  children: FolderNode[];
  fileCount: number;
  isSystem?: boolean;
  sortOrder?: number;
  parentId?: number | null;
}

const removeHiddenFolders = (folders: FolderNode[]): FolderNode[] =>
  folders
    .filter((folder) => !folder.name.startsWith("."))
    .map((folder) => ({
      ...folder,
      children: removeHiddenFolders(folder.children || []),
    }));

interface FolderStore {
  folders: FolderNode[];
  selectedFolderId: number | null;
  expandedFolderIds: number[];
  isLoading: boolean;
  newFolderName: string;
  addingSubfolder: FolderNode | null;
  editingFolder: FolderNode | null;
  deleteConfirm: FolderNode | null;
  dragOverFolderId: number | null;
  uniqueContextId: string;
  loadFolders: () => Promise<void>;
  initDefaultFolder: () => Promise<FolderSummary | null>;
  selectFolder: (folderId: number | null) => void;
  toggleFolder: (folderId: number) => void;
  createFolder: (name: string, parentId: number | null) => Promise<void>;
  deleteFolder: (id: number) => Promise<void>;
  renameFolder: (id: number, name: string) => Promise<void>;
  moveFile: (fileId: number, targetFolderId: number | null) => Promise<void>;
  moveFolder: (
    folderId: number,
    newParentId: number | null,
    options?: {
      sortOrder?: number;
      sourceSiblingIds?: number[];
      targetSiblingIds?: number[];
    },
  ) => Promise<void>;
  reorderFolders: (folderIds: number[]) => Promise<void>;
  setFolders: (folders: FolderNode[]) => void;
  setNewFolderName: (name: string) => void;
  setAddingSubfolder: (folder: FolderNode | null) => void;
  setEditingFolder: (folder: FolderNode | null) => void;
  setDeleteConfirm: (folder: FolderNode | null) => void;
  setDragOverFolderId: (folderId: number | null) => void;
}

let loadFoldersRequestId = 0;

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  selectedFolderId: null,
  expandedFolderIds: [],
  isLoading: false,
  newFolderName: "",
  addingSubfolder: null,
  editingFolder: null,
  deleteConfirm: null,
  dragOverFolderId: null,
  uniqueContextId: "shiguang-folder-tree-context",

  setDragOverFolderId: (folderId) => set({ dragOverFolderId: folderId }),

  setFolders: (folders) => set({ folders }),

  loadFolders: async () => {
    const requestId = ++loadFoldersRequestId;
    set({ isLoading: true });
    try {
      const folders = await getFolderTree();
      if (requestId !== loadFoldersRequestId) {
        return;
      }
      set({ folders: removeHiddenFolders(folders), isLoading: false });
    } catch (e) {
      console.error("Failed to load folders:", e);
      if (requestId === loadFoldersRequestId) {
        set({ isLoading: false });
      }
    }
  },

  initDefaultFolder: async () => {
    try {
      const folder = await initDefaultFolder();
      if (!folder) {
        return null;
      }
      set({ selectedFolderId: folder.id });
      return folder;
    } catch (e) {
      console.error("Failed to init default folder:", e);
      return null;
    }
  },

  selectFolder: (folderId) => {
    set({ selectedFolderId: folderId });
  },

  toggleFolder: (folderId) => {
    const { expandedFolderIds } = get();
    if (expandedFolderIds.includes(folderId)) {
      set({ expandedFolderIds: expandedFolderIds.filter((id) => id !== folderId) });
    } else {
      set({ expandedFolderIds: [...expandedFolderIds, folderId] });
    }
  },

  createFolder: async (name, parentId) => {
    try {
      await createFolder({ name, parentId });
      await get().loadFolders();
    } catch (e) {
      console.error("Failed to create folder:", e);
    }
  },

  deleteFolder: async (id) => {
    try {
      await deleteFolder(id);
      await get().loadFolders();
      await useSmartCollectionStore.getState().loadStats();
    } catch (e) {
      console.error("Failed to delete folder:", e);
    }
  },

  renameFolder: async (id, name) => {
    try {
      await renameFolder({ id, name });
      await get().loadFolders();
    } catch (e) {
      console.error("Failed to rename folder:", e);
    }
  },

  moveFile: async (fileId, targetFolderId) => {
    try {
      await useLibraryQueryStore.getState().moveFile(fileId, targetFolderId);
      await get().loadFolders();
    } catch (e) {
      console.error("Failed to move file:", e);
    }
  },

  moveFolder: async (folderId, newParentId, options) => {
    try {
      await moveFolderDesktop({
        folderId,
        newParentId,
        sortOrder: options?.sortOrder ?? 0,
      });
      if (options?.sourceSiblingIds && options.sourceSiblingIds.length > 0) {
        await reorderFoldersDesktop(options.sourceSiblingIds);
      }
      if (options?.targetSiblingIds && options.targetSiblingIds.length > 0) {
        await reorderFoldersDesktop(options.targetSiblingIds);
      }
      await get().loadFolders();
      // Reload files to reflect the new paths after folder move
      const libraryStore = useLibraryQueryStore.getState();
      await libraryStore.loadFilesInFolder(libraryStore.selectedFolderId);
    } catch (e) {
      console.error("Failed to move folder:", e);
    }
  },

  reorderFolders: async (folderIds) => {
    try {
      await reorderFoldersDesktop(folderIds);
      // Reload folders to reflect the new order
      await get().loadFolders();
    } catch (e) {
      console.error("Failed to reorder folders:", e);
    }
  },

  setNewFolderName: (name) => set({ newFolderName: name }),

  setAddingSubfolder: (folder) => set({ addingSubfolder: folder }),

  setEditingFolder: (folder) => set({ editingFolder: folder, newFolderName: folder?.name || "" }),

  setDeleteConfirm: (folder) => set({ deleteConfirm: folder }),
}));
