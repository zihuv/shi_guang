import { useCallback, type DragEvent as ReactDragEvent } from "react";
import { INTERNAL_FILE_DRAG_MIME } from "@/components/folder-tree/utils";
import { useSelectionStore } from "@/stores/selectionStore";

function getInternalDragFileIds(fileId: number) {
  return useSelectionStore.getState().beginInternalFileDrag(fileId);
}

export function useExternalFileDrag(fileId: number) {
  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const draggedFileIds = getInternalDragFileIds(fileId);
      const payload = JSON.stringify(draggedFileIds);

      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, payload);
      event.dataTransfer.setData("text/plain", payload);
    },
    [fileId],
  );

  const handleDragEnd = useCallback(() => {
    useSelectionStore.getState().clearInternalFileDrag();
  }, []);

  return {
    dragHandleProps: {
      draggable: true,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
    } as const,
  };
}
