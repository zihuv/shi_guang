import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type FileItem } from "@/stores/fileTypes";
import {
  BASE_WHEEL_ZOOM_SENSITIVITY,
  BUTTON_ZOOM_FACTOR,
  FIT_MODE_SNAP_EPSILON,
  clampValue,
  clampZoom,
} from "@/components/image-preview/constants";

type ZoomValue = number | "auto";

export function usePreviewZoomPan({
  currentFile,
  loadedImageSize,
  isFullscreen,
  isImageLike,
  previewIndex,
  previewMode,
  previewTrackpadZoomSpeed,
}: {
  currentFile: FileItem | undefined;
  loadedImageSize: { width: number; height: number };
  isFullscreen: boolean;
  isImageLike: boolean;
  previewIndex: number;
  previewMode: boolean;
  previewTrackpadZoomSpeed: number;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<ZoomValue>("auto");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const previousZoomRef = useRef<ZoomValue>("auto");
  const shouldCenterImageRef = useRef(false);
  const lastPreviewFileIdRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  const supportsZoom = isImageLike;
  const isFitMode = zoom === "auto";
  const canPanImage = isImageLike && !isFitMode;
  const manualZoomScale = typeof zoom === "number" ? zoom / 100 : 1;
  const imageWidth =
    currentFile && currentFile.width > 0
      ? currentFile.width
      : loadedImageSize.width > 0
        ? loadedImageSize.width
        : null;
  const imageHeight =
    currentFile && currentFile.height > 0
      ? currentFile.height
      : loadedImageSize.height > 0
        ? loadedImageSize.height
        : null;
  const fitZoomPercent =
    imageWidth && imageHeight && viewportSize.width > 0 && viewportSize.height > 0
      ? clampZoom(
          Math.min(
            100,
            Math.floor(
              Math.min(
                Math.max(1, viewportSize.width - 32) / imageWidth,
                Math.max(1, viewportSize.height - 32) / imageHeight,
              ) * 100,
            ),
          ),
        )
      : 100;
  const scaledImageWidth =
    !isFitMode && imageWidth ? Math.max(1, Math.round(imageWidth * manualZoomScale)) : null;
  const scaledImageHeight =
    !isFitMode && imageHeight ? Math.max(1, Math.round(imageHeight * manualZoomScale)) : null;

  useEffect(() => {
    if (!currentFile) {
      lastPreviewFileIdRef.current = null;
      return;
    }

    const previousFileId = lastPreviewFileIdRef.current;
    if (previousFileId !== null && previousFileId !== currentFile.id) {
      shouldCenterImageRef.current = false;
      pendingScrollRef.current = null;
      setZoom("auto");
      panStateRef.current = null;
      setIsPanning(false);
    }

    lastPreviewFileIdRef.current = currentFile.id;
  }, [currentFile]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const updateViewportSize = () => {
      setViewportSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateViewportSize();

    const observer = new ResizeObserver(() => {
      updateViewportSize();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [isFullscreen, previewIndex, previewMode]);

  useLayoutEffect(() => {
    const container = viewportRef.current;
    if (!container) {
      previousZoomRef.current = zoom;
      return;
    }

    if (zoom === "auto") {
      pendingScrollRef.current = null;
      container.scrollLeft = 0;
      container.scrollTop = 0;
      shouldCenterImageRef.current = false;
      previousZoomRef.current = zoom;
      return;
    }

    const pendingScroll = pendingScrollRef.current;
    if (pendingScroll) {
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

      container.scrollLeft = clampValue(pendingScroll.left, 0, maxScrollLeft);
      container.scrollTop = clampValue(pendingScroll.top, 0, maxScrollTop);
      pendingScrollRef.current = null;
      shouldCenterImageRef.current = false;
      previousZoomRef.current = zoom;
      return;
    }

    if (previousZoomRef.current === "auto" || shouldCenterImageRef.current) {
      container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
      container.scrollTop = Math.max(0, (container.scrollHeight - container.clientHeight) / 2);
      shouldCenterImageRef.current = false;
    }

    previousZoomRef.current = zoom;
  }, [isFullscreen, previewIndex, viewportSize.height, viewportSize.width, zoom]);

  const applyZoom = useCallback(
    (
      nextZoomInput: number | ((currentZoom: number) => number),
      anchor?: { x: number; y: number },
    ) => {
      const container = viewportRef.current;
      if (!container) return;

      const anchorX = anchor?.x ?? container.clientWidth / 2;
      const anchorY = anchor?.y ?? container.clientHeight / 2;
      const currentScrollLeft = container.scrollLeft;
      const currentScrollTop = container.scrollTop;

      setZoom((prevZoom) => {
        const baseZoom = prevZoom === "auto" ? fitZoomPercent : prevZoom;
        const nextZoom = clampZoom(
          typeof nextZoomInput === "function" ? nextZoomInput(baseZoom) : nextZoomInput,
        );

        if (nextZoom <= fitZoomPercent + FIT_MODE_SNAP_EPSILON) {
          pendingScrollRef.current = null;
          shouldCenterImageRef.current = false;
          return "auto";
        }

        const currentScale = baseZoom / 100;
        const nextScale = nextZoom / 100;

        if (imageWidth && imageHeight) {
          const currentCanvasWidth = Math.max(imageWidth * currentScale, viewportSize.width);
          const currentCanvasHeight = Math.max(imageHeight * currentScale, viewportSize.height);
          const currentImageOffsetLeft = Math.max(
            0,
            (currentCanvasWidth - imageWidth * currentScale) / 2,
          );
          const currentImageOffsetTop = Math.max(
            0,
            (currentCanvasHeight - imageHeight * currentScale) / 2,
          );
          const nextCanvasWidth = Math.max(imageWidth * nextScale, viewportSize.width);
          const nextCanvasHeight = Math.max(imageHeight * nextScale, viewportSize.height);
          const nextImageOffsetLeft = Math.max(0, (nextCanvasWidth - imageWidth * nextScale) / 2);
          const nextImageOffsetTop = Math.max(0, (nextCanvasHeight - imageHeight * nextScale) / 2);

          const imageCoordinateX = clampValue(
            (currentScrollLeft + anchorX - currentImageOffsetLeft) / currentScale,
            0,
            imageWidth,
          );
          const imageCoordinateY = clampValue(
            (currentScrollTop + anchorY - currentImageOffsetTop) / currentScale,
            0,
            imageHeight,
          );

          pendingScrollRef.current = {
            left: nextImageOffsetLeft + imageCoordinateX * nextScale - anchorX,
            top: nextImageOffsetTop + imageCoordinateY * nextScale - anchorY,
          };
        } else {
          shouldCenterImageRef.current = true;
        }

        return Math.round(nextZoom * 100) / 100;
      });
    },
    [fitZoomPercent, imageHeight, imageWidth, viewportSize.height, viewportSize.width],
  );

  const handleZoomOut = () => {
    applyZoom((currentZoom) => currentZoom / BUTTON_ZOOM_FACTOR);
  };

  const handleZoomIn = () => {
    applyZoom((currentZoom) => currentZoom * BUTTON_ZOOM_FACTOR);
  };

  const handleNativeWheel = useCallback(
    (event: WheelEvent) => {
      if (!supportsZoom) return;
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const container = viewportRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const deltaY =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;

      applyZoom(
        (currentZoom) =>
          currentZoom * Math.exp(-deltaY * BASE_WHEEL_ZOOM_SENSITIVITY * previewTrackpadZoomSpeed),
        {
          x: pointerX,
          y: pointerY,
        },
      );
    },
    [applyZoom, previewTrackpadZoomSpeed, supportsZoom],
  );

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleNativeWheel);
    };
  }, [handleNativeWheel, isFullscreen, previewIndex, previewMode]);

  const finishPan = (pointerId: number) => {
    const container = viewportRef.current;
    if (container?.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId);
    }
    panStateRef.current = null;
    setIsPanning(false);
  };

  const handleFitToView = () => {
    const panState = panStateRef.current;
    if (panState) {
      finishPan(panState.pointerId);
    }

    pendingScrollRef.current = null;
    shouldCenterImageRef.current = false;
    setZoom("auto");
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPanImage || event.button !== 0) return;

    const container = viewportRef.current;
    if (!container) return;

    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    container.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    const container = viewportRef.current;
    if (!panState || !container || panState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    container.scrollLeft = panState.scrollLeft - deltaX;
    container.scrollTop = panState.scrollTop - deltaY;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) return;
    finishPan(event.pointerId);
  };

  return {
    viewportRef,
    viewportSize,
    supportsZoom,
    isFitMode,
    canPanImage,
    isPanning,
    scaledImageWidth,
    scaledImageHeight,
    handleZoomOut,
    handleZoomIn,
    handleFitToView,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
