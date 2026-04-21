import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { toast } from "sonner";
import { INTERNAL_FILE_DRAG_MIME } from "@/components/folder-tree/utils";
import { startExternalFileDrag } from "@/lib/externalDrag";
import { useSelectionStore } from "@/stores/selectionStore";

const EXTERNAL_DRAG_THRESHOLD = 6;
const EXTERNAL_DRAG_REGION_SELECTOR = "[data-external-drag-region='true']";

type PendingExternalDrag = {
  startX: number;
  startY: number;
  started: boolean;
};

function getExternalDragFileIds(fileId: number) {
  const { selectedFiles } = useSelectionStore.getState();
  return selectedFiles.includes(fileId) ? selectedFiles : [fileId];
}

function getInternalDragFileIds(fileId: number) {
  return useSelectionStore.getState().beginInternalFileDrag(fileId);
}

export function isExternalDragRegionTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(EXTERNAL_DRAG_REGION_SELECTOR) !== null;
}

export function useExternalFileDrag(fileId: number) {
  const pendingExternalDragRef = useRef<PendingExternalDrag | null>(null);
  const moveListenerRef = useRef<((event: MouseEvent) => void) | null>(null);
  const mouseUpListenerRef = useRef<(() => void) | null>(null);
  const blurListenerRef = useRef<(() => void) | null>(null);

  const clearPendingExternalDrag = useCallback(() => {
    pendingExternalDragRef.current = null;
    if (moveListenerRef.current) {
      window.removeEventListener("mousemove", moveListenerRef.current);
      moveListenerRef.current = null;
    }
    if (mouseUpListenerRef.current) {
      window.removeEventListener("mouseup", mouseUpListenerRef.current);
      mouseUpListenerRef.current = null;
    }
    if (blurListenerRef.current) {
      window.removeEventListener("blur", blurListenerRef.current);
      blurListenerRef.current = null;
    }
  }, []);

  const beginTrackingExternalDrag = useCallback(() => {
    if (moveListenerRef.current || mouseUpListenerRef.current || blurListenerRef.current) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const current = pendingExternalDragRef.current;
      if (!current) {
        clearPendingExternalDrag();
        return;
      }

      if ((event.buttons & 1) !== 1) {
        clearPendingExternalDrag();
        return;
      }

      if (current.started) {
        return;
      }

      if (useSelectionStore.getState().isDraggingInternal) {
        clearPendingExternalDrag();
        return;
      }

      if (
        Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <
        EXTERNAL_DRAG_THRESHOLD
      ) {
        return;
      }

      current.started = true;
      clearPendingExternalDrag();
      useSelectionStore.getState().clearInternalFileDrag();

      void startExternalFileDrag(getExternalDragFileIds(fileId)).catch((error) => {
        console.error("Failed to start external file drag:", error);
        toast.error("拖拽到外部应用失败");
      });
    };

    const handleWindowMouseUp = () => {
      clearPendingExternalDrag();
    };

    const handleWindowBlur = () => {
      clearPendingExternalDrag();
    };

    moveListenerRef.current = handleWindowMouseMove;
    mouseUpListenerRef.current = handleWindowMouseUp;
    blurListenerRef.current = handleWindowBlur;

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("blur", handleWindowBlur);
  }, [clearPendingExternalDrag, fileId]);

  useEffect(() => clearPendingExternalDrag, [clearPendingExternalDrag]);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      pendingExternalDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      };
      beginTrackingExternalDrag();
    },
    [beginTrackingExternalDrag],
  );

  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const draggedFileIds = getInternalDragFileIds(fileId);
      const payload = JSON.stringify(draggedFileIds);

      clearPendingExternalDrag();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, payload);
      event.dataTransfer.setData("text/plain", payload);
    },
    [clearPendingExternalDrag, fileId],
  );

  const handleDragEnd = useCallback(() => {
    clearPendingExternalDrag();
    useSelectionStore.getState().clearInternalFileDrag();
  }, [clearPendingExternalDrag]);

  return {
    dragHandleProps: {
      draggable: true,
      "data-external-drag-region": "true",
      onMouseDown: handleMouseDown,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
    } as const,
  };
}
