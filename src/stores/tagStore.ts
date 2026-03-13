import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface Tag {
  id: number
  name: string
  color: string
  count: number
}

interface TagStore {
  tags: Tag[]
  selectedTagId: number | null
  loadTags: () => Promise<void>
  addTag: (name: string, color: string) => Promise<void>
  deleteTag: (id: number) => Promise<void>
  updateTag: (id: number, name: string, color: string) => Promise<void>
  setSelectedTagId: (id: number | null) => void
}

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],
  selectedTagId: null,

  loadTags: async () => {
    try {
      const tags = await invoke<Tag[]>('get_all_tags')
      set({ tags })
    } catch (e) {
      console.error('Failed to load tags:', e)
    }
  },

  addTag: async (name, color) => {
    await invoke('create_tag', { name, color })
    get().loadTags()
  },

  deleteTag: async (id) => {
    await invoke('delete_tag', { id })
    get().loadTags()
  },

  updateTag: async (id, name, color) => {
    await invoke('update_tag', { id, name, color })
    get().loadTags()
  },

  setSelectedTagId: (id) => set({ selectedTagId: id }),
}))
