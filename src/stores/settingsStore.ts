import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SHORTCUTS, resolveShortcuts, type ShortcutActionId, type ShortcutConfig } from "@/lib/shortcuts";
import { useFolderStore } from "@/stores/folderStore";
import { useFileStore } from "@/stores/fileStore";

const SHORTCUTS_SETTING_KEY = "shortcuts";
const PREVIEW_TRACKPAD_ZOOM_SPEED_SETTING_KEY = "previewTrackpadZoomSpeed";
const LIBRARY_VIEW_PREFERENCES_SETTING_KEY = "libraryViewPreferences";
const PANEL_LAYOUT_SETTING_KEY = "panelLayout";

export type LibraryViewMode = "grid" | "list" | "adaptive";
export type LibraryVisibleField = "name" | "ext" | "size" | "dimensions" | "tags";
const LIBRARY_VISIBLE_FIELDS_VERSION = 2;

export const DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED = 1;
export const PREVIEW_TRACKPAD_ZOOM_SPEED_MIN = 0.2;
export const PREVIEW_TRACKPAD_ZOOM_SPEED_MAX = 3;
export const PREVIEW_TRACKPAD_ZOOM_SPEED_STEP = 0.1;
export const DEFAULT_LIBRARY_VIEW_MODE: LibraryViewMode = "grid";
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_DETAIL_PANEL_WIDTH = 288;
export const MIN_SIDEBAR_WIDTH = 120;
export const MAX_SIDEBAR_WIDTH = 420;
export const MIN_DETAIL_PANEL_WIDTH = 160;
export const MAX_DETAIL_PANEL_WIDTH = 560;
export const DEFAULT_LIBRARY_VISIBLE_FIELDS: LibraryVisibleField[] = [
  "name",
  "ext",
  "size",
  "dimensions",
  "tags",
];
export const LIBRARY_VIEW_SCALE_STEP = 0.02;
const SHARED_TILE_VIEW_SCALE_MIN = 0.5;
const SHARED_TILE_VIEW_SCALE_MAX = 1.8;
export const DEFAULT_LIBRARY_VIEW_SCALES: Record<LibraryViewMode, number> = {
  grid: 1,
  list: 1,
  adaptive: 1,
};

const LIBRARY_VIEW_SCALE_LIMITS: Record<
  LibraryViewMode,
  { min: number; max: number }
> = {
  grid: { min: SHARED_TILE_VIEW_SCALE_MIN, max: SHARED_TILE_VIEW_SCALE_MAX },
  list: { min: 0.82, max: 1.8 },
  adaptive: { min: SHARED_TILE_VIEW_SCALE_MIN, max: SHARED_TILE_VIEW_SCALE_MAX },
};

let libraryViewPreferencesPersistTimer: ReturnType<typeof setTimeout> | null =
  null;
let panelLayoutPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function clampPreviewTrackpadZoomSpeed(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED;
  }

  const clamped = Math.max(
    PREVIEW_TRACKPAD_ZOOM_SPEED_MIN,
    Math.min(PREVIEW_TRACKPAD_ZOOM_SPEED_MAX, value),
  );
  return Number(
    (
      Math.round(clamped / PREVIEW_TRACKPAD_ZOOM_SPEED_STEP) * PREVIEW_TRACKPAD_ZOOM_SPEED_STEP
    ).toFixed(1),
  );
}

function isLibraryViewMode(value: unknown): value is LibraryViewMode {
  return value === "grid" || value === "list" || value === "adaptive";
}

function isLibraryVisibleField(value: unknown): value is LibraryVisibleField {
  return value === "name" || value === "ext" || value === "size" || value === "dimensions" || value === "tags";
}

function isSharedTileViewMode(viewMode: LibraryViewMode) {
  return viewMode === "grid" || viewMode === "adaptive";
}

export function clampLibraryViewScale(
  viewMode: LibraryViewMode,
  value: number,
) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIBRARY_VIEW_SCALES[viewMode];
  }

  const limits = LIBRARY_VIEW_SCALE_LIMITS[viewMode];
  const clamped = Math.max(limits.min, Math.min(limits.max, value));
  return Number(
    (Math.round(clamped / LIBRARY_VIEW_SCALE_STEP) * LIBRARY_VIEW_SCALE_STEP).toFixed(2),
  );
}

export function getLibraryViewScaleRange(viewMode: LibraryViewMode) {
  return LIBRARY_VIEW_SCALE_LIMITS[viewMode];
}

export function clampSidebarWidth(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.round(
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value)),
  );
}

export function clampDetailPanelWidth(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_DETAIL_PANEL_WIDTH;
  }

  return Math.round(
    Math.max(MIN_DETAIL_PANEL_WIDTH, Math.min(MAX_DETAIL_PANEL_WIDTH, value)),
  );
}

function resolveLibraryViewScales(
  value?: Partial<Record<LibraryViewMode, unknown>>,
) {
  const tileScaleSource =
    value?.grid !== undefined ? Number(value.grid) : Number(value?.adaptive);
  const tileScale = clampLibraryViewScale("grid", tileScaleSource);

  return {
    grid: tileScale,
    list: clampLibraryViewScale("list", Number(value?.list)),
    adaptive: tileScale,
  };
}

function resolveLibraryVisibleFields(value: unknown, version?: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_LIBRARY_VISIBLE_FIELDS];
  }

  const fields = value.filter(isLibraryVisibleField);
  if (version === LIBRARY_VISIBLE_FIELDS_VERSION) {
    return [...fields];
  }

  if (!fields.includes("tags")) {
    fields.push("tags");
  }
  return [...fields];
}

function serializeLibraryViewPreferences(
  mode: LibraryViewMode,
  scales: Record<LibraryViewMode, number>,
  visibleFields: LibraryVisibleField[],
) {
  return JSON.stringify({
    mode,
    scales,
    visibleFields,
    visibleFieldsVersion: LIBRARY_VISIBLE_FIELDS_VERSION,
  });
}

function scheduleLibraryViewPreferencesPersist(
  get: () => {
    libraryViewMode: LibraryViewMode;
    libraryViewScales: Record<LibraryViewMode, number>;
    libraryVisibleFields: LibraryVisibleField[];
  },
) {
  if (libraryViewPreferencesPersistTimer) {
    clearTimeout(libraryViewPreferencesPersistTimer);
  }

  libraryViewPreferencesPersistTimer = setTimeout(() => {
    const { libraryViewMode, libraryViewScales, libraryVisibleFields } = get();
    void invoke("set_setting", {
      key: LIBRARY_VIEW_PREFERENCES_SETTING_KEY,
      value: serializeLibraryViewPreferences(
        libraryViewMode,
        libraryViewScales,
        libraryVisibleFields,
      ),
    }).catch((error) => {
      console.error("Failed to persist library view preferences:", error);
    });
  }, 120);
}

function serializePanelLayout(sidebarWidth: number, detailPanelWidth: number) {
  return JSON.stringify({
    sidebarWidth,
    detailPanelWidth,
  });
}

function schedulePanelLayoutPersist(
  get: () => {
    sidebarWidth: number;
    detailPanelWidth: number;
  },
) {
  if (panelLayoutPersistTimer) {
    clearTimeout(panelLayoutPersistTimer);
  }

  panelLayoutPersistTimer = setTimeout(() => {
    const { sidebarWidth, detailPanelWidth } = get();
    void invoke("set_setting", {
      key: PANEL_LAYOUT_SETTING_KEY,
      value: serializePanelLayout(sidebarWidth, detailPanelWidth),
    }).catch((error) => {
      console.error("Failed to persist panel layout:", error);
    });
  }, 120);
}

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
  previewTrackpadZoomSpeed: number;
  libraryViewMode: LibraryViewMode;
  libraryViewScales: Record<LibraryViewMode, number>;
  libraryVisibleFields: LibraryVisibleField[];
  sidebarWidth: number;
  detailPanelWidth: number;
}

interface SettingsStore extends Settings {
  setTheme: (theme: "light" | "dark") => Promise<void>;
  switchIndexPath: (path: string) => Promise<void>;
  setDeleteMode: (useTrash: boolean) => Promise<void>;
  setShortcut: (actionId: ShortcutActionId, shortcut: string) => Promise<void>;
  resetShortcut: (actionId: ShortcutActionId) => Promise<void>;
  setPreviewTrackpadZoomSpeed: (speed: number) => Promise<void>;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
  setLibraryViewScale: (viewMode: LibraryViewMode, scale: number) => void;
  resetLibraryViewScale: (viewMode: LibraryViewMode) => void;
  toggleLibraryVisibleField: (field: LibraryVisibleField) => void;
  setSidebarWidth: (width: number) => void;
  setDetailPanelWidth: (width: number) => void;
  loadSettings: () => Promise<void>;
  rebuildIndex: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: "light",
  indexPaths: [],
  useTrash: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  previewTrackpadZoomSpeed: DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED,
  libraryViewMode: DEFAULT_LIBRARY_VIEW_MODE,
  libraryViewScales: { ...DEFAULT_LIBRARY_VIEW_SCALES },
  libraryVisibleFields: [...DEFAULT_LIBRARY_VISIBLE_FIELDS],
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  detailPanelWidth: DEFAULT_DETAIL_PANEL_WIDTH,

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

  setPreviewTrackpadZoomSpeed: async (speed) => {
    const nextSpeed = clampPreviewTrackpadZoomSpeed(speed);
    await invoke("set_setting", {
      key: PREVIEW_TRACKPAD_ZOOM_SPEED_SETTING_KEY,
      value: String(nextSpeed),
    });
    set({ previewTrackpadZoomSpeed: nextSpeed });
  },

  setLibraryViewMode: (mode) => {
    set({ libraryViewMode: mode });
    scheduleLibraryViewPreferencesPersist(get);
  },

  setLibraryViewScale: (viewMode, scale) => {
    const normalizedScale = clampLibraryViewScale(viewMode, scale);
    set((state) => ({
      libraryViewScales: {
        ...state.libraryViewScales,
        ...(isSharedTileViewMode(viewMode)
          ? {
              grid: normalizedScale,
              adaptive: normalizedScale,
            }
          : {
              [viewMode]: normalizedScale,
            }),
      },
    }));
    scheduleLibraryViewPreferencesPersist(get);
  },

  resetLibraryViewScale: (viewMode) => {
    get().setLibraryViewScale(viewMode, DEFAULT_LIBRARY_VIEW_SCALES[viewMode]);
  },

  toggleLibraryVisibleField: (field) => {
    set((state) => ({
      libraryVisibleFields: state.libraryVisibleFields.includes(field)
        ? state.libraryVisibleFields.filter((item) => item !== field)
        : [...state.libraryVisibleFields, field],
    }));
    scheduleLibraryViewPreferencesPersist(get);
  },

  setSidebarWidth: (width) => {
    set({ sidebarWidth: clampSidebarWidth(width) });
    schedulePanelLayoutPersist(get);
  },

  setDetailPanelWidth: (width) => {
    set({ detailPanelWidth: clampDetailPanelWidth(width) });
    schedulePanelLayoutPersist(get);
  },

  switchIndexPath: async (path) => {
    const nextPath = path.trim();
    if (!nextPath || get().indexPaths[0] === nextPath) {
      return;
    }

    await invoke("switch_index_path_and_restart", { path: nextPath });
  },

  loadSettings: async () => {
    let theme: "light" | "dark" = "light";
    let indexPaths: string[] = [];
    let useTrash: boolean = true;
    let shortcuts = { ...DEFAULT_SHORTCUTS };
    let previewTrackpadZoomSpeed = DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED;
    let libraryViewMode: LibraryViewMode = DEFAULT_LIBRARY_VIEW_MODE;
    let libraryViewScales = { ...DEFAULT_LIBRARY_VIEW_SCALES };
    let libraryVisibleFields = [...DEFAULT_LIBRARY_VISIBLE_FIELDS];
    let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
    let detailPanelWidth = DEFAULT_DETAIL_PANEL_WIDTH;

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

    try {
      const speedValue = await invoke<string>("get_setting", { key: PREVIEW_TRACKPAD_ZOOM_SPEED_SETTING_KEY });
      previewTrackpadZoomSpeed = clampPreviewTrackpadZoomSpeed(Number.parseFloat(speedValue));
    } catch (e) {
      const errorMsg = String(e);
      if (!errorMsg.includes("Setting not found")) {
        console.error("Failed to load preview trackpad zoom speed:", e);
      }
    }

    try {
      const libraryViewPreferencesValue = await invoke<string>("get_setting", {
        key: LIBRARY_VIEW_PREFERENCES_SETTING_KEY,
      });
      const parsedPreferences = JSON.parse(libraryViewPreferencesValue) as {
        mode?: unknown;
        scales?: Partial<Record<LibraryViewMode, unknown>>;
        visibleFields?: unknown;
        visibleFieldsVersion?: unknown;
      };

      if (isLibraryViewMode(parsedPreferences.mode)) {
        libraryViewMode = parsedPreferences.mode;
      }
      libraryViewScales = resolveLibraryViewScales(parsedPreferences.scales);
      libraryVisibleFields = resolveLibraryVisibleFields(
        parsedPreferences.visibleFields,
        parsedPreferences.visibleFieldsVersion,
      );
    } catch (e) {
      const errorMsg = String(e);
      if (!errorMsg.includes("Setting not found")) {
        console.error("Failed to load library view preferences:", e);
      }
    }

    try {
      const panelLayoutValue = await invoke<string>("get_setting", {
        key: PANEL_LAYOUT_SETTING_KEY,
      });
      const parsedLayout = JSON.parse(panelLayoutValue) as {
        sidebarWidth?: unknown;
        detailPanelWidth?: unknown;
      };

      sidebarWidth = clampSidebarWidth(Number(parsedLayout.sidebarWidth));
      detailPanelWidth = clampDetailPanelWidth(Number(parsedLayout.detailPanelWidth));
    } catch (e) {
      const errorMsg = String(e);
      if (!errorMsg.includes("Setting not found")) {
        console.error("Failed to load panel layout:", e);
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
      previewTrackpadZoomSpeed,
      libraryViewMode,
      libraryViewScales,
      libraryVisibleFields,
      sidebarWidth,
      detailPanelWidth,
    });
  },

  rebuildIndex: async () => {
    await invoke("rebuild_library_index");
    await invoke("scan_folders");
    await useFolderStore.getState().loadFolders();
    await loadFilesInCurrentFolder();
  },
}));
