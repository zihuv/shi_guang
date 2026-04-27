import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {
  BROWSER_COLLECTION_FOLDER_NAME,
  createFolderRecord,
  createFolderTrashEntry,
  currentTimestamp,
  deleteFolderRecord,
  getAllFolders,
  getDeleteMode,
  getFolderById,
  getFolderByPath,
  getFolderTree,
  getIndexPaths,
  moveFolderRecord,
  permanentDeleteFileRecord,
  renameFolder,
  reorderFolders,
  softDeleteFolderSubtree,
} from "../database";
import { removeThumbnailForFile } from "../storage";
import type { AppState } from "../types";
import {
  type CommandHandler,
  numberArg,
  numberArrayArg,
  optionalNumberArg,
  stringArg,
  taskId,
} from "./common";
import { ensureBrowserCollectionFolder } from "./collector-server";
import { scanFoldersOnly } from "./library-sync-service";
import {
  ensureDeletedFolderHoldingDir,
  getFilesUnderFolderPath,
  getFoldersUnderFolderPath,
  moveDirectoryWithFallback,
} from "./trash-file-service";
import { normalizeFolderName } from "../path-utils";

export function createFolderCommands(state: AppState): Record<string, CommandHandler> {
  return {
    get_folder_tree: () => getFolderTree(state.db),
    init_default_folder: () =>
      getAllFolders(state.db).find((folder) => !folder.isSystem && folder.parent_id === null) ??
      getAllFolders(state.db).find((folder) => !folder.isSystem) ??
      null,
    create_folder: async (args) => {
      const parentId = optionalNumberArg(args, "parentId", "parent_id");
      const parentPath =
        parentId === null ? getIndexPaths(state.db)[0] : getFolderById(state.db, parentId)?.path;
      if (!parentPath) throw new Error("No index path configured");
      const folderName = normalizeFolderName(stringArg(args, "name"));
      const folderPath = path.join(parentPath, folderName);
      if (getFolderByPath(state.db, folderPath) || fssync.existsSync(folderPath)) {
        throw new Error(`文件夹“${folderName}”已存在`);
      }
      await fs.mkdir(folderPath);
      return getFolderById(
        state.db,
        createFolderRecord(
          state.db,
          folderPath,
          folderName,
          parentId,
          Boolean(args.isSystem ?? args.is_system),
        ),
      );
    },
    delete_folder: async (args) => {
      const id = numberArg(args, "id");
      const folder = getFolderById(state.db, id);
      if (!folder) return null;
      if (folder.isSystem) throw new Error("Cannot delete system folder");
      const affectedFiles = getFilesUnderFolderPath(state.db, folder.path);
      const useTrash = getDeleteMode(state.db);

      if (!useTrash || !fssync.existsSync(folder.path)) {
        if (fssync.existsSync(folder.path)) {
          await fs.rm(folder.path, { recursive: true, force: true }).catch(() => undefined);
        }
        for (const file of affectedFiles) {
          await removeThumbnailForFile(getIndexPaths(state.db), file.path, file.contentHash);
          permanentDeleteFileRecord(state.db, file.id);
        }
        deleteFolderRecord(state.db, id);
        return {
          folderId: id,
          folderName: folder.name,
          folderPath: folder.path,
          removedFileCount: affectedFiles.length,
          movedToTrash: false,
        };
      }

      const holdingDir = await ensureDeletedFolderHoldingDir(state.appDataDir);
      const tempPath = path.join(
        holdingDir,
        `folder-trash-${taskId()}-${path.basename(folder.path)}`,
      );
      await moveDirectoryWithFallback(folder.path, tempPath);

      const deletedAt = currentTimestamp();
      const subfolderCount = Math.max(
        getFoldersUnderFolderPath(state.db, folder.path).length - 1,
        0,
      );
      state.db.transaction(() => {
        createFolderTrashEntry(state.db, {
          folderId: id,
          tempPath,
          deletedAt,
          fileCount: affectedFiles.length,
          subfolderCount,
        });
        softDeleteFolderSubtree(state.db, folder.path, deletedAt);
        for (const file of affectedFiles) {
          state.db.prepare("UPDATE files SET missing_at = ? WHERE id = ?").run(deletedAt, file.id);
        }
      })();
      return {
        folderId: id,
        folderName: folder.name,
        folderPath: folder.path,
        removedFileCount: affectedFiles.length,
        movedToTrash: true,
      };
    },
    rename_folder: (args) => renameFolder(state.db, numberArg(args, "id"), stringArg(args, "name")),
    move_folder: (args) =>
      moveFolderRecord(
        state.db,
        numberArg(args, "folderId", "folder_id"),
        optionalNumberArg(args, "newParentId", "new_parent_id"),
        numberArg({ sortOrder: args.sortOrder ?? args.sort_order ?? 0 }, "sortOrder"),
      ),
    reorder_folders: (args) =>
      reorderFolders(state.db, numberArrayArg(args, "folderIds", "folder_ids")),
    scan_folders: async () => {
      let total = 0;
      for (const indexPath of getIndexPaths(state.db)) {
        total += await scanFoldersOnly(state, indexPath);
      }
      return total;
    },
    init_browser_collection_folder: () => ensureBrowserCollectionFolder(state),
    get_browser_collection_folder: () =>
      getAllFolders(state.db).find(
        (folder) => folder.isSystem && folder.name === BROWSER_COLLECTION_FOLDER_NAME,
      ) ?? null,
  };
}
