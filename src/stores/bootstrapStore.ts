import { create } from "zustand";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTagStore } from "@/stores/tagStore";
import { useTrashStore } from "@/stores/trashStore";
import { useFilterStore } from "@/stores/filterStore";

interface BootstrapStore {
  hasBootstrapped: boolean;
  isBootstrapping: boolean;
  bootstrapError: string | null;
  bootstrap: () => Promise<void>;
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

      const defaultFolder = await useFolderStore.getState().initDefaultFolder();
      if (defaultFolder) {
        useFolderStore.getState().selectFolder(defaultFolder.id);
        useLibraryQueryStore.getState().setSelectedFolderId(defaultFolder.id);
        await useLibraryQueryStore.getState().loadFilesInFolder(defaultFolder.id);
      } else {
        await useLibraryQueryStore.getState().loadFiles();
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
