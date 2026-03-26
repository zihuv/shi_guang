import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useFileStore } from "@/stores/fileStore";
import { useFolderStore } from "@/stores/folderStore";

const dragDropState = {
  processedPaths: new Set<string>(),
  isProcessing: false,
  listenersReady: false,
};

type UseTauriImportListenersOptions = {
  dragOverFolderId: number | null;
  setDragOverFolderId: (folderId: number | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  importFile: (
    sourcePath: string,
    refresh?: boolean,
    targetFolderId?: number | null,
  ) => Promise<unknown>;
};

export function useTauriImportListeners({
  dragOverFolderId,
  setDragOverFolderId,
  setIsDragging,
  importFile,
}: UseTauriImportListenersOptions) {
  const importFileRef = useRef(importFile);
  const dragOverFolderIdRef = useRef(dragOverFolderId);
  const setDragOverFolderIdRef = useRef(setDragOverFolderId);

  importFileRef.current = importFile;
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

    const setupListeners = async () => {
      unlistenDragEnter = await listen("tauri://drag-enter", () => {
        if (!useFileStore.getState().isDraggingInternal) {
          setIsDragging(true);
        }
      });

      unlistenDragLeave = await listen("tauri://drag-leave", () => {
        if (!useFileStore.getState().isDraggingInternal) {
          setIsDragging(false);
        }
      });

      unlistenDragDrop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        async (event) => {
          if (useFileStore.getState().isDraggingInternal) {
            return;
          }

          if (dragDropState.isProcessing) {
            return;
          }

          setIsDragging(false);
          dragDropState.isProcessing = true;

          try {
            for (const path of event.payload.paths) {
              if (dragDropState.processedPaths.has(path)) {
                continue;
              }

              dragDropState.processedPaths.add(path);

              try {
                const targetFolderId =
                  dragOverFolderIdRef.current !== null
                    ? dragOverFolderIdRef.current
                    : undefined;
                await importFileRef.current(path, true, targetFolderId);
              } catch (error) {
                console.error("[Tauri DragDrop] Import error:", error);
                dragDropState.processedPaths.delete(path);
              }
            }
          } finally {
            dragDropState.isProcessing = false;

            if (dragOverFolderIdRef.current !== null) {
              setDragOverFolderIdRef.current(null);
            }

            setTimeout(() => {
              for (const path of event.payload.paths) {
                dragDropState.processedPaths.delete(path);
              }
            }, 2000);
          }
        },
      );

      unlistenFileImported = await listen("file-imported", async () => {
        toast.success("图片导入成功");
        const folderId = useFolderStore.getState().selectedFolderId;
        await useFileStore.getState().loadFilesInFolder(folderId);
      });

      unlistenFileImportError = await listen<{ error: string }>(
        "file-import-error",
        async (event) => {
          toast.error(`图片导入失败: ${event.payload.error}`);
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
      dragDropState.listenersReady = false;
    };
  }, [setIsDragging]);
}
