import { invokeDesktop } from "@/services/desktop/core";

const LAST_SELECTED_FOLDER_SETTING_KEY = "lastSelectedFolderId";

export function getSetting(key: string) {
  return invokeDesktop<string | null>("get_setting", { key });
}

export function setSetting(key: string, value: string) {
  return invokeDesktop<void>("set_setting", { key, value });
}

export async function getLastSelectedFolderId() {
  const rawValue = await getSetting(LAST_SELECTED_FOLDER_SETTING_KEY);
  if (rawValue === null) {
    return null;
  }

  const normalizedValue = rawValue.trim();

  if (!normalizedValue || normalizedValue === "null") {
    return null;
  }

  const parsedFolderId = Number.parseInt(normalizedValue, 10);
  return Number.isInteger(parsedFolderId) && parsedFolderId > 0 ? parsedFolderId : null;
}

export function setLastSelectedFolderId(folderId: number | null) {
  return setSetting(
    LAST_SELECTED_FOLDER_SETTING_KEY,
    folderId === null ? "null" : String(folderId),
  );
}

export function getIndexPaths() {
  return invokeDesktop<string[]>("get_index_paths");
}

export function getRecentIndexPaths() {
  return invokeDesktop<string[]>("get_recent_index_paths");
}

export function getDefaultIndexPath() {
  return invokeDesktop<string>("get_default_index_path");
}

export function addIndexPath(path: string) {
  return invokeDesktop<void>("add_index_path", { path });
}

export function switchIndexPathAndRestart(path: string) {
  return invokeDesktop<void>("switch_index_path_and_restart", { path });
}

export function syncIndexPath(path: string) {
  return invokeDesktop<number>("sync_index_path", { path });
}

export function rebuildLibraryIndex() {
  return invokeDesktop<number>("rebuild_library_index");
}

export function getThumbnailPath(
  filePath: string,
  maxEdge?: number,
  options: { allowBackgroundRequest?: boolean } = {},
) {
  return invokeDesktop<string | null>("get_thumbnail_path", {
    filePath,
    maxEdge,
    allowBackgroundRequest: options.allowBackgroundRequest,
  });
}

export function getThumbnailDataBase64(filePath: string, maxEdge?: number) {
  return invokeDesktop<string | null>("get_thumbnail_data_base64", { filePath, maxEdge });
}

export function saveThumbnailCache(args: {
  filePath: string;
  dataBase64: string;
  maxEdge?: number;
}) {
  return invokeDesktop<string | null>("save_thumbnail_cache", args);
}
