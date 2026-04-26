import { useCallback, type DragEvent as ReactDragEvent } from "react";
import { INTERNAL_FILE_DRAG_MIME } from "@/components/folder-tree/utils";
import { useSelectionStore } from "@/stores/selectionStore";

function getInternalDragFileIds(fileId: number) {
  return useSelectionStore.getState().beginInternalFileDrag(fileId);
}

function createMultiFileDragImage(sourceElement: HTMLElement, count: number) {
  const rect = sourceElement.getBoundingClientRect();
  const previewWidth = Math.max(72, Math.min(150, rect.width));
  const previewHeight = Math.max(72, Math.min(150, rect.height));

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "-10000px";
  container.style.width = `${previewWidth + 18}px`;
  container.style.height = `${previewHeight + 18}px`;
  container.style.pointerEvents = "none";

  const createLayer = (offset: number, opacity: string) => {
    const layer = document.createElement("div");
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.width = `${previewWidth}px`;
    layer.style.height = `${previewHeight}px`;
    layer.style.transform = `translate(${offset}px, ${offset}px)`;
    layer.style.borderRadius = "16px";
    layer.style.background = "rgba(255,255,255,0.95)";
    layer.style.boxShadow = "0 12px 30px rgba(15,23,42,0.22)";
    layer.style.opacity = opacity;
    return layer;
  };

  const clone = sourceElement.cloneNode(true) as HTMLElement;
  clone.style.width = `${previewWidth}px`;
  clone.style.height = `${previewHeight}px`;
  clone.style.overflow = "hidden";
  clone.style.borderRadius = "16px";
  clone.style.background = "white";
  clone.style.boxShadow = "0 18px 38px rgba(15,23,42,0.28)";
  clone.style.transform = "translate(0, 0)";

  const badge = document.createElement("div");
  badge.textContent = String(count);
  badge.style.position = "absolute";
  badge.style.right = "0";
  badge.style.top = "0";
  badge.style.minWidth = "28px";
  badge.style.height = "28px";
  badge.style.padding = "0 8px";
  badge.style.display = "flex";
  badge.style.alignItems = "center";
  badge.style.justifyContent = "center";
  badge.style.borderRadius = "999px";
  badge.style.background = "#2563eb";
  badge.style.color = "white";
  badge.style.fontSize = "13px";
  badge.style.fontWeight = "700";
  badge.style.boxShadow = "0 8px 18px rgba(37,99,235,0.35)";

  container.append(createLayer(14, "0.45"), createLayer(7, "0.72"), clone, badge);
  document.body.appendChild(container);

  return {
    element: container,
    offsetX: Math.round(previewWidth / 2),
    offsetY: Math.round(previewHeight / 2),
    cleanup: () => container.remove(),
  };
}

export function useExternalFileDrag(fileId: number) {
  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const draggedFileIds = getInternalDragFileIds(fileId);
      const payload = JSON.stringify(draggedFileIds);

      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, payload);
      event.dataTransfer.setData("text/plain", payload);

      if (draggedFileIds.length > 1) {
        const dragImage = createMultiFileDragImage(event.currentTarget, draggedFileIds.length);
        event.dataTransfer.setDragImage(dragImage.element, dragImage.offsetX, dragImage.offsetY);
        window.setTimeout(dragImage.cleanup, 0);
      }
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
