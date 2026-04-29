import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {
  filterFiles,
  getAllFiles,
  getFileById,
  getFileByPath,
  getFileVisualEmbeddingQuery,
  getFilesInFolder,
  getIndexPaths,
  getSmartCollectionStats,
  searchFiles,
  searchFilesByVisualEmbedding,
  touchFileLastAccessed,
  updateFileColorData,
  updateFileDimensions,
  updateFileMetadata,
  updateFileNameRecord,
  updateFileThumbHash,
} from "../database";
import { copyFileWithCloneFallback, ensureDir, moveFileWithFallback } from "../file-operations";
import { buildThumbHash, extractColorDistributionFromInput } from "../media";
import { getThumbnailCachePath } from "../storage";
import type { AppState, ImportTaskItem } from "../types";
import {
  type CommandHandler,
  emit,
  numberArg,
  optionalNumberArg,
  stringArg,
  type GetWindow,
} from "./common";
import {
  ensureThumbnailForFile,
  shouldGenerateFileThumbnail,
  startImportTask,
} from "./import-service";
import { appDocumentsDir } from "./trash-file-service";
import { loadVisualModelValidation, loadVisualSearchConfig } from "./visual-ai-service";
import { encodeVisualSearchTextInUtility } from "../visual-search/visual-index-utility-service.js";

function searchFilesByNameFallback(state: AppState, args: Record<string, unknown>, query: string) {
  const filter = (args.filter ?? {}) as Record<string, unknown>;
  return filterFiles(state.db, {
    ...args,
    filter: {
      ...filter,
      query: filter.query || query,
      natural_language_query: null,
    },
  });
}

export function createFileCommands(
  state: AppState,
  getWindow: GetWindow,
): Record<string, CommandHandler> {
  const getThumbnailPath = async (args: Record<string, unknown>) => {
    const filePath = stringArg(args, "filePath", "file_path");
    const file = getFileByPath(state.db, filePath);
    if (!file) {
      return null;
    }
    const allowBackgroundRequest = args.allowBackgroundRequest ?? args.allow_background_request;
    return ensureThumbnailForFile(state, getWindow(), file.id, {
      allowBackgroundRequest: allowBackgroundRequest !== false,
    });
  };

  return {
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
      const imageQueryFileId = Number(filter.image_query_file_id ?? filter.imageQueryFileId);
      if (Number.isInteger(imageQueryFileId) && imageQueryFileId > 0) {
        const config = loadVisualSearchConfig(state);
        if (!config.enabled) {
          throw new Error("请先在设置中启用本地自然语言搜索。");
        }

        const validation = await loadVisualModelValidation(state, config);
        if (!validation.valid || !validation.modelId) {
          throw new Error(validation.message);
        }

        const query = getFileVisualEmbeddingQuery(state.db, imageQueryFileId, validation.modelId);
        if (!query) {
          throw new Error("这张图片还没有当前模型的视觉索引，请先在设置中建立或更新视觉索引。");
        }

        return searchFilesByVisualEmbedding(state.db, args, validation.modelId, query.embedding, {
          excludeFileId: query.fileId,
        });
      }

      const naturalLanguageQuery = String(filter.natural_language_query ?? "").trim();
      if (!naturalLanguageQuery) {
        return filterFiles(state.db, args);
      }

      const config = loadVisualSearchConfig(state);
      if (!config.modelPath.trim()) {
        return searchFilesByNameFallback(state, args, naturalLanguageQuery);
      }

      if (!config.enabled) {
        throw new Error("请先在设置中启用本地自然语言搜索。");
      }

      const validation = await loadVisualModelValidation(state, config);
      if (!validation.valid || !validation.modelId) {
        throw new Error(validation.message);
      }

      const embedding = await encodeVisualSearchTextInUtility(
        config,
        validation,
        naturalLanguageQuery,
      );
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
      await ensureDir(exportDir);
      await fs.writeFile(
        path.join(exportDir, `${path.basename(file.name, path.extname(file.name))}_metadata.json`),
        JSON.stringify(file, null, 2),
      );
      if (fssync.existsSync(file.path))
        await copyFileWithCloneFallback(file.path, path.join(exportDir, file.name));
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
    get_thumbnail_path: getThumbnailPath,
    get_thumbnail_data_base64: async (args) => {
      const thumbnail = await getThumbnailPath(args);
      return typeof thumbnail === "string"
        ? (await fs.readFile(thumbnail)).toString("base64")
        : null;
    },
    get_thumbnail_cache_path: (args) => {
      const filePath = stringArg(args, "filePath", "file_path");
      const file = getFileByPath(state.db, filePath);
      return getThumbnailCachePath(
        getIndexPaths(state.db),
        filePath,
        file
          ? {
              contentHash: file.contentHash,
              size: file.size,
              modifiedAt: file.modifiedAt,
            }
          : null,
      );
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
      const cachePath = getThumbnailCachePath(getIndexPaths(state.db), filePath, {
        contentHash: file.contentHash,
        size: file.size,
        modifiedAt: file.modifiedAt,
      });
      if (!cachePath) return null;
      await ensureDir(path.dirname(cachePath));
      await fs.writeFile(
        cachePath,
        Buffer.from(stringArg(args, "dataBase64", "data_base64"), "base64"),
      );
      emit(getWindow(), "file-updated", { fileId: file.id });
      return cachePath;
    },
  };
}
