import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useTagStore } from "@/stores/tagStore";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { completeVisualIndexBrowserDecodeRequest } from "@/services/desktop/files";
import { getDesktopBridge, listenDesktop } from "@/services/desktop/core";
import { buildBrowserDecodedImageDataUrl, getVideoThumbnailSrc, isVideoFile } from "@/utils";

const dragDropState = {
  processedPaths: new Set<string>(),
  isProcessing: false,
  listenersReady: false,
};

const visualIndexBrowserDecodeState = {
  queue: Promise.resolve() as Promise<void>,
};

type UseDesktopImportListenersOptions = {
  dragOverFolderId: number | null;
  setDragOverFolderId: (folderId: number | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  importFiles: (sourcePaths: string[], targetFolderId?: number | null) => Promise<unknown>;
};

type FileUpdatedPayload = {
  fileId?: number;
};

type FileImportedPayload = {
  file_id?: number;
  path?: string;
};

type LibrarySyncUpdatedPayload = {
  errorCount?: number;
};

type VisualIndexBrowserDecodeRequestPayload = {
  requestId?: string;
  request_id?: string;
  fileId?: number;
  file_id?: number;
  path?: string;
  maxEdge?: number;
  max_edge?: number;
  outputMimeType?: string;
  output_mime_type?: string;
};

type ThumbnailBuildRequestPayload = {
  fileId?: number;
  file_id?: number;
  path?: string;
  ext?: string;
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
      maxEdge: payload?.maxEdge ?? payload?.max_edge ?? 1280,
      outputMimeType: payload?.outputMimeType ?? payload?.output_mime_type ?? "image/jpeg",
      preferWorker: true,
      allowImageElementFallback: false,
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

async function handleThumbnailBuildRequest(payload?: ThumbnailBuildRequestPayload) {
  const path = payload?.path?.trim();
  const ext = payload?.ext?.trim().toLowerCase();

  if (!path || !ext) {
    return;
  }

  if (!isVideoFile(ext)) {
    return;
  }

  await getVideoThumbnailSrc(path);
}

function enqueueVisualIndexBrowserDecodeRequest(payload?: VisualIndexBrowserDecodeRequestPayload) {
  // Serialize large browser-side transcodes so timed-out AVIF requests do not pile up
  // and keep the main thread saturated.
  const task = visualIndexBrowserDecodeState.queue.then(() =>
    handleVisualIndexBrowserDecodeRequest(payload),
  );
  visualIndexBrowserDecodeState.queue = task.catch(() => undefined);
  return task;
}

export function useDesktopImportListeners({
  dragOverFolderId,
  setDragOverFolderId,
  setIsDragging,
  importFiles,
}: UseDesktopImportListenersOptions) {
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
    let unlistenLibrarySyncUpdated: (() => void) | undefined;
    let librarySyncRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let unlistenVisualIndexBrowserDecodeRequest: (() => void) | undefined;
    let unlistenThumbnailBuildRequest: (() => void) | undefined;

    const setupListeners = async () => {
      const handleDragEnter = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes("Files")) {
          return;
        }
        event.preventDefault();
        if (!useSelectionStore.getState().isDraggingInternal) {
          setIsDragging(true);
        }
      };

      const handleDragOver = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes("Files")) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      };

      const handleDragLeave = (event: DragEvent) => {
        if (event.relatedTarget) {
          return;
        }
        if (!useSelectionStore.getState().isDraggingInternal) {
          setIsDragging(false);
        }
      };

      const handleDrop = async (event: DragEvent) => {
        if (useSelectionStore.getState().isDraggingInternal) {
          return;
        }

        event.preventDefault();
        if (dragDropState.isProcessing) {
          return;
        }

        setIsDragging(false);
        dragDropState.isProcessing = true;
        const bridge = getDesktopBridge();
        const paths = Array.from(event.dataTransfer?.files ?? [])
          .map((file) => bridge.file.getPathForFile(file))
          .filter((path) => path.trim().length > 0);

        const uniquePaths = [...new Set(paths)].filter(
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
            dragOverFolderIdRef.current !== null ? dragOverFolderIdRef.current : undefined;
          await importFilesRef.current(uniquePaths, targetFolderId);
        } catch (error) {
          console.error("[Desktop DragDrop] Import error:", error);
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
      };

      document.addEventListener("dragenter", handleDragEnter);
      document.addEventListener("dragover", handleDragOver);
      document.addEventListener("dragleave", handleDragLeave);
      document.addEventListener("drop", handleDrop);

      unlistenDragEnter = () => document.removeEventListener("dragenter", handleDragEnter);
      unlistenDragDrop = () => {
        document.removeEventListener("dragover", handleDragOver);
        document.removeEventListener("drop", handleDrop);
      };
      unlistenDragLeave = () => document.removeEventListener("dragleave", handleDragLeave);

      unlistenFileImported = await listenDesktop<FileImportedPayload>("file-imported", async () => {
        const libraryStore = useLibraryQueryStore.getState();
        await Promise.all([
          libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
          useFolderStore.getState().loadFolders(),
        ]);
      });

      unlistenFileImportError = await listenDesktop<{ error: string }>(
        "file-import-error",
        async (event) => {
          toast.error(`图片导入失败: ${event.payload.error}`);
        },
      );

      unlistenFileUpdated = await listenDesktop<FileUpdatedPayload>(
        "file-updated",
        async (event) => {
          if (typeof event.payload?.fileId === "number") {
            useThumbnailRefreshStore.getState().bumpFileVersion(event.payload.fileId);
          }

          const libraryStore = useLibraryQueryStore.getState();
          await Promise.all([
            libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
            useFolderStore.getState().loadFolders(),
            useTagStore.getState().loadTags(),
          ]);
        },
      );

      unlistenLibrarySyncUpdated = await listenDesktop<LibrarySyncUpdatedPayload>(
        "library-sync-updated",
        (event) => {
          if ((event.payload?.errorCount ?? 0) > 0) {
            toast.error("素材目录同步时遇到部分文件处理失败");
          }

          if (librarySyncRefreshTimer) {
            return;
          }

          librarySyncRefreshTimer = setTimeout(() => {
            librarySyncRefreshTimer = null;
            const libraryStore = useLibraryQueryStore.getState();
            void Promise.all([
              libraryStore.runCurrentQuery(libraryStore.selectedFolderId),
              useFolderStore.getState().loadFolders(),
              useTagStore.getState().loadTags(),
            ]);
          }, 400);
        },
      );

      unlistenVisualIndexBrowserDecodeRequest =
        await listenDesktop<VisualIndexBrowserDecodeRequestPayload>(
          "visual-index-browser-decode-request",
          async (event) => {
            try {
              await enqueueVisualIndexBrowserDecodeRequest(event.payload);
            } catch (error) {
              console.error("Failed to resolve visual index browser decode request:", error);
            }
          },
        );

      unlistenThumbnailBuildRequest = await listenDesktop<ThumbnailBuildRequestPayload>(
        "thumbnail-build-request",
        async (event) => {
          try {
            await handleThumbnailBuildRequest(event.payload);
          } catch (error) {
            console.error("Failed to build thumbnail from background request:", error);
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
      unlistenLibrarySyncUpdated?.();
      if (librarySyncRefreshTimer) {
        clearTimeout(librarySyncRefreshTimer);
      }
      unlistenVisualIndexBrowserDecodeRequest?.();
      unlistenThumbnailBuildRequest?.();
      dragDropState.listenersReady = false;
    };
  }, [setIsDragging]);
}
