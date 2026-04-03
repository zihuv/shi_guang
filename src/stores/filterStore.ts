import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"

const FILTER_PREFERENCES_SETTING_KEY = "libraryFilterPreferences"
let filterPreferencesPersistTimer: ReturnType<typeof setTimeout> | null = null

export type FileSortOption =
  | "imported_desc"
  | "imported_asc"
  | "modified_desc"
  | "created_desc"
  | "name_asc"
  | "name_desc"
  | "size_desc"
  | "size_asc"

export const DEFAULT_FILE_SORT: FileSortOption = "imported_desc"

const FILE_TYPES = new Set(["all", "image", "video", "document"])

type PersistedFilterPreferences = {
  fileType?: unknown
  tagIds?: unknown
  dominantColor?: unknown
  sort?: unknown
}

export interface FilterCriteria {
  searchQuery: string
  fileType: "all" | "image" | "video" | "document"
  dateRange: { start: string | null; end: string | null }
  sizeRange: { min: number | null; max: number | null }
  tagIds: number[]
  minRating: number
  favoritesOnly: boolean
  dominantColor: string | null
  keyword: string
  folderId: number | null
  sort: FileSortOption
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
  setSort: (sort: FileSortOption) => void
  loadPreferences: () => Promise<void>
}

const initialCriteria: FilterCriteria = {
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
  sort: DEFAULT_FILE_SORT,
}

function isFileSortOption(value: unknown): value is FileSortOption {
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

function serializeFilterPreferences(criteria: FilterCriteria) {
  return JSON.stringify({
    fileType: criteria.fileType,
    tagIds: criteria.tagIds,
    dominantColor: criteria.dominantColor,
    sort: criteria.sort,
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

    void invoke("set_setting", {
      key: FILTER_PREFERENCES_SETTING_KEY,
      value: serializeFilterPreferences(criteria),
    }).catch((error) => {
      console.error("Failed to persist filter preferences:", error)
    })
  }, 120)
}

function restoreFilterPreferences(
  criteria: FilterCriteria,
  value: PersistedFilterPreferences,
): FilterCriteria {
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
    sort: isFileSortOption(value.sort) ? value.sort : criteria.sort,
  }
}

export function getSortConfig(sort: FileSortOption) {
  switch (sort) {
    case "imported_asc":
      return { sortBy: "imported_at", sortDirection: "asc" as const }
    case "modified_desc":
      return { sortBy: "modified_at", sortDirection: "desc" as const }
    case "created_desc":
      return { sortBy: "created_at", sortDirection: "desc" as const }
    case "name_asc":
      return { sortBy: "name", sortDirection: "asc" as const }
    case "name_desc":
      return { sortBy: "name", sortDirection: "desc" as const }
    case "size_desc":
      return { sortBy: "size", sortDirection: "desc" as const }
    case "size_asc":
      return { sortBy: "size", sortDirection: "asc" as const }
    case "imported_desc":
    default:
      return { sortBy: "imported_at", sortDirection: "desc" as const }
  }
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  criteria: { ...initialCriteria },
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
        ...initialCriteria,
        searchQuery: state.criteria.searchQuery,
        sort: state.criteria.sort,
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

  setSort: (sort) => {
    set((state) => ({
      criteria: { ...state.criteria, sort },
    }))
    scheduleFilterPreferencesPersist(get)
  },

  getActiveFilterCount: () => {
    const { criteria } = get()
    let count = 0
    if (criteria.fileType !== "all") count += 1
    if (criteria.tagIds.length > 0) count += 1
    if (criteria.dominantColor) count += 1
    return count
  },

  loadPreferences: async () => {
    let nextCriteria = { ...get().criteria }

    try {
      const rawValue = await invoke<string>("get_setting", {
        key: FILTER_PREFERENCES_SETTING_KEY,
      })
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
        sort: nextCriteria.sort,
      },
      hasLoadedPreferences: true,
    }))

    const { useFileStore } = await import("./fileStore")
    const fileStore = useFileStore.getState()
    if (fileStore.selectedFolderId !== null || fileStore.files.length > 0 || fileStore.searchQuery.trim()) {
      void fileStore.runCurrentQuery()
    }
  },
}))
