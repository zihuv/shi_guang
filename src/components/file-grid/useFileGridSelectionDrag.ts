import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { type FileItem } from "@/stores/fileTypes";
import {
  getPointerPositionInScrollContainer,
  getSelectionBounds,
  isCardIntersectingSelection,
  SELECTION_DRAG_THRESHOLD,
  type SelectionBox,
} from "@/components/file-grid/fileGridLayout";

export function useFileGridSelectionDrag({
  scrollParentRef,
  selectedFile,
  selectedFilesLength,
  clearSelection,
  setSelectedFile,
  setSelectedFiles,
}: {
  scrollParentRef: RefObject<HTMLDivElement | null>;
  selectedFile: FileItem | null;
  selectedFilesLength: number;
  clearSelection: () => void;
  setSelectedFile: (file: FileItem | null) => void;
  setSelectedFiles: (fileIds: number[]) => void;
}) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);

  useEffect(() => {
    selectionBoxRef.current = selectionBox;
  }, [selectionBox]);

  const handleSelectionStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest(".file-card")) {
      return;
    }

    const container = scrollParentRef.current;
    if (!container) {
      return;
    }

    container.focus({ preventScroll: true });

    if (selectedFilesLength > 0) {
      clearSelection();
    }
    if (selectedFile) {
      setSelectedFile(null);
    }

    setIsSelecting(true);
    const startPoint = getPointerPositionInScrollContainer(event.clientX, event.clientY, container);

    setSelectionBox({
      startX: startPoint.x,
      startY: startPoint.y,
      endX: startPoint.x,
      endY: startPoint.y,
    });
  };

  useEffect(() => {
    if (!isSelecting) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const container = scrollParentRef.current;
      if (!container) {
        return;
      }

      setSelectionBox((current) => {
        if (!current) {
          return current;
        }

        const point = getPointerPositionInScrollContainer(event.clientX, event.clientY, container);
        return {
          ...current,
          endX: point.x,
          endY: point.y,
        };
      });
    };

    const handleWindowMouseUp = () => {
      const container = scrollParentRef.current;
      const currentSelectionBox = selectionBoxRef.current;

      if (container && currentSelectionBox) {
        const bounds = getSelectionBounds(currentSelectionBox);

        if (Math.max(bounds.width, bounds.height) > SELECTION_DRAG_THRESHOLD) {
          const containerRect = container.getBoundingClientRect();
          const nextSelectedFiles = Array.from(container.querySelectorAll(".file-card"))
            .map((card) => {
              if (
                !isCardIntersectingSelection(
                  card.getBoundingClientRect(),
                  containerRect,
                  container,
                  bounds,
                )
              ) {
                return null;
              }

              const fileId = Number(card.getAttribute("data-file-id") || "0");
              return fileId > 0 ? fileId : null;
            })
            .filter((fileId): fileId is number => fileId !== null);

          setSelectedFiles(nextSelectedFiles);
          setSelectedFile(null);
        }
      }

      selectionBoxRef.current = null;
      setIsSelecting(false);
      setSelectionBox(null);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isSelecting, scrollParentRef, setSelectedFile, setSelectedFiles]);

  return {
    isSelecting,
    selectionBox,
    handleSelectionStart,
  };
}
