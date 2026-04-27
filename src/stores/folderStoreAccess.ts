type FolderStoreAccess = {
  loadFolders: () => Promise<void>;
  selectFolder: (folderId: number | null) => void;
};

let folderStoreAccess: FolderStoreAccess | null = null;

export function bindFolderStoreAccess(access: FolderStoreAccess) {
  folderStoreAccess = access;
}

export async function loadFoldersFromAccess() {
  await folderStoreAccess?.loadFolders();
}

export function selectFolderFromAccess(folderId: number | null) {
  folderStoreAccess?.selectFolder(folderId);
}
