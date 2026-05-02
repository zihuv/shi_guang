import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";
import { getFolderById, getOrCreateFolder, getIndexPaths } from "../database";
import type { AppState, FileRecord, ImportTaskItem, ImportTaskSnapshot } from "../types";
import { emit, taskId } from "./common";
import {
  collectFilesFromDirectoryWithRel,
  importBytes,
  importClipboardFile,
  importFilePath,
} from "./import-core";
import { runPostImportPipeline } from "./post-import-pipeline";

export {
  buildFileInputFromPath,
  collectFilesFromDirectory,
  collectFilesFromDirectoryWithRel,
  getTargetDir,
  importBytes,
  importClipboardFile,
  importExistingFilePath,
  importFilePath,
  normalizeImportExtension,
  timestampFromStats,
} from "./import-core";
export {
  ensureThumbnailForFile,
  runPostImportPipeline,
  shouldGenerateFileThumbnail,
  type PostImportContext,
  type PostImportSource,
} from "./post-import-pipeline";

const FILE_PATH_IMPORT_CONCURRENCY = 5;

function importTaskSource(item: ImportTaskItem): string {
  if (item.kind === "base64_image") {
    return `clipboard.${item.ext ?? "png"}`;
  }
  if (item.kind === "binary_image") {
    return `clipboard.${item.ext ?? "png"}`;
  }
  if (item.kind === "clipboard_file") {
    return String(item.sourcePath ?? item.path ?? "");
  }
  return String(item.path ?? "");
}

function isFilePathImportItem(item: ImportTaskItem): boolean {
  return !item.kind || item.kind === "file_path";
}

async function importTaskItem(
  state: AppState,
  item: ImportTaskItem,
  fallbackFolderId: number | null,
): Promise<FileRecord> {
  const folderId = item.folderId ?? fallbackFolderId;
  if (item.kind === "base64_image") {
    return importBytes(state, {
      bytes: Buffer.from(String(item.base64Data ?? item.base64_data ?? ""), "base64"),
      folderId,
      fallbackExt: item.ext,
      namePrefix: "paste",
    });
  }

  if (item.kind === "binary_image") {
    return importBytes(state, {
      bytes: Buffer.from(item.bytes ?? []),
      folderId,
      fallbackExt: item.ext,
      namePrefix: "paste",
      rating: typeof item.rating === "number" ? item.rating : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      sourceUrl:
        typeof item.sourceUrl === "string"
          ? item.sourceUrl
          : typeof item.source_url === "string"
            ? item.source_url
            : undefined,
      tagIds: Array.isArray(item.tagIds)
        ? item.tagIds.filter((tagId): tagId is number => Number.isInteger(tagId))
        : Array.isArray(item.tag_ids)
          ? item.tag_ids.filter((tagId): tagId is number => Number.isInteger(tagId))
          : undefined,
    });
  }

  if (item.kind === "clipboard_file") {
    return importClipboardFile(state, {
      sourcePath: String(item.sourcePath ?? item.path ?? ""),
      folderId,
      ext: item.ext,
      rating: typeof item.rating === "number" ? item.rating : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      sourceUrl:
        typeof item.sourceUrl === "string"
          ? item.sourceUrl
          : typeof item.source_url === "string"
            ? item.source_url
            : undefined,
      tagIds: Array.isArray(item.tagIds)
        ? item.tagIds.filter((tagId): tagId is number => Number.isInteger(tagId))
        : Array.isArray(item.tag_ids)
          ? item.tag_ids.filter((tagId): tagId is number => Number.isInteger(tagId))
          : undefined,
    });
  }

  return importFilePath(state, String(item.path ?? ""), folderId);
}

async function runImportTask(
  state: AppState,
  window: BrowserWindow | null,
  id: string,
): Promise<void> {
  const entry = state.importTasks.get(id);
  if (!entry) return;
  entry.snapshot.status = "running";
  emit(window, "import-task-updated", id);

  const recordResult = (
    index: number,
    item: ImportTaskItem,
    file: FileRecord | null,
    error?: unknown,
  ) => {
    const source = importTaskSource(item);
    if (file) {
      entry.snapshot.successCount += 1;
      entry.snapshot.results.push({ index, status: "completed", source, error: null, file });
      runPostImportPipeline(state, window, file, { source: "import_task" });
    } else {
      entry.snapshot.failureCount += 1;
      entry.snapshot.results.push({
        index,
        status: "failed",
        source,
        error: error instanceof Error ? error.message : String(error),
        file: null,
      });
    }

    entry.snapshot.processed += 1;
    entry.snapshot.status =
      entry.snapshot.processed === entry.snapshot.total
        ? entry.snapshot.failureCount > 0
          ? "completed_with_errors"
          : "completed"
        : "running";
    emit(window, "import-task-updated", id);
  };

  const processOne = async (index: number, item: ImportTaskItem): Promise<void> => {
    if (entry.cancelled) {
      entry.snapshot.status = "cancelled";
      emit(window, "import-task-updated", id);
      return;
    }

    try {
      recordResult(index, item, await importTaskItem(state, item, entry.folderId));
    } catch (error) {
      recordResult(index, item, null, error);
    }
  };

  if (entry.items.length > 1 && entry.items.every(isFilePathImportItem)) {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(FILE_PATH_IMPORT_CONCURRENCY, entry.items.length) },
      async () => {
        while (!entry.cancelled) {
          const index = nextIndex;
          nextIndex += 1;
          const item = entry.items[index];
          if (!item) {
            return;
          }
          await processOne(index, item);
        }
      },
    );
    await Promise.all(workers);
  } else {
    for (const [index, item] of entry.items.entries()) {
      await processOne(index, item);
      if (entry.cancelled) {
        return;
      }
    }
  }

  if (entry.cancelled && entry.snapshot.processed < entry.snapshot.total) {
    entry.snapshot.status = "cancelled";
    emit(window, "import-task-updated", id);
  }
}

export async function startImportTask(
  state: AppState,
  window: BrowserWindow | null,
  items: ImportTaskItem[],
  folderId: number | null,
): Promise<ImportTaskSnapshot> {
  const indexPath = getIndexPaths(state.db)[0] ?? state.indexPath;
  const parentPath =
    folderId !== null ? (getFolderById(state.db, folderId)?.path ?? indexPath) : indexPath;
  const expanded: ImportTaskItem[] = [];
  for (const item of items) {
    if (item.kind === "file_path" || !item.kind) {
      const p = String(item.path ?? "");
      if (p) {
        try {
          const stats = await fs.stat(p);
          if (stats.isDirectory()) {
            const dirName = path.basename(p);
            const destDir = path.join(parentPath, dirName);
            const files = await collectFilesFromDirectoryWithRel(p);
            for (const f of files) {
              const targetFolderId =
                f.relDir === "."
                  ? getOrCreateFolder(state.db, destDir, [indexPath])
                  : getOrCreateFolder(state.db, path.join(destDir, f.relDir), [indexPath]);
              expanded.push({
                kind: "file_path",
                path: f.abs,
                folderId: targetFolderId ?? folderId,
              });
            }
            continue;
          }
        } catch {
          // stat failed, pass through as-is
        }
      }
    }
    expanded.push(item);
  }

  const id = `import-${taskId()}`;
  const snapshot: ImportTaskSnapshot = {
    id,
    status: "queued",
    total: expanded.length,
    processed: 0,
    successCount: 0,
    failureCount: 0,
    results: [],
  };
  state.importTasks.set(id, { snapshot, items: expanded, folderId, cancelled: false });
  void runImportTask(state, window, id);
  return snapshot;
}
