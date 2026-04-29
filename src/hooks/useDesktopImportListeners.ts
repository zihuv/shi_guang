import { useEffect } from "react";
import { toast } from "sonner";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useTagStore } from "@/stores/tagStore";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { completeVisualIndexBrowserDecodeRequest } from "@/services/desktop/files";
import { listenDesktop } from "@/services/desktop/core";
import { buildBrowserDecodedImageDataUrl, generateRendererThumbnailCache } from "@/utils";

const visualIndexBrowserDecodeState = {
  queue: Promise.resolve() as Promise<void>,
};

const LIBRARY_IMPORT_REFRESH_DELAY_MS = 120;

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
  runtime?: string;
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

  await generateRendererThumbnailCache({ path, ext });
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

export function useDesktopImportListeners() {
  useEffect(() => {
    let unlistenFileImported: (() => void) | undefined;
    let unlistenFileImportError: (() => void) | undefined;
    let unlistenFileUpdated: (() => void) | undefined;
    let unlistenLibrarySyncUpdated: (() => void) | undefined;
    let librarySyncRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let libraryImportRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let importRefreshShouldIncludeTags = false;
    let unlistenVisualIndexBrowserDecodeRequest: (() => void) | undefined;
    let unlistenThumbnailBuildRequest: (() => void) | undefined;

    const scheduleImportRefresh = (options: { includeTags?: boolean } = {}) => {
      importRefreshShouldIncludeTags ||= Boolean(options.includeTags);
      if (libraryImportRefreshTimer) {
        clearTimeout(libraryImportRefreshTimer);
      }

      libraryImportRefreshTimer = setTimeout(() => {
        libraryImportRefreshTimer = null;
        const includeTags = importRefreshShouldIncludeTags;
        importRefreshShouldIncludeTags = false;
        const libraryStore = useLibraryQueryStore.getState();
        const refreshes: Array<Promise<unknown>> = [
          libraryStore.runCurrentQuery(),
          useFolderStore.getState().loadFolders(),
        ];

        if (includeTags) {
          refreshes.push(useTagStore.getState().loadTags());
        }

        void Promise.all(refreshes);
      }, LIBRARY_IMPORT_REFRESH_DELAY_MS);
    };

    const setupListeners = async () => {
      unlistenFileImported = await listenDesktop<FileImportedPayload>("file-imported", () => {
        scheduleImportRefresh();
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

          scheduleImportRefresh({ includeTags: true });
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
    };

    setupListeners();

    return () => {
      unlistenFileImported?.();
      unlistenFileImportError?.();
      unlistenFileUpdated?.();
      unlistenLibrarySyncUpdated?.();
      if (librarySyncRefreshTimer) {
        clearTimeout(librarySyncRefreshTimer);
      }
      if (libraryImportRefreshTimer) {
        clearTimeout(libraryImportRefreshTimer);
      }
      unlistenVisualIndexBrowserDecodeRequest?.();
      unlistenThumbnailBuildRequest?.();
    };
  }, []);
}
