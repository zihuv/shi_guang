import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type FileItem } from "@/stores/fileTypes";
import { useFilterStore } from "@/stores/filterStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";
import {
  clampLibraryViewScale,
  DEFAULT_LIBRARY_VIEW_SCALES,
  getLibraryViewScaleRange,
  LIBRARY_VIEW_SCALE_STEP,
  type LibraryViewMode,
  useSettingsStore,
} from "@/stores/settingsStore";
import { useTrashStore } from "@/stores/trashStore";
import { getActiveFilterCount } from "@/features/filters/schema";
import { REQUEST_FOCUS_FIRST_FILE_EVENT } from "@/lib/libraryNavigation";
import {
  buildAdaptiveLayout,
  findAdaptiveNeighborIndex,
  getAdaptiveFooterHeight,
  getGridMetadataHeight,
  getPointerPositionInScrollContainer,
  getSelectionBounds,
  GRID_GAP,
  GRID_PREVIEW_HEIGHT_RATIO,
  isCardIntersectingSelection,
  isDialogTarget,
  isEditableTarget,
  LIST_BASE_ROW_HEIGHT,
  LIST_BASE_THUMBNAIL_SIZE,
  resolvePackedTileColumns,
  SELECTION_DRAG_THRESHOLD,
  type SelectionBox,
  TILE_CARD_BASE_WIDTH,
  TILE_CARD_MAX_WIDTH,
  TILE_CARD_MIN_WIDTH,
  SINGLE_TILE_CARD_MAX_WIDTH,
  SINGLE_TILE_CARD_SCALE_MULTIPLIER,
  VIEW_SCALE_KEYBOARD_STEP,
  VIEW_SCALE_WHEEL_SENSITIVITY,
} from "@/components/file-grid/fileGridLayout";
import {
  FileGridPagination,
  FileGridSelectionBar,
  FileGridToolbar,
  type ToolbarMenu,
} from "@/components/file-grid/FileGridChrome";
import {
  prewarmThumbHashPlaceholders,
  prewarmThumbnailImageSources,
} from "@/components/file-grid/fileGridCards";
import { FileGridViewport } from "@/components/file-grid/FileGridViewport";

const SORT_FIELD_LABELS: Record<string, string> = {
  imported_at: "导入时间",
  created_at: "创建时间",
  modified_at: "修改时间",
  name: "名称",
  ext: "类型",
  size: "文件大小",
};

const VIEW_MODE_LABELS: Record<LibraryViewMode, string> = {
  grid: "网格",
  adaptive: "自适应",
  list: "列表",
};

const INFO_FIELD_LABELS = {
  name: "名称",
  ext: "类型",
  size: "文件大小",
  dimensions: "尺寸",
  tags: "标签",
} as const;

export default function FileGrid() {
  const files = useLibraryQueryStore((state) => state.files);
  const isLoading = useLibraryQueryStore((state) => state.isLoading);
  const pagination = useLibraryQueryStore((state) => state.pagination);
  const runCurrentQuery = useLibraryQueryStore((state) => state.runCurrentQuery);
  const setPage = useLibraryQueryStore((state) => state.setPage);
  const setPageSize = useLibraryQueryStore((state) => state.setPageSize);
  const resetPage = useLibraryQueryStore((state) => state.resetPage);
  const selectedFile = useSelectionStore((state) => state.selectedFile);
  const selectedFiles = useSelectionStore((state) => state.selectedFiles);
  const setSelectedFile = useSelectionStore((state) => state.setSelectedFile);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const setSelectedFiles = useSelectionStore((state) => state.setSelectedFiles);
  const openPreview = usePreviewStore((state) => state.openPreview);
  const deleteFiles = useTrashStore((state) => state.deleteFiles);
  const isFilterPanelOpen = useFilterStore((state) => state.isFilterPanelOpen);
  const setFilterPanelOpen = useFilterStore((state) => state.setFilterPanelOpen);
  const toggleFilterPanel = useFilterStore((state) => state.toggleFilterPanel);
  const activeFilterCount = useFilterStore((state) => getActiveFilterCount(state.criteria));
  const sortBy = useFilterStore((state) => state.criteria.sortBy);
  const sortDirection = useFilterStore((state) => state.criteria.sortDirection);
  const setSortBy = useFilterStore((state) => state.setSortBy);
  const setSortDirection = useFilterStore((state) => state.setSortDirection);
  const viewMode = useSettingsStore((state) => state.libraryViewMode);
  const libraryViewScales = useSettingsStore((state) => state.libraryViewScales);
  const libraryVisibleFields = useSettingsStore((state) => state.libraryVisibleFields);
  const setLibraryViewMode = useSettingsStore((state) => state.setLibraryViewMode);
  const setLibraryViewScale = useSettingsStore((state) => state.setLibraryViewScale);
  const resetLibraryViewScale = useSettingsStore((state) => state.resetLibraryViewScale);
  const toggleLibraryVisibleField = useSettingsStore((state) => state.toggleLibraryVisibleField);
  const filteredFiles = files;
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<ToolbarMenu | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollDirection, setScrollDirection] = useState<"forward" | "backward">("forward");

  const scrollParentRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuButtonRef = useRef<HTMLButtonElement>(null);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  const layoutMenuButtonRef = useRef<HTMLButtonElement>(null);
  const infoMenuRef = useRef<HTMLDivElement>(null);
  const infoMenuButtonRef = useRef<HTMLButtonElement>(null);
  const currentViewScaleRef = useRef(
    viewMode === "list" ? libraryViewScales.list : libraryViewScales.grid,
  );
  const wheelScaleRemainderRef = useRef(0);
  const sortDidMountRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const previousScrollTopRef = useRef(0);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);
  const tileViewScale = libraryViewScales.grid;
  const gridViewScale = tileViewScale;
  const listViewScale = libraryViewScales.list;
  const currentViewScale = viewMode === "list" ? listViewScale : tileViewScale;
  const currentViewScaleRange = getLibraryViewScaleRange(viewMode);
  const currentSortFieldLabel = SORT_FIELD_LABELS[sortBy] ?? "导入时间";
  const currentSortDirectionLabel = sortDirection === "asc" ? "升序" : "降序";
  const currentViewModeLabel = VIEW_MODE_LABELS[viewMode] ?? "网格";
  const visibleInfoFieldLabels = libraryVisibleFields.map((field) => INFO_FIELD_LABELS[field]);

  useEffect(() => {
    selectionBoxRef.current = selectionBox;
  }, [selectionBox]);

  useEffect(() => {
    currentViewScaleRef.current = currentViewScale;
  }, [currentViewScale]);

  useEffect(() => {
    wheelScaleRemainderRef.current = 0;
  }, [viewMode]);

  useEffect(() => {
    if (!sortDidMountRef.current) {
      sortDidMountRef.current = true;
      return;
    }

    resetPage();
    void runCurrentQuery();
  }, [resetPage, runCurrentQuery, sortBy, sortDirection]);

  useEffect(() => {
    if (!openToolbarMenu && !isFilterPanelOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (
        filterMenuRef.current?.contains(target) ||
        filterMenuButtonRef.current?.contains(target)
      ) {
        return;
      }

      const activeMenuRef =
        openToolbarMenu === "sort"
          ? sortMenuRef
          : openToolbarMenu === "layout"
            ? layoutMenuRef
            : infoMenuRef;
      const activeButtonRef =
        openToolbarMenu === "sort"
          ? sortMenuButtonRef
          : openToolbarMenu === "layout"
            ? layoutMenuButtonRef
            : infoMenuButtonRef;

      if (activeMenuRef.current?.contains(target) || activeButtonRef.current?.contains(target)) {
        return;
      }

      if (openToolbarMenu) {
        setOpenToolbarMenu(null);
      }

      if (isFilterPanelOpen) {
        setFilterPanelOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openToolbarMenu) {
          setOpenToolbarMenu(null);
        }
        if (isFilterPanelOpen) {
          setFilterPanelOpen(false);
        }
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFilterPanelOpen, openToolbarMenu, setFilterPanelOpen]);

  useEffect(() => {
    const element = scrollParentRef.current;
    if (!element) return;

    const updateWidth = () => {
      const styles = window.getComputedStyle(element);
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft || "0") +
        Number.parseFloat(styles.paddingRight || "0");
      const verticalPadding =
        Number.parseFloat(styles.paddingTop || "0") +
        Number.parseFloat(styles.paddingBottom || "0");

      setContainerWidth(Math.max(0, element.clientWidth - horizontalPadding));
      setViewportHeight(Math.max(0, element.clientHeight - verticalPadding));
      pendingScrollTopRef.current = element.scrollTop;
      setScrollTop(element.scrollTop);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    const handleScroll = () => {
      pendingScrollTopRef.current = element.scrollTop;
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const nextScrollTop = pendingScrollTopRef.current;
        if (nextScrollTop !== previousScrollTopRef.current) {
          setScrollDirection(
            nextScrollTop > previousScrollTopRef.current ? "forward" : "backward",
          );
          previousScrollTopRef.current = nextScrollTop;
        }
        setScrollTop(nextScrollTop);
      });
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      observer.disconnect();
      element.removeEventListener("scroll", handleScroll);
    };
  }, [isLoading, files.length]);

  const tileTargetWidth = Math.max(
    TILE_CARD_MIN_WIDTH,
    Math.min(TILE_CARD_MAX_WIDTH, Math.round(TILE_CARD_BASE_WIDTH * tileViewScale)),
  );
  const gridMinWidth = tileTargetWidth;
  const gridMetadataHeight = getGridMetadataHeight(gridViewScale, libraryVisibleFields);
  const listRowHeight = Math.max(42, Math.round(LIST_BASE_ROW_HEIGHT * listViewScale));
  const listThumbnailSize = Math.max(28, Math.round(LIST_BASE_THUMBNAIL_SIZE * listViewScale));
  const adaptiveTargetWidth = tileTargetWidth;
  const contentWidth = Math.max(0, containerWidth);
  const singleVisibleFile = filteredFiles.length === 1 ? filteredFiles[0] : null;
  const singleBaseWidth = Math.round(tileTargetWidth * SINGLE_TILE_CARD_SCALE_MULTIPLIER);
  const singleGridWidth = singleVisibleFile
    ? Math.max(
        TILE_CARD_MIN_WIDTH,
        Math.min(contentWidth, SINGLE_TILE_CARD_MAX_WIDTH, singleBaseWidth),
      )
    : null;
  const singleAdaptiveWidthCap = useMemo(() => {
    if (!singleVisibleFile) {
      return null;
    }

    const baseCap = Math.min(contentWidth, SINGLE_TILE_CARD_MAX_WIDTH);
    if (
      !singleVisibleFile.width ||
      !singleVisibleFile.height ||
      singleVisibleFile.width <= 0 ||
      singleVisibleFile.height <= 0 ||
      viewportHeight <= 0
    ) {
      return Math.max(TILE_CARD_MIN_WIDTH, Math.min(baseCap, singleBaseWidth));
    }

    const footerHeight = getAdaptiveFooterHeight(singleVisibleFile, libraryVisibleFields);
    const maxCardHeight = Math.max(360, viewportHeight - 48);
    const maxImageHeight = Math.max(240, maxCardHeight - footerHeight);
    const widthByHeight = Math.floor((maxImageHeight * singleVisibleFile.width) / singleVisibleFile.height);

    return Math.max(TILE_CARD_MIN_WIDTH, Math.min(baseCap, singleBaseWidth, widthByHeight));
  }, [contentWidth, libraryVisibleFields, singleBaseWidth, singleVisibleFile, viewportHeight]);
  const gridLayout = useMemo(
    () => {
      if (singleGridWidth != null) {
        return {
          columns: 1,
          itemWidth: singleGridWidth,
          trackWidth: singleGridWidth,
        };
      }

      return resolvePackedTileColumns({
        containerWidth: contentWidth,
        preferredWidth: gridMinWidth,
        minWidth: TILE_CARD_MIN_WIDTH,
        itemCount: filteredFiles.length,
      });
    },
    [contentWidth, filteredFiles.length, gridMinWidth, singleGridWidth],
  );
  const gridColumns = gridLayout.columns;
  const gridItemWidth = gridLayout.itemWidth;
  const gridTrackWidth = gridLayout.trackWidth;
  const gridPreviewHeight = Math.ceil(gridItemWidth * GRID_PREVIEW_HEIGHT_RATIO);
  const gridRowHeight = gridPreviewHeight + gridMetadataHeight;
  const gridRowSpan = gridRowHeight + GRID_GAP;
  const gridRowCount = Math.ceil(filteredFiles.length / gridColumns);
  const leadingOverscanPx = Math.max(320, Math.min(960, Math.round(viewportHeight * 0.75)));
  const trailingOverscanPx = Math.max(960, Math.min(2200, Math.round(viewportHeight * 2)));
  const overscanBeforePx = scrollDirection === "forward" ? leadingOverscanPx : trailingOverscanPx;
  const overscanAfterPx = scrollDirection === "forward" ? trailingOverscanPx : leadingOverscanPx;
  const gridVisibleStartRow = Math.max(
    0,
    Math.floor((scrollTop - overscanBeforePx) / Math.max(gridRowSpan, 1)),
  );
  const gridVisibleEndRow = Math.min(
    Math.max(0, gridRowCount - 1),
    Math.ceil((scrollTop + viewportHeight + overscanAfterPx) / Math.max(gridRowSpan, 1)),
  );
  const gridVirtualRows = useMemo(
    () =>
      gridRowCount > 0
        ? Array.from(
            { length: Math.max(0, gridVisibleEndRow - gridVisibleStartRow + 1) },
            (_, idx) => gridVisibleStartRow + idx,
          )
        : [],
    [gridRowCount, gridVisibleEndRow, gridVisibleStartRow],
  );
  const adaptiveLayoutColumns = useMemo(
    () => {
      if (singleAdaptiveWidthCap != null) {
        return {
          columns: 1,
          itemWidth: singleAdaptiveWidthCap,
          trackWidth: singleAdaptiveWidthCap,
        };
      }

      return resolvePackedTileColumns({
        containerWidth: contentWidth,
        preferredWidth: adaptiveTargetWidth,
        minWidth: TILE_CARD_MIN_WIDTH,
        itemCount: filteredFiles.length,
      });
    },
    [adaptiveTargetWidth, contentWidth, filteredFiles.length, singleAdaptiveWidthCap],
  );
  const adaptiveColumns = adaptiveLayoutColumns.columns;
  const adaptiveColumnWidth = adaptiveLayoutColumns.itemWidth;
  const adaptiveLayout = useMemo(
    () =>
      buildAdaptiveLayout(
        filteredFiles,
        adaptiveColumns,
        adaptiveColumnWidth,
        libraryVisibleFields,
      ),
    [adaptiveColumnWidth, adaptiveColumns, filteredFiles, libraryVisibleFields],
  );
  const adaptiveVisibleStart = scrollTop - overscanBeforePx;
  const adaptiveVisibleEnd = scrollTop + viewportHeight + overscanAfterPx;
  const adaptiveVisibleItems = useMemo(
    () =>
      adaptiveLayout.items.filter(
        (item) => item.top + item.height >= adaptiveVisibleStart && item.top <= adaptiveVisibleEnd,
      ),
    [adaptiveLayout.items, adaptiveVisibleEnd, adaptiveVisibleStart],
  );
  const listOverscanRows = Math.max(
    12,
    Math.min(
      48,
      Math.ceil((Math.max(viewportHeight, listRowHeight) / Math.max(listRowHeight, 1)) * 2),
    ),
  );

  const listRowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => listRowHeight,
    overscan: listOverscanRows,
  });

  useEffect(() => {
    listRowVirtualizer.measure();
  }, [listRowHeight, listRowVirtualizer]);
  const listVirtualItems = listRowVirtualizer.getVirtualItems();
  const listTotalSize = listRowVirtualizer.getTotalSize();

  useEffect(() => {
    if (!filteredFiles.length) {
      return;
    }

    const visibleFiles =
      viewMode === "adaptive"
        ? adaptiveVisibleItems.map((item) => item.file)
        : viewMode === "grid"
          ? gridVirtualRows.flatMap((rowIndex) => {
              const startIndex = rowIndex * gridColumns;
              return filteredFiles.slice(startIndex, startIndex + gridColumns);
            })
          : listVirtualItems
              .map((virtualRow) => filteredFiles[virtualRow.index])
              .filter((file): file is FileItem => Boolean(file));

    const visibleIndexes =
      viewMode === "adaptive"
        ? adaptiveVisibleItems.map((item) => item.index)
        : viewMode === "grid"
          ? gridVirtualRows.flatMap((rowIndex) => {
              const startIndex = rowIndex * gridColumns;
              return Array.from(
                { length: Math.min(gridColumns, Math.max(0, filteredFiles.length - startIndex)) },
                (_, offset) => startIndex + offset,
              );
            })
          : listVirtualItems.map((virtualRow) => virtualRow.index);
    const minVisibleIndex = visibleIndexes.length ? Math.min(...visibleIndexes) : 0;
    const maxVisibleIndex = visibleIndexes.length ? Math.max(...visibleIndexes) : -1;
    const directionalPrewarmCount = Math.max(24, Math.min(120, visibleFiles.length * 2));
    const directionalFiles =
      scrollDirection === "forward"
        ? filteredFiles.slice(maxVisibleIndex + 1, maxVisibleIndex + 1 + directionalPrewarmCount)
        : filteredFiles.slice(
            Math.max(0, minVisibleIndex - directionalPrewarmCount),
            Math.max(0, minVisibleIndex),
          );
    const nextCandidates = [...visibleFiles, ...directionalFiles].filter(
      (file, index, files) => files.findIndex((candidate) => candidate.id === file.id) === index,
    );
    const prewarm = () => {
      prewarmThumbHashPlaceholders(nextCandidates.slice(0, 96));
      prewarmThumbnailImageSources(nextCandidates.slice(0, 96));
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleHandle = window.requestIdleCallback(prewarm);
      return () => {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(idleHandle);
        }
      };
    }

    const timeoutId = setTimeout(prewarm, 40);
    return () => clearTimeout(timeoutId);
  }, [
    adaptiveVisibleItems,
    filteredFiles,
    gridColumns,
    gridVirtualRows,
    listVirtualItems,
    scrollDirection,
    viewMode,
  ]);

  const handleViewModeChange = (nextViewMode: LibraryViewMode) => {
    wheelScaleRemainderRef.current = 0;
    setLibraryViewMode(nextViewMode);
    setOpenToolbarMenu(null);
  };

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

  const handleViewportWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
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

    const delta = Math.sign(wheelScaleRemainderRef.current) * wholeSteps * LIBRARY_VIEW_SCALE_STEP;
    wheelScaleRemainderRef.current -= delta;

    const nextScale = clampLibraryViewScale(viewMode, currentViewScaleRef.current + delta);
    currentViewScaleRef.current = nextScale;
    setLibraryViewScale(viewMode, nextScale);
  };

  const handleFileClick = (file: FileItem, event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    scrollParentRef.current?.focus({ preventScroll: true });

    if (event.ctrlKey || event.metaKey) {
      const nextSelectedIds = new Set<number>(selectedFiles);

      // Promote the current single selection into the multi-selection set.
      if (selectedFile) {
        nextSelectedIds.add(selectedFile.id);
      }

      if (nextSelectedIds.has(file.id)) {
        nextSelectedIds.delete(file.id);
      } else {
        nextSelectedIds.add(file.id);
      }

      setSelectedFiles(Array.from(nextSelectedIds));
      setSelectedFile(null);
      return;
    }

    if (selectedFiles.length > 0) {
      clearSelection();
    }

    setSelectedFile(file);
  };

  const handleFileDoubleClick = (index: number) => {
    openPreview(index, filteredFiles);
  };

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

    if (selectedFiles.length > 0) {
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
  }, [isSelecting, setSelectedFile, setSelectedFiles]);

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
        const item = adaptiveLayout.items[index];
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
    [adaptiveLayout.items, gridColumns, gridRowHeight, gridRowSpan, listRowHeight, viewMode],
  );

  const focusGridContainer = useCallback(() => {
    scrollParentRef.current?.focus({ preventScroll: true });
  }, []);

  const selectFileAtIndex = useCallback(
    (index: number) => {
      const nextFile = filteredFiles[index];
      focusGridContainer();

      if (!nextFile) {
        return;
      }

      if (selectedFiles.length > 0) {
        clearSelection();
      }

      setSelectedFile(nextFile);
      scrollIndexIntoView(index);
    },
    [
      clearSelection,
      filteredFiles,
      focusGridContainer,
      scrollIndexIntoView,
      selectedFiles.length,
      setSelectedFile,
    ],
  );

  useEffect(() => {
    const handleRequestFocusFirstFile = () => {
      focusGridContainer();
      if (filteredFiles.length === 0) {
        return;
      }

      selectFileAtIndex(0);
    };

    window.addEventListener(REQUEST_FOCUS_FIRST_FILE_EVENT, handleRequestFocusFirstFile);
    return () => {
      window.removeEventListener(REQUEST_FOCUS_FIRST_FILE_EVENT, handleRequestFocusFirstFile);
    };
  }, [filteredFiles.length, focusGridContainer, selectFileAtIndex]);

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
        selectedFiles.length > 0 ||
        filteredFiles.length === 0
      ) {
        return;
      }

      event.preventDefault();

      const currentIndex = selectedFile
        ? filteredFiles.findIndex((file) => file.id === selectedFile.id)
        : -1;
      let nextIndex = currentIndex;

      if (currentIndex === -1) {
        nextIndex =
          event.key === "ArrowLeft" || event.key === "ArrowUp" ? filteredFiles.length - 1 : 0;
      } else if (viewMode === "list") {
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          nextIndex = Math.max(0, currentIndex - 1);
        } else {
          nextIndex = Math.min(filteredFiles.length - 1, currentIndex + 1);
        }
      } else if (viewMode === "grid") {
        const row = Math.floor(currentIndex / gridColumns);
        const col = currentIndex % gridColumns;

        switch (event.key) {
          case "ArrowLeft":
            nextIndex = Math.max(0, currentIndex - 1);
            break;
          case "ArrowRight":
            nextIndex = Math.min(filteredFiles.length - 1, currentIndex + 1);
            break;
          case "ArrowUp":
            if (row === 0) {
              return;
            }
            nextIndex = (row - 1) * gridColumns + col;
            break;
          case "ArrowDown": {
            const nextRowStart = (row + 1) * gridColumns;
            if (nextRowStart >= filteredFiles.length) {
              return;
            }
            nextIndex = Math.min(nextRowStart + col, filteredFiles.length - 1);
            break;
          }
        }
      } else {
        nextIndex = findAdaptiveNeighborIndex(adaptiveLayout.items, currentIndex, event.key);
      }

      if (nextIndex === currentIndex || nextIndex < 0 || nextIndex >= filteredFiles.length) {
        return;
      }

      selectFileAtIndex(nextIndex);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [
    adaptiveLayout.items,
    filteredFiles,
    gridColumns,
    gridRowHeight,
    isSelecting,
    listRowHeight,
    selectedFile,
    selectedFiles.length,
    selectFileAtIndex,
    viewMode,
  ]);

  const handleBatchDelete = async () => {
    await deleteFiles(selectedFiles);
    setShowBatchDeleteConfirm(false);
  };

  return (
    <div className="flex h-full flex-col">
      <FileGridToolbar
        activeFilterCount={activeFilterCount}
        applyCurrentViewScale={applyCurrentViewScale}
        currentSortDirectionLabel={currentSortDirectionLabel}
        currentSortFieldLabel={currentSortFieldLabel}
        currentViewModeLabel={currentViewModeLabel}
        currentViewScale={currentViewScale}
        currentViewScaleRange={currentViewScaleRange}
        filterMenuButtonRef={filterMenuButtonRef}
        filterMenuRef={filterMenuRef}
        filteredFileCount={filteredFiles.length}
        handleViewModeChange={handleViewModeChange}
        infoMenuButtonRef={infoMenuButtonRef}
        infoMenuRef={infoMenuRef}
        isFilterPanelOpen={isFilterPanelOpen}
        layoutMenuButtonRef={layoutMenuButtonRef}
        layoutMenuRef={layoutMenuRef}
        libraryVisibleFields={libraryVisibleFields}
        openToolbarMenu={openToolbarMenu}
        paginationLabel={
          pagination.totalPages > 1
            ? `(第 ${pagination.page}/${pagination.totalPages} 页)`
            : undefined
        }
        resetCurrentViewScale={resetCurrentViewScale}
        setOpenToolbarMenu={setOpenToolbarMenu}
        setSortBy={setSortBy}
        setSortDirection={setSortDirection}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortMenuButtonRef={sortMenuButtonRef}
        sortMenuRef={sortMenuRef}
        toggleFilterPanel={toggleFilterPanel}
        toggleLibraryVisibleField={toggleLibraryVisibleField}
        viewMode={viewMode}
        visibleInfoFieldLabels={visibleInfoFieldLabels}
      />

      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-gray-500 dark:text-gray-400">
          <svg
            className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-lg font-medium">暂无文件</p>
          <p className="mt-1 text-sm">当前目录下暂无文件</p>
        </div>
      ) : (
        <FileGridViewport
          adaptiveLayout={adaptiveLayout}
          adaptiveVisibleItems={adaptiveVisibleItems}
          filteredFiles={filteredFiles}
          gridColumns={gridColumns}
          gridItemWidth={gridItemWidth}
          gridMetadataHeight={gridMetadataHeight}
          gridRowCount={gridRowCount}
          gridRowHeight={gridRowHeight}
          gridRowSpan={gridRowSpan}
          gridTrackWidth={gridTrackWidth}
          gridVirtualRows={gridVirtualRows}
          handleFileClick={handleFileClick}
          handleFileDoubleClick={handleFileDoubleClick}
          handleSelectionStart={handleSelectionStart}
          handleViewportWheel={handleViewportWheel}
          libraryVisibleFields={libraryVisibleFields}
          listThumbnailSize={listThumbnailSize}
          listTotalSize={listTotalSize}
          listVirtualItems={listVirtualItems}
          scrollParentRef={scrollParentRef}
          selectedFileId={selectedFile?.id ?? null}
          selectedFiles={selectedFiles}
          selectionBox={selectionBox}
          viewMode={viewMode}
        />
      )}

      <FileGridPagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalPages={pagination.totalPages}
        setPage={setPage}
        setPageSize={setPageSize}
      />

      <FileGridSelectionBar
        selectedCount={selectedFiles.length}
        showBatchDeleteConfirm={showBatchDeleteConfirm}
        clearSelection={clearSelection}
        handleBatchDelete={handleBatchDelete}
        setShowBatchDeleteConfirm={setShowBatchDeleteConfirm}
      />
    </div>
  );
}
