import { useCallback, useEffect, type RefObject } from "react";
import type { FileItem } from "@/stores/fileTypes";
import type { LibraryViewMode } from "@/stores/settingsStore";
import { REQUEST_FOCUS_FIRST_FILE_EVENT } from "@/lib/libraryNavigation";
import { getNextFileGridIndex } from "@/components/file-grid/fileGridModel";
import {
  type AdaptiveLayoutItem,
  isDialogTarget,
  isEditableTarget,
} from "@/components/file-grid/fileGridLayout";

interface UseFileGridKeyboardNavigationOptions {
  adaptiveItems: AdaptiveLayoutItem[];
  clearSelection: () => void;
  files: FileItem[];
  gridColumns: number;
  gridRowHeight: number;
  gridRowSpan: number;
  isSelecting: boolean;
  listRowHeight: number;
  scrollParentRef: RefObject<HTMLDivElement | null>;
  selectedFile: FileItem | null;
  selectedFilesLength: number;
  setSelectedFile: (file: FileItem | null) => void;
  viewMode: LibraryViewMode;
}

export function useFileGridKeyboardNavigation({
  adaptiveItems,
  clearSelection,
  files,
  gridColumns,
  gridRowHeight,
  gridRowSpan,
  isSelecting,
  listRowHeight,
  scrollParentRef,
  selectedFile,
  selectedFilesLength,
  setSelectedFile,
  viewMode,
}: UseFileGridKeyboardNavigationOptions) {
  const scrollIndexIntoView = useCallback(
    (index: number) => {
      const container = scrollParentRef.current;
      if (!container) {
        return;
      }

      let itemTop = 0;
      let itemBottom = 0;

      if (viewMode === "list") {
        itemTop = index * listRowHeight;
        itemBottom = itemTop + listRowHeight;
      } else if (viewMode === "grid") {
        const row = Math.floor(index / gridColumns);
        itemTop = row * gridRowSpan;
        itemBottom = itemTop + gridRowHeight;
      } else {
        const item = adaptiveItems[index];
        if (!item) {
          return;
        }
        itemTop = item.top;
        itemBottom = item.top + item.height;
      }

      const padding = 24;
      const viewportTop = container.scrollTop;
      const viewportBottom = viewportTop + container.clientHeight;

      if (itemTop < viewportTop + padding) {
        container.scrollTo({ top: Math.max(0, itemTop - padding) });
        return;
      }

      if (itemBottom > viewportBottom - padding) {
        container.scrollTo({ top: Math.max(0, itemBottom - container.clientHeight + padding) });
      }
    },
    [
      adaptiveItems,
      gridColumns,
      gridRowHeight,
      gridRowSpan,
      listRowHeight,
      scrollParentRef,
      viewMode,
    ],
  );

  const focusGridContainer = useCallback(() => {
    scrollParentRef.current?.focus({ preventScroll: true });
  }, [scrollParentRef]);

  const selectFileAtIndex = useCallback(
    (index: number) => {
      const nextFile = files[index];
      focusGridContainer();

      if (!nextFile) {
        return;
      }

      if (selectedFilesLength > 0) {
        clearSelection();
      }

      setSelectedFile(nextFile);
      scrollIndexIntoView(index);
    },
    [
      clearSelection,
      files,
      focusGridContainer,
      scrollIndexIntoView,
      selectedFilesLength,
      setSelectedFile,
    ],
  );

  useEffect(() => {
    const handleRequestFocusFirstFile = () => {
      focusGridContainer();
      if (files.length === 0) {
        return;
      }

      selectFileAtIndex(0);
    };

    window.addEventListener(REQUEST_FOCUS_FIRST_FILE_EVENT, handleRequestFocusFirstFile);
    return () => {
      window.removeEventListener(REQUEST_FOCUS_FIRST_FILE_EVENT, handleRequestFocusFirstFile);
    };
  }, [files.length, focusGridContainer, selectFileAtIndex]);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isSelecting ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        return;
      }

      if (
        isEditableTarget(event.target) ||
        isDialogTarget(event.target) ||
        selectedFilesLength > 0 ||
        files.length === 0
      ) {
        return;
      }

      event.preventDefault();

      const currentIndex = selectedFile
        ? files.findIndex((file) => file.id === selectedFile.id)
        : -1;
      const nextIndex = getNextFileGridIndex({
        currentIndex,
        key: event.key,
        filteredFilesLength: files.length,
        viewMode,
        gridColumns,
        adaptiveItems,
      });

      if (nextIndex == null || nextIndex === currentIndex) {
        return;
      }

      selectFileAtIndex(nextIndex);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [
    adaptiveItems,
    files,
    gridColumns,
    isSelecting,
    selectedFile,
    selectedFilesLength,
    selectFileAtIndex,
    viewMode,
  ]);
}
