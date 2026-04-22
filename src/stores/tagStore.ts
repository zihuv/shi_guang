import { create } from "zustand";
import {
  createTag,
  deleteTag,
  getAllTags,
  moveTag,
  reorderTags,
  updateTag,
} from "@/services/desktop/tags";
import { useSmartCollectionStore } from "@/stores/smartCollectionStore";

export interface Tag {
  id: number;
  name: string;
  color: string;
  count: number;
  parentId: number | null;
  sortOrder?: number;
  children: Tag[];
}

type RawTag = Omit<Tag, "children">;

export function buildTagTree(rawTags: RawTag[]): Tag[] {
  const tagMap = new Map<number, Tag>();

  rawTags.forEach((tag) => {
    tagMap.set(tag.id, {
      ...tag,
      children: [],
    });
  });

  const roots: Tag[] = [];

  rawTags.forEach((tag) => {
    const node = tagMap.get(tag.id);
    if (!node) return;

    if (tag.parentId === null) {
      roots.push(node);
      return;
    }

    const parent = tagMap.get(tag.parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: Tag[]) => {
    nodes.sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

export function flattenTagTree(tags: Tag[], depth = 0): Array<Tag & { depth: number }> {
  return tags.flatMap((tag) => [{ ...tag, depth }, ...flattenTagTree(tag.children, depth + 1)]);
}

export function collectTagIds(tag: Tag): number[] {
  return [tag.id, ...tag.children.flatMap((child) => collectTagIds(child))];
}

interface TagStore {
  tags: Tag[];
  flatTags: Array<Tag & { depth: number }>;
  selectedTagId: number | null;
  loadTags: () => Promise<void>;
  addTag: (name: string, color: string, parentId?: number | null) => Promise<void>;
  deleteTag: (id: number) => Promise<void>;
  updateTag: (id: number, name: string, color: string) => Promise<void>;
  reorderTags: (tagIds: number[], parentId?: number | null) => Promise<void>;
  moveTag: (tagId: number, newParentId: number | null, sortOrder?: number) => Promise<void>;
  setTags: (tags: Tag[]) => void;
  setSelectedTagId: (id: number | null) => void;
}

const syncTags = (set: (partial: Partial<TagStore>) => void, rawTags: RawTag[]) => {
  const tree = buildTagTree(rawTags);
  set({
    tags: tree,
    flatTags: flattenTagTree(tree),
  });
};

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],
  flatTags: [],
  selectedTagId: null,

  loadTags: async () => {
    try {
      const tags = await getAllTags();
      syncTags(set, tags);
    } catch (e) {
      console.error("Failed to load tags:", e);
    }
  },

  addTag: async (name, color, parentId = null) => {
    await createTag({ name, color, parentId });
    await get().loadTags();
  },

  deleteTag: async (id) => {
    await deleteTag(id);
    await get().loadTags();
    await useSmartCollectionStore.getState().loadStats();
  },

  updateTag: async (id, name, color) => {
    await updateTag({ id, name, color });
    await get().loadTags();
  },

  reorderTags: async (tagIds, parentId = null) => {
    try {
      await reorderTags({ tagIds, parentId });
      await get().loadTags();
    } catch (e) {
      console.error("Failed to reorder tags:", e);
    }
  },

  moveTag: async (tagId, newParentId, sortOrder = 0) => {
    try {
      await moveTag({ tagId, newParentId, sortOrder });
      await get().loadTags();
    } catch (e) {
      console.error("Failed to move tag:", e);
    }
  },

  setSelectedTagId: (id) => set({ selectedTagId: id }),

  setTags: (tags) => set({ tags, flatTags: flattenTagTree(tags) }),
}));
