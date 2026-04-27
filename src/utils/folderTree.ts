import type { FolderNode } from "@/shared/desktop-types";

export function findFolderById(folders: FolderNode[], id: number): FolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder;
    }
    const found = findFolderById(folder.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}
