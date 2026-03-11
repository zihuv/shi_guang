import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface FileItem {
  id: number
  path: string
  name: string
  ext: string
  size: number
  width: number
  height: number
  createdAt: string
  modifiedAt: string
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
  searchQuery: string
  isLoading: boolean
  setSearchQuery: (query: string) => void
  setSelectedFile: (file: FileItem | null) => void
  loadFiles: () => Promise<void>
  searchFiles: (query: string) => Promise<void>
  addTagToFile: (fileId: number, tagId: number) => Promise<void>
  removeTagFromFile: (fileId: number, tagId: number) => Promise<void>
  deleteFile: (fileId: number) => Promise<void>
  importFile: (sourcePath: string) => Promise<FileItem | null>
  importImageFromBase64: (base64Data: string, ext: string) => Promise<FileItem | null>
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  selectedFile: null,
  searchQuery: '',
  isLoading: false,

  setSearchQuery: (query) => {
    set({ searchQuery: query })
    get().searchFiles(query)
  },

  setSelectedFile: (file) => set({ selectedFile: file }),

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
    console.log('[FileStore] deleteFile completed')
  },

  importFile: async (sourcePath: string) => {
    console.log('[FileStore] importFile called, path:', sourcePath)
    try {
      const file = await invoke<FileItem>('import_file', { sourcePath })
      console.log('[FileStore] importFile result:', file)
      await get().loadFiles()
      console.log('[FileStore] loadFiles completed')
      return file
    } catch (e) {
      console.error('[FileStore] Failed to import file:', e)
      return null
    }
  },

  importImageFromBase64: async (base64Data: string, ext: string) => {
    console.log('[FileStore] importImageFromBase64 called, ext:', ext)
    try {
      const file = await invoke<FileItem>('import_image_from_base64', { base64Data, ext })
      console.log('[FileStore] importImageFromBase64 result:', file)
      await get().loadFiles()
      return file
    } catch (e) {
      console.error('[FileStore] Failed to import image from clipboard:', e)
      return null
    }
  },
}))
