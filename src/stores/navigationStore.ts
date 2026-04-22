import { create } from "zustand";
import type { SmartCollectionId } from "@/stores/fileTypes";

export type AppView = "library" | "tags" | "trash";

interface NavigationStore {
  currentView: AppView;
  activeSmartCollection: SmartCollectionId | null;
  randomSeed: number;
  setCurrentView: (view: AppView) => void;
  openLibrary: (smartCollection?: SmartCollectionId | null) => void;
  openSmartCollection: (smartCollection: SmartCollectionId) => void;
  clearSmartCollection: () => void;
  openTags: () => void;
  openTrash: () => void;
}

function nextRandomSeed(previousSeed: number) {
  const candidate = Date.now() + Math.floor(Math.random() * 1000000);
  return candidate === previousSeed ? candidate + 1 : candidate;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  currentView: "library",
  activeSmartCollection: null,
  randomSeed: Date.now(),

  setCurrentView: (view) => set({ currentView: view }),

  openLibrary: (smartCollection = null) =>
    set((state) => ({
      currentView: "library",
      activeSmartCollection: smartCollection,
      randomSeed: smartCollection === "random" ? nextRandomSeed(state.randomSeed) : state.randomSeed,
    })),

  openSmartCollection: (smartCollection) =>
    set((state) => ({
      currentView: "library",
      activeSmartCollection: smartCollection,
      randomSeed: smartCollection === "random" ? nextRandomSeed(state.randomSeed) : state.randomSeed,
    })),

  clearSmartCollection: () => set({ activeSmartCollection: null }),

  openTags: () => set({ currentView: "tags" }),

  openTrash: () => set({ currentView: "trash" }),
}));
