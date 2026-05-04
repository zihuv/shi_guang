import { useCallback, useEffect, useRef, type DragEvent as ReactDragEvent } from "react";
import { useSelectionStore } from "@/stores/selectionStore";
import { sendDesktop } from "@/services/desktop/core";

function getInternalDragFileIds(fileId: number) {
  return useSelectionStore.getState().beginInternalFileDrag(fileId);
}

export function useExternalFileDrag(fileId: number) {
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const currentPointerRef = useRef<{ x: number; y: number } | null>(null);
  const targetFolderIdRef = useRef<number | null>(null);

  useEffect(() => {
    const { isDraggingInternal } = useSelectionStore.getState();
    if (!isDraggingInternal) return;

    const POLL_INTERVAL_MS = 150;
    const DRAG_THRESHOLD_PX = 6;

    function findFolderIdUnderCursor(x: number, y: number): number | null {
      let el = document.elementFromPoint(x, y);
      while (el) {
        const id = el.getAttribute?.("data-folder-id");
        if (id) return Number(id);
        el = el.parentElement;
      }
      return null;
    }

    function isDragThresholdMet(x: number, y: number): boolean {
      const start = dragStartPosRef.current;
      if (!start) return false;
      return Math.abs(x - start.x) > DRAG_THRESHOLD_PX || Math.abs(y - start.y) > DRAG_THRESHOLD_PX;
    }

    function cleanup(moveToFolderId: number | null) {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);

      if (
        moveToFolderId != null &&
        moveToFolderId > 0 &&
        useSelectionStore.getState().markInternalDropHandled()
      ) {
        const { draggedFileIds } = useSelectionStore.getState();
        if (draggedFileIds.length > 0) {
          import("@/stores/libraryQueryStore").then((mod) => {
            const store = mod.useLibraryQueryStore.getState();
            if (draggedFileIds.length > 1) {
              store.moveFiles(draggedFileIds, moveToFolderId);
            } else {
              store.moveFile(draggedFileIds[0], moveToFolderId);
            }
          });
        }
      }

      useSelectionStore.getState().clearInternalFileDrag();
      targetFolderIdRef.current = null;
      dragStartPosRef.current = null;
      currentPointerRef.current = null;
    }

    function onPointerMove(e: PointerEvent) {
      currentPointerRef.current = { x: e.clientX, y: e.clientY };
    }

    function onPointerUp(e: PointerEvent) {
      currentPointerRef.current = { x: e.clientX, y: e.clientY };
      cleanup(targetFolderIdRef.current);
    }

    let pollTimer = setInterval(() => {
      const pos = currentPointerRef.current;
      if (!pos) return;
      if (!isDragThresholdMet(pos.x, pos.y)) return;
      targetFolderIdRef.current = findFolderIdUnderCursor(pos.x, pos.y);
    }, POLL_INTERVAL_MS);

    let cleanupTimer = setTimeout(() => cleanup(null), 10_000);

    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
  });

  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      dragStartPosRef.current = { x: event.clientX, y: event.clientY };
      const draggedFileIds = getInternalDragFileIds(fileId);
      sendDesktop("start_drag_files", { fileIds: draggedFileIds });
    },
    [fileId],
  );

  const handleDragEnd = useCallback(() => {
    useSelectionStore.getState().clearInternalFileDrag();
    targetFolderIdRef.current = null;
    dragStartPosRef.current = null;
    currentPointerRef.current = null;
  }, []);

  return {
    dragHandleProps: {
      draggable: true,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
    } as const,
  };
}
