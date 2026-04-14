import { invokeTauri } from "@/services/tauri/core";

const LAST_SELECTED_FOLDER_SETTING_KEY = "lastSelectedFolderId";

export function getSetting(key: string) {
  return invokeTauri<string>("get_setting", { key });
}

export function setSetting(key: string, value: string) {
  return invokeTauri<void>("set_setting", { key, value });
}

export async function getLastSelectedFolderId() {
  try {
    const rawValue = await getSetting(LAST_SELECTED_FOLDER_SETTING_KEY);
    const normalizedValue = rawValue.trim();

    if (!normalizedValue || normalizedValue === "null") {
      return null;
    }

    const parsedFolderId = Number.parseInt(normalizedValue, 10);
    return Number.isInteger(parsedFolderId) && parsedFolderId > 0 ? parsedFolderId : null;
  } catch (error) {
    const errorMessage = String(error);
    if (errorMessage.includes("Setting not found")) {
      return null;
    }

    throw error;
  }
}

export function setLastSelectedFolderId(folderId: number | null) {
  return setSetting(
    LAST_SELECTED_FOLDER_SETTING_KEY,
    folderId === null ? "null" : String(folderId),
  );
}

export function getIndexPaths() {
  return invokeTauri<string[]>("get_index_paths");
}

export function getDefaultIndexPath() {
  return invokeTauri<string>("get_default_index_path");
}

export function addIndexPath(path: string) {
  return invokeTauri<void>("add_index_path", { path });
}

export function switchIndexPathAndRestart(path: string) {
  return invokeTauri<void>("switch_index_path_and_restart", { path });
}

export function syncIndexPath(path: string) {
  return invokeTauri<number>("sync_index_path", { path });
}

export function rebuildLibraryIndex() {
  return invokeTauri<number>("rebuild_library_index");
}

export function getThumbnailPath(filePath: string, maxEdge?: number) {
  return invokeTauri<string | null>("get_thumbnail_path", { filePath, maxEdge });
}

export function getThumbnailDataBase64(filePath: string, maxEdge?: number) {
  return invokeTauri<string | null>("get_thumbnail_data_base64", { filePath, maxEdge });
}

export function saveThumbnailCache(args: {
  filePath: string;
  dataBase64: string;
  maxEdge?: number;
}) {
  return invokeTauri<string | null>("save_thumbnail_cache", args);
}
