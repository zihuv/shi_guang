import { create } from "zustand"
import {
  type FileSortField,
  type FilterCriteria,
  type SortDirection,
  initialFilterCriteria,
} from "@/features/filters/types"
import { getActiveFilterCount as getSchemaActiveFilterCount } from "@/features/filters/schema"
import { getSetting, setSetting } from "@/services/tauri/indexing"
import { useLibraryQueryStore } from "@/stores/libraryQueryStore"

export type { FileSortField, FilterCriteria, SortDirection } from "@/features/filters/types"

const FILTER_PREFERENCES_SETTING_KEY = "libraryFilterPreferences"
let filterPreferencesPersistTimer: ReturnType<typeof setTimeout> | null = null

type LegacyFileSortOption =
  | "imported_desc"
  | "imported_asc"
  | "modified_desc"
  | "created_desc"
  | "name_asc"
  | "name_desc"
  | "size_desc"
  | "size_asc"

const FILE_TYPES = new Set(["all", "image", "video", "document"])

type PersistedFilterPreferences = {
  fileType?: unknown
  tagIds?: unknown
  dominantColor?: unknown
  sortBy?: unknown
  sortDirection?: unknown
  sort?: unknown
}

interface FilterStore {
  criteria: FilterCriteria
  isFilterPanelOpen: boolean
  hasLoadedPreferences: boolean
  setSearchQuery: (query: string) => void
  setTagIds: (tagIds: number[]) => void
  setFileType: (fileType: FilterCriteria["fileType"]) => void
  setDateRange: (range: FilterCriteria["dateRange"]) => void
  setSizeRange: (range: FilterCriteria["sizeRange"]) => void
  toggleTag: (tagId: number) => void
  setMinRating: (rating: number) => void
  setFavoritesOnly: (favoritesOnly: boolean) => void
  clearFilters: () => void
  setFilterPanelOpen: (open: boolean) => void
  toggleFilterPanel: () => void
  getActiveFilterCount: () => number
  setDominantColor: (color: string | null) => void
  setKeyword: (keyword: string) => void
  setFolderId: (folderId: number | null) => void
  setSortBy: (sortBy: FileSortField) => void
  setSortDirection: (sortDirection: SortDirection) => void
  setSort: (sortBy: FileSortField, sortDirection?: SortDirection) => void
  loadPreferences: () => Promise<void>
}

function isFileSortField(value: unknown): value is FileSortField {
  return (
    value === "imported_at" ||
    value === "created_at" ||
    value === "modified_at" ||
    value === "name" ||
    value === "ext" ||
    value === "size"
  )
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc"
}

function isLegacyFileSortOption(value: unknown): value is LegacyFileSortOption {
  return (
    value === "imported_desc" ||
    value === "imported_asc" ||
    value === "modified_desc" ||
    value === "created_desc" ||
    value === "name_asc" ||
    value === "name_desc" ||
    value === "size_desc" ||
    value === "size_asc"
  )
}

function getLegacySortConfig(sort: LegacyFileSortOption) {
  switch (sort) {
    case "imported_asc":
      return { sortBy: "imported_at" as const, sortDirection: "asc" as const }
    case "modified_desc":
      return { sortBy: "modified_at" as const, sortDirection: "desc" as const }
    case "created_desc":
      return { sortBy: "created_at" as const, sortDirection: "desc" as const }
    case "name_asc":
      return { sortBy: "name" as const, sortDirection: "asc" as const }
    case "name_desc":
      return { sortBy: "name" as const, sortDirection: "desc" as const }
    case "size_desc":
      return { sortBy: "size" as const, sortDirection: "desc" as const }
    case "size_asc":
      return { sortBy: "size" as const, sortDirection: "asc" as const }
    case "imported_desc":
    default:
      return { sortBy: "imported_at" as const, sortDirection: "desc" as const }
  }
}

function serializeFilterPreferences(criteria: FilterCriteria) {
  return JSON.stringify({
    fileType: criteria.fileType,
    tagIds: criteria.tagIds,
    dominantColor: criteria.dominantColor,
    sortBy: criteria.sortBy,
    sortDirection: criteria.sortDirection,
  })
}

function scheduleFilterPreferencesPersist(
  get: () => { criteria: FilterCriteria; hasLoadedPreferences: boolean },
) {
  if (!get().hasLoadedPreferences) {
    return
  }

  if (filterPreferencesPersistTimer) {
    clearTimeout(filterPreferencesPersistTimer)
  }

  filterPreferencesPersistTimer = setTimeout(() => {
    const { criteria, hasLoadedPreferences } = get()
    if (!hasLoadedPreferences) {
      return
    }

    void setSetting(
      FILTER_PREFERENCES_SETTING_KEY,
      serializeFilterPreferences(criteria),
    ).catch((error) => {
      console.error("Failed to persist filter preferences:", error)
    })
  }, 120)
}

function restoreFilterPreferences(
  criteria: FilterCriteria,
  value: PersistedFilterPreferences,
): FilterCriteria {
  const legacySort = isLegacyFileSortOption(value.sort)
    ? getLegacySortConfig(value.sort)
    : {
        sortBy: criteria.sortBy,
        sortDirection: criteria.sortDirection,
      }

  return {
    ...criteria,
    fileType: FILE_TYPES.has(value.fileType as string)
      ? (value.fileType as FilterCriteria["fileType"])
      : criteria.fileType,
    tagIds: Array.isArray(value.tagIds)
      ? value.tagIds
          .map((tagId) => Number(tagId))
          .filter((tagId) => Number.isInteger(tagId) && tagId > 0)
      : criteria.tagIds,
    dominantColor:
      typeof value.dominantColor === "string" || value.dominantColor === null
        ? value.dominantColor
        : criteria.dominantColor,
    sortBy: isFileSortField(value.sortBy) ? value.sortBy : legacySort.sortBy,
    sortDirection: isSortDirection(value.sortDirection)
      ? value.sortDirection
      : legacySort.sortDirection,
  }
}

export function getSortConfig(criteria: Pick<FilterCriteria, "sortBy" | "sortDirection">) {
  return {
    sortBy: criteria.sortBy,
    sortDirection: criteria.sortDirection,
  }
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  criteria: { ...initialFilterCriteria },
  isFilterPanelOpen: false,
  hasLoadedPreferences: false,

  setSearchQuery: (query) => {
    set((state) => ({
      criteria: { ...state.criteria, searchQuery: query },
    }))
  },

  setFileType: (fileType) => {
    set((state) => ({
      criteria: { ...state.criteria, fileType },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  setDateRange: (range) => {
    set((state) => ({
      criteria: { ...state.criteria, dateRange: range },
    }))
  },

  setSizeRange: (range) => {
    set((state) => ({
      criteria: { ...state.criteria, sizeRange: range },
    }))
  },

  toggleTag: (tagId) => {
    set((state) => {
      const tagIds = state.criteria.tagIds.includes(tagId)
        ? state.criteria.tagIds.filter((id) => id !== tagId)
        : [...state.criteria.tagIds, tagId]
      return {
        criteria: { ...state.criteria, tagIds },
      }
    })
    scheduleFilterPreferencesPersist(get)
  },

  setTagIds: (tagIds) => {
    set((state) => ({
      criteria: { ...state.criteria, tagIds },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  setMinRating: (rating) => {
    set((state) => ({
      criteria: { ...state.criteria, minRating: rating },
    }))
  },

  setFavoritesOnly: (favoritesOnly) => {
    set((state) => ({
      criteria: { ...state.criteria, favoritesOnly },
    }))
  },

  clearFilters: () => {
    set((state) => ({
      criteria: {
        ...initialFilterCriteria,
        searchQuery: state.criteria.searchQuery,
        sortBy: state.criteria.sortBy,
        sortDirection: state.criteria.sortDirection,
      },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  setFilterPanelOpen: (open) => {
    set({ isFilterPanelOpen: open })
  },

  toggleFilterPanel: () => {
    set((state) => ({ isFilterPanelOpen: !state.isFilterPanelOpen }))
  },

  setDominantColor: (color) => {
    set((state) => ({
      criteria: { ...state.criteria, dominantColor: color },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  setKeyword: (keyword) => {
    set((state) => ({
      criteria: { ...state.criteria, keyword },
    }))
  },

  setFolderId: (folderId) => {
    set((state) => ({
      criteria: { ...state.criteria, folderId },
    }))
  },

  setSortBy: (sortBy) => {
    set((state) => ({
      criteria: { ...state.criteria, sortBy },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  setSortDirection: (sortDirection) => {
    set((state) => ({
      criteria: { ...state.criteria, sortDirection },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  setSort: (sortBy, sortDirection) => {
    set((state) => ({
      criteria: {
        ...state.criteria,
        sortBy,
        sortDirection: sortDirection ?? state.criteria.sortDirection,
      },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  getActiveFilterCount: () => {
    return getSchemaActiveFilterCount(get().criteria)
  },

  loadPreferences: async () => {
    let nextCriteria = { ...get().criteria }

    try {
      const rawValue = await getSetting(FILTER_PREFERENCES_SETTING_KEY)
      const parsed = JSON.parse(rawValue) as PersistedFilterPreferences
      nextCriteria = restoreFilterPreferences(nextCriteria, parsed)
    } catch (error) {
      const errorMsg = String(error)
      if (!errorMsg.includes("Setting not found")) {
        console.error("Failed to load filter preferences:", error)
      }
    }

    set((state) => ({
      criteria: {
        ...state.criteria,
        fileType: nextCriteria.fileType,
        tagIds: nextCriteria.tagIds,
        dominantColor: nextCriteria.dominantColor,
        sortBy: nextCriteria.sortBy,
        sortDirection: nextCriteria.sortDirection,
      },
      hasLoadedPreferences: true,
    }))

    const libraryStore = useLibraryQueryStore.getState()
    if (
      libraryStore.selectedFolderId !== null ||
      libraryStore.files.length > 0 ||
      libraryStore.searchQuery.trim()
    ) {
      void libraryStore.runCurrentQuery()
    }
  },
}))
