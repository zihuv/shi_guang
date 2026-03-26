import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { useFileStore } from './fileStore'

export interface FolderNode {
  id: number
  name: string
  path: string
  children: FolderNode[]
  fileCount: number
  isSystem?: boolean
  sortOrder?: number
  parentId?: number | null
}

const removeHiddenFolders = (folders: FolderNode[]): FolderNode[] =>
  folders
    .filter((folder) => !folder.name.startsWith('.'))
    .map((folder) => ({
      ...folder,
      children: removeHiddenFolders(folder.children || []),
    }))

interface FolderStore {
  folders: FolderNode[]
  selectedFolderId: number | null
  expandedFolderIds: number[]
  isLoading: boolean
  newFolderName: string
  addingSubfolder: FolderNode | null
  editingFolder: FolderNode | null
  deleteConfirm: FolderNode | null
  dragOverFolderId: number | null
  uniqueContextId: string
  loadFolders: () => Promise<void>
  initDefaultFolder: () => Promise<{ id: number; name: string; path: string; parent_id: number | null; created_at: string } | null>
  selectFolder: (folderId: number | null) => void
  toggleFolder: (folderId: number) => void
  createFolder: (name: string, parentId: number | null) => Promise<void>
  deleteFolder: (id: number) => Promise<void>
  renameFolder: (id: number, name: string) => Promise<void>
  moveFile: (fileId: number, targetFolderId: number | null) => Promise<void>
  moveFolder: (folderId: number, newParentId: number | null) => Promise<void>
  reorderFolders: (folderIds: number[]) => Promise<void>
  setFolders: (folders: FolderNode[]) => void
  setNewFolderName: (name: string) => void
  setAddingSubfolder: (folder: FolderNode | null) => void
  setEditingFolder: (folder: FolderNode | null) => void
  setDeleteConfirm: (folder: FolderNode | null) => void
  setDragOverFolderId: (folderId: number | null) => void
}

let loadFoldersRequestId = 0

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  selectedFolderId: null,
  expandedFolderIds: [],
  isLoading: false,
  newFolderName: '',
  addingSubfolder: null,
  editingFolder: null,
  deleteConfirm: null,
  dragOverFolderId: null,
  uniqueContextId: 'shiguang-folder-tree-context',

  setDragOverFolderId: (folderId) => set({ dragOverFolderId: folderId }),

  setFolders: (folders) => set({ folders }),

  loadFolders: async () => {
    const requestId = ++loadFoldersRequestId
    set({ isLoading: true })
    try {
      const folders = await invoke<FolderNode[]>('get_folder_tree')
      if (requestId !== loadFoldersRequestId) {
        return
      }
      set({ folders: removeHiddenFolders(folders), isLoading: false })
    } catch (e) {
      console.error('Failed to load folders:', e)
      if (requestId === loadFoldersRequestId) {
        set({ isLoading: false })
      }
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

  moveFolder: async (folderId, newParentId) => {
    try {
      await invoke('move_folder', { folderId, newParentId, sortOrder: 0 })
      await get().loadFolders()
      // Reload files to reflect the new paths after folder move
      const { selectedFolderId } = useFileStore.getState()
      await useFileStore.getState().loadFilesInFolder(selectedFolderId)
    } catch (e) {
      console.error('Failed to move folder:', e)
    }
  },

  reorderFolders: async (folderIds) => {
    try {
      await invoke('reorder_folders', { folderIds })
      // Reload folders to reflect the new order
      await get().loadFolders()
    } catch (e) {
      console.error('Failed to reorder folders:', e)
    }
  },

  setNewFolderName: (name) => set({ newFolderName: name }),

  setAddingSubfolder: (folder) => set({ addingSubfolder: folder }),

  setEditingFolder: (folder) => set({ editingFolder: folder, newFolderName: folder?.name || '' }),

  setDeleteConfirm: (folder) => set({ deleteConfirm: folder }),
}))
