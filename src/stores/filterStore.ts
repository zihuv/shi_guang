import { create } from 'zustand'

export interface FilterCriteria {
  searchQuery: string
  fileType: 'all' | 'image' | 'video' | 'document'
  dateRange: { start: string | null; end: string | null }
  sizeRange: { min: number | null; max: number | null }
  tagIds: number[]
  minRating: number
  favoritesOnly: boolean
  dominantColor: string | null
  keyword: string
  folderId: number | null
}

interface FilterStore {
  criteria: FilterCriteria
  isFilterPanelOpen: boolean
  setSearchQuery: (query: string) => void
  setFileType: (fileType: FilterCriteria['fileType']) => void
  setDateRange: (range: FilterCriteria['dateRange']) => void
  setSizeRange: (range: FilterCriteria['sizeRange']) => void
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
}

const initialCriteria: FilterCriteria = {
  searchQuery: '',
  fileType: 'all',
  dateRange: { start: null, end: null },
  sizeRange: { min: null, max: null },
  tagIds: [],
  minRating: 0,
  favoritesOnly: false,
  dominantColor: null,
  keyword: '',
  folderId: null,
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  criteria: { ...initialCriteria },
  isFilterPanelOpen: false,

  setSearchQuery: (query) => {
    set((state) => ({
      criteria: { ...state.criteria, searchQuery: query },
    }))
  },

  setFileType: (fileType) => {
    set((state) => ({
      criteria: { ...state.criteria, fileType },
    }))
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
    set({ criteria: { ...initialCriteria } })
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

  getActiveFilterCount: () => {
    const { criteria } = get()
    let count = 0
    if (criteria.fileType !== 'all') count++
    if (criteria.dateRange.start || criteria.dateRange.end) count++
    if (criteria.sizeRange.min || criteria.sizeRange.max) count++
    if (criteria.tagIds.length > 0) count++
    if (criteria.minRating > 0) count++
    if (criteria.favoritesOnly) count++
    if (criteria.dominantColor) count++
    if (criteria.keyword) count++
    if (criteria.folderId !== null) count++
    return count
  },
}))
