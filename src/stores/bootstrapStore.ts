import { create } from "zustand";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTagStore } from "@/stores/tagStore";
import { useTrashStore } from "@/stores/trashStore";
import { useFilterStore } from "@/stores/filterStore";
import { getLastSelectedFolderId } from "@/services/desktop/indexing";
import type { FolderNode } from "@/stores/folderStore";

interface BootstrapStore {
  hasBootstrapped: boolean;
  isBootstrapping: boolean;
  bootstrapError: string | null;
  bootstrap: () => Promise<void>;
}

function hasFolderId(nodes: FolderNode[], folderId: number): boolean {
  for (const node of nodes) {
    if (node.id === folderId) {
      return true;
    }

    if (node.children.length > 0 && hasFolderId(node.children, folderId)) {
      return true;
    }
  }

  return false;
}

export const useBootstrapStore = create<BootstrapStore>((set, get) => ({
  hasBootstrapped: false,
  isBootstrapping: false,
  bootstrapError: null,

  bootstrap: async () => {
    if (get().hasBootstrapped || get().isBootstrapping) {
      return;
    }

    set({ isBootstrapping: true, bootstrapError: null });

    try {
      await useSettingsStore.getState().loadSettings();
      await useFilterStore.getState().loadPreferences();
      await useTagStore.getState().loadTags();
      await useFolderStore.getState().loadFolders();
      await useTrashStore.getState().loadTrashCount();

      const folderStore = useFolderStore.getState();
      const libraryStore = useLibraryQueryStore.getState();
      const persistedFolderId = await getLastSelectedFolderId();
      const initialFolderId =
        persistedFolderId !== null && hasFolderId(folderStore.folders, persistedFolderId)
          ? persistedFolderId
          : ((await folderStore.initDefaultFolder())?.id ?? null);

      if (initialFolderId !== null) {
        folderStore.selectFolder(initialFolderId);
        libraryStore.setSelectedFolderId(initialFolderId);
        await libraryStore.loadFilesInFolder(initialFolderId);
      } else {
        folderStore.selectFolder(null);
        libraryStore.setSelectedFolderId(null);
        await libraryStore.loadFilesInFolder(null);
      }

      set({ hasBootstrapped: true, isBootstrapping: false });
    } catch (error) {
      const message = String(error);
      console.error("Failed to bootstrap application:", error);
      set({
        isBootstrapping: false,
        bootstrapError: message,
      });
    }
  },
}));
