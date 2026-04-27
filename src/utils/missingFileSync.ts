import { getIndexPaths, syncIndexPath } from "@/services/desktop/indexing";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";

const missingFileSyncs = new Set<string>();
const MISSING_FILE_ERROR_MARKERS = [
  "No such file or directory",
  "The system cannot find the file specified",
  "系统找不到指定的文件",
  "(os error 2)",
];

function normalizeFsPath(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function isMissingFileError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? "");
  return MISSING_FILE_ERROR_MARKERS.some((marker) => message.includes(marker));
}

function findMatchingIndexPath(filePath: string, indexPaths: string[]): string | null {
  const normalizedFilePath = normalizeFsPath(filePath);
  let match: string | null = null;

  for (const indexPath of indexPaths) {
    const normalizedIndexPath = normalizeFsPath(indexPath);
    if (
      normalizedFilePath === normalizedIndexPath ||
      normalizedFilePath.startsWith(`${normalizedIndexPath}\\`)
    ) {
      if (!match || normalizedIndexPath.length > normalizeFsPath(match).length) {
        match = indexPath;
      }
    }
  }

  return match;
}

async function refreshVisibleLibraryState() {
  try {
    await useFolderStore.getState().loadFolders();
    const libraryStore = useLibraryQueryStore.getState();
    await libraryStore.runCurrentQuery(libraryStore.selectedFolderId);
  } catch (error) {
    console.error("Failed to refresh library state:", error);
  }
}

export function scheduleMissingFileCleanup(path: string) {
  void (async () => {
    try {
      const indexPaths = await getIndexPaths();
      const matchingIndexPath = findMatchingIndexPath(path, indexPaths);
      if (!matchingIndexPath || missingFileSyncs.has(matchingIndexPath)) {
        return;
      }

      missingFileSyncs.add(matchingIndexPath);
      try {
        await syncIndexPath(matchingIndexPath);
        await refreshVisibleLibraryState();
      } finally {
        missingFileSyncs.delete(matchingIndexPath);
      }
    } catch (error) {
      console.error("Failed to sync missing file cleanup:", error);
    }
  })();
}
