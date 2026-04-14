import { create } from "zustand";

interface ThumbnailRefreshStore {
  fileVersions: Record<number, number>;
  bumpFileVersion: (fileId: number) => void;
}

export const useThumbnailRefreshStore = create<ThumbnailRefreshStore>((set) => ({
  fileVersions: {},
  bumpFileVersion: (fileId) =>
    set((state) => ({
      fileVersions: {
        ...state.fileVersions,
        [fileId]: (state.fileVersions[fileId] ?? 0) + 1,
      },
    })),
}));
