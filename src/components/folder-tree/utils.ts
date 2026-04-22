import type { FolderNode } from "@/stores/folderStore";
import { useFolderStore } from "@/stores/folderStore";
import { useFilterStore } from "@/stores/filterStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";

export const INTERNAL_FILE_DRAG_MIME = "application/x-shiguang-file-ids";

export type FlattenedFolderNode = FolderNode & { sortOrder: number };

export const findFolderById = (folders: FolderNode[], folderId: number): FolderNode | null => {
  for (const folder of folders) {
    if (folder.id === folderId) return folder;
    if (folder.children && folder.children.length > 0) {
      const found = findFolderById(folder.children, folderId);
      if (found) return found;
    }
  }
  return null;
};

export const findFolderParentId = (
  folders: FolderNode[],
  folderId: number,
  parentId: number | null,
): number | null => {
  for (const folder of folders) {
    if (folder.id === folderId) return parentId;
    if (folder.children && folder.children.length > 0) {
      const found = findFolderParentId(folder.children, folderId, folder.id);
      if (found !== null) return found;
    }
  }
  return null;
};

export const findSiblings = (folders: FolderNode[], parentId: number | null): FolderNode[] => {
  if (parentId === null) return folders;

  const findParentChildren = (items: FolderNode[]): FolderNode[] | null => {
    for (const item of items) {
      if (item.id === parentId) return item.children || [];
      if (item.children && item.children.length > 0) {
        const found = findParentChildren(item.children);
        if (found) return found;
      }
    }
    return null;
  };

  return findParentChildren(folders) || [];
};

export const getAllFolderIds = (folders: FolderNode[]): number[] => {
  const ids: number[] = [];
  for (const folder of folders) {
    ids.push(folder.id);
    if (folder.children && folder.children.length > 0) {
      ids.push(...getAllFolderIds(folder.children));
    }
  }
  return ids;
};

export const isDescendant = (folders: FolderNode[], parentId: number, childId: number): boolean => {
  const parent = findFolderById(folders, parentId);
  if (!parent || !parent.children) return false;

  const checkDescendant = (items: FolderNode[], targetId: number): boolean => {
    for (const item of items) {
      if (item.id === targetId) return true;
      if (item.children && checkDescendant(item.children, targetId)) return true;
    }
    return false;
  };

  return checkDescendant(parent.children, childId);
};

export async function selectFolderFromTree(folderId: number | null) {
  const folderStore = useFolderStore.getState();
  const filterStore = useFilterStore.getState();
  const libraryStore = useLibraryQueryStore.getState();
  const navigationStore = useNavigationStore.getState();
  const selectionStore = useSelectionStore.getState();
  const previewStore = usePreviewStore.getState();

  navigationStore.openLibrary();

  if (filterStore.isFilterPanelOpen || folderId === null) {
    filterStore.setFolderId(null);
  }

  if (folderStore.selectedFolderId === folderId) {
    selectionStore.clearSelection();
    previewStore.closePreview();
    if (selectionStore.selectedFile) {
      selectionStore.setSelectedFile(null);
    }
    return;
  }

  folderStore.selectFolder(folderId);
  selectionStore.clearSelection();
  previewStore.closePreview();
  selectionStore.setSelectedFile(null);
  await libraryStore.loadFilesInFolder(folderId);
}

export const flattenFolders = (nodes: FolderNode[], depth = 0): FlattenedFolderNode[] => {
  let result: FlattenedFolderNode[] = [];
  for (const node of nodes) {
    result.push({ ...node, sortOrder: depth });
    if (node.children && node.children.length > 0) {
      result = result.concat(flattenFolders(node.children, depth + 1));
    }
  }
  return result;
};
