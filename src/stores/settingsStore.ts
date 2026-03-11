import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

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
    // Trigger file reindex
    await invoke('reindex_all')
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
      console.error('Failed to load settings:', e)
    }
  },
}))
