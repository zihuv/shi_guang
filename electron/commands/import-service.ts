import { BrowserWindow } from "electron";
import log from "electron-log/main";
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import {
  addTagToFile,
  currentTimestamp,
  getFileById,
  getFolderById,
  getIndexPaths,
  upsertFile,
  type UpsertFileInput,
} from "../database";
import {
  buildThumbHash,
  computeVisualContentHash,
  detectExtensionFromBytes,
  detectExtensionFromPath,
  extractColorDistributionFromInput,
  getImageDimensions,
} from "../media";
import { hasThumbnailCachePath, getOrCreateThumbnail } from "../storage";
import { decideThumbnailGeneration, isVideoThumbnailExt } from "../thumbnail";
import type { AppState, FileRecord, ImportTaskItem, ImportTaskSnapshot } from "../types";
import { emit, taskId } from "./common";
import { maybeAutoIndexImportedFile } from "./visual-ai-service";

const recentImports = new Map<string, number>();
let autoThumbnailQueue = Promise.resolve();

export function timestampFromStats(stats: Stats, key: "birthtime" | "mtime"): string {
  const value = key === "birthtime" ? stats.birthtime : stats.mtime;
  return currentTimestamp(Number.isFinite(value.getTime()) ? value : new Date());
}

export function normalizeImportExtension(ext: string | null | undefined): string {
  const normalized = ext?.trim().replace(/^\./, "").toLowerCase();
  return normalized || "bin";
}

export function shouldGenerateFileThumbnail(
  file: Pick<FileRecord, "ext" | "width" | "height" | "size">,
) {
  return decideThumbnailGeneration({
    ext: file.ext,
    width: file.width,
    height: file.height,
    size: file.size,
  }).shouldGenerate;
}

export async function ensureThumbnailForFile(
  state: AppState,
  window: BrowserWindow | null,
  fileId: number,
  options: {
    allowBackgroundRequest?: boolean;
  } = {},
): Promise<string | null> {
  const file = getFileById(state.db, fileId);
  if (!file) {
    return null;
  }

  if (!shouldGenerateFileThumbnail(file)) {
    return null;
  }

  const existingThumbnailPath = hasThumbnailCachePath(
    getIndexPaths(state.db),
    file.path,
    file.contentHash,
  );
  if (existingThumbnailPath) {
    return existingThumbnailPath;
  }

  if (isVideoThumbnailExt(file.ext)) {
    if (options.allowBackgroundRequest !== false && window) {
      emit(window, "thumbnail-build-request", {
        fileId: file.id,
        path: file.path,
        ext: file.ext,
      });
    }
    return null;
  }

  const thumbnailPath = await getOrCreateThumbnail(getIndexPaths(state.db), {
    filePath: file.path,
    ext: file.ext,
    contentHash: file.contentHash,
  });

  if (thumbnailPath) {
    emit(window, "file-updated", { fileId: file.id });
    return thumbnailPath;
  }

  return null;
}

export function scheduleThumbnailGeneration(
  state: AppState,
  window: BrowserWindow | null,
  fileId: number,
): void {
  autoThumbnailQueue = autoThumbnailQueue
    .then(async () => {
      await ensureThumbnailForFile(state, window, fileId);
    })
    .catch((error) => {
      log.warn("[thumbnail] background generation failed", {
        fileId,
        error,
      });
    });
}

function generatedImportName(prefix: string | null, ext: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const id = taskId();
  return prefix ? `${prefix}_${stamp}_${id}.${ext}` : `${stamp}_${id}.${ext}`;
}

export function normalizeFolderName(name: string): string {
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

export function getTargetDir(state: AppState, folderId: number | null): string {
  if (folderId !== null) {
    const folder = getFolderById(state.db, folderId);
    if (folder) {
      return folder.path;
    }
  }
  const indexPath = getIndexPaths(state.db)[0] ?? state.indexPath;
  return indexPath;
}

export async function buildFileInputFromPath(
  filePath: string,
  folderId: number | null,
  knownBytes?: Buffer,
): Promise<UpsertFileInput> {
  const stats = await fs.stat(filePath);
  const ext = normalizeImportExtension(
    knownBytes ? detectExtensionFromBytes(knownBytes) : await detectExtensionFromPath(filePath),
  );
  const dimensions = await getImageDimensions(filePath, ext);
  const colors = await extractColorDistributionFromInput(filePath);
  const dominantColor = colors[0]?.color ?? "";
  const contentHash = await computeVisualContentHash(filePath);
  const thumbHash = await buildThumbHash(filePath, ext);
  return {
    path: filePath,
    name: path.basename(filePath),
    ext,
    size: stats.size,
    width: dimensions.width,
    height: dimensions.height,
    folderId,
    createdAt: timestampFromStats(stats, "birthtime"),
    modifiedAt: timestampFromStats(stats, "mtime"),
    dominantColor,
    colorDistribution: JSON.stringify(colors),
    thumbHash,
    contentHash,
  };
}

export async function importBytes(
  state: AppState,
  request: {
    bytes: Buffer;
    folderId: number | null;
    fallbackExt?: string | null;
    targetPath?: string | null;
    namePrefix?: string | null;
    createdAt?: string;
    modifiedAt?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const detectedExt = detectExtensionFromBytes(request.bytes);
  const storageExt = normalizeImportExtension(detectedExt ?? request.fallbackExt);
  const recordExt = normalizeImportExtension(detectedExt);
  const targetPath =
    request.targetPath ??
    path.join(
      getTargetDir(state, request.folderId),
      generatedImportName(request.namePrefix ?? null, storageExt),
    );

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, request.bytes);
  const stats = await fs.stat(targetPath);
  const dimensions = await getImageDimensions(targetPath, recordExt);
  const colors = await extractColorDistributionFromInput(targetPath);
  const thumbHash = await buildThumbHash(targetPath, recordExt);
  const fileId = upsertFile(state.db, {
    path: targetPath,
    name: path.basename(targetPath),
    ext: recordExt,
    size: stats.size,
    width: dimensions.width,
    height: dimensions.height,
    folderId: request.folderId,
    createdAt: request.createdAt ?? currentTimestamp(),
    modifiedAt: request.modifiedAt ?? currentTimestamp(),
    rating: request.rating ?? 0,
    description: request.description ?? "",
    sourceUrl: request.sourceUrl ?? "",
    dominantColor: colors[0]?.color ?? "",
    colorDistribution: JSON.stringify(colors),
    thumbHash,
    contentHash: await computeVisualContentHash(targetPath),
  });
  for (const tagId of new Set(request.tagIds ?? [])) {
    addTagToFile(state.db, fileId, tagId);
  }
  return getFileById(state.db, fileId) as FileRecord;
}

export async function importFilePath(
  state: AppState,
  sourcePath: string,
  folderId: number | null,
): Promise<FileRecord> {
  const now = Date.now();
  const recent = recentImports.get(sourcePath);
  if (recent && now - recent < 3000) {
    throw new Error("Duplicate import skipped");
  }
  recentImports.set(sourcePath, now);

  const stats = await fs.stat(sourcePath);
  if (!stats.isFile()) {
    throw new Error("Source file does not exist");
  }
  return importBytes(state, {
    bytes: await fs.readFile(sourcePath),
    folderId,
    fallbackExt: path.extname(sourcePath),
    createdAt: timestampFromStats(stats, "birthtime"),
    modifiedAt: timestampFromStats(stats, "mtime"),
  });
}

export async function importClipboardFile(
  state: AppState,
  request: {
    sourcePath: string;
    folderId: number | null;
    ext?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const stats = await fs.stat(request.sourcePath);
  if (!stats.isFile()) {
    throw new Error("Clipboard source file does not exist");
  }

  return importBytes(state, {
    bytes: await fs.readFile(request.sourcePath),
    folderId: request.folderId,
    fallbackExt: request.ext ?? path.extname(request.sourcePath),
    createdAt: timestampFromStats(stats, "birthtime"),
    modifiedAt: timestampFromStats(stats, "mtime"),
    rating: request.rating,
    description: request.description,
    sourceUrl: request.sourceUrl,
    tagIds: request.tagIds,
  });
}

export function postImport(state: AppState, window: BrowserWindow | null, file: FileRecord): void {
  emit(window, "file-imported", { file_id: file.id, path: file.path });
  emit(window, "file-updated", { fileId: file.id });
  scheduleThumbnailGeneration(state, window, file.id);
  void maybeAutoIndexImportedFile(state, file, window);
}

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

async function runImportTask(
  state: AppState,
  window: BrowserWindow | null,
  id: string,
): Promise<void> {
  const entry = state.importTasks.get(id);
  if (!entry) return;
  entry.snapshot.status = "running";
  emit(window, "import-task-updated", id);

  for (const [index, item] of entry.items.entries()) {
    if (entry.cancelled) {
      entry.snapshot.status = "cancelled";
      emit(window, "import-task-updated", id);
      return;
    }

    const source = importTaskSource(item);
    try {
      const file =
        item.kind === "base64_image"
          ? await importBytes(state, {
              bytes: Buffer.from(String(item.base64Data ?? item.base64_data ?? ""), "base64"),
              folderId: entry.folderId,
              fallbackExt: item.ext,
              namePrefix: "paste",
            })
          : item.kind === "binary_image"
            ? await importBytes(state, {
                bytes: Buffer.from(item.bytes ?? []),
                folderId: entry.folderId,
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
              })
            : item.kind === "clipboard_file"
              ? await importClipboardFile(state, {
                  sourcePath: String(item.sourcePath ?? item.path ?? ""),
                  folderId: entry.folderId,
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
                })
              : await importFilePath(state, String(item.path ?? ""), entry.folderId);
      entry.snapshot.successCount += 1;
      entry.snapshot.results.push({ index, status: "completed", source, error: null, file });
      postImport(state, window, file);
    } catch (error) {
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
  }
}

export function startImportTask(
  state: AppState,
  window: BrowserWindow | null,
  items: ImportTaskItem[],
  folderId: number | null,
): ImportTaskSnapshot {
  const id = `import-${taskId()}`;
  const snapshot: ImportTaskSnapshot = {
    id,
    status: "queued",
    total: items.length,
    processed: 0,
    successCount: 0,
    failureCount: 0,
    results: [],
  };
  state.importTasks.set(id, { snapshot, items, folderId, cancelled: false });
  void runImportTask(state, window, id);
  return snapshot;
}
