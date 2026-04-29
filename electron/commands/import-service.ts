import { BrowserWindow } from "electron";
import log from "electron-log/main";
import fs from "node:fs/promises";
import fssync from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import {
  addTagToFile,
  currentTimestamp,
  getFileById,
  getFileByPath,
  getFolderById,
  getIndexPaths,
  getSetting,
  upsertFile,
  type UpsertFileInput,
} from "../database";
import {
  buildThumbHash,
  canAnalyzeImage,
  canBackendDecodeImage,
  computeVisualContentHash,
  detectExtensionFromBytes,
  detectExtensionFromPath,
  extractColorDistributionFromInput,
  getImageDimensions,
  isBlockedUnsupportedExtension,
  isScanSupportedExtension,
} from "../media";
import { hasThumbnailCachePath, getOrCreateThumbnail } from "../storage";
import { decideThumbnailPlan } from "../thumbnail";
import type { AppState, FileRecord, ImportTaskItem, ImportTaskSnapshot } from "../types";
import { copyFileWithCloneFallback, ensureDir } from "../file-operations";
import { emit, taskId } from "./common";
import {
  hasEnabledAiMetadataAnalysisFields,
  maybeAutoIndexImportedFile,
  startAiMetadataTask,
} from "./visual-ai-service";

const recentImports = new Map<string, number>();
const FILE_PATH_IMPORT_CONCURRENCY = 5;
const pendingImportTargetPaths = new Set<string>();
let autoThumbnailQueue = Promise.resolve();

export function timestampFromStats(stats: Stats, key: "birthtime" | "mtime"): string {
  const value = key === "birthtime" ? stats.birthtime : stats.mtime;
  return currentTimestamp(Number.isFinite(value.getTime()) ? value : new Date());
}

export function normalizeImportExtension(ext: string | null | undefined): string {
  const normalized = ext?.trim().replace(/^\./, "").toLowerCase();
  return normalized || "bin";
}

function fallbackExtensionFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).replace(/^\./, "").trim().toLowerCase();
  return ext || null;
}

function assertSupportedImportExtension(ext: string): void {
  if (!isScanSupportedExtension(ext)) {
    throw new Error(`不支持的文件格式: ${ext.toUpperCase()}`);
  }
}

function assertFallbackExtensionAllowed(ext: string | null | undefined): void {
  const normalized = normalizeImportExtension(ext);
  if (normalized !== "bin" && isBlockedUnsupportedExtension(normalized)) {
    throw new Error(`不支持的文件格式: ${normalized.toUpperCase()}`);
  }
}

export function shouldGenerateFileThumbnail(
  file: Pick<FileRecord, "ext" | "width" | "height" | "size">,
) {
  return decideThumbnailPlan({
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

  const thumbnailPlan = decideThumbnailPlan({
    ext: file.ext,
    width: file.width,
    height: file.height,
    size: file.size,
  });
  if (!thumbnailPlan.shouldGenerate) {
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

  if (thumbnailPlan.runtime === "renderer") {
    if (options.allowBackgroundRequest !== false && window) {
      emit(window, "thumbnail-build-request", {
        fileId: file.id,
        path: file.path,
        ext: file.ext,
        reason: thumbnailPlan.reason,
        runtime: thumbnailPlan.runtime,
      });
    }
    return null;
  }

  if (thumbnailPlan.runtime !== "main") {
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

export async function importExistingFilePath(
  state: AppState,
  request: {
    filePath: string;
    folderId: number | null;
    createdAt?: string;
    modifiedAt?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const input = await buildFileInputFromPath(request.filePath, request.folderId);
  const fileId = upsertFile(state.db, {
    ...input,
    createdAt: request.createdAt ?? input.createdAt,
    modifiedAt: request.modifiedAt ?? input.modifiedAt,
    rating: request.rating,
    description: request.description,
    sourceUrl: request.sourceUrl,
  });
  for (const tagId of new Set(request.tagIds ?? [])) {
    addTagToFile(state.db, fileId, tagId);
  }
  return getFileById(state.db, fileId) as FileRecord;
}

async function importFileFromPath(
  state: AppState,
  request: {
    sourcePath: string;
    folderId: number | null;
    fallbackExt?: string | null;
    createdAt?: string;
    modifiedAt?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const detectedExt = await detectExtensionFromPath(request.sourcePath);
  const recordExt = normalizeImportExtension(
    detectedExt ?? request.fallbackExt ?? fallbackExtensionFromPath(request.sourcePath),
  );
  assertSupportedImportExtension(recordExt);
  const targetPath = await resolveImportTargetPath(state, request.sourcePath, request.folderId);
  const targetKey = path.resolve(targetPath);

  try {
    await copyFileWithCloneFallback(request.sourcePath, targetPath);
    return await importExistingFilePath(state, {
      filePath: targetPath,
      folderId: request.folderId,
      createdAt: request.createdAt,
      modifiedAt: request.modifiedAt,
      rating: request.rating,
      description: request.description,
      sourceUrl: request.sourceUrl,
      tagIds: request.tagIds,
    });
  } finally {
    pendingImportTargetPaths.delete(targetKey);
  }
}

async function resolveImportTargetPath(
  state: AppState,
  sourcePath: string,
  folderId: number | null,
): Promise<string> {
  const targetDir = getTargetDir(state, folderId);
  await ensureDir(targetDir);

  const hasConflict = (candidate: string) => {
    const resolved = path.resolve(candidate);
    return (
      pendingImportTargetPaths.has(resolved) ||
      fssync.existsSync(candidate) ||
      Boolean(getFileByPath(state.db, candidate))
    );
  };

  const desiredPath = path.join(targetDir, path.basename(sourcePath));
  if (!hasConflict(desiredPath)) {
    pendingImportTargetPaths.add(path.resolve(desiredPath));
    return desiredPath;
  }

  const ext = path.extname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = path.join(
      targetDir,
      `${stem}_import_${Date.now().toString(16)}_${attempt}${ext}`,
    );
    if (!hasConflict(candidate)) {
      pendingImportTargetPaths.add(path.resolve(candidate));
      return candidate;
    }
  }

  throw new Error("Failed to resolve available import target path");
}

export async function buildFileInputFromPath(
  filePath: string,
  folderId: number | null,
  knownBytes?: Buffer,
): Promise<UpsertFileInput> {
  const stats = await fs.stat(filePath);
  const ext = normalizeImportExtension(
    (knownBytes ? detectExtensionFromBytes(knownBytes) : await detectExtensionFromPath(filePath)) ??
      fallbackExtensionFromPath(filePath),
  );
  assertSupportedImportExtension(ext);
  const canExtractVisualMetadata = canBackendDecodeImage(ext);
  const dimensions = canExtractVisualMetadata
    ? await getImageDimensions(filePath, ext)
    : { width: 0, height: 0 };
  const colors = canExtractVisualMetadata ? await extractColorDistributionFromInput(filePath) : [];
  const dominantColor = colors[0]?.color ?? "";
  const contentHash = canExtractVisualMetadata ? await computeVisualContentHash(filePath) : null;
  const thumbHash = canExtractVisualMetadata ? await buildThumbHash(filePath, ext) : "";
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
  assertFallbackExtensionAllowed(request.fallbackExt);
  const storageExt = normalizeImportExtension(detectedExt ?? request.fallbackExt);
  const recordExt = normalizeImportExtension(detectedExt ?? request.fallbackExt);
  assertSupportedImportExtension(recordExt);
  const targetPath =
    request.targetPath ??
    path.join(
      getTargetDir(state, request.folderId),
      generatedImportName(request.namePrefix ?? null, storageExt),
    );

  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, request.bytes);
  const stats = await fs.stat(targetPath);
  const canExtractVisualMetadata = canBackendDecodeImage(recordExt);
  const dimensions = canExtractVisualMetadata
    ? await getImageDimensions(targetPath, recordExt)
    : { width: 0, height: 0 };
  const colors = canExtractVisualMetadata
    ? await extractColorDistributionFromInput(targetPath)
    : [];
  const thumbHash = canExtractVisualMetadata ? await buildThumbHash(targetPath, recordExt) : "";
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
    contentHash: canExtractVisualMetadata ? await computeVisualContentHash(targetPath) : null,
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
  return importFileFromPath(state, {
    sourcePath,
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

  return importFileFromPath(state, {
    sourcePath: request.sourcePath,
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

function shouldAutoAnalyzeImportedMetadata(state: AppState): boolean {
  const value = getSetting(state.db, "aiAutoAnalyzeOnImport");
  if (value !== "true" && value !== "1") {
    return false;
  }
  return hasEnabledAiMetadataAnalysisFields(state);
}

function isFilePathImportItem(item: ImportTaskItem): boolean {
  return !item.kind || item.kind === "file_path";
}

async function importTaskItem(
  state: AppState,
  item: ImportTaskItem,
  folderId: number | null,
): Promise<FileRecord> {
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
  const autoAnalyzeFileIds: number[] = [];

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
      if (canAnalyzeImage(file.ext)) {
        autoAnalyzeFileIds.push(file.id);
      }
      postImport(state, window, file);
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
    return;
  }

  if (autoAnalyzeFileIds.length > 0 && shouldAutoAnalyzeImportedMetadata(state)) {
    startAiMetadataTask(state, window, autoAnalyzeFileIds);
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
