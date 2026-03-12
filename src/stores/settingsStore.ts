import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useFolderStore } from "@/stores/folderStore";
import { useFileStore } from "@/stores/fileStore";

interface Settings {
  theme: "light" | "dark";
  indexPaths: string[];
}

interface SettingsStore extends Settings {
  setTheme: (theme: "light" | "dark") => Promise<void>;
  addIndexPath: (path: string) => Promise<void>;
  removeIndexPath: (path: string) => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "light",
  indexPaths: [],

  setTheme: async (theme) => {
    await invoke("set_setting", { key: "theme", value: theme });
    set({ theme });
  },

  addIndexPath: async (path) => {
    await invoke("add_index_path", { path });
    const paths = await invoke<string[]>("get_index_paths");
    set({ indexPaths: paths });
    // Trigger file reindex and folder scan
    await invoke("reindex_all");
    await invoke("scan_folders");
    // Reload folders and files in UI
    useFolderStore.getState().loadFolders();
    useFileStore.getState().loadFiles();
  },

  removeIndexPath: async (path) => {
    await invoke("remove_index_path", { path });
    const paths = await invoke<string[]>("get_index_paths");
    set({ indexPaths: paths });
  },

  loadSettings: async () => {
    let theme: "light" | "dark" = "light";
    let indexPaths: string[] = [];

    // Get theme
    try {
      const themeValue = await invoke<string>("get_setting", { key: "theme" });
      theme = (themeValue as "light" | "dark") || "light";
    } catch (e) {
      // Silently handle "Setting not found" - first run has no settings
      const errorMsg = String(e);
      if (!errorMsg.includes("Setting not found")) {
        console.error("Failed to load theme:", e);
      }
    }

    // Get index paths
    try {
      indexPaths = await invoke<string[]>("get_index_paths");
    } catch (e) {
      console.error("Failed to load index paths:", e);
    }

    // If no index paths configured, add default path (user's Pictures/shiguang folder)
    if (!indexPaths || indexPaths.length === 0) {
      try {
        const defaultPath = await invoke<string>("get_default_index_path");
        await invoke("add_index_path", { path: defaultPath });
        indexPaths = [defaultPath];
        // Trigger file scan and folder scan
        await invoke("reindex_all");
        await invoke("scan_folders");
        // Reload folders and files in UI
        useFolderStore.getState().loadFolders();
        useFileStore.getState().loadFiles();
      } catch (e) {
        console.error("Failed to add default index path:", e);
      }
    } else {
      // Even if index paths exist, trigger reindex to ensure files are indexed
      try {
        await invoke("reindex_all");
        await invoke("scan_folders");
        useFolderStore.getState().loadFolders();
        useFileStore.getState().loadFiles();
      } catch (e) {
        console.error("Failed to reindex:", e);
      }
    }

    set({
      theme,
      indexPaths: indexPaths || [],
    });
  },
}));
