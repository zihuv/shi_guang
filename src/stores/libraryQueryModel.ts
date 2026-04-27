import type { SmartCollectionId } from "@/stores/fileTypes";

export function resolveLibraryQueryFolderId(args: {
  activeSmartCollection: SmartCollectionId | null;
  selectedFolderId: number | null;
  folderIdOverride?: number | null;
}) {
  const { activeSmartCollection, selectedFolderId, folderIdOverride } = args;
  const hasGlobalSmartCollection =
    activeSmartCollection !== null && activeSmartCollection !== "all";

  if (hasGlobalSmartCollection) {
    return null;
  }

  return folderIdOverride !== undefined ? folderIdOverride : selectedFolderId;
}
