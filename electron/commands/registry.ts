import { app, clipboard, nativeImage, shell } from "electron";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { serializeClipboardImportedImageItems, SHIGUANG_CLIPBOARD_FORMAT } from "../clipboard";
import {
  addIndexPath,
  addTagToFile,
  BROWSER_COLLECTION_FOLDER_NAME,
  createFolderRecord,
  createFolderTrashEntry,
  createTag,
  currentTimestamp,
  deleteFolderRecord,
  deleteTag,
  filterFiles,
  getAllFiles,
  getAllFolders,
  getAllTags,
  getDeleteMode,
  getFilesInFolder,
  getFileById,
  getFileByPath,
  getFolderById,
  getFolderByPath,
  getFolderTree,
  getIndexPaths,
  getSetting,
  getSmartCollectionStats,
  getTrashCount,
  getTrashFiles,
  getTrashFolders,
  getTrashItems,
  moveFileWithFallback,
  moveFolderRecord,
  moveTag,
  permanentDeleteFileRecord,
  removeIndexPath,
  removeTagFromFile,
  reorderFolders,
  reorderTags,
  renameFolder,
  searchFiles,
  searchFilesByVisualEmbedding,
  setDeleteMode,
  setSetting,
  softDeleteFolderSubtree,
  touchFileLastAccessed,
  updateFileColorData,
  updateFileDimensions,
  updateFileMetadata,
  updateFileNameRecord,
  updateFileThumbHash,
  updateTag,
} from "../database";
import { buildThumbHash, extractColorDistributionFromInput } from "../media";
import {
  ensureStorageDirs,
  getDefaultIndexPath,
  getThumbnailCachePath,
  persistIndexPath,
  readRecentIndexPaths,
  rememberRecentIndexPaths,
  removeThumbnailForFile,
} from "../storage";
import {
  encodeVisualSearchText,
  getRecommendedVisualModelPath,
  validateVisualModelPath,
} from "../visual-search";
import type { AppState, FileRecord, ImportTaskItem } from "../types";
import {
  type CommandHandler,
  emit,
  numberArg,
  numberArrayArg,
  optionalNumberArg,
  stringArg,
  taskId,
  type GetWindow,
} from "./common";
import { ensureBrowserCollectionFolder } from "./collector-server";
import {
  ensureThumbnailForFile,
  importBytes,
  importFilePath,
  postImport,
  shouldGenerateFileThumbnail,
  startImportTask,
} from "./import-service";
import { scanFoldersOnly, scanIndexPath } from "./library-sync-service";
import {
  appDocumentsDir,
  copyOneFile,
  deleteFileCommand,
  ensureDeletedFolderHoldingDir,
  getFilesUnderFolderPath,
  getFoldersUnderFolderPath,
  moveDirectoryWithFallback,
  moveOneFile,
  permanentDeleteOneFile,
  permanentlyDeleteTrashedFolder,
  restoreOneFile,
  restoreTrashedFolder,
} from "./trash-file-service";
import {
  analyzeFileMetadata,
  extractResponseText,
  getVisualStatus,
  loadAiConfig,
  loadVisualModelValidation,
  loadVisualSearchConfig,
  postAiJson,
  runVisualIndexJob,
  startAiMetadataTask,
  startVisualIndexTask,
} from "./visual-ai-service";

function getDragIcon() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "assets", "app-icon.png")]
    : [
        path.join(process.cwd(), "assets", "app-icon.png"),
        path.join(process.cwd(), "src", "assets", "app-icon.png"),
      ];

  const iconPath = candidates.find((candidate) => fssync.existsSync(candidate));
  const fallbackIconPath = path.join(process.cwd(), "assets", "image.png");
  const sourceIconPath = iconPath ?? fallbackIconPath;
  const dragIcon = nativeImage.createFromPath(sourceIconPath);

  if (!dragIcon.isEmpty()) {
    return dragIcon.resize({
      width: 48,
      height: 48,
      quality: "best",
    });
  }

  return sourceIconPath;
}

function normalizeFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("文件夹名称不能为空");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("文件夹名称不合法");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("文件夹名称不能包含斜杠");
  }
  return trimmed;
}

export function createCommandRegistry(
  state: AppState,
  getWindow: GetWindow,
): Record<string, CommandHandler> {
  const commands: Record<string, CommandHandler> = {
    get_all_files: (args) => getAllFiles(state.db, args),
    search_files: (args) => searchFiles(state.db, args),
    get_files_in_folder: (args) => getFilesInFolder(state.db, args),
    get_file: (args) => {
      const file = getFileById(state.db, numberArg(args, "fileId", "file_id"));
      if (!file) throw new Error("File not found");
      return file;
    },
    filter_files: async (args) => {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      const naturalLanguageQuery = String(filter.natural_language_query ?? "").trim();
      if (!naturalLanguageQuery) {
        return filterFiles(state.db, args);
      }

      const config = loadVisualSearchConfig(state);
      if (!config.enabled) {
        throw new Error("请先在设置中启用本地自然语言搜索。");
      }

      const validation = await loadVisualModelValidation(state, config);
      if (!validation.valid || !validation.modelId) {
        throw new Error(validation.message);
      }

      const embedding = await encodeVisualSearchText(config, validation, naturalLanguageQuery);
      return searchFilesByVisualEmbedding(state.db, args, validation.modelId, embedding);
    },
    update_file_metadata: (args) =>
      updateFileMetadata(
        state.db,
        numberArg(args, "fileId", "file_id"),
        numberArg(args, "rating"),
        stringArg(args, "description"),
        stringArg(args, "sourceUrl", "source_url"),
      ),
    update_file_dimensions: (args) =>
      updateFileDimensions(
        state.db,
        numberArg(args, "fileId", "file_id"),
        numberArg(args, "width"),
        numberArg(args, "height"),
      ),
    get_or_create_thumb_hash: async (args) => {
      const filePath = stringArg(args, "filePath", "file_path");
      const file = getFileByPath(state.db, filePath);
      if (file?.thumbHash) {
        return file.thumbHash;
      }

      const ext = file?.ext ?? path.extname(filePath).slice(1);
      const thumbHash = await buildThumbHash(filePath, ext);
      if (file && thumbHash) {
        updateFileThumbHash(state.db, file.id, thumbHash);
      }
      return thumbHash;
    },
    extract_color: async (args) => {
      const fileId = numberArg(args, "fileId", "file_id");
      const file = getFileById(state.db, fileId);
      if (!file) throw new Error("File not found");
      const colors = await extractColorDistributionFromInput(file.path);
      updateFileColorData(state.db, fileId, colors[0]?.color ?? "", JSON.stringify(colors));
      return colors[0]?.color ?? "";
    },
    export_file: async (args) => {
      const file = getFileById(state.db, numberArg(args, "fileId", "file_id"));
      if (!file) throw new Error("File not found");
      const exportDir = path.join(appDocumentsDir(), "shiguang_exports");
      await fs.mkdir(exportDir, { recursive: true });
      await fs.writeFile(
        path.join(exportDir, `${path.basename(file.name, path.extname(file.name))}_metadata.json`),
        JSON.stringify(file, null, 2),
      );
      if (fssync.existsSync(file.path))
        await fs.copyFile(file.path, path.join(exportDir, file.name));
      return exportDir;
    },
    update_file_name: async (args) => {
      const fileId = numberArg(args, "fileId", "file_id");
      const file = getFileById(state.db, fileId);
      if (!file) throw new Error("File not found");
      const newName = stringArg(args, "newName", "new_name");
      const newPath = path.join(path.dirname(file.path), newName);
      if (fssync.existsSync(file.path)) await moveFileWithFallback(file.path, newPath);
      updateFileNameRecord(state.db, fileId, newName, newPath);
    },
    analyze_file_metadata: async (args, window) => {
      const file = await analyzeFileMetadata(
        state,
        numberArg(args, "fileId", "file_id"),
        typeof args.imageDataUrl === "string" ? args.imageDataUrl : undefined,
      );
      emit(window, "file-updated", { fileId: file.id });
      return file;
    },
    start_ai_metadata_task: (args, window) =>
      startAiMetadataTask(state, window, numberArrayArg(args, "fileIds", "file_ids")),
    get_ai_metadata_task: (args) => {
      const task = state.aiMetadataTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("AI metadata task not found");
      return task.snapshot;
    },
    cancel_ai_metadata_task: (args) => {
      const task = state.aiMetadataTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("AI metadata task not found");
      task.cancelled = true;
    },
    rebuild_visual_index: async () => {
      const result = await runVisualIndexJob(state, null, null, false);
      return {
        total: result.total,
        indexed: result.indexed,
        failed: result.failed,
        skipped: result.skipped,
      };
    },
    start_visual_index_task: (args, window) =>
      startVisualIndexTask(
        state,
        window,
        Boolean(args.processUnindexedOnly ?? args.process_unindexed_only),
      ),
    get_visual_index_task: (args) => {
      const task = state.visualIndexTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Visual index task not found");
      return task.snapshot;
    },
    cancel_visual_index_task: (args) => {
      const task = state.visualIndexTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Visual index task not found");
      task.cancelled = true;
    },
    get_visual_index_status: async () => getVisualStatus(state),
    complete_visual_index_browser_decode_request: () => undefined,
    validate_visual_model_path: async (args) =>
      validateVisualModelPath(stringArg(args, "modelPath", "model_path")),
    get_recommended_visual_model_path: async () => getRecommendedVisualModelPath(),
    test_ai_endpoint: async () => {
      const config = loadAiConfig(state);
      const payload = await postAiJson(config, {
        model: config.model,
        messages: [
          { role: "system", content: "你是一个接口连通性测试助手。" },
          { role: "user", content: "只回复 ok" },
        ],
        enable_thinking: false,
        stream: false,
        temperature: 0,
        max_tokens: 16,
      });
      return `图片元数据分析接口可用，响应示例: ${(extractResponseText(payload) ?? "").slice(0, 48)}`;
    },
    import_file: async (args, window) => {
      const file = await importFilePath(
        state,
        stringArg(args, "sourcePath", "source_path"),
        optionalNumberArg(args, "folderId", "folder_id"),
      );
      postImport(state, window, file);
      return file;
    },
    import_image_from_base64: async (args, window) => {
      const file = await importBytes(state, {
        bytes: Buffer.from(stringArg(args, "base64Data", "base64_data"), "base64"),
        folderId: optionalNumberArg(args, "folderId", "folder_id"),
        fallbackExt: stringArg(args, "ext"),
        namePrefix: "paste",
      });
      postImport(state, window, file);
      return file;
    },
    start_import_task: (args, window) =>
      startImportTask(
        state,
        window,
        (Array.isArray(args.items) ? args.items : []) as ImportTaskItem[],
        optionalNumberArg(args, "folderId", "folder_id"),
      ),
    get_import_task: (args) => {
      const task = state.importTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Import task not found");
      return task.snapshot;
    },
    cancel_import_task: (args) => {
      const task = state.importTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Import task not found");
      task.cancelled = true;
    },
    retry_import_task: (args, window) => {
      const task = state.importTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Import task not found");
      const failed = task.snapshot.results
        .filter((result) => result.status === "failed")
        .map((result) => task.items[result.index])
        .filter(Boolean);
      if (!failed.length) throw new Error("No failed import items to retry");
      return startImportTask(state, window, failed, task.folderId);
    },
    get_setting: (args) => {
      return getSetting(state.db, stringArg(args, "key"));
    },
    set_setting: (args) => setSetting(state.db, stringArg(args, "key"), stringArg(args, "value")),
    get_index_paths: () => getIndexPaths(state.db),
    get_recent_index_paths: async () => readRecentIndexPaths(state.appDataDir),
    get_default_index_path: async () => {
      const indexPath = getDefaultIndexPath();
      await fs.mkdir(indexPath, { recursive: true });
      await ensureStorageDirs(indexPath);
      return indexPath;
    },
    add_index_path: async (args) => {
      const indexPath = stringArg(args, "path");
      await fs.mkdir(indexPath, { recursive: true });
      await ensureStorageDirs(indexPath);
      addIndexPath(state.db, indexPath);
    },
    switch_index_path_and_restart: async (args) => {
      const indexPath = stringArg(args, "path");
      await fs.mkdir(indexPath, { recursive: true });
      await ensureStorageDirs(indexPath);
      await rememberRecentIndexPaths(state.appDataDir, [indexPath, state.indexPath]);
      await persistIndexPath(state.appDataDir, indexPath);
      const { app } = await import("electron");
      app.relaunch();
      app.quit();
    },
    sync_index_path: (args, window) => scanIndexPath(state, stringArg(args, "path"), window),
    rebuild_library_index: async (_args, window) => {
      let total = 0;
      for (const indexPath of getIndexPaths(state.db))
        total += await scanIndexPath(state, indexPath, window);
      return total;
    },
    reindex_all: async (_args, window) => {
      let total = 0;
      for (const indexPath of getIndexPaths(state.db))
        total += await scanIndexPath(state, indexPath, window);
      return total;
    },
    get_thumbnail_path: async (args) => {
      const filePath = stringArg(args, "filePath", "file_path");
      const file = getFileByPath(state.db, filePath);
      if (!file) {
        return null;
      }
      return ensureThumbnailForFile(state, getWindow(), file.id, {
        allowBackgroundRequest: true,
      });
    },
    get_thumbnail_data_base64: async (args) => {
      const thumbnail = await commands.get_thumbnail_path(args, getWindow());
      return typeof thumbnail === "string"
        ? (await fs.readFile(thumbnail)).toString("base64")
        : null;
    },
    get_thumbnail_cache_path: (args) => {
      const filePath = stringArg(args, "filePath", "file_path");
      const file = getFileByPath(state.db, filePath);
      return getThumbnailCachePath(getIndexPaths(state.db), filePath, file?.contentHash);
    },
    get_smart_collection_stats: () => getSmartCollectionStats(state.db),
    touch_file_last_accessed: (args) =>
      touchFileLastAccessed(state.db, numberArg(args, "fileId", "file_id")),
    save_thumbnail_cache: async (args) => {
      const filePath = stringArg(args, "filePath", "file_path");
      const file = getFileByPath(state.db, filePath);
      if (!file) {
        return null;
      }
      if (!shouldGenerateFileThumbnail(file)) {
        return null;
      }
      const cachePath = getThumbnailCachePath(getIndexPaths(state.db), filePath, file.contentHash);
      if (!cachePath) return null;
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(
        cachePath,
        Buffer.from(stringArg(args, "dataBase64", "data_base64"), "base64"),
      );
      emit(getWindow(), "file-updated", { fileId: file.id });
      return cachePath;
    },
    remove_index_path: (args) => removeIndexPath(state.db, stringArg(args, "path")),
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
      for (const indexPath of getIndexPaths(state.db))
        total += await scanFoldersOnly(state, indexPath);
      return total;
    },
    init_browser_collection_folder: () => ensureBrowserCollectionFolder(state),
    get_browser_collection_folder: () =>
      getAllFolders(state.db).find(
        (folder) => folder.isSystem && folder.name === BROWSER_COLLECTION_FOLDER_NAME,
      ) ?? null,
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
    delete_file: async (args) => deleteFileCommand(state, numberArg(args, "fileId", "file_id")),
    delete_files: async (args) => {
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids"))
        await deleteFileCommand(state, fileId);
    },
    get_trash_files: () => getTrashFiles(state.db),
    get_trash_items: () => getTrashItems(state.db),
    restore_file: async (args) => {
      const result = await restoreOneFile(state, numberArg(args, "fileId", "file_id"));
      return { movedToUnclassifiedCount: result.movedToUnclassified ? 1 : 0 };
    },
    restore_files: async (args) => {
      let movedToUnclassifiedCount = 0;
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids"))
        movedToUnclassifiedCount += (await restoreOneFile(state, fileId)).movedToUnclassified
          ? 1
          : 0;
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
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids"))
        await permanentDeleteOneFile(state, fileId);
    },
    permanent_delete_folder: (args) =>
      permanentlyDeleteTrashedFolder(state, numberArg(args, "folderId", "folder_id")),
    permanent_delete_folders: async (args) => {
      for (const folderId of numberArrayArg(args, "folderIds", "folder_ids"))
        await permanentlyDeleteTrashedFolder(state, folderId);
    },
    empty_trash: async () => {
      for (const folder of getTrashFolders(state.db))
        await permanentlyDeleteTrashedFolder(state, folder.id);
      for (const file of getTrashFiles(state.db)) await permanentDeleteOneFile(state, file.id);
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
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids"))
        await copyOneFile(
          state,
          window,
          fileId,
          optionalNumberArg(args, "targetFolderId", "target_folder_id"),
        );
    },
    move_file: (args) =>
      moveOneFile(
        state,
        numberArg(args, "fileId", "file_id"),
        optionalNumberArg(args, "targetFolderId", "target_folder_id"),
      ),
    move_files: async (args) => {
      for (const fileId of new Set(numberArrayArg(args, "fileIds", "file_ids")))
        await moveOneFile(
          state,
          fileId,
          optionalNumberArg(args, "targetFolderId", "target_folder_id"),
        );
    },
    copy_files_to_clipboard: (args) => {
      const files = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId))
        .filter((item): item is FileRecord => Boolean(item));
      const paths = files.map((file) => file.path);
      if (files.length === 1) {
        const image = nativeImage.createFromPath(files[0].path);
        if (!image.isEmpty()) {
          clipboard.write({
            image,
            text: files[0].path,
          });
          clipboard.writeBuffer(
            SHIGUANG_CLIPBOARD_FORMAT,
            serializeClipboardImportedImageItems(files),
          );
          return;
        }
      }
      clipboard.writeText(paths.join("\n"));
      if (files.length > 0) {
        clipboard.writeBuffer(
          SHIGUANG_CLIPBOARD_FORMAT,
          serializeClipboardImportedImageItems(files),
        );
      }
    },
    start_drag_files: (args, window) => {
      const paths = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId)?.path)
        .filter((item): item is string => Boolean(item));
      if (!paths.length || !window) throw new Error("No files selected");
      window.webContents.startDrag({
        file: paths[0],
        icon: getDragIcon(),
      });
    },
    open_file: async (args) => {
      const fileId = numberArg(args, "fileId", "file_id");
      const file = getFileById(state.db, fileId);
      if (!file) throw new Error("File not found");
      touchFileLastAccessed(state.db, fileId);
      const result = await shell.openPath(file.path);
      if (result) throw new Error(result);
    },
    show_in_explorer: (args) => {
      const file = getFileById(state.db, numberArg(args, "fileId", "file_id"));
      if (!file) throw new Error("File not found");
      shell.showItemInFolder(file.path);
    },
    show_folder_in_explorer: async (args) => {
      const folder = getFolderById(state.db, numberArg(args, "folderId", "folder_id"));
      if (!folder) throw new Error("Folder not found");
      const result = await shell.openPath(folder.path);
      if (result) throw new Error(result);
    },
    show_current_library_in_explorer: async () => {
      const result = await shell.openPath(state.indexPath);
      if (result) throw new Error(result);
    },
  };

  return commands;
}
