import { invokeTauri } from "@/services/tauri/core";
import type { FileItem } from "@/stores/fileTypes";

export function deleteFile(fileId: number) {
  return invokeTauri<void>("delete_file", { fileId });
}

export function deleteFiles(fileIds: number[]) {
  return invokeTauri<void>("delete_files", { fileIds });
}

export function getTrashFiles() {
  return invokeTauri<FileItem[]>("get_trash_files");
}

export function restoreFile(fileId: number) {
  return invokeTauri<void>("restore_file", { fileId });
}

export function restoreFiles(fileIds: number[]) {
  return invokeTauri<void>("restore_files", { fileIds });
}

export function permanentDeleteFile(fileId: number) {
  return invokeTauri<void>("permanent_delete_file", { fileId });
}

export function permanentDeleteFiles(fileIds: number[]) {
  return invokeTauri<void>("permanent_delete_files", { fileIds });
}

export function emptyTrash() {
  return invokeTauri<void>("empty_trash");
}

export function getDeleteMode() {
  return invokeTauri<boolean>("get_delete_mode");
}

export function setDeleteMode(useTrash: boolean) {
  return invokeTauri<void>("set_delete_mode", { useTrash });
}

export function getTrashCount() {
  return invokeTauri<number>("get_trash_count");
}
