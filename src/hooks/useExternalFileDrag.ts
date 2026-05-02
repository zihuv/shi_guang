import { useCallback, type DragEvent as ReactDragEvent } from "react";
import { INTERNAL_FILE_DRAG_MIME } from "@/components/folder-tree/utils";
import { useSelectionStore } from "@/stores/selectionStore";

const DRAG_PREVIEW_SIZE = 80;

function getInternalDragFileIds(fileId: number) {
  return useSelectionStore.getState().beginInternalFileDrag(fileId);
}

function findThumbnailImg(element: HTMLElement): HTMLImageElement | null {
  return element.querySelector("img");
}

function findFileExt(element: HTMLElement): string {
  const uppercaseSpan = element.querySelector(".uppercase");
  if (uppercaseSpan?.textContent) {
    return uppercaseSpan.textContent.trim();
  }
  return "";
}

function createFileIconSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.width = "28px";
  svg.style.height = "28px";
  svg.style.color = "#9ca3af";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "14 2 14 8 20 8");
  svg.append(path, polyline);
  return svg;
}

function createFallbackPreview(ext: string, size: number): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.gap = "4px";
  wrapper.style.borderRadius = "12px";
  wrapper.style.background = "#f3f4f6";
  wrapper.style.color = "#6b7280";
  wrapper.style.fontSize = "11px";
  wrapper.style.fontWeight = "600";
  wrapper.style.textTransform = "uppercase";

  wrapper.appendChild(createFileIconSvg());
  if (ext) {
    const label = document.createElement("span");
    label.textContent = ext;
    wrapper.appendChild(label);
  }
  return wrapper;
}

function createDragImage(sourceElement: HTMLElement, count: number) {
  const size = DRAG_PREVIEW_SIZE;
  const offsetX = Math.round(size / 2);
  const offsetY = Math.round(size / 2);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "-10000px";
  container.style.pointerEvents = "none";

  if (count > 1) {
    container.style.width = `${size + 18}px`;
    container.style.height = `${size + 18}px`;

    const createLayer = (offset: number, opacity: string) => {
      const layer = document.createElement("div");
      layer.style.position = "absolute";
      layer.style.inset = "0";
      layer.style.width = `${size}px`;
      layer.style.height = `${size}px`;
      layer.style.transform = `translate(${offset}px, ${offset}px)`;
      layer.style.borderRadius = "12px";
      layer.style.background = "rgba(255,255,255,0.95)";
      layer.style.boxShadow = "0 12px 30px rgba(15,23,42,0.22)";
      layer.style.opacity = opacity;
      return layer;
    };

    const main = document.createElement("div");
    main.style.width = `${size}px`;
    main.style.height = `${size}px`;
    main.style.overflow = "hidden";
    main.style.borderRadius = "12px";
    main.style.background = "white";
    main.style.boxShadow = "0 18px 38px rgba(15,23,42,0.28)";
    main.style.transform = "translate(0, 0)";
    main.style.position = "relative";

    const img = findThumbnailImg(sourceElement);
    if (img?.src) {
      const previewImg = document.createElement("img");
      previewImg.src = img.src;
      previewImg.style.width = "100%";
      previewImg.style.height = "100%";
      previewImg.style.objectFit = "contain";
      main.appendChild(previewImg);
    } else {
      const ext = findFileExt(sourceElement);
      main.appendChild(createFallbackPreview(ext, size));
    }

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

    container.append(createLayer(14, "0.45"), createLayer(7, "0.72"), main, badge);
  } else {
    container.style.width = `${size}px`;
    container.style.height = `${size}px`;

    const wrapper = document.createElement("div");
    wrapper.style.width = `${size}px`;
    wrapper.style.height = `${size}px`;
    wrapper.style.overflow = "hidden";
    wrapper.style.borderRadius = "12px";
    wrapper.style.background = "white";
    wrapper.style.boxShadow = "0 12px 30px rgba(15,23,42,0.22)";

    const img = findThumbnailImg(sourceElement);
    if (img?.src) {
      const previewImg = document.createElement("img");
      previewImg.src = img.src;
      previewImg.style.width = "100%";
      previewImg.style.height = "100%";
      previewImg.style.objectFit = "contain";
      wrapper.appendChild(previewImg);
    } else {
      const ext = findFileExt(sourceElement);
      wrapper.appendChild(createFallbackPreview(ext, size));
    }

    container.appendChild(wrapper);
  }

  document.body.appendChild(container);

  return {
    element: container,
    offsetX,
    offsetY,
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

      const dragImage = createDragImage(event.currentTarget, draggedFileIds.length);
      event.dataTransfer.setDragImage(dragImage.element, dragImage.offsetX, dragImage.offsetY);
      window.setTimeout(dragImage.cleanup, 0);
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
