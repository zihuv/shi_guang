export type FileSortField = "imported_at" | "created_at" | "modified_at" | "name" | "ext" | "size";

export type SortDirection = "asc" | "desc";

export interface FilterCriteria {
  searchQuery: string;
  fileType: "all" | "image" | "video" | "document";
  dateRange: { start: string | null; end: string | null };
  sizeRange: { min: number | null; max: number | null };
  tagIds: number[];
  minRating: number;
  favoritesOnly: boolean;
  dominantColor: string | null;
  keyword: string;
  folderId: number | null;
  sortBy: FileSortField;
  sortDirection: SortDirection;
}

export const DEFAULT_FILE_SORT_BY: FileSortField = "imported_at";
export const DEFAULT_SORT_DIRECTION: SortDirection = "desc";

export const initialFilterCriteria: FilterCriteria = {
  searchQuery: "",
  fileType: "all",
  dateRange: { start: null, end: null },
  sizeRange: { min: null, max: null },
  tagIds: [],
  minRating: 0,
  favoritesOnly: false,
  dominantColor: null,
  keyword: "",
  folderId: null,
  sortBy: DEFAULT_FILE_SORT_BY,
  sortDirection: DEFAULT_SORT_DIRECTION,
};
