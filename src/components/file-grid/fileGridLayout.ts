import { type FileItem } from "@/stores/fileTypes";
import { type LibraryVisibleField } from "@/stores/settingsStore";

export const TILE_CARD_BASE_WIDTH = 180;
export const TILE_CARD_MIN_WIDTH = 90;
export const TILE_CARD_MAX_WIDTH = 420;
export const GRID_GAP = 16;
export const GRID_PREVIEW_HEIGHT_RATIO = 0.6;
export const LIST_BASE_ROW_HEIGHT = 56;
export const LIST_BASE_THUMBNAIL_SIZE = 40;
export const GRID_VIEWPORT_OVERSCAN_PX = 400;
export const ADAPTIVE_VIEWPORT_OVERSCAN_PX = 320;
export const SELECTION_DRAG_THRESHOLD = 10;
export const VIEW_SCALE_KEYBOARD_STEP = 0.1;
export const VIEW_SCALE_WHEEL_SENSITIVITY = 0.0012;

const GRID_METADATA_HEIGHT = 56;
const GRID_METADATA_HEIGHT_WITH_TAGS = 72;
const ADAPTIVE_CARD_FOOTER_HEIGHT = 44;
const ADAPTIVE_CARD_FOOTER_WITH_TAGS_HEIGHT = 62;

export type SelectionBox = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type ArrowNavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export type AdaptiveLayoutItem = {
  file: FileItem;
  index: number;
  columnIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PackedTileColumns = {
  columns: number;
  itemWidth: number;
  trackWidth: number;
};

export function getPointerPositionInScrollContainer(
  clientX: number,
  clientY: number,
  container: HTMLDivElement,
) {
  const rect = container.getBoundingClientRect();

  return {
    x: clientX - rect.left + container.scrollLeft,
    y: clientY - rect.top + container.scrollTop,
  };
}

export function getSelectionBounds(selectionBox: SelectionBox) {
  const minX = Math.min(selectionBox.startX, selectionBox.endX);
  const maxX = Math.max(selectionBox.startX, selectionBox.endX);
  const minY = Math.min(selectionBox.startY, selectionBox.endY);
  const maxY = Math.max(selectionBox.startY, selectionBox.endY);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function isCardIntersectingSelection(
  cardRect: DOMRect,
  containerRect: DOMRect,
  container: HTMLDivElement,
  bounds: ReturnType<typeof getSelectionBounds>,
) {
  const cardLeft = cardRect.left - containerRect.left + container.scrollLeft;
  const cardTop = cardRect.top - containerRect.top + container.scrollTop;
  const cardRight = cardLeft + cardRect.width;
  const cardBottom = cardTop + cardRect.height;

  return (
    cardLeft <= bounds.maxX &&
    cardRight >= bounds.minX &&
    cardTop <= bounds.maxY &&
    cardBottom >= bounds.minY
  );
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"),
  );
}

export function isDialogTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[role='dialog'], [role='menu']"));
}

export function getGridMetadataHeight(scale: number, visibleFields: LibraryVisibleField[]) {
  const showsTags = visibleFields.includes("tags");
  const baseHeight = showsTags ? GRID_METADATA_HEIGHT_WITH_TAGS : GRID_METADATA_HEIGHT;
  const minHeight = showsTags ? 62 : 48;
  return Math.max(minHeight, Math.round(baseHeight * (0.88 + scale * 0.1)));
}

export function resolvePackedTileColumns({
  containerWidth,
  preferredWidth,
  minWidth,
  itemCount,
}: {
  containerWidth: number;
  preferredWidth: number;
  minWidth: number;
  itemCount?: number;
}): PackedTileColumns {
  const safeContainerWidth = Math.max(0, Math.floor(containerWidth));
  const safePreferredWidth = Math.max(1, Math.round(preferredWidth));
  const safeMinWidth = Math.max(1, Math.min(Math.round(minWidth), safePreferredWidth));
  const maxColumnsByWidth = Math.max(
    1,
    Math.floor((Math.max(safeContainerWidth, safeMinWidth) + GRID_GAP) / (safeMinWidth + GRID_GAP)),
  );
  const maxColumns =
    itemCount && itemCount > 0
      ? Math.max(1, Math.min(maxColumnsByWidth, itemCount))
      : maxColumnsByWidth;

  let bestLayout: PackedTileColumns | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const availableWidth =
      safeContainerWidth > 0
        ? Math.floor((safeContainerWidth - GRID_GAP * (columns - 1)) / columns)
        : safePreferredWidth;

    if (availableWidth <= 0) {
      continue;
    }

    if (availableWidth < safeMinWidth && !(columns === 1 && safeContainerWidth < safeMinWidth)) {
      continue;
    }

    const oversize = Math.max(0, availableWidth - safePreferredWidth);
    const undersize = Math.max(0, safePreferredWidth - availableWidth);
    const score = oversize * 1.25 + undersize * 0.9;

    if (!bestLayout || score < bestScore || (score === bestScore && columns > bestLayout.columns)) {
      bestLayout = {
        columns,
        itemWidth: availableWidth,
        trackWidth: columns * availableWidth + GRID_GAP * Math.max(0, columns - 1),
      };
      bestScore = score;
    }
  }

  if (bestLayout) {
    return bestLayout;
  }

  const fallbackWidth =
    safeContainerWidth > 0
      ? Math.max(1, Math.min(safeContainerWidth, safePreferredWidth))
      : safePreferredWidth;

  return {
    columns: 1,
    itemWidth: fallbackWidth,
    trackWidth: fallbackWidth,
  };
}

export function findAdaptiveNeighborIndex(
  items: AdaptiveLayoutItem[],
  currentIndex: number,
  direction: ArrowNavigationKey,
) {
  const currentItem = items[currentIndex];
  if (!currentItem) {
    return currentIndex;
  }

  const currentLeft = currentItem.left;
  const currentRight = currentItem.left + currentItem.width;
  const currentTop = currentItem.top;
  const currentBottom = currentItem.top + currentItem.height;
  const currentCenterX = currentItem.left + currentItem.width / 2;
  const currentCenterY = currentItem.top + currentItem.height / 2;
  let bestIndex = currentIndex;
  let bestRank: [number, number, number, number] | null = null;

  const compareRank = (nextRank: [number, number, number, number]) => {
    if (!bestRank) {
      return true;
    }

    for (let index = 0; index < nextRank.length; index += 1) {
      if (nextRank[index] < bestRank[index]) {
        return true;
      }
      if (nextRank[index] > bestRank[index]) {
        return false;
      }
    }

    return false;
  };

  items.forEach((item, index) => {
    if (index === currentIndex) {
      return;
    }

    const candidateCenterX = item.left + item.width / 2;
    const candidateCenterY = item.top + item.height / 2;
    const deltaX = candidateCenterX - currentCenterX;
    const deltaY = candidateCenterY - currentCenterY;
    const candidateLeft = item.left;
    const candidateRight = item.left + item.width;
    const candidateTop = item.top;
    const candidateBottom = item.top + item.height;

    switch (direction) {
      case "ArrowUp": {
        if (deltaY >= -4) {
          return;
        }
        const overlap = Math.max(
          0,
          Math.min(currentRight, candidateRight) - Math.max(currentLeft, candidateLeft),
        );
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, currentTop - candidateBottom),
          Math.abs(deltaX),
          Math.abs(deltaY),
        ];
        if (compareRank(rank)) {
          bestIndex = index;
          bestRank = rank;
        }
        break;
      }
      case "ArrowDown": {
        if (deltaY <= 4) {
          return;
        }
        const overlap = Math.max(
          0,
          Math.min(currentRight, candidateRight) - Math.max(currentLeft, candidateLeft),
        );
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, candidateTop - currentBottom),
          Math.abs(deltaX),
          Math.abs(deltaY),
        ];
        if (compareRank(rank)) {
          bestIndex = index;
          bestRank = rank;
        }
        break;
      }
      case "ArrowLeft": {
        if (deltaX >= -4) {
          return;
        }
        const overlap = Math.max(
          0,
          Math.min(currentBottom, candidateBottom) - Math.max(currentTop, candidateTop),
        );
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, currentLeft - candidateRight),
          Math.abs(deltaY),
          Math.abs(deltaX),
        ];
        if (compareRank(rank)) {
          bestIndex = index;
          bestRank = rank;
        }
        break;
      }
      case "ArrowRight": {
        if (deltaX <= 4) {
          return;
        }
        const overlap = Math.max(
          0,
          Math.min(currentBottom, candidateBottom) - Math.max(currentTop, candidateTop),
        );
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, candidateLeft - currentRight),
          Math.abs(deltaY),
          Math.abs(deltaX),
        ];
        if (compareRank(rank)) {
          bestIndex = index;
          bestRank = rank;
        }
        break;
      }
    }
  });

  return bestIndex;
}

export function buildAdaptiveLayout(
  files: FileItem[],
  columns: number,
  columnWidth: number,
  visibleFields: LibraryVisibleField[],
) {
  if (files.length === 0 || columnWidth <= 0) {
    return {
      items: [] as AdaptiveLayoutItem[],
      totalHeight: 0,
      columnWidth: 0,
      trackWidth: 0,
    };
  }

  const heights = Array.from({ length: columns }, () => 0);
  const items: AdaptiveLayoutItem[] = files.map((file, index) => {
    const imageHeight = getAdaptiveImageHeight(file, columnWidth);
    const totalHeight = imageHeight + getAdaptiveFooterHeight(file, visibleFields);
    let columnIndex = 0;

    for (let i = 1; i < heights.length; i += 1) {
      if (heights[i] < heights[columnIndex]) {
        columnIndex = i;
      }
    }

    const top = heights[columnIndex];
    const left = columnIndex * (columnWidth + GRID_GAP);
    heights[columnIndex] += totalHeight + GRID_GAP;

    return {
      file,
      index,
      columnIndex,
      left,
      top,
      width: columnWidth,
      height: totalHeight,
    };
  });

  return {
    items,
    totalHeight: Math.max(0, ...heights) - GRID_GAP,
    columnWidth,
    trackWidth: columnWidth * columns + GRID_GAP * Math.max(0, columns - 1),
  };
}

export function buildAdaptiveColumns(items: AdaptiveLayoutItem[], columns: number) {
  const nextColumns = Array.from(
    { length: Math.max(1, columns) },
    () => [] as AdaptiveLayoutItem[],
  );

  items.forEach((item) => {
    const column = nextColumns[item.columnIndex];
    if (column) {
      column.push(item);
    }
  });

  return nextColumns;
}

function getAdaptiveImageHeight(file: FileItem, width: number) {
  if (!file.width || !file.height || file.width <= 0 || file.height <= 0) {
    return width;
  }

  return Math.max(80, Math.round((file.height / file.width) * width));
}

function getAdaptiveFooterHeight(file: FileItem, visibleFields: LibraryVisibleField[]) {
  return shouldShowTags(file, visibleFields)
    ? ADAPTIVE_CARD_FOOTER_WITH_TAGS_HEIGHT
    : ADAPTIVE_CARD_FOOTER_HEIGHT;
}

function shouldShowTags(file: FileItem, visibleFields: LibraryVisibleField[]) {
  return visibleFields.includes("tags") && file.tags.length > 0;
}
