import { invokeTauri } from "@/services/tauri/core"

export function copyFile(args: { fileId: number; targetFolderId: number | null }) {
  return invokeTauri<void>("copy_file", args)
}

export function copyFiles(args: { fileIds: number[]; targetFolderId: number | null }) {
  return invokeTauri<void>("copy_files", args)
}

export function moveFile(args: { fileId: number; targetFolderId: number | null }) {
  return invokeTauri<void>("move_file", args)
}

export function moveFiles(args: { fileIds: number[]; targetFolderId: number | null }) {
  return invokeTauri<void>("move_files", args)
}

export function copyFilesToClipboard(fileIds: number[]) {
  return invokeTauri<void>("copy_files_to_clipboard", { fileIds })
}

export function startDragFiles(fileIds: number[]) {
  return invokeTauri<void>("start_drag_files", { fileIds })
}

export function openFile(fileId: number) {
  return invokeTauri<void>("open_file", { fileId })
}

export function showInExplorer(fileId: number) {
  return invokeTauri<void>("show_in_explorer", { fileId })
}

export function showFolderInExplorer(folderId: number) {
  return invokeTauri<void>("show_folder_in_explorer", { folderId })
}

