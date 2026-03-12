import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { useFolderStore } from '@/stores/folderStore'

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
  tags: Tag[]
}

export interface Tag {
  id: number
  name: string
  color: string
}

interface FileStore {
  files: FileItem[]
  selectedFile: FileItem | null
  selectedFolderId: number | null
  selectedFiles: number[]
  searchQuery: string
  isLoading: boolean
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
  loadFiles: () => Promise<void>
  loadFilesInFolder: (folderId: number | null) => Promise<void>
  searchFiles: (query: string) => Promise<void>
  addTagToFile: (fileId: number, tagId: number) => Promise<void>
  removeTagFromFile: (fileId: number, tagId: number) => Promise<void>
  deleteFile: (fileId: number) => Promise<void>
  deleteFiles: (fileIds: number[]) => Promise<void>
  importFile: (sourcePath: string, refresh?: boolean) => Promise<FileItem | null>
  importFiles: (sourcePaths: string[]) => Promise<FileItem[]>
  importImageFromBase64: (base64Data: string, ext: string, refresh?: boolean) => Promise<FileItem | null>
  importImagesFromBase64: (items: { base64Data: string; ext: string }[]) => Promise<FileItem[]>
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  selectedFile: null,
  selectedFolderId: null,
  selectedFiles: [],
  searchQuery: '',
  isLoading: false,
  // Preview mode defaults
  previewMode: false,
  previewIndex: 0,
  previewFiles: [],

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
    get().searchFiles(query)
  },

  setSelectedFile: (file) => set({ selectedFile: file }),

  setSelectedFolderId: (folderId) => set({ selectedFolderId: folderId }),

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
    set({ selectedFiles: files.map(f => f.id) })
  },

  loadFiles: async () => {
    set({ isLoading: true })
    try {
      const files = await invoke<FileItem[]>('get_all_files')
      set({ files, isLoading: false })
    } catch (e) {
      console.error('Failed to load files:', e)
      set({ isLoading: false })
    }
  },

  loadFilesInFolder: async (folderId) => {
    console.log('[fileStore] loadFilesInFolder called, folderId:', folderId)
    set({ isLoading: true })
    try {
      const files = await invoke<FileItem[]>('get_files_in_folder', { folderId })
      console.log('[fileStore] Loaded files:', files.length)
      set({ files, isLoading: false })
    } catch (e) {
      console.error('[fileStore] Failed to load files in folder:', e)
      set({ isLoading: false })
    }
  },

  searchFiles: async (query) => {
    set({ isLoading: true })
    try {
      const files = await invoke<FileItem[]>('search_files', { query })
      set({ files, isLoading: false })
    } catch (e) {
      console.error('Failed to search files:', e)
      set({ isLoading: false })
    }
  },

  addTagToFile: async (fileId, tagId) => {
    await invoke('add_tag_to_file', { fileId, tagId })
    get().loadFiles()
  },

  removeTagFromFile: async (fileId, tagId) => {
    await invoke('remove_tag_from_file', { fileId, tagId })
    get().loadFiles()
  },

  deleteFile: async (fileId: number) => {
    console.log('[FileStore] deleteFile called, fileId:', fileId)
    await invoke('delete_file', { fileId })
    set({ selectedFile: null })
    get().loadFiles()
    useFolderStore.getState().loadFolders()
    console.log('[FileStore] deleteFile completed')
  },

  deleteFiles: async (fileIds: number[]) => {
    console.log('[FileStore] deleteFiles called, fileIds:', fileIds)
    await invoke('delete_files', { fileIds })
    set({ selectedFiles: [], selectedFile: null })
    get().loadFiles()
    useFolderStore.getState().loadFolders()
    console.log('[FileStore] deleteFiles completed')
  },

  importFile: async (sourcePath: string, refresh = true) => {
    console.log('[FileStore] importFile called, path:', sourcePath, 'refresh:', refresh)
    const { selectedFolderId } = get()
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

  importFiles: async (sourcePaths: string[]) => {
    console.log('[FileStore] importFiles called, count:', sourcePaths.length)
    const { selectedFolderId } = get()
    const results: FileItem[] = []
    try {
      for (const path of sourcePaths) {
        try {
          const file = await invoke<FileItem>('import_file', { sourcePath: path, folderId: selectedFolderId })
          if (file) {
            results.push(file)
          }
        } catch (e) {
          console.error('[FileStore] Failed to import file:', path, e)
        }
      }
      // Only refresh once after all imports
      await get().loadFilesInFolder(selectedFolderId)
      useFolderStore.getState().loadFolders()
      console.log('[FileStore] importFiles completed, imported:', results.length)
      return results
    } catch (e) {
      console.error('[FileStore] Failed to import files:', e)
      return results
    }
  },

  importImageFromBase64: async (base64Data: string, ext: string, refresh = true) => {
    console.log('[FileStore] importImageFromBase64 called, ext:', ext, 'refresh:', refresh)
    const { selectedFolderId } = get()
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

  importImagesFromBase64: async (items: { base64Data: string; ext: string }[]) => {
    console.log('[FileStore] importImagesFromBase64 called, count:', items.length)
    const { selectedFolderId } = get()
    const results: FileItem[] = []
    try {
      for (const item of items) {
        try {
          const file = await invoke<FileItem>('import_image_from_base64', {
            base64Data: item.base64Data,
            ext: item.ext,
            folderId: selectedFolderId
          })
          if (file) {
            results.push(file)
          }
        } catch (e) {
          console.error('[FileStore] Failed to import image from base64:', e)
        }
      }
      // Only refresh once after all imports
      await get().loadFilesInFolder(selectedFolderId)
      useFolderStore.getState().loadFolders()
      console.log('[FileStore] importImagesFromBase64 completed, imported:', results.length)
      return results
    } catch (e) {
      console.error('[FileStore] Failed to import images:', e)
      return results
    }
  },
}))
