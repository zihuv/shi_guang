import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface FolderNode {
  id: number
  name: string
  path: string
  children: FolderNode[]
  fileCount: number
}

interface FolderStore {
  folders: FolderNode[]
  selectedFolderId: number | null
  expandedFolderIds: number[]
  isLoading: boolean
  loadFolders: () => Promise<void>
  initDefaultFolder: () => Promise<void>
  selectFolder: (folderId: number | null) => void
  toggleFolder: (folderId: number) => void
  createFolder: (name: string, parentId: number | null) => Promise<void>
  deleteFolder: (id: number) => Promise<void>
  renameFolder: (id: number, name: string) => Promise<void>
  moveFile: (fileId: number, targetFolderId: number | null) => Promise<void>
}

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  selectedFolderId: null,
  expandedFolderIds: [],
  isLoading: false,

  loadFolders: async () => {
    set({ isLoading: true })
    try {
      const folders = await invoke<FolderNode[]>('get_folder_tree')
      set({ folders, isLoading: false })
    } catch (e) {
      console.error('Failed to load folders:', e)
      set({ isLoading: false })
    }
  },

  initDefaultFolder: async () => {
    try {
      const folder = await invoke<{ id: number; name: string; path: string; parent_id: number | null; created_at: string }>('init_default_folder')
      await get().loadFolders()
      set({ selectedFolderId: folder.id })
      return folder
    } catch (e) {
      console.error('Failed to init default folder:', e)
      return null
    }
  },

  selectFolder: (folderId) => {
    set({ selectedFolderId: folderId })
  },

  toggleFolder: (folderId) => {
    const { expandedFolderIds } = get()
    if (expandedFolderIds.includes(folderId)) {
      set({ expandedFolderIds: expandedFolderIds.filter(id => id !== folderId) })
    } else {
      set({ expandedFolderIds: [...expandedFolderIds, folderId] })
    }
  },

  createFolder: async (name, parentId) => {
    try {
      await invoke('create_folder', { name, parentId })
      await get().loadFolders()
    } catch (e) {
      console.error('Failed to create folder:', e)
    }
  },

  deleteFolder: async (id) => {
    try {
      await invoke('delete_folder', { id })
      await get().loadFolders()
    } catch (e) {
      console.error('Failed to delete folder:', e)
    }
  },

  renameFolder: async (id, name) => {
    try {
      await invoke('rename_folder', { id, name })
      await get().loadFolders()
    } catch (e) {
      console.error('Failed to rename folder:', e)
    }
  },

  moveFile: async (fileId, targetFolderId) => {
    try {
      await invoke('move_file', { fileId, targetFolderId })
      await get().loadFolders()
    } catch (e) {
      console.error('Failed to move file:', e)
    }
  },
}))
