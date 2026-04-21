import { invokeDesktop } from "@/services/desktop/core";
import type { FileItem } from "@/stores/fileTypes";

export function deleteFile(fileId: number) {
  return invokeDesktop<void>("delete_file", { fileId });
}

export function deleteFiles(fileIds: number[]) {
  return invokeDesktop<void>("delete_files", { fileIds });
}

export function getTrashFiles() {
  return invokeDesktop<FileItem[]>("get_trash_files");
}

export function restoreFile(fileId: number) {
  return invokeDesktop<void>("restore_file", { fileId });
}

export function restoreFiles(fileIds: number[]) {
  return invokeDesktop<void>("restore_files", { fileIds });
}

export function permanentDeleteFile(fileId: number) {
  return invokeDesktop<void>("permanent_delete_file", { fileId });
}

export function permanentDeleteFiles(fileIds: number[]) {
  return invokeDesktop<void>("permanent_delete_files", { fileIds });
}

export function emptyTrash() {
  return invokeDesktop<void>("empty_trash");
}

export function getDeleteMode() {
  return invokeDesktop<boolean>("get_delete_mode");
}

export function setDeleteMode(useTrash: boolean) {
  return invokeDesktop<void>("set_delete_mode", { useTrash });
}

export function getTrashCount() {
  return invokeDesktop<number>("get_trash_count");
}
