import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useTagStore } from "@/stores/tagStore";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { completeVisualIndexBrowserDecodeRequest } from "@/services/tauri/files";
import { buildBrowserDecodedImageDataUrl } from "@/utils";

const dragDropState = {
  processedPaths: new Set<string>(),
  isProcessing: false,
  listenersReady: false,
};

const visualIndexBrowserDecodeState = {
  queue: Promise.resolve() as Promise<void>,
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

type VisualIndexBrowserDecodeRequestPayload = {
  requestId?: string;
  request_id?: string;
  fileId?: number;
  file_id?: number;
  path?: string;
  outputMimeType?: string;
  output_mime_type?: string;
};

async function handleVisualIndexBrowserDecodeRequest(
  payload?: VisualIndexBrowserDecodeRequestPayload,
) {
  const requestId = (payload?.requestId ?? payload?.request_id)?.trim();
  const path = payload?.path?.trim();

  if (!requestId || !path) {
    return;
  }

  let imageDataUrl: string | undefined;
  let errorMessage: string | undefined;

  try {
    imageDataUrl = await buildBrowserDecodedImageDataUrl(path, {
      maxEdge: null,
      outputMimeType: payload?.outputMimeType ?? payload?.output_mime_type ?? "image/png",
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  await completeVisualIndexBrowserDecodeRequest({
    requestId,
    imageDataUrl,
    error: errorMessage,
  });
}

function enqueueVisualIndexBrowserDecodeRequest(
  payload?: VisualIndexBrowserDecodeRequestPayload,
) {
  // Serialize large browser-side transcodes so timed-out AVIF requests do not pile up
  // and keep the main thread saturated.
  const task = visualIndexBrowserDecodeState.queue.then(() =>
    handleVisualIndexBrowserDecodeRequest(payload),
  );
  visualIndexBrowserDecodeState.queue = task.catch(() => undefined);
  return task;
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
    let unlistenVisualIndexBrowserDecodeRequest: (() => void) | undefined;

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

      unlistenFileImported = await listen<FileImportedPayload>("file-imported", async () => {
        const libraryStore = useLibraryQueryStore.getState();
        await Promise.all([
          libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
          useFolderStore.getState().loadFolders(),
        ]);
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

      unlistenVisualIndexBrowserDecodeRequest = await listen<VisualIndexBrowserDecodeRequestPayload>(
        "visual-index-browser-decode-request",
        async (event) => {
          try {
            await enqueueVisualIndexBrowserDecodeRequest(event.payload);
          } catch (error) {
            console.error("Failed to resolve visual index browser decode request:", error);
          }
        },
      );

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
      unlistenVisualIndexBrowserDecodeRequest?.();
      dragDropState.listenersReady = false;
    };
  }, [setIsDragging]);
}
