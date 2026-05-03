import { invokeDesktop } from "@/services/desktop/core";

export interface UpdateCheckResult {
  status: "disabled" | "checking" | "available" | "not-available" | "downloaded" | "error";
  message: string;
  version?: string;
  downloadUrl?: string;
}

export function getAppVersion() {
  return invokeDesktop<string>("get_app_version");
}

export function checkForUpdates() {
  return invokeDesktop<UpdateCheckResult>("check_for_updates");
}

export function copyFile(args: { fileId: number; targetFolderId: number | null }) {
  return invokeDesktop<void>("copy_file", args);
}

export function copyFiles(args: { fileIds: number[]; targetFolderId: number | null }) {
  return invokeDesktop<void>("copy_files", args);
}

export function moveFile(args: { fileId: number; targetFolderId: number | null }) {
  return invokeDesktop<void>("move_file", args);
}

export function moveFiles(args: { fileIds: number[]; targetFolderId: number | null }) {
  return invokeDesktop<void>("move_files", args);
}

export function copyFilesToClipboard(fileIds: number[]) {
  return invokeDesktop<void>("copy_files_to_clipboard", { fileIds });
}

export function startDragFiles(fileIds: number[]) {
  return invokeDesktop<void>("start_drag_files", { fileIds });
}

export function openFile(fileId: number) {
  return invokeDesktop<void>("open_file", { fileId });
}

export function showInExplorer(fileId: number) {
  return invokeDesktop<void>("show_in_explorer", { fileId });
}

export function showFolderInExplorer(folderId: number) {
  return invokeDesktop<void>("show_folder_in_explorer", { folderId });
}

export function showCurrentLibraryInExplorer() {
  return invokeDesktop<void>("show_current_library_in_explorer");
}

export function openLogDirectory() {
  return invokeDesktop<void>("open_log_directory");
}
