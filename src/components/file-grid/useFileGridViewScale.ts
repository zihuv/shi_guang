import { useCallback, useEffect, useRef, type WheelEvent as ReactWheelEvent } from "react";
import {
  clampLibraryViewScale,
  DEFAULT_LIBRARY_VIEW_SCALES,
  LIBRARY_VIEW_SCALE_STEP,
  type LibraryViewMode,
} from "@/stores/settingsStore";
import {
  isDialogTarget,
  isEditableTarget,
  VIEW_SCALE_KEYBOARD_STEP,
  VIEW_SCALE_WHEEL_SENSITIVITY,
} from "@/components/file-grid/fileGridLayout";

interface UseFileGridViewScaleOptions {
  currentViewScale: number;
  isSelecting: boolean;
  resetLibraryViewScale: (viewMode: LibraryViewMode) => void;
  setLibraryViewScale: (viewMode: LibraryViewMode, scale: number) => void;
  viewMode: LibraryViewMode;
}

export function useFileGridViewScale({
  currentViewScale,
  isSelecting,
  resetLibraryViewScale,
  setLibraryViewScale,
  viewMode,
}: UseFileGridViewScaleOptions) {
  const currentViewScaleRef = useRef(currentViewScale);
  const wheelScaleRemainderRef = useRef(0);

  useEffect(() => {
    currentViewScaleRef.current = currentViewScale;
  }, [currentViewScale]);

  useEffect(() => {
    wheelScaleRemainderRef.current = 0;
  }, [viewMode]);

  const applyCurrentViewScale = useCallback(
    (nextScale: number) => {
      const normalizedScale = clampLibraryViewScale(viewMode, nextScale);
      wheelScaleRemainderRef.current = 0;
      currentViewScaleRef.current = normalizedScale;
      setLibraryViewScale(viewMode, normalizedScale);
    },
    [setLibraryViewScale, viewMode],
  );

  const stepCurrentViewScale = useCallback(
    (direction: 1 | -1) => {
      applyCurrentViewScale(currentViewScaleRef.current + direction * VIEW_SCALE_KEYBOARD_STEP);
    },
    [applyCurrentViewScale],
  );

  const resetCurrentViewScale = useCallback(() => {
    wheelScaleRemainderRef.current = 0;
    currentViewScaleRef.current = DEFAULT_LIBRARY_VIEW_SCALES[viewMode];
    resetLibraryViewScale(viewMode);
  }, [resetLibraryViewScale, viewMode]);

  const handleViewportWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!(event.ctrlKey || event.metaKey) || isSelecting) {
        return;
      }

      if (isEditableTarget(event.target) || isDialogTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      wheelScaleRemainderRef.current += -event.deltaY * VIEW_SCALE_WHEEL_SENSITIVITY;
      const wholeSteps = Math.trunc(
        Math.abs(wheelScaleRemainderRef.current) / LIBRARY_VIEW_SCALE_STEP,
      );

      if (wholeSteps === 0) {
        return;
      }

      const delta =
        Math.sign(wheelScaleRemainderRef.current) * wholeSteps * LIBRARY_VIEW_SCALE_STEP;
      wheelScaleRemainderRef.current -= delta;

      const nextScale = clampLibraryViewScale(viewMode, currentViewScaleRef.current + delta);
      currentViewScaleRef.current = nextScale;
      setLibraryViewScale(viewMode, nextScale);
    },
    [isSelecting, setLibraryViewScale, viewMode],
  );

  useEffect(() => {
    const handleWindowZoomKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        isSelecting
      ) {
        return;
      }

      if (isEditableTarget(event.target) || isDialogTarget(event.target)) {
        return;
      }

      let handled = true;

      switch (event.key) {
        case "+":
        case "=":
        case "NumpadAdd":
          stepCurrentViewScale(1);
          break;
        case "-":
        case "_":
        case "NumpadSubtract":
          stepCurrentViewScale(-1);
          break;
        case "0":
        case "Numpad0":
          resetCurrentViewScale();
          break;
        default:
          handled = false;
          break;
      }

      if (!handled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleWindowZoomKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowZoomKeyDown);
    };
  }, [isSelecting, resetCurrentViewScale, stepCurrentViewScale]);

  return {
    applyCurrentViewScale,
    handleViewportWheel,
    resetCurrentViewScale,
  };
}
