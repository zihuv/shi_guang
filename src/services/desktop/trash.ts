import { invokeDesktop } from "@/services/desktop/core";
import type { FileItem, TrashItem } from "@/stores/fileTypes";

export interface RestoreFilesResult {
  movedToUnclassifiedCount: number;
}

export interface RestoreFolderResult {
  restoredPath: string;
  originalPath: string;
}

export function deleteFile(fileId: number) {
  return invokeDesktop<void>("delete_file", { fileId });
}

export function deleteFiles(fileIds: number[]) {
  return invokeDesktop<void>("delete_files", { fileIds });
}

export function getTrashFiles() {
  return invokeDesktop<FileItem[]>("get_trash_files");
}

export function getTrashItems() {
  return invokeDesktop<TrashItem[]>("get_trash_items");
}

export function restoreFile(fileId: number) {
  return invokeDesktop<RestoreFilesResult>("restore_file", { fileId });
}

export function restoreFiles(fileIds: number[]) {
  return invokeDesktop<RestoreFilesResult>("restore_files", { fileIds });
}

export function restoreFolder(folderId: number) {
  return invokeDesktop<RestoreFolderResult>("restore_folder", { folderId });
}

export function restoreFolders(folderIds: number[]) {
  return invokeDesktop<RestoreFolderResult[]>("restore_folders", { folderIds });
}

export function permanentDeleteFile(fileId: number) {
  return invokeDesktop<void>("permanent_delete_file", { fileId });
}

export function permanentDeleteFiles(fileIds: number[]) {
  return invokeDesktop<void>("permanent_delete_files", { fileIds });
}

export function permanentDeleteFolder(folderId: number) {
  return invokeDesktop<void>("permanent_delete_folder", { folderId });
}

export function permanentDeleteFolders(folderIds: number[]) {
  return invokeDesktop<void>("permanent_delete_folders", { folderIds });
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
