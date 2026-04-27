import { useEffect, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileItem } from "@/stores/fileTypes";
import type { LibraryVisibleField } from "@/stores/settingsStore";
import {
  buildAdaptiveLayout,
  getAdaptiveFooterHeight,
  getGridMetadataHeight,
  GRID_GAP,
  GRID_PREVIEW_HEIGHT_RATIO,
  LIST_BASE_ROW_HEIGHT,
  LIST_BASE_THUMBNAIL_SIZE,
  resolvePackedTileColumns,
  TILE_CARD_BASE_WIDTH,
  TILE_CARD_MAX_WIDTH,
  TILE_CARD_MIN_WIDTH,
  SINGLE_TILE_CARD_MAX_WIDTH,
  SINGLE_TILE_CARD_SCALE_MULTIPLIER,
} from "@/components/file-grid/fileGridLayout";

interface UseFileGridLayoutsOptions {
  containerWidth: number;
  files: FileItem[];
  libraryVisibleFields: LibraryVisibleField[];
  listViewScale: number;
  scrollDirection: "forward" | "backward";
  scrollParentRef: RefObject<HTMLDivElement | null>;
  scrollTop: number;
  tileViewScale: number;
  viewportHeight: number;
}

export function useFileGridLayouts({
  containerWidth,
  files,
  libraryVisibleFields,
  listViewScale,
  scrollDirection,
  scrollParentRef,
  scrollTop,
  tileViewScale,
  viewportHeight,
}: UseFileGridLayoutsOptions) {
  const gridViewScale = tileViewScale;
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
  const singleVisibleFile = files.length === 1 ? files[0] : null;
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
    const widthByHeight = Math.floor(
      (maxImageHeight * singleVisibleFile.width) / singleVisibleFile.height,
    );

    return Math.max(TILE_CARD_MIN_WIDTH, Math.min(baseCap, singleBaseWidth, widthByHeight));
  }, [contentWidth, libraryVisibleFields, singleBaseWidth, singleVisibleFile, viewportHeight]);
  const gridLayout = useMemo(() => {
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
      itemCount: files.length,
    });
  }, [contentWidth, files.length, gridMinWidth, singleGridWidth]);
  const gridColumns = gridLayout.columns;
  const gridItemWidth = gridLayout.itemWidth;
  const gridTrackWidth = gridLayout.trackWidth;
  const gridPreviewHeight = Math.ceil(gridItemWidth * GRID_PREVIEW_HEIGHT_RATIO);
  const gridRowHeight = gridPreviewHeight + gridMetadataHeight;
  const gridRowSpan = gridRowHeight + GRID_GAP;
  const gridRowCount = Math.ceil(files.length / gridColumns);
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
  const adaptiveLayoutColumns = useMemo(() => {
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
      itemCount: files.length,
    });
  }, [adaptiveTargetWidth, contentWidth, files.length, singleAdaptiveWidthCap]);
  const adaptiveColumns = adaptiveLayoutColumns.columns;
  const adaptiveColumnWidth = adaptiveLayoutColumns.itemWidth;
  const adaptiveLayout = useMemo(
    () => buildAdaptiveLayout(files, adaptiveColumns, adaptiveColumnWidth, libraryVisibleFields),
    [adaptiveColumnWidth, adaptiveColumns, files, libraryVisibleFields],
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
    count: files.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => listRowHeight,
    overscan: listOverscanRows,
  });

  useEffect(() => {
    listRowVirtualizer.measure();
  }, [listRowHeight, listRowVirtualizer]);

  return {
    adaptiveLayout,
    adaptiveVisibleItems,
    gridColumns,
    gridItemWidth,
    gridMetadataHeight,
    gridRowCount,
    gridRowHeight,
    gridRowSpan,
    gridTrackWidth,
    gridVirtualRows,
    listRowHeight,
    listThumbnailSize,
    listTotalSize: listRowVirtualizer.getTotalSize(),
    listVirtualItems: listRowVirtualizer.getVirtualItems(),
  };
}
