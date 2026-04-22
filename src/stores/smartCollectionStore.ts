import { create } from "zustand";
import { getSmartCollectionStats } from "@/services/desktop/files";
import type { SmartCollectionStats } from "@/stores/fileTypes";

const EMPTY_STATS: SmartCollectionStats = {
  allCount: 0,
  unclassifiedCount: 0,
  untaggedCount: 0,
};

interface SmartCollectionStore {
  stats: SmartCollectionStats;
  isLoading: boolean;
  loadStats: () => Promise<void>;
}

export const useSmartCollectionStore = create<SmartCollectionStore>((set) => ({
  stats: EMPTY_STATS,
  isLoading: false,

  loadStats: async () => {
    set({ isLoading: true });
    try {
      const stats = await getSmartCollectionStats();
      set({ stats, isLoading: false });
    } catch (error) {
      console.error("Failed to load smart collection stats:", error);
      set({ isLoading: false });
    }
  },
}));
