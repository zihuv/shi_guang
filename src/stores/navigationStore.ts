import { create } from "zustand";

export type AppView = "library" | "tags" | "trash";

interface NavigationStore {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  openLibrary: () => void;
  openTags: () => void;
  openTrash: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  currentView: "library",

  setCurrentView: (view) => set({ currentView: view }),

  openLibrary: () => set({ currentView: "library" }),

  openTags: () => set({ currentView: "tags" }),

  openTrash: () => set({ currentView: "trash" }),
}));
