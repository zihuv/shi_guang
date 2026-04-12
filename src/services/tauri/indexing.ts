import { invokeTauri } from "@/services/tauri/core"

export function getSetting(key: string) {
  return invokeTauri<string>("get_setting", { key })
}

export function setSetting(key: string, value: string) {
  return invokeTauri<void>("set_setting", { key, value })
}

export function getIndexPaths() {
  return invokeTauri<string[]>("get_index_paths")
}

export function getDefaultIndexPath() {
  return invokeTauri<string>("get_default_index_path")
}

export function addIndexPath(path: string) {
  return invokeTauri<void>("add_index_path", { path })
}

export function switchIndexPathAndRestart(path: string) {
  return invokeTauri<void>("switch_index_path_and_restart", { path })
}

export function syncIndexPath(path: string) {
  return invokeTauri<number>("sync_index_path", { path })
}

export function rebuildLibraryIndex() {
  return invokeTauri<number>("rebuild_library_index")
}

export function getThumbnailPath(filePath: string) {
  return invokeTauri<string | null>("get_thumbnail_path", { filePath })
}

export function getThumbnailDataBase64(filePath: string) {
  return invokeTauri<string | null>("get_thumbnail_data_base64", { filePath })
}

export function saveThumbnailCache(args: { filePath: string; dataBase64: string }) {
  return invokeTauri<string | null>("save_thumbnail_cache", args)
}
