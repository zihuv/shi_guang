import { invokeDesktop } from "@/services/desktop/core";
import type { RawTag } from "@/shared/desktop-types";

export function getAllTags() {
  return invokeDesktop<RawTag[]>("get_all_tags");
}

export function createTag(args: { name: string; color: string; parentId?: number | null }) {
  return invokeDesktop<void>("create_tag", args);
}

export function updateTag(args: { id: number; name: string; color: string }) {
  return invokeDesktop<void>("update_tag", args);
}

export function deleteTag(id: number) {
  return invokeDesktop<void>("delete_tag", { id });
}

export function addTagToFile(args: { fileId: number; tagId: number }) {
  return invokeDesktop<void>("add_tag_to_file", args);
}

export function removeTagFromFile(args: { fileId: number; tagId: number }) {
  return invokeDesktop<void>("remove_tag_from_file", args);
}

export function reorderTags(args: { tagIds: number[]; parentId?: number | null }) {
  return invokeDesktop<void>("reorder_tags", args);
}

export function moveTag(args: { tagId: number; newParentId: number | null; sortOrder?: number }) {
  return invokeDesktop<void>("move_tag", args);
}
