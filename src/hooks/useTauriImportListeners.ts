import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useTagStore } from "@/stores/tagStore";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { generateBrowserThumbnailCache, normalizeExt } from "@/utils";

const dragDropState = {
  processedPaths: new Set<string>(),
  isProcessing: false,
  listenersReady: false,
};

type UseTauriImportListenersOptions = {
  dragOverFolderId: number | null;
  setDragOverFolderId: (folderId: number | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  importFiles: (
    sourcePaths: string[],
    targetFolderId?: number | null,
  ) => Promise<unknown>;
};

type FileUpdatedPayload = {
  fileId?: number;
};

type FileImportedPayload = {
  file_id?: number;
  path?: string;
};

function getPathExtension(path: string): string {
  const ext = path.split(".").pop();
  return ext ? normalizeExt(ext) : "";
}

async function maybeGenerateImportedAvifThumbnail(payload?: FileImportedPayload) {
  const path = payload?.path?.trim();
  if (!path || getPathExtension(path) !== "avif") {
    return;
  }

  const thumbnailSrc = await generateBrowserThumbnailCache(path);
  if (!thumbnailSrc) {
    return;
  }

  if (typeof payload?.file_id === "number") {
    useThumbnailRefreshStore.getState().bumpFileVersion(payload.file_id);
  }
}

export function useTauriImportListeners({
  dragOverFolderId,
  setDragOverFolderId,
  setIsDragging,
  importFiles,
}: UseTauriImportListenersOptions) {
  const importFilesRef = useRef(importFiles);
  const dragOverFolderIdRef = useRef(dragOverFolderId);
  const setDragOverFolderIdRef = useRef(setDragOverFolderId);

  importFilesRef.current = importFiles;
  dragOverFolderIdRef.current = dragOverFolderId;
  setDragOverFolderIdRef.current = setDragOverFolderId;

  useEffect(() => {
    if (dragDropState.listenersReady) {
      return;
    }

    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;
    let unlistenFileImported: (() => void) | undefined;
    let unlistenFileImportError: (() => void) | undefined;
    let unlistenFileUpdated: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenDragEnter = await listen("tauri://drag-enter", () => {
        if (!useSelectionStore.getState().isDraggingInternal) {
          setIsDragging(true);
        }
      });

      unlistenDragLeave = await listen("tauri://drag-leave", () => {
        if (!useSelectionStore.getState().isDraggingInternal) {
          setIsDragging(false);
        }
      });

      unlistenDragDrop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        async (event) => {
          if (useSelectionStore.getState().isDraggingInternal) {
            return;
          }

          if (dragDropState.isProcessing) {
            return;
          }

          setIsDragging(false);
          dragDropState.isProcessing = true;

          const uniquePaths = [...new Set(event.payload.paths)].filter(
            (path) => !dragDropState.processedPaths.has(path),
          );

          if (uniquePaths.length === 0) {
            dragDropState.isProcessing = false;
            return;
          }

          for (const path of uniquePaths) {
            dragDropState.processedPaths.add(path);
          }

          try {
            const targetFolderId =
              dragOverFolderIdRef.current !== null
                ? dragOverFolderIdRef.current
                : undefined;
            await importFilesRef.current(uniquePaths, targetFolderId);
          } catch (error) {
            console.error("[Tauri DragDrop] Import error:", error);
            for (const path of uniquePaths) {
              dragDropState.processedPaths.delete(path);
            }
          } finally {
            dragDropState.isProcessing = false;

            if (dragOverFolderIdRef.current !== null) {
              setDragOverFolderIdRef.current(null);
            }

            setTimeout(() => {
              for (const path of uniquePaths) {
                dragDropState.processedPaths.delete(path);
              }
            }, 2000);
          }
        },
      );

      unlistenFileImported = await listen<FileImportedPayload>("file-imported", async (event) => {
        const libraryStore = useLibraryQueryStore.getState();
        await Promise.all([
          libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
          useFolderStore.getState().loadFolders(),
        ]);

        void maybeGenerateImportedAvifThumbnail(event.payload).catch((error) => {
          console.error("Failed to generate imported AVIF thumbnail:", error);
        });
      });

      unlistenFileImportError = await listen<{ error: string }>(
        "file-import-error",
        async (event) => {
          toast.error(`图片导入失败: ${event.payload.error}`);
        },
      );

      unlistenFileUpdated = await listen<FileUpdatedPayload>("file-updated", async (event) => {
        if (typeof event.payload?.fileId === "number") {
          useThumbnailRefreshStore.getState().bumpFileVersion(event.payload.fileId);
        }

        const libraryStore = useLibraryQueryStore.getState();
        await Promise.all([
          libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
          useFolderStore.getState().loadFolders(),
          useTagStore.getState().loadTags(),
        ]);
      });

      dragDropState.listenersReady = true;
    };

    setupListeners();

    return () => {
      unlistenDragEnter?.();
      unlistenDragDrop?.();
      unlistenDragLeave?.();
      unlistenFileImported?.();
      unlistenFileImportError?.();
      unlistenFileUpdated?.();
      dragDropState.listenersReady = false;
    };
  }, [setIsDragging]);
}
