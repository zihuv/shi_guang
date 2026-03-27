import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useFilterStore } from '@/stores/filterStore'
import { useFolderStore } from '@/stores/folderStore'
import { useTagStore } from '@/stores/tagStore'

// Helper to get name without extension
export const getNameWithoutExt = (name: string): string => {
  const lastDot = name.lastIndexOf('.');
  if (lastDot > 0) {
    return name.substring(0, lastDot);
  }
  return name;
};

export interface FileItem {
  id: number
  path: string
  name: string
  ext: string
  size: number
  width: number
  height: number
  folderId: number | null
  createdAt: string
  modifiedAt: string
  importedAt: string
  rating: number
  description: string
  sourceUrl: string
  dominantColor: string
  colorDistribution: Array<{ color: string; percentage: number }>
  tags: Tag[]
  deletedAt?: string | null
}

// Helper function to parse file from database (colorDistribution is JSON string)
const parseFile = (file: FileItem): FileItem => ({
  ...file,
  colorDistribution: typeof file.colorDistribution === 'string'
    ? JSON.parse(file.colorDistribution)
    : (file.colorDistribution || [])
})

// 批量解析文件列表
const parseFileList = (files: FileItem[]): FileItem[] => files.map(parseFile)

interface PaginatedFilesResponse {
  files: FileItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

interface ImportTaskItemResult {
  index: number
  status: string
  source: string
  error?: string | null
  file?: FileItem | null
}

interface ImportTaskSnapshot {
  id: string
  status: string
  total: number
  processed: number
  successCount: number
  failureCount: number
  results: ImportTaskItemResult[]
}

const TERMINAL_IMPORT_TASK_STATUSES = new Set([
  'completed',
  'completed_with_errors',
  'cancelled',
  'failed',
])

let fileListRequestId = 0
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForImportTask = async (
  taskId: string,
  onUpdate: (task: ImportTaskSnapshot) => void,
) => {
  let unlisten: (() => void) | null = null
  let fallbackTimer: ReturnType<typeof setInterval> | null = null
  let isSettled = false
  let isRefreshing = false
  let needsRefresh = false

  return await new Promise<ImportTaskSnapshot>((resolve, reject) => {
    const cleanup = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = null
      }
      if (unlisten) {
        unlisten()
        unlisten = null
      }
    }

    const finish = (snapshot: ImportTaskSnapshot) => {
      if (isSettled) return
      isSettled = true
      cleanup()
      resolve(snapshot)
    }

    const fail = (error: unknown) => {
      if (isSettled) return
      isSettled = true
      cleanup()
      reject(error)
    }

    const refreshSnapshot = async () => {
      if (isSettled) return
      if (isRefreshing) {
        needsRefresh = true
        return
      }

      isRefreshing = true
      try {
        const snapshot = await invoke<ImportTaskSnapshot>('get_import_task', { taskId })
        onUpdate(snapshot)
        if (TERMINAL_IMPORT_TASK_STATUSES.has(snapshot.status)) {
          finish(snapshot)
        }
      } catch (error) {
        fail(error)
      } finally {
        isRefreshing = false
        if (needsRefresh && !isSettled) {
          needsRefresh = false
          void refreshSnapshot()
        }
      }
    }

    fallbackTimer = setInterval(() => {
      void refreshSnapshot()
    }, 1000)

    void listen<string>('import-task-updated', (event) => {
      if (event.payload !== taskId || isSettled) return
      void refreshSnapshot()
    })
      .then((dispose) => {
        if (isSettled) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch(() => {
        // Keep the fallback timer active when event subscription is unavailable.
      })

    void refreshSnapshot()
  })
}

const finalizeImportTask = async (
  task: ImportTaskSnapshot,
  setImportTask: (task: ImportTaskSnapshot | null) => void,
  refreshFiles: () => Promise<void>,
) => {
  const results = parseFileList(
    task.results
      .filter((result) => result.status === 'completed' && result.file)
      .map((result) => result.file as FileItem),
  )

  await delay(0)
  await refreshFiles()
  useFolderStore.getState().loadFolders()
  setImportTask(null)
  return results
}

export interface Tag {
  id: number
  name: string
  color: string
}

// Undo action types
interface UndoAction {
  type: 'delete'
  fileIds: number[]
  timestamp: number
}

interface FileStore {
  files: FileItem[]
  selectedFile: FileItem | null
  selectedFolderId: number | null
  selectedFiles: number[]
  searchQuery: string
  isLoading: boolean
  importTask: ImportTaskSnapshot | null
  // Pagination state
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  // Undo stack for delete operations
  undoStack: UndoAction[]
  addToUndoStack: (fileIds: number[]) => void
  undo: () => Promise<void>
  clearUndoStack: () => void
  // Internal drag state (to prevent showing drop overlay for internal drags)
  isDraggingInternal: boolean
  setIsDraggingInternal: (isDragging: boolean) => void
  draggedFileIds: number[]
  draggedPrimaryFileId: number | null
  currentDragSessionId: string | null
  dropHandledForSession: boolean
  beginInternalFileDrag: (fileId: number) => number[]
  markInternalDropHandled: () => boolean
  clearInternalFileDrag: () => void
  // Preview mode state
  previewMode: boolean
  previewIndex: number
  previewFiles: FileItem[]
  setPreviewMode: (mode: boolean) => void
  setPreviewIndex: (index: number) => void
  setPreviewFiles: (files: FileItem[]) => void
  openPreview: (index: number, files: FileItem[]) => void
  closePreview: () => void
  setSearchQuery: (query: string) => void
  setSelectedFile: (file: FileItem | null) => void
  setSelectedFolderId: (folderId: number | null) => void
  toggleFileSelection: (fileId: number) => void
  clearSelection: () => void
  selectAll: () => void
  toggleSelectAll: () => void
  loadFiles: () => Promise<void>
  loadFilesInFolder: (folderId: number | null) => Promise<void>
  searchFiles: (query: string) => Promise<void>
  runCurrentQuery: (folderIdOverride?: number | null) => Promise<void>
  filterFiles: (filter: {
    query?: string
    folderId?: number | null
    fileTypes?: string[]
    dateStart?: string | null
    dateEnd?: string | null
    sizeMin?: number | null
    sizeMax?: number | null
    tagIds?: number[]
    minRating?: number
    favoritesOnly?: boolean
    dominantColor?: string
  }) => Promise<void>
  addTagToFile: (fileId: number, tagId: number) => Promise<void>
  removeTagFromFile: (fileId: number, tagId: number) => Promise<void>
  deleteFile: (fileId: number) => Promise<void>
  deleteFiles: (fileIds: number[]) => Promise<void>
  importFile: (sourcePath: string, refresh?: boolean, targetFolderId?: number | null) => Promise<FileItem | null>
  importFiles: (sourcePaths: string[], targetFolderId?: number | null) => Promise<FileItem[]>
  importImageFromBase64: (base64Data: string, ext: string, refresh?: boolean, targetFolderId?: number | null) => Promise<FileItem | null>
  importImagesFromBase64: (items: { base64Data: string; ext: string }[], targetFolderId?: number | null) => Promise<FileItem[]>
  cancelImportTask: () => Promise<void>
  updateFileMetadata: (fileId: number, rating: number, description: string, sourceUrl: string) => Promise<void>
  moveFile: (fileId: number, targetFolderId: number | null) => Promise<void>
  moveFiles: (fileIds: number[], targetFolderId: number | null) => Promise<void>
  copyFiles: (fileIds: number[], targetFolderId: number | null) => Promise<void>
  extractColor: (fileId: number) => Promise<string>
  exportFile: (fileId: number) => Promise<string>
  updateFileName: (fileId: number, newName: string) => Promise<void>
  // Trash-related state
  trashFiles: FileItem[]
  trashCount: number
  loadTrashFiles: () => Promise<void>
  restoreFile: (fileId: number) => Promise<void>
  restoreFiles: (fileIds: number[]) => Promise<void>
  permanentDeleteFile: (fileId: number) => Promise<void>
  permanentDeleteFiles: (fileIds: number[]) => Promise<void>
  emptyTrash: () => Promise<void>
  loadTrashCount: () => Promise<void>
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  selectedFile: null,
  selectedFolderId: null,
  selectedFiles: [],
  searchQuery: '',
  isLoading: false,
  importTask: null,

  // Pagination defaults
  pagination: {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
  },

  setPage: (page) => {
    set((state) => ({ pagination: { ...state.pagination, page } }))
    get().runCurrentQuery()
  },

  setPageSize: (pageSize) => {
    set((state) => ({ pagination: { ...state.pagination, pageSize, page: 1 } }))
    get().runCurrentQuery()
  },
  isDraggingInternal: false,
  draggedFileIds: [],
  draggedPrimaryFileId: null,
  currentDragSessionId: null,
  dropHandledForSession: false,

  // Undo stack for delete operations (max 50 entries)
  undoStack: [],

  addToUndoStack: (fileIds: number[]) => {
    const { undoStack } = get()
    const newStack = [...undoStack, { type: 'delete' as const, fileIds, timestamp: Date.now() }]
    // Limit stack size to 50
    if (newStack.length > 50) {
      newStack.shift()
    }
    set({ undoStack: newStack })
  },

  undo: async () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return

    const lastAction = undoStack[undoStack.length - 1]
    if (lastAction.type === 'delete') {
      console.log('[FileStore] Undoing delete for files:', lastAction.fileIds)
      await invoke('restore_files', { fileIds: lastAction.fileIds })
      // Refresh current view
      const { selectedFolderId } = get()
      await get().loadFilesInFolder(selectedFolderId)
      useFolderStore.getState().loadFolders()
      await get().loadTrashCount()
    }

    // Pop the last action from the stack
    set({ undoStack: undoStack.slice(0, -1) })
  },

  clearUndoStack: () => set({ undoStack: [] }),

  setIsDraggingInternal: (isDragging) => set({ isDraggingInternal: isDragging }),
  beginInternalFileDrag: (fileId) => {
    const { selectedFiles } = get()
    const draggedFileIds = selectedFiles.includes(fileId) ? selectedFiles : [fileId]
    const currentDragSessionId = `${Date.now()}-${fileId}-${Math.random().toString(36).slice(2, 8)}`
    set({
      isDraggingInternal: true,
      draggedFileIds,
      draggedPrimaryFileId: fileId,
      currentDragSessionId,
      dropHandledForSession: false,
    })
    console.log('[FileStore] beginInternalFileDrag', { currentDragSessionId, draggedFileIds, fileId })
    return draggedFileIds
  },
  markInternalDropHandled: () => {
    const { currentDragSessionId, dropHandledForSession } = get()
    if (!currentDragSessionId || dropHandledForSession) {
      console.log('[FileStore] drop ignored', { currentDragSessionId, dropHandledForSession })
      return false
    }
    set({ dropHandledForSession: true })
    console.log('[FileStore] drop accepted', { currentDragSessionId })
    return true
  },
  clearInternalFileDrag: () =>
    set({
      isDraggingInternal: false,
      draggedFileIds: [],
      draggedPrimaryFileId: null,
      currentDragSessionId: null,
      dropHandledForSession: false,
    }),
  // Preview mode defaults
  previewMode: false,
  previewIndex: 0,
  previewFiles: [],

  // Trash-related state
  trashFiles: [],
  trashCount: 0,

  setPreviewMode: (mode) => set({ previewMode: mode }),

  setPreviewIndex: (index) => set({ previewIndex: index }),

  setPreviewFiles: (files) => set({ previewFiles: files }),

  openPreview: (index, files) => set({
    previewMode: true,
    previewIndex: index,
    previewFiles: files
  }),

  closePreview: () => set({
    previewMode: false,
    previewIndex: 0,
    previewFiles: []
  }),

  setSearchQuery: (query) => {
    set({ searchQuery: query })
    useFilterStore.getState().setSearchQuery(query)
    set((state) => ({ pagination: { ...state.pagination, page: 1 } }))

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
    }

    searchDebounceTimer = setTimeout(() => {
      void get().runCurrentQuery()
    }, 250)
  },

  setSelectedFile: (file) => set({ selectedFile: file ? parseFile(file) : null }),

  setSelectedFolderId: (folderId) => set({ selectedFolderId: folderId }),

  runCurrentQuery: async (folderIdOverride) => {
    const { searchQuery, selectedFolderId } = get()
    const criteria = useFilterStore.getState().criteria
    const folderId = folderIdOverride !== undefined ? folderIdOverride : selectedFolderId
    const hasStructuredFilters =
      criteria.fileType !== 'all' ||
      !!criteria.dateRange.start ||
      !!criteria.dateRange.end ||
      criteria.sizeRange.min !== null ||
      criteria.sizeRange.max !== null ||
      criteria.tagIds.length > 0 ||
      criteria.minRating > 0 ||
      criteria.favoritesOnly ||
      !!criteria.dominantColor ||
      !!criteria.keyword ||
      criteria.folderId !== null

    if (hasStructuredFilters) {
      await get().filterFiles({
        query: criteria.keyword || searchQuery || undefined,
        folderId: criteria.folderId ?? folderId,
        fileTypes: criteria.fileType !== 'all' ? [criteria.fileType] : undefined,
        dateStart: criteria.dateRange.start,
        dateEnd: criteria.dateRange.end,
        sizeMin: criteria.sizeRange.min,
        sizeMax: criteria.sizeRange.max,
        tagIds: criteria.tagIds.length ? criteria.tagIds : undefined,
        minRating: criteria.minRating > 0 ? criteria.minRating : undefined,
        favoritesOnly: criteria.favoritesOnly || undefined,
        dominantColor: criteria.dominantColor || undefined,
      })
      return
    }

    if (searchQuery.trim()) {
      await get().searchFiles(searchQuery)
      return
    }

    await get().loadFilesInFolder(folderId)
  },

  toggleFileSelection: (fileId) => {
    const { selectedFiles } = get()
    if (selectedFiles.includes(fileId)) {
      set({ selectedFiles: selectedFiles.filter(id => id !== fileId) })
    } else {
      set({ selectedFiles: [...selectedFiles, fileId] })
    }
  },

  clearSelection: () => set({ selectedFiles: [] }),

  selectAll: () => {
    const { files } = get()
    set({ selectedFiles: files.map(f => f.id), selectedFile: null })
  },

  toggleSelectAll: () => {
    const { files, selectedFiles } = get()
    if (files.length > 0 && selectedFiles.length === files.length) {
      set({ selectedFiles: [] })
      return
    }

    set({ selectedFiles: files.map(f => f.id), selectedFile: null })
  },

  loadFiles: async () => {
    const { selectedFile, pagination } = get()
    const requestId = ++fileListRequestId
    set({ isLoading: true })
    try {
      const result = await invoke<PaginatedFilesResponse>('get_all_files', {
        page: pagination.page,
        pageSize: pagination.pageSize
      })
      if (requestId !== fileListRequestId) return
      // Parse colorDistribution from JSON string
      const parsedFiles = parseFileList(result.files)
      // Update selectedFile if it exists in the new files list
      let newSelectedFile = selectedFile
      if (selectedFile) {
        newSelectedFile = parsedFiles.find(f => f.id === selectedFile.id) || null
      }
      set({
        files: parsedFiles,
        isLoading: false,
        selectedFile: newSelectedFile,
        pagination: {
          page: result.page,
          pageSize: result.page_size,
          total: result.total,
          totalPages: result.total_pages,
        }
      })
    } catch (e) {
      console.error('Failed to load files:', e)
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  loadFilesInFolder: async (folderId) => {
    console.log('[fileStore] loadFilesInFolder called, folderId:', folderId)
    set({ selectedFolderId: folderId })
    const criteria = useFilterStore.getState().criteria
    const hasStructuredFilters =
      criteria.fileType !== 'all' ||
      !!criteria.dateRange.start ||
      !!criteria.dateRange.end ||
      criteria.sizeRange.min !== null ||
      criteria.sizeRange.max !== null ||
      criteria.tagIds.length > 0 ||
      criteria.minRating > 0 ||
      criteria.favoritesOnly ||
      !!criteria.dominantColor ||
      !!criteria.keyword ||
      criteria.folderId !== null
    if (hasStructuredFilters || get().searchQuery.trim()) {
      await get().runCurrentQuery(folderId)
      return
    }

    const { pagination, selectedFile, selectedFiles } = get()
    const requestId = ++fileListRequestId
    set({ isLoading: true })
    try {
      let result: PaginatedFilesResponse
      if (folderId === null) {
        // When folderId is null, get ALL files (not just orphan files)
        // Use filter_files with no folder filter
        result = await invoke('filter_files', {
          filter: {
            query: null,
            folder_id: null,
            file_types: null,
            date_start: null,
            date_end: null,
            size_min: null,
            size_max: null,
            tag_ids: null,
            min_rating: null,
            favorites_only: null,
            dominant_color: null,
          },
          page: pagination.page,
          pageSize: pagination.pageSize
        })
      } else {
        result = await invoke('get_files_in_folder', {
          folderId,
          page: pagination.page,
          pageSize: pagination.pageSize
        })
      }
      if (requestId !== fileListRequestId) return
      // Parse colorDistribution from JSON string
      const parsedFiles = parseFileList(result.files)
      const visibleFileIds = new Set(parsedFiles.map((file) => file.id))
      const newSelectedFile = selectedFile
        ? parsedFiles.find((file) => file.id === selectedFile.id) || null
        : null
      const newSelectedFiles = selectedFiles.filter((fileId) => visibleFileIds.has(fileId))
      console.log('[fileStore] Loaded files:', parsedFiles.length)
      set({
        files: parsedFiles,
        isLoading: false,
        selectedFile: newSelectedFile,
        selectedFiles: newSelectedFiles,
        pagination: {
          page: result.page,
          pageSize: result.page_size,
          total: result.total,
          totalPages: result.total_pages,
        }
      })
    } catch (e) {
      console.error('[fileStore] Failed to load files in folder:', e)
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  searchFiles: async (query) => {
    const { pagination } = get()
    const requestId = ++fileListRequestId
    set({ isLoading: true })
    try {
      const result = await invoke<PaginatedFilesResponse>('search_files', {
        query,
        page: pagination.page,
        pageSize: pagination.pageSize
      })
      if (requestId !== fileListRequestId) return
      // Parse colorDistribution from JSON string
      const parsedFiles = parseFileList(result.files)
      set({
        files: parsedFiles,
        isLoading: false,
        pagination: {
          page: result.page,
          pageSize: result.page_size,
          total: result.total,
          totalPages: result.total_pages,
        }
      })
    } catch (e) {
      console.error('Failed to search files:', e)
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  filterFiles: async (filter) => {
    const { pagination } = get()
    const requestId = ++fileListRequestId
    set({ isLoading: true })
    try {
      const result = await invoke<PaginatedFilesResponse>('filter_files', {
        filter: {
          query: filter.query || null,
          folder_id: filter.folderId ?? null,
          file_types: filter.fileTypes || null,
          date_start: filter.dateStart || null,
          date_end: filter.dateEnd || null,
          size_min: filter.sizeMin ?? null,
          size_max: filter.sizeMax ?? null,
          tag_ids: filter.tagIds?.length ? filter.tagIds : null,
          min_rating: filter.minRating ?? null,
          favorites_only: filter.favoritesOnly ?? null,
          dominant_color: filter.dominantColor || null,
        },
        page: pagination.page,
        pageSize: pagination.pageSize
      })
      if (requestId !== fileListRequestId) return
      // Parse colorDistribution from JSON string
      const parsedFiles = parseFileList(result.files)
      set({
        files: parsedFiles,
        isLoading: false,
        pagination: {
          page: result.page,
          pageSize: result.page_size,
          total: result.total,
          totalPages: result.total_pages,
        }
      })
    } catch (e) {
      console.error('Failed to filter files:', e)
      if (requestId === fileListRequestId) {
        set({ isLoading: false })
      }
    }
  },

  addTagToFile: async (fileId, tagId) => {
    await invoke('add_tag_to_file', { fileId, tagId })
    const { selectedFolderId } = get()
    await get().loadFilesInFolder(selectedFolderId)
    useTagStore.getState().loadTags()
  },

  removeTagFromFile: async (fileId, tagId) => {
    await invoke('remove_tag_from_file', { fileId, tagId })
    const { selectedFolderId } = get()
    await get().loadFilesInFolder(selectedFolderId)
    useTagStore.getState().loadTags()
  },

  deleteFile: async (fileId: number) => {
    console.log('[FileStore] deleteFile called, fileId:', fileId)
    const { selectedFolderId } = get()
    await invoke('delete_file', { fileId })
    // Add to undo stack for Ctrl+Z restore
    get().addToUndoStack([fileId])
    set({ selectedFile: null })
    await get().loadFilesInFolder(selectedFolderId)
    useFolderStore.getState().loadFolders()
    console.log('[FileStore] deleteFile completed')
  },

  deleteFiles: async (fileIds: number[]) => {
    console.log('[FileStore] deleteFiles called, fileIds:', fileIds)
    const { selectedFolderId } = get()
    await invoke('delete_files', { fileIds })
    // Add to undo stack for Ctrl+Z restore
    get().addToUndoStack(fileIds)
    set({ selectedFiles: [], selectedFile: null })
    await get().loadFilesInFolder(selectedFolderId)
    useFolderStore.getState().loadFolders()
    console.log('[FileStore] deleteFiles completed')
  },

  importFile: async (sourcePath: string, refresh = true, targetFolderId?: number | null) => {
    console.log('[FileStore] importFile called, path:', sourcePath, 'refresh:', refresh, 'targetFolderId:', targetFolderId)
    const selectedFolderId = targetFolderId !== undefined ? targetFolderId : get().selectedFolderId
    try {
      const file = await invoke<FileItem>('import_file', { sourcePath, folderId: selectedFolderId })
      console.log('[FileStore] importFile result:', file)
      if (refresh) {
        await get().loadFilesInFolder(selectedFolderId)
        useFolderStore.getState().loadFolders()
      }
      console.log('[FileStore] loadFiles completed')
      return file
    } catch (e) {
      console.error('[FileStore] Failed to import file:', e)
      return null
    }
  },

  importFiles: async (sourcePaths: string[], targetFolderId?: number | null) => {
    console.log('[FileStore] importFiles called, count:', sourcePaths.length)
    if (sourcePaths.length === 0) return []
    const selectedFolderId = targetFolderId !== undefined ? targetFolderId : get().selectedFolderId
    try {
      const task = await invoke<ImportTaskSnapshot>('start_import_task', {
        items: sourcePaths.map((path) => ({ kind: 'file_path', path })),
        folderId: selectedFolderId,
      })
      set({ importTask: task })

      const currentTask = await waitForImportTask(task.id, (nextTask) => {
        set({ importTask: nextTask })
      })
      const results = await finalizeImportTask(
        currentTask,
        (nextTask) => set({ importTask: nextTask }),
        () => get().loadFilesInFolder(selectedFolderId),
      )
      console.log('[FileStore] importFiles completed, imported:', results.length)
      return results
    } catch (e) {
      console.error('[FileStore] Failed to import files:', e)
      set({ importTask: null })
      return []
    }
  },

  importImageFromBase64: async (base64Data: string, ext: string, refresh = true, targetFolderId?: number | null) => {
    console.log('[FileStore] importImageFromBase64 called, ext:', ext, 'refresh:', refresh, 'targetFolderId:', targetFolderId)
    const selectedFolderId = targetFolderId !== undefined ? targetFolderId : get().selectedFolderId
    try {
      const file = await invoke<FileItem>('import_image_from_base64', { base64Data, ext, folderId: selectedFolderId })
      console.log('[FileStore] importImageFromBase64 result:', file)
      if (refresh) {
        await get().loadFilesInFolder(selectedFolderId)
        useFolderStore.getState().loadFolders()
      }
      return file
    } catch (e) {
      console.error('[FileStore] Failed to import image from clipboard:', e)
      return null
    }
  },

  importImagesFromBase64: async (items: { base64Data: string; ext: string }[], targetFolderId?: number | null) => {
    console.log('[FileStore] importImagesFromBase64 called, count:', items.length, 'targetFolderId:', targetFolderId)
    if (items.length === 0) return []
    const selectedFolderId = targetFolderId !== undefined ? targetFolderId : get().selectedFolderId
    try {
      const task = await invoke<ImportTaskSnapshot>('start_import_task', {
        items: items.map((item) => ({
          kind: 'base64_image',
          base64Data: item.base64Data,
          ext: item.ext,
        })),
        folderId: selectedFolderId,
      })
      set({ importTask: task })

      const currentTask = await waitForImportTask(task.id, (nextTask) => {
        set({ importTask: nextTask })
      })
      const results = await finalizeImportTask(
        currentTask,
        (nextTask) => set({ importTask: nextTask }),
        () => get().loadFilesInFolder(selectedFolderId),
      )
      console.log('[FileStore] importImagesFromBase64 completed, imported:', results.length)
      return results
    } catch (e) {
      console.error('[FileStore] Failed to import images:', e)
      set({ importTask: null })
      return []
    }
  },

  cancelImportTask: async () => {
    const task = get().importTask
    if (!task || TERMINAL_IMPORT_TASK_STATUSES.has(task.status)) return
    await invoke('cancel_import_task', { taskId: task.id })
  },

  updateFileMetadata: async (fileId: number, rating: number, description: string, sourceUrl: string) => {
    console.log('[FileStore] updateFileMetadata called, fileId:', fileId, 'rating:', rating)
    await invoke('update_file_metadata', { fileId, rating, description, sourceUrl })
    // Re-fetch from database to get accurate modified_at (set by trigger)
    const updatedFile = await invoke<FileItem>('get_file', { fileId })
    const parsedFile = parseFile(updatedFile)
    set((state) => ({
      files: state.files.map((f) => f.id === fileId ? parsedFile : f),
      selectedFile: state.selectedFile?.id === fileId ? parsedFile : state.selectedFile,
    }))
  },

  moveFile: async (fileId: number, targetFolderId: number | null) => {
    console.log('[FileStore] moveFile called, fileId:', fileId, 'targetFolderId:', targetFolderId)
    await invoke('move_file', { fileId, targetFolderId })
    const { selectedFolderId } = get()
    await get().loadFilesInFolder(selectedFolderId)
    await useFolderStore.getState().loadFolders()
  },

  moveFiles: async (fileIds: number[], targetFolderId: number | null) => {
    console.log('[FileStore] moveFiles called, fileIds:', fileIds, 'targetFolderId:', targetFolderId)
    await invoke('move_files', { fileIds, targetFolderId })
    const { selectedFolderId } = get()
    set({ selectedFiles: [], selectedFile: null })
    await get().loadFilesInFolder(selectedFolderId)
    await useFolderStore.getState().loadFolders()
  },

  copyFiles: async (fileIds: number[], targetFolderId: number | null) => {
    console.log('[FileStore] copyFiles called, fileIds:', fileIds, 'targetFolderId:', targetFolderId)
    await invoke('copy_files', { fileIds, targetFolderId })
    const { selectedFolderId } = get()
    await get().loadFilesInFolder(selectedFolderId)
    await useFolderStore.getState().loadFolders()
  },

  extractColor: async (fileId: number) => {
    console.log('[FileStore] extractColor called, fileId:', fileId)
    const color = await invoke<string>('extract_color', { fileId })
    // Re-fetch from database to get accurate modified_at
    const updatedFile = await invoke<FileItem>('get_file', { fileId })
    const parsedFile = parseFile(updatedFile)
    set((state) => ({
      files: state.files.map((f) => f.id === fileId ? parsedFile : f),
      selectedFile: state.selectedFile?.id === fileId ? parsedFile : state.selectedFile,
    }))
    return color
  },

  exportFile: async (fileId: number) => {
    console.log('[FileStore] exportFile called, fileId:', fileId)
    const exportPath = await invoke<string>('export_file', { fileId })
    console.log('[FileStore] exportFile completed, path:', exportPath)
    return exportPath
  },

  updateFileName: async (fileId: number, newName: string) => {
    console.log('[FileStore] updateFileName called, fileId:', fileId, 'newName:', newName)
    await invoke('update_file_name', { fileId, newName })
    // Re-fetch from database to get accurate modified_at
    const updatedFile = await invoke<FileItem>('get_file', { fileId })
    const parsedFile = parseFile(updatedFile)
    set((state) => ({
      files: state.files.map((f) => f.id === fileId ? parsedFile : f),
      selectedFile: state.selectedFile?.id === fileId ? parsedFile : state.selectedFile,
    }))
  },

  // Trash-related methods
  loadTrashFiles: async () => {
    console.log('[FileStore] loadTrashFiles called')
    set({ isLoading: true })
    try {
      const files = await invoke<FileItem[]>('get_trash_files')
      const parsedFiles = parseFileList(files)
      set({ trashFiles: parsedFiles, isLoading: false })
      console.log('[FileStore] Loaded trash files:', parsedFiles.length)
    } catch (e) {
      console.error('[FileStore] Failed to load trash files:', e)
      set({ isLoading: false })
    }
  },

  restoreFile: async (fileId: number) => {
    console.log('[FileStore] restoreFile called, fileId:', fileId)
    await invoke('restore_file', { fileId })
    // Reload trash files and refresh current view
    await get().loadTrashFiles()
    await get().loadTrashCount()
  },

  restoreFiles: async (fileIds: number[]) => {
    console.log('[FileStore] restoreFiles called, fileIds:', fileIds)
    await invoke('restore_files', { fileIds })
    await get().loadTrashFiles()
    await get().loadTrashCount()
  },

  permanentDeleteFile: async (fileId: number) => {
    console.log('[FileStore] permanentDeleteFile called, fileId:', fileId)
    await invoke('permanent_delete_file', { fileId })
    await get().loadTrashFiles()
    await get().loadTrashCount()
  },

  permanentDeleteFiles: async (fileIds: number[]) => {
    console.log('[FileStore] permanentDeleteFiles called, fileIds:', fileIds)
    await invoke('permanent_delete_files', { fileIds })
    await get().loadTrashFiles()
    await get().loadTrashCount()
  },

  emptyTrash: async () => {
    console.log('[FileStore] emptyTrash called')
    await invoke('empty_trash')
    await get().loadTrashFiles()
    await get().loadTrashCount()
  },

  loadTrashCount: async () => {
    try {
      const count = await invoke<number>('get_trash_count')
      set({ trashCount: count })
    } catch (e) {
      console.error('[FileStore] Failed to load trash count:', e)
    }
  },
}))
