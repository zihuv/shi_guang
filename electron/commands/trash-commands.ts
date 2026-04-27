import {
  getDeleteMode,
  getTrashCount,
  getTrashFiles,
  getTrashFolders,
  getTrashItems,
  setDeleteMode,
} from "../database";
import type { AppState } from "../types";
import { type CommandHandler, numberArg, numberArrayArg } from "./common";
import {
  copyOneFile,
  deleteFileCommand,
  moveOneFile,
  permanentDeleteOneFile,
  permanentlyDeleteTrashedFolder,
  restoreOneFile,
  restoreTrashedFolder,
} from "./trash-file-service";
import { optionalNumberArg } from "./common";

export function createTrashCommands(state: AppState): Record<string, CommandHandler> {
  return {
    delete_file: async (args) => deleteFileCommand(state, numberArg(args, "fileId", "file_id")),
    delete_files: async (args) => {
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids")) {
        await deleteFileCommand(state, fileId);
      }
    },
    get_trash_files: () => getTrashFiles(state.db),
    get_trash_items: () => getTrashItems(state.db),
    restore_file: async (args) => {
      const result = await restoreOneFile(state, numberArg(args, "fileId", "file_id"));
      return { movedToUnclassifiedCount: result.movedToUnclassified ? 1 : 0 };
    },
    restore_files: async (args) => {
      let movedToUnclassifiedCount = 0;
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids")) {
        movedToUnclassifiedCount += (await restoreOneFile(state, fileId)).movedToUnclassified
          ? 1
          : 0;
      }
      return { movedToUnclassifiedCount };
    },
    restore_folder: (args) => restoreTrashedFolder(state, numberArg(args, "folderId", "folder_id")),
    restore_folders: async (args) => {
      const results = [];
      for (const folderId of numberArrayArg(args, "folderIds", "folder_ids")) {
        results.push(await restoreTrashedFolder(state, folderId));
      }
      return results;
    },
    permanent_delete_file: (args) =>
      permanentDeleteOneFile(state, numberArg(args, "fileId", "file_id")),
    permanent_delete_files: async (args) => {
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids")) {
        await permanentDeleteOneFile(state, fileId);
      }
    },
    permanent_delete_folder: (args) =>
      permanentlyDeleteTrashedFolder(state, numberArg(args, "folderId", "folder_id")),
    permanent_delete_folders: async (args) => {
      for (const folderId of numberArrayArg(args, "folderIds", "folder_ids")) {
        await permanentlyDeleteTrashedFolder(state, folderId);
      }
    },
    empty_trash: async () => {
      for (const folder of getTrashFolders(state.db)) {
        await permanentlyDeleteTrashedFolder(state, folder.id);
      }
      for (const file of getTrashFiles(state.db)) {
        await permanentDeleteOneFile(state, file.id);
      }
    },
    get_delete_mode: () => getDeleteMode(state.db),
    set_delete_mode: (args) => setDeleteMode(state.db, Boolean(args.useTrash ?? args.use_trash)),
    get_trash_count: () => getTrashCount(state.db),
    copy_file: async (args, window) =>
      copyOneFile(
        state,
        window,
        numberArg(args, "fileId", "file_id"),
        optionalNumberArg(args, "targetFolderId", "target_folder_id"),
      ),
    copy_files: async (args, window) => {
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids")) {
        await copyOneFile(
          state,
          window,
          fileId,
          optionalNumberArg(args, "targetFolderId", "target_folder_id"),
        );
      }
    },
    move_file: (args) =>
      moveOneFile(
        state,
        numberArg(args, "fileId", "file_id"),
        optionalNumberArg(args, "targetFolderId", "target_folder_id"),
      ),
    move_files: async (args) => {
      for (const fileId of new Set(numberArrayArg(args, "fileIds", "file_ids"))) {
        await moveOneFile(
          state,
          fileId,
          optionalNumberArg(args, "targetFolderId", "target_folder_id"),
        );
      }
    },
  };
}
