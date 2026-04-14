import { invokeTauri } from "@/services/tauri/core";
import type { Tag } from "@/stores/tagStore";

export function getAllTags() {
  return invokeTauri<Tag[]>("get_all_tags");
}

export function createTag(args: { name: string; color: string; parentId?: number | null }) {
  return invokeTauri<void>("create_tag", args);
}

export function updateTag(args: { id: number; name: string; color: string }) {
  return invokeTauri<void>("update_tag", args);
}

export function deleteTag(id: number) {
  return invokeTauri<void>("delete_tag", { id });
}

export function addTagToFile(args: { fileId: number; tagId: number }) {
  return invokeTauri<void>("add_tag_to_file", args);
}

export function removeTagFromFile(args: { fileId: number; tagId: number }) {
  return invokeTauri<void>("remove_tag_from_file", args);
}

export function reorderTags(args: { tagIds: number[]; parentId?: number | null }) {
  return invokeTauri<void>("reorder_tags", args);
}

export function moveTag(args: { tagId: number; newParentId: number | null; sortOrder?: number }) {
  return invokeTauri<void>("move_tag", args);
}
