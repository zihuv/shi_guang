import { create } from "zustand";
import type { FileItem } from "@/stores/fileTypes";

interface SelectionStore {
  selectedFile: FileItem | null;
  selectedFiles: number[];
  visibleFileIds: number[];
  isDraggingInternal: boolean;
  draggedFileIds: number[];
  draggedPrimaryFileId: number | null;
  currentDragSessionId: string | null;
  dropHandledForSession: boolean;
  setSelectedFile: (file: FileItem | null) => void;
  setSelectedFiles: (fileIds: number[]) => void;
  toggleFileSelection: (fileId: number) => void;
  clearSelection: () => void;
  selectAll: () => void;
  toggleSelectAll: () => void;
  reconcileVisibleSelection: (files: FileItem[]) => void;
  setIsDraggingInternal: (isDragging: boolean) => void;
  beginInternalFileDrag: (fileId: number) => number[];
  markInternalDropHandled: () => boolean;
  clearInternalFileDrag: () => void;
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedFile: null,
  selectedFiles: [],
  visibleFileIds: [],
  isDraggingInternal: false,
  draggedFileIds: [],
  draggedPrimaryFileId: null,
  currentDragSessionId: null,
  dropHandledForSession: false,

  setSelectedFile: (file) => set({ selectedFile: file }),

  setSelectedFiles: (fileIds) => set({ selectedFiles: fileIds }),

  toggleFileSelection: (fileId) => {
    const { selectedFiles } = get();
    if (selectedFiles.includes(fileId)) {
      set({ selectedFiles: selectedFiles.filter((id) => id !== fileId) });
      return;
    }

    set({ selectedFiles: [...selectedFiles, fileId] });
  },

  clearSelection: () => set({ selectedFiles: [] }),

  selectAll: () => {
    set((state) => ({ selectedFiles: state.visibleFileIds, selectedFile: null }));
  },

  toggleSelectAll: () => {
    const { selectedFiles, visibleFileIds } = get();
    if (visibleFileIds.length > 0 && selectedFiles.length === visibleFileIds.length) {
      set({ selectedFiles: [] });
      return;
    }

    set({ selectedFiles: visibleFileIds, selectedFile: null });
  },

  reconcileVisibleSelection: (files) => {
    const { selectedFile, selectedFiles } = get();
    const visibleFileIds = new Set(files.map((file) => file.id));

    set({
      selectedFile: selectedFile ? files.find((file) => file.id === selectedFile.id) || null : null,
      selectedFiles: selectedFiles.filter((fileId) => visibleFileIds.has(fileId)),
      visibleFileIds: files.map((file) => file.id),
    });
  },

  setIsDraggingInternal: (isDragging) => set({ isDraggingInternal: isDragging }),

  beginInternalFileDrag: (fileId) => {
    const { selectedFiles } = get();
    const draggedFileIds = selectedFiles.includes(fileId) ? selectedFiles : [fileId];
    const currentDragSessionId = `${Date.now()}-${fileId}-${Math.random().toString(36).slice(2, 8)}`;

    set({
      isDraggingInternal: true,
      draggedFileIds,
      draggedPrimaryFileId: fileId,
      currentDragSessionId,
      dropHandledForSession: false,
    });

    return draggedFileIds;
  },

  markInternalDropHandled: () => {
    const { currentDragSessionId, dropHandledForSession } = get();
    if (!currentDragSessionId || dropHandledForSession) {
      return false;
    }

    set({ dropHandledForSession: true });
    return true;
  },

  clearInternalFileDrag: () =>
    set({
      isDraggingInternal: false,
      draggedFileIds: [],
      draggedPrimaryFileId: null,
      currentDragSessionId: null,
      dropHandledForSession: false,
    }),
}));
