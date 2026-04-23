import {
  findAdaptiveNeighborIndex,
  type AdaptiveLayoutItem,
} from "@/components/file-grid/fileGridLayout";
import { type FileItem, type SmartCollectionId } from "@/stores/fileTypes";
import { type LibraryVisibleField, type LibraryViewMode } from "@/stores/settingsStore";

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

const INFO_FIELD_LABELS: Record<LibraryVisibleField, string> = {
  name: "名称",
  ext: "类型",
  size: "文件大小",
  dimensions: "尺寸",
  tags: "标签",
};

type PrewarmContext = {
  filteredFiles: FileItem[];
  viewMode: LibraryViewMode;
  adaptiveVisibleItems: Array<{ file: FileItem; index: number }>;
  gridVirtualRows: number[];
  gridColumns: number;
  listVirtualIndexes: number[];
  scrollDirection: "forward" | "backward";
};

export function getCurrentSortFieldLabel(
  sortBy: string,
  activeSmartCollection: SmartCollectionId | null,
) {
  if (activeSmartCollection === "random") {
    return "随机模式";
  }
  if (activeSmartCollection === "recent") {
    return "最近使用";
  }
  return SORT_FIELD_LABELS[sortBy] ?? "导入时间";
}

export function getCurrentSortDirectionLabel(
  sortDirection: "asc" | "desc",
  activeSmartCollection: SmartCollectionId | null,
) {
  if (activeSmartCollection === "random" || activeSmartCollection === "recent") {
    return "固定排序";
  }
  return sortDirection === "asc" ? "升序" : "降序";
}

export function getCurrentViewModeLabel(viewMode: LibraryViewMode) {
  return VIEW_MODE_LABELS[viewMode] ?? "网格";
}

export function getVisibleInfoFieldLabels(visibleFields: LibraryVisibleField[]) {
  return visibleFields.map((field) => INFO_FIELD_LABELS[field]);
}

export function getPrewarmCandidates({
  filteredFiles,
  viewMode,
  adaptiveVisibleItems,
  gridVirtualRows,
  gridColumns,
  listVirtualIndexes,
  scrollDirection,
}: PrewarmContext) {
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
        : listVirtualIndexes;

  const visibleFiles =
    viewMode === "adaptive"
      ? adaptiveVisibleItems.map((item) => item.file)
      : visibleIndexes
          .map((index) => filteredFiles[index])
          .filter((file): file is FileItem => Boolean(file));

  const minVisibleIndex = visibleIndexes.length ? Math.min(...visibleIndexes) : 0;
  const maxVisibleIndex = visibleIndexes.length ? Math.max(...visibleIndexes) : -1;
  const directionalPrewarmCount = Math.max(12, Math.min(36, visibleFiles.length));
  const directionalFiles =
    scrollDirection === "forward"
      ? filteredFiles.slice(maxVisibleIndex + 1, maxVisibleIndex + 1 + directionalPrewarmCount)
      : filteredFiles.slice(
          Math.max(0, minVisibleIndex - directionalPrewarmCount),
          Math.max(0, minVisibleIndex),
        );

  return [...visibleFiles, ...directionalFiles].filter(
    (file, index, files) => files.findIndex((candidate) => candidate.id === file.id) === index,
  );
}

export function getNextFileGridIndex({
  currentIndex,
  key,
  filteredFilesLength,
  viewMode,
  gridColumns,
  adaptiveItems,
}: {
  currentIndex: number;
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
  filteredFilesLength: number;
  viewMode: LibraryViewMode;
  gridColumns: number;
  adaptiveItems: AdaptiveLayoutItem[];
}) {
  if (filteredFilesLength <= 0) {
    return null;
  }

  if (currentIndex === -1) {
    return key === "ArrowLeft" || key === "ArrowUp" ? filteredFilesLength - 1 : 0;
  }

  if (viewMode === "list") {
    return key === "ArrowUp" || key === "ArrowLeft"
      ? Math.max(0, currentIndex - 1)
      : Math.min(filteredFilesLength - 1, currentIndex + 1);
  }

  if (viewMode === "grid") {
    const row = Math.floor(currentIndex / gridColumns);
    const col = currentIndex % gridColumns;

    switch (key) {
      case "ArrowLeft":
        return Math.max(0, currentIndex - 1);
      case "ArrowRight":
        return Math.min(filteredFilesLength - 1, currentIndex + 1);
      case "ArrowUp":
        return row === 0 ? null : (row - 1) * gridColumns + col;
      case "ArrowDown": {
        const nextRowStart = (row + 1) * gridColumns;
        return nextRowStart >= filteredFilesLength
          ? null
          : Math.min(nextRowStart + col, filteredFilesLength - 1);
      }
    }
  }

  const nextIndex = findAdaptiveNeighborIndex(adaptiveItems, currentIndex, key);
  return nextIndex === currentIndex ? null : nextIndex;
}
