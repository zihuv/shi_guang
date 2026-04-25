import type { FileFilterPayload } from "@/services/desktop/files";
import type { FilterCriteria } from "@/features/filters/types";

export type FilterFieldId =
  | "fileType"
  | "tagIds"
  | "dominantColor"
  | "keyword"
  | "dateRange"
  | "sizeRange"
  | "minRating";

export interface FilterFieldDefinition {
  id: FilterFieldId;
  label: string;
  isActive: (criteria: FilterCriteria) => boolean;
}

export const FILTER_FIELD_DEFINITIONS: FilterFieldDefinition[] = [
  {
    id: "fileType",
    label: "文件类型",
    isActive: (criteria) => criteria.fileType !== "all",
  },
  {
    id: "tagIds",
    label: "标签",
    isActive: (criteria) => criteria.tagIds.length > 0,
  },
  {
    id: "dominantColor",
    label: "主色",
    isActive: (criteria) => Boolean(criteria.dominantColor),
  },
  {
    id: "keyword",
    label: "关键词",
    isActive: (criteria) => Boolean(criteria.keyword.trim()),
  },
  {
    id: "dateRange",
    label: "导入时间",
    isActive: (criteria) => Boolean(criteria.dateRange.start || criteria.dateRange.end),
  },
  {
    id: "sizeRange",
    label: "文件大小",
    isActive: (criteria) => criteria.sizeRange.min !== null || criteria.sizeRange.max !== null,
  },
  {
    id: "minRating",
    label: "最低评分",
    isActive: (criteria) => criteria.minRating > 0,
  },
];

export function getActiveFilterCount(criteria: FilterCriteria) {
  return FILTER_FIELD_DEFINITIONS.reduce(
    (count, definition) => count + (definition.isActive(criteria) ? 1 : 0),
    0,
  );
}

export function hasStructuredFilters(criteria: FilterCriteria) {
  return FILTER_FIELD_DEFINITIONS.some((definition) => definition.isActive(criteria));
}

export function buildFileFilterPayload(args: {
  criteria: FilterCriteria;
  fallbackQuery?: string;
  naturalLanguageQuery?: string;
  imageQueryFileId?: number | null;
  folderId?: number | null;
  smartView?: import("@/stores/fileTypes").SmartCollectionId | null;
  smartSeed?: number | null;
}): FileFilterPayload {
  const {
    criteria,
    fallbackQuery,
    naturalLanguageQuery,
    imageQueryFileId,
    folderId,
    smartView,
    smartSeed,
  } = args;

  return {
    query: criteria.keyword || fallbackQuery || null,
    natural_language_query: naturalLanguageQuery || null,
    image_query_file_id: imageQueryFileId ?? null,
    folder_id: criteria.folderId ?? folderId ?? null,
    smart_view: smartView ?? null,
    smart_seed: smartSeed ?? null,
    file_types: criteria.fileType !== "all" ? [criteria.fileType] : null,
    date_start: criteria.dateRange.start || null,
    date_end: criteria.dateRange.end || null,
    size_min: criteria.sizeRange.min ?? null,
    size_max: criteria.sizeRange.max ?? null,
    tag_ids: criteria.tagIds.length ? criteria.tagIds : null,
    min_rating: criteria.minRating > 0 ? criteria.minRating : null,
    dominant_color: criteria.dominantColor || null,
    sort_by: criteria.sortBy,
    sort_direction: criteria.sortDirection,
  };
}
