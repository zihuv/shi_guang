import {
  addTagToFile,
  createTag,
  deleteTag,
  getAllTags,
  moveTag,
  removeTagFromFile,
  reorderTags,
  updateTag,
} from "../database";
import type { AppState } from "../types";
import {
  type CommandHandler,
  numberArg,
  numberArrayArg,
  optionalNumberArg,
  stringArg,
} from "./common";

export function createTagCommands(state: AppState): Record<string, CommandHandler> {
  return {
    get_all_tags: () => getAllTags(state.db),
    create_tag: (args) =>
      createTag(
        state.db,
        stringArg(args, "name"),
        stringArg(args, "color"),
        optionalNumberArg(args, "parentId", "parent_id"),
      ),
    update_tag: (args) =>
      updateTag(state.db, numberArg(args, "id"), stringArg(args, "name"), stringArg(args, "color")),
    delete_tag: (args) => deleteTag(state.db, numberArg(args, "id")),
    add_tag_to_file: (args) =>
      addTagToFile(
        state.db,
        numberArg(args, "fileId", "file_id"),
        numberArg(args, "tagId", "tag_id"),
      ),
    remove_tag_from_file: (args) =>
      removeTagFromFile(
        state.db,
        numberArg(args, "fileId", "file_id"),
        numberArg(args, "tagId", "tag_id"),
      ),
    reorder_tags: (args) =>
      reorderTags(
        state.db,
        numberArrayArg(args, "tagIds", "tag_ids"),
        optionalNumberArg(args, "parentId", "parent_id"),
      ),
    move_tag: (args) =>
      moveTag(
        state.db,
        numberArg(args, "tagId", "tag_id"),
        optionalNumberArg(args, "newParentId", "new_parent_id"),
        optionalNumberArg(args, "sortOrder", "sort_order") ?? 0,
      ),
  };
}
