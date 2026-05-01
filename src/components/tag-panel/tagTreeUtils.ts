import { type Tag } from "@/stores/tagStore";
import { filterFuzzyTree } from "@/shared/fuzzySearch";

export const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
];

export type DragPosition = { type: "none" } | { type: "sort"; targetId: number; before: boolean };

export const findTagParentId = (
  tags: Tag[],
  tagId: number,
  parentId: number | null = null,
): number | null => {
  for (const tag of tags) {
    if (tag.id === tagId) return parentId;
    if (tag.children.length > 0) {
      const found = findTagParentId(tag.children, tagId, tag.id);
      if (found !== null) return found;
    }
  }
  return null;
};

export const findTagById = (tags: Tag[], tagId: number): Tag | null => {
  for (const tag of tags) {
    if (tag.id === tagId) return tag;
    const found = findTagById(tag.children, tagId);
    if (found) return found;
  }
  return null;
};

export const findTagSiblings = (tags: Tag[], parentId: number | null): Tag[] => {
  if (parentId === null) return tags;
  const parent = findTagById(tags, parentId);
  return parent?.children ?? [];
};

export const isDescendant = (tags: Tag[], parentId: number, childId: number): boolean => {
  const parent = findTagById(tags, parentId);
  if (!parent) return false;

  const check = (nodes: Tag[]): boolean => {
    for (const node of nodes) {
      if (node.id === childId) return true;
      if (check(node.children)) return true;
    }
    return false;
  };

  return check(parent.children);
};

export function filterTagTree(tags: Tag[], query: string): Tag[] {
  if (!query.trim()) {
    return tags;
  }

  return filterFuzzyTree(tags, query, {
    keys: [(tag) => tag.name],
    getChildren: (tag) => tag.children,
    setChildren: (tag, children) => ({
      ...tag,
      children,
    }),
  });
}
