import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { useFolderStore } from './folderStore'
import { useFileStore } from './fileStore'

interface Settings {
  theme: 'light' | 'dark'
  indexPaths: string[]
}

interface SettingsStore extends Settings {
  setTheme: (theme: 'light' | 'dark') => Promise<void>
  addIndexPath: (path: string) => Promise<void>
  removeIndexPath: (path: string) => Promise<void>
  loadSettings: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: 'light',
  indexPaths: [],

  setTheme: async (theme) => {
    await invoke('set_setting', { key: 'theme', value: theme })
    set({ theme })
  },

  addIndexPath: async (path) => {
    await invoke('add_index_path', { path })
    const paths = await invoke<string[]>('get_index_paths')
    set({ indexPaths: paths })
    // Trigger file reindex and folder scan
    await invoke('reindex_all')
    await invoke('scan_folders')
    // Reload folders and files in UI
    useFolderStore.getState().loadFolders()
    useFileStore.getState().loadFiles()
  },

  removeIndexPath: async (path) => {
    await invoke('remove_index_path', { path })
    const paths = await invoke<string[]>('get_index_paths')
    set({ indexPaths: paths })
  },

  loadSettings: async () => {
    try {
      const theme = await invoke<string>('get_setting', { key: 'theme' })
      const indexPaths = await invoke<string[]>('get_index_paths')
      set({
        theme: (theme as 'light' | 'dark') || 'light',
        indexPaths: indexPaths || []
      })
    } catch (e) {
      // Silently handle "Setting not found" - first run has no settings
      // Only log if it's a different error
      const errorMsg = String(e)
      if (!errorMsg.includes('Setting not found')) {
        console.error('Failed to load settings:', e)
      }
    }
  },
}))
