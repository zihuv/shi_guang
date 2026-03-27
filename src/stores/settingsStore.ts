import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SHORTCUTS, resolveShortcuts, type ShortcutActionId, type ShortcutConfig } from "@/lib/shortcuts";
import { useFolderStore } from "@/stores/folderStore";
import { useFileStore } from "@/stores/fileStore";

const SHORTCUTS_SETTING_KEY = "shortcuts";

const loadFilesInCurrentFolder = async () => {
  const selectedFolderId = useFolderStore.getState().selectedFolderId;
  if (selectedFolderId) {
    await useFileStore.getState().loadFilesInFolder(selectedFolderId);
  }
};

interface Settings {
  theme: "light" | "dark";
  indexPaths: string[];
  useTrash: boolean;
  shortcuts: ShortcutConfig;
}

interface SettingsStore extends Settings {
  setTheme: (theme: "light" | "dark") => Promise<void>;
  addIndexPath: (path: string) => Promise<void>;
  removeIndexPath: (path: string) => Promise<void>;
  setDeleteMode: (useTrash: boolean) => Promise<void>;
  setShortcut: (actionId: ShortcutActionId, shortcut: string) => Promise<void>;
  resetShortcut: (actionId: ShortcutActionId) => Promise<void>;
  loadSettings: () => Promise<void>;
  rebuildIndex: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: "light",
  indexPaths: [],
  useTrash: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },

  setTheme: async (theme) => {
    await invoke("set_setting", { key: "theme", value: theme });
    set({ theme });
  },

  setDeleteMode: async (useTrash: boolean) => {
    await invoke("set_delete_mode", { useTrash });
    set({ useTrash });
  },

  setShortcut: async (actionId, shortcut) => {
    const nextShortcuts = {
      ...get().shortcuts,
      [actionId]: shortcut,
    };
    await invoke("set_setting", {
      key: SHORTCUTS_SETTING_KEY,
      value: JSON.stringify(nextShortcuts),
    });
    set({ shortcuts: nextShortcuts });
  },

  resetShortcut: async (actionId) => {
    await get().setShortcut(actionId, DEFAULT_SHORTCUTS[actionId]);
  },

  addIndexPath: async (path) => {
    await invoke("add_index_path", { path });
    const paths = await invoke<string[]>("get_index_paths");
    set({ indexPaths: paths });
    await invoke("sync_index_path", { path });
    // Reload folders and files in UI
    useFolderStore.getState().loadFolders();
    loadFilesInCurrentFolder();
  },

  removeIndexPath: async (path) => {
    await invoke("remove_index_path", { path });
    const paths = await invoke<string[]>("get_index_paths");
    set({ indexPaths: paths });
  },

  loadSettings: async () => {
    let theme: "light" | "dark" = "light";
    let indexPaths: string[] = [];
    let useTrash: boolean = true;
    let shortcuts = { ...DEFAULT_SHORTCUTS };

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

    // Get delete mode
    try {
      useTrash = await invoke<boolean>("get_delete_mode");
    } catch (e) {
      console.error("Failed to load delete mode:", e);
    }

    // Get index paths
    try {
      indexPaths = await invoke<string[]>("get_index_paths");
    } catch (e) {
      console.error("Failed to load index paths:", e);
    }

    try {
      const shortcutsValue = await invoke<string>("get_setting", { key: SHORTCUTS_SETTING_KEY });
      shortcuts = resolveShortcuts(JSON.parse(shortcutsValue) as Partial<Record<ShortcutActionId, string | null>>);
    } catch (e) {
      const errorMsg = String(e);
      if (!errorMsg.includes("Setting not found")) {
        console.error("Failed to load shortcuts:", e);
      }
    }

    // If no index paths configured, add default path (user's Pictures/shiguang folder)
    if (!indexPaths || indexPaths.length === 0) {
      try {
        const defaultPath = await invoke<string>("get_default_index_path");
        await invoke("add_index_path", { path: defaultPath });
        indexPaths = [defaultPath];
        await invoke("sync_index_path", { path: defaultPath });
        // Reload folders and files in UI
        useFolderStore.getState().loadFolders();
        loadFilesInCurrentFolder();
      } catch (e) {
        console.error("Failed to add default index path:", e);
      }
    }

    set({
      theme,
      indexPaths: indexPaths || [],
      useTrash,
      shortcuts,
    });
  },

  rebuildIndex: async () => {
    await invoke("rebuild_library_index");
    await invoke("scan_folders");
    await useFolderStore.getState().loadFolders();
    await loadFilesInCurrentFolder();
  },
}));
