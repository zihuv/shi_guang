import type { FileItem, TrashFileItem, TrashItem } from "@/shared/desktop-types";

export type {
  AiMetadataTaskItemResult,
  AiMetadataTaskSnapshot,
  BinaryImageImportItem,
  DeleteFolderResult,
  FileItem,
  FileTag as Tag,
  FolderNode,
  FolderSummary,
  ImportTaskItem,
  ImportTaskItemResult,
  ImportTaskSnapshot,
  PaginatedFilesResponse,
  RawTag,
  SmartCollectionId,
  SmartCollectionStats,
  TagNode,
  TrashFileItem,
  TrashFolderItem,
  TrashItem,
  VisualIndexTaskSnapshot,
  VisualSearchDebugScore,
} from "@/shared/desktop-types";

export const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "cancelled",
  "failed",
]);

export const TERMINAL_IMPORT_TASK_STATUSES = TERMINAL_TASK_STATUSES;

export const TERMINAL_AI_METADATA_TASK_STATUSES = TERMINAL_TASK_STATUSES;

export const TERMINAL_VISUAL_INDEX_TASK_STATUSES = TERMINAL_TASK_STATUSES;

export function isTerminalTaskStatus(status: string) {
  return TERMINAL_TASK_STATUSES.has(status);
}

export const getNameWithoutExt = (name: string): string => {
  const lastDot = name.lastIndexOf(".");
  if (lastDot > 0) {
    return name.substring(0, lastDot);
  }
  return name;
};

export const parseFile = (file: FileItem): FileItem => ({
  ...file,
  colorDistribution:
    typeof file.colorDistribution === "string"
      ? JSON.parse(file.colorDistribution)
      : file.colorDistribution || [],
});

export const parseFileList = (files: FileItem[]): FileItem[] => files.map(parseFile);

export const parseTrashItem = (item: TrashItem): TrashItem =>
  item.kind === "file" ? ({ ...parseFile(item), kind: "file" } as TrashFileItem) : item;

export const parseTrashItemList = (items: TrashItem[]): TrashItem[] => items.map(parseTrashItem);
