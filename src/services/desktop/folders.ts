import { invokeDesktop } from "@/services/desktop/core";
import type { DeleteFolderResult, FolderNode, FolderSummary } from "@/shared/desktop-types";
export type { DeleteFolderResult, FolderSummary } from "@/shared/desktop-types";

export function getFolderTree() {
  return invokeDesktop<FolderNode[]>("get_folder_tree");
}

export function initDefaultFolder() {
  return invokeDesktop<FolderSummary | null>("init_default_folder");
}

export function createFolder(args: { name: string; parentId: number | null }) {
  return invokeDesktop<FolderSummary>("create_folder", args);
}

export function deleteFolder(id: number) {
  return invokeDesktop<DeleteFolderResult | null>("delete_folder", { id });
}

export function renameFolder(args: { id: number; name: string }) {
  return invokeDesktop<void>("rename_folder", args);
}

export function moveFolder(args: {
  folderId: number;
  newParentId: number | null;
  sortOrder: number;
}) {
  return invokeDesktop<void>("move_folder", args);
}

export function reorderFolders(folderIds: number[]) {
  return invokeDesktop<void>("reorder_folders", { folderIds });
}

export function scanFolders() {
  return invokeDesktop<number>("scan_folders");
}
