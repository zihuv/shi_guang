import { create } from "zustand";
import type { FileItem } from "@/stores/fileTypes";

interface PreviewStore {
  previewMode: boolean;
  previewIndex: number;
  previewFiles: FileItem[];
  setPreviewMode: (mode: boolean) => void;
  setPreviewIndex: (index: number) => void;
  setPreviewFiles: (files: FileItem[]) => void;
  openPreview: (index: number, files: FileItem[]) => void;
  closePreview: () => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  previewMode: false,
  previewIndex: 0,
  previewFiles: [],

  setPreviewMode: (mode) => set({ previewMode: mode }),
  setPreviewIndex: (index) => set({ previewIndex: index }),
  setPreviewFiles: (files) => set({ previewFiles: files }),
  openPreview: (index, files) =>
    set({
      previewMode: true,
      previewIndex: index,
      previewFiles: files,
    }),
  closePreview: () =>
    set({
      previewMode: false,
      previewIndex: 0,
      previewFiles: [],
    }),
}));
