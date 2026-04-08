import { invokeTauri } from "@/services/tauri/core"
import type { FolderNode } from "@/stores/folderStore"

export interface FolderSummary {
  id: number
  name: string
  path: string
  parent_id: number | null
  created_at: string
}

export function getFolderTree() {
  return invokeTauri<FolderNode[]>("get_folder_tree")
}

export function initDefaultFolder() {
  return invokeTauri<FolderSummary | null>("init_default_folder")
}

export function createFolder(args: { name: string; parentId: number | null }) {
  return invokeTauri<void>("create_folder", args)
}

export function deleteFolder(id: number) {
  return invokeTauri<void>("delete_folder", { id })
}

export function renameFolder(args: { id: number; name: string }) {
  return invokeTauri<void>("rename_folder", args)
}

export function moveFolder(args: {
  folderId: number
  newParentId: number | null
  sortOrder: number
}) {
  return invokeTauri<void>("move_folder", args)
}

export function reorderFolders(folderIds: number[]) {
  return invokeTauri<void>("reorder_folders", { folderIds })
}

export function scanFolders() {
  return invokeTauri<number>("scan_folders")
}

