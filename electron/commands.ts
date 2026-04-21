import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import log from "electron-log/main";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  addIndexPath,
  addTagToFile,
  attachTags,
  BROWSER_COLLECTION_FOLDER_NAME,
  BROWSER_COLLECTION_FOLDER_SORT_ORDER,
  clearFilesFolderId,
  createFolderRecord,
  createTag,
  currentTimestamp,
  deleteFileByPath,
  deleteFolderRecord,
  deleteTag,
  filePathsInDir,
  filterFiles,
  getFileById,
  getFileByPath,
  getAllFiles,
  getAllFolders,
  getAllTags,
  getDeleteMode,
  getFilesInFolder,
  getFolderById,
  getFolderByPath,
  getFolderTree,
  getIndexPaths,
  getSetting,
  getOrCreateFolder,
  getUnindexedVisualIndexCandidates,
  getVisualIndexCandidate,
  getVisualIndexCandidates,
  getVisualIndexCounts,
  getTrashCount,
  getTrashFiles,
  isFileUnchanged,
  markFileVisualEmbeddingError,
  moveFileWithFallback,
  moveFolderRecord,
  moveTag,
  permanentDeleteFileRecord,
  removeIndexPath,
  removeTagFromFile,
  reorderFolders,
  reorderTags,
  renameFolder,
  resolveAvailableTargetPath,
  restoreFileRecord,
  searchFiles,
  searchFilesByVisualEmbedding,
  setDeleteMode,
  setIndexPath,
  setSetting,
  softDeleteFile,
  updateFileBasicInfo,
  updateFileColorData,
  updateFileDimensions,
  updateFileMetadata,
  updateFileNameRecord,
  updateFilePathAndFolder,
  updateTag,
  upsertFileVisualEmbedding,
  upsertFile,
  type UpsertFileInput,
} from "./database";
import {
  canAnalyzeImage,
  computeVisualContentHash,
  detectExtensionFromBytes,
  detectExtensionFromPath,
  extractColorDistributionFromInput,
  getImageDimensions,
  isScanSupportedExtension,
} from "./media";
import {
  ensureStorageDirs,
  getDefaultIndexPath,
  getOrCreateThumbnail,
  getThumbnailCachePath,
  isPathAllowedForRead,
  persistIndexPath,
  removeThumbnailForFile,
} from "./storage";
import { isHiddenName, pathHasPrefix } from "./path-utils";
import {
  embeddingToBuffer,
  encodeVisualSearchImage,
  encodeVisualSearchText,
  getCachedVisualRuntimeSnapshot,
  getRecommendedVisualModelPath,
  resolveVisualSearchConfig,
  validateVisualModelPath,
  type VisualModelValidationResult,
  type VisualSearchConfig,
} from "./visual-search";
import type {
  AiMetadataTaskSnapshot,
  AppState,
  FileRecord,
  FolderRecord,
  ImportTaskItem,
  ImportTaskSnapshot,
  VisualIndexTaskSnapshot,
} from "./types";

type GetWindow = () => BrowserWindow | null;

function getDragIconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "assets", "app-icon.png")]
    : [
        path.join(process.cwd(), "assets", "app-icon.png"),
        path.join(process.cwd(), "src", "assets", "app-icon.png"),
      ];

  const iconPath = candidates.find((candidate) => fssync.existsSync(candidate));
  return iconPath ?? path.join(process.cwd(), "assets", "image.png");
}
type CommandHandler = (
  args: Record<string, unknown>,
  eventWindow: BrowserWindow | null,
) => unknown | Promise<unknown>;

const recentImports = new Map<string, number>();
let collectorServer: FastifyInstance | null = null;
let autoVisualIndexQueue = Promise.resolve();

function emit(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}

function numberArg(args: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  throw new Error(`Missing numeric argument: ${keys[0]}`);
}

function optionalNumberArg(args: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = args[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      return value;
    }
  }
  throw new Error(`Missing string argument: ${keys[0]}`);
}

function numberArrayArg(args: Record<string, unknown>, ...keys: string[]): number[] {
  for (const key of keys) {
    const value = args[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is number => typeof item === "number" && Number.isFinite(item),
      );
    }
  }
  return [];
}

function taskId(): string {
  return Date.now().toString(16) + crypto.randomBytes(4).toString("hex");
}

function timestampFromStats(stats: fssync.Stats, key: "birthtime" | "mtime"): string {
  const value = key === "birthtime" ? stats.birthtime : stats.mtime;
  return currentTimestamp(Number.isFinite(value.getTime()) ? value : new Date());
}

function normalizeImportExtension(ext: string | null | undefined): string {
  const normalized = ext?.trim().replace(/^\./, "").toLowerCase();
  return normalized || "bin";
}

function generatedImportName(prefix: string | null, ext: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const id = taskId();
  return prefix ? `${prefix}_${stamp}_${id}.${ext}` : `${stamp}_${id}.${ext}`;
}

function getTargetDir(state: AppState, folderId: number | null): string {
  if (folderId !== null) {
    const folder = getFolderById(state.db, folderId);
    if (folder) {
      return folder.path;
    }
  }
  const indexPath = getIndexPaths(state.db)[0] ?? state.indexPath;
  return indexPath;
}

async function buildFileInputFromPath(
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
    contentHash,
  };
}

async function importBytes(
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
    contentHash: await computeVisualContentHash(targetPath),
  });
  return getFileById(state.db, fileId) as FileRecord;
}

async function importFilePath(
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

function loadVisualSearchConfig(state: AppState): VisualSearchConfig {
  return resolveVisualSearchConfig(getSetting(state.db, "visualSearch"));
}

async function loadVisualModelValidation(
  state: AppState,
  config = loadVisualSearchConfig(state),
): Promise<VisualModelValidationResult> {
  return validateVisualModelPath(config.modelPath);
}

async function indexVisualCandidate(
  state: AppState,
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
  candidate: NonNullable<ReturnType<typeof getVisualIndexCandidate>>,
): Promise<void> {
  const embedding = await encodeVisualSearchImage(config, validation, candidate.file.path);
  upsertFileVisualEmbedding(state.db, {
    fileId: candidate.file.id,
    modelId: validation.modelId ?? "",
    dimensions: embedding.length,
    embedding: embeddingToBuffer(embedding),
    sourceSize: candidate.sourceSize,
    sourceModifiedAt: candidate.sourceModifiedAt,
    sourceContentHash: candidate.contentHash ?? "",
  });
}

async function maybeAutoIndexImportedFile(
  state: AppState,
  file: FileRecord,
  window: BrowserWindow | null,
): Promise<void> {
  const config = loadVisualSearchConfig(state);
  if (!config.enabled || !config.autoVectorizeOnImport) {
    return;
  }

  const candidate = getVisualIndexCandidate(state.db, file.id);
  if (!candidate) {
    return;
  }

  autoVisualIndexQueue = autoVisualIndexQueue.then(async () => {
    const validation = await loadVisualModelValidation(state, config);
    if (!validation.valid || !validation.modelId) {
      return;
    }

    try {
      await indexVisualCandidate(state, config, validation, candidate);
    } catch (error) {
      markFileVisualEmbeddingError(state.db, {
        fileId: candidate.file.id,
        modelId: validation.modelId,
        sourceSize: candidate.sourceSize,
        sourceModifiedAt: candidate.sourceModifiedAt,
        sourceContentHash: candidate.contentHash,
        error: error instanceof Error ? error.message : String(error),
      });
      log.warn("[visual-search] auto index failed", {
        fileId: candidate.file.id,
        path: candidate.file.path,
        error,
      });
    }

    emit(window, "file-updated", { fileId: candidate.file.id });
  });

  await autoVisualIndexQueue;
}

function postImport(state: AppState, window: BrowserWindow | null, file: FileRecord): void {
  emit(window, "file-imported", { file_id: file.id, path: file.path });
  emit(window, "file-updated", { fileId: file.id });
  void maybeAutoIndexImportedFile(state, file, window);
}

function importTaskSource(item: ImportTaskItem): string {
  if (item.kind === "base64_image") {
    return `clipboard.${item.ext ?? "png"}`;
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

function startImportTask(
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

async function scanFoldersOnly(state: AppState, rootPath: string): Promise<number> {
  const indexPaths = getIndexPaths(state.db);
  let count = 0;

  async function visit(dir: string, depth: number): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || isHiddenName(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (depth >= 0) {
        getOrCreateFolder(state.db, child, indexPaths);
        count += 1;
      }
      await visit(child, depth + 1);
    }
  }

  await visit(rootPath, 0);
  return count;
}

async function scanIndexPath(state: AppState, rootPath: string): Promise<number> {
  const indexPaths = getIndexPaths(state.db);
  const existing = filePathsInDir(state.db, rootPath);
  const processed = new Set<string>();
  let inserted = 0;

  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isHiddenName(entry.name)) continue;
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = normalizeImportExtension(await detectExtensionFromPath(candidate));
      if (!isScanSupportedExtension(ext)) continue;
      processed.add(candidate);
      const folderId = getOrCreateFolder(state.db, path.dirname(candidate), indexPaths);
      const input = await buildFileInputFromPath(candidate, folderId);
      if (existing.has(candidate)) {
        if (!isFileUnchanged(state.db, candidate, ext, input.size, input.modifiedAt)) {
          updateFileBasicInfo(state.db, input);
          updateFileColorData(
            state.db,
            getFileByPath(state.db, candidate)?.id ?? 0,
            input.dominantColor ?? "",
            input.colorDistribution ?? "[]",
          );
        }
      } else {
        upsertFile(state.db, input);
        inserted += 1;
      }
    }
  }

  await visit(rootPath);
  for (const stalePath of [...existing].filter((item) => !processed.has(item))) {
    deleteFileByPath(state.db, stalePath);
  }
  return inserted;
}

function ensureBrowserCollectionFolder(state: AppState): FolderRecord {
  const existing = getAllFolders(state.db).find(
    (folder) => folder.isSystem && folder.name === BROWSER_COLLECTION_FOLDER_NAME,
  );
  if (existing) {
    if (existing.sortOrder !== BROWSER_COLLECTION_FOLDER_SORT_ORDER) {
      state.db
        .prepare("UPDATE folders SET sort_order = ? WHERE id = ?")
        .run(BROWSER_COLLECTION_FOLDER_SORT_ORDER, existing.id);
      return { ...existing, sortOrder: BROWSER_COLLECTION_FOLDER_SORT_ORDER };
    }
    return existing;
  }

  const folderPath = path.join(
    getIndexPaths(state.db)[0] ?? state.indexPath,
    BROWSER_COLLECTION_FOLDER_NAME,
  );
  fssync.mkdirSync(folderPath, { recursive: true });
  const pathExisting = getFolderByPath(state.db, folderPath);
  if (pathExisting) {
    state.db
      .prepare("UPDATE folders SET is_system = 1, parent_id = NULL, sort_order = ? WHERE id = ?")
      .run(BROWSER_COLLECTION_FOLDER_SORT_ORDER, pathExisting.id);
    return {
      ...pathExisting,
      isSystem: true,
      parent_id: null,
      sortOrder: BROWSER_COLLECTION_FOLDER_SORT_ORDER,
    };
  }

  const id = createFolderRecord(
    state.db,
    folderPath,
    BROWSER_COLLECTION_FOLDER_NAME,
    null,
    true,
    BROWSER_COLLECTION_FOLDER_SORT_ORDER,
  );
  return getFolderById(state.db, id) as FolderRecord;
}

function loadAiConfig(state: AppState): { baseUrl: string; apiKey: string; model: string } {
  const raw = getSetting(state.db, "aiConfig");
  if (!raw) throw new Error("请先在设置中填写 AI 配置");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const endpoint = (parsed.metadata as Record<string, unknown> | undefined) ?? {};
  const baseUrl = String(endpoint.baseUrl ?? parsed.baseUrl ?? "https://api.openai.com/v1").trim();
  const apiKey = String(endpoint.apiKey ?? parsed.apiKey ?? "").trim();
  const model = String(endpoint.model ?? parsed.multimodalModel ?? "").trim();
  if (!baseUrl || !apiKey) throw new Error("图片元数据分析配置不完整，请填写 Base URL 和 API Key");
  if (!model) throw new Error("图片元数据分析配置不完整，请填写模型");
  return { baseUrl, apiKey, model };
}

async function getVisualStatus(state: AppState) {
  const config = loadVisualSearchConfig(state);
  const validation = await loadVisualModelValidation(state, config);
  const modelId = validation.valid ? validation.modelId : null;
  const counts = getVisualIndexCounts(state.db, modelId ?? "__visual_search_unconfigured__");
  const runtimeSnapshot =
    validation.valid && validation.normalizedModelPath
      ? getCachedVisualRuntimeSnapshot(config, validation.normalizedModelPath)
      : {
          runtimeLoaded: false,
          runtimeMode: "uninitialized" as const,
          effectiveProvider: null,
          runtimeReason: null,
        };

  let message = "请先启用本地自然语言搜索。";
  if (!config.enabled) {
    message = "本地自然语言搜索已关闭。";
  } else if (!validation.valid) {
    message = validation.message;
  } else if (!runtimeSnapshot.runtimeLoaded) {
    message =
      counts.pending + counts.outdated > 0
        ? `模型已就绪，运行时未加载；待处理 ${counts.pending} 张，已过期 ${counts.outdated} 张。`
        : "模型已就绪，运行时未加载。";
  } else if (counts.pending + counts.error + counts.outdated > 0) {
    message = `模型已加载，已索引 ${counts.ready}/${counts.totalImages} 张，仍有 ${counts.pending} 张待处理、${counts.error} 张失败、${counts.outdated} 张过期。`;
  } else {
    message = `模型已加载，${counts.totalImages} 张图片索引已全部就绪。`;
  }

  return {
    modelValid: validation.valid,
    message,
    modelId,
    version: validation.version,
    requestedDevice: config.runtime.device,
    providerPolicy: config.runtime.providerPolicy,
    runtimeLoaded: runtimeSnapshot.runtimeLoaded,
    runtimeMode: runtimeSnapshot.runtimeMode,
    effectiveProvider: runtimeSnapshot.effectiveProvider,
    runtimeReason: runtimeSnapshot.runtimeReason,
    indexedCount: counts.ready,
    failedCount: counts.error,
    pendingCount: counts.pending,
    outdatedCount: counts.outdated,
    totalImageCount: counts.totalImages,
  };
}

async function runVisualIndexJob(
  state: AppState,
  window: BrowserWindow | null,
  entryId: string | null,
  processUnindexedOnly: boolean,
) {
  const config = loadVisualSearchConfig(state);
  if (!config.enabled) {
    throw new Error("请先在设置中启用本地自然语言搜索。");
  }

  const validation = await loadVisualModelValidation(state, config);
  if (!validation.valid || !validation.modelId) {
    throw new Error(validation.message);
  }

  const candidates = processUnindexedOnly
    ? getUnindexedVisualIndexCandidates(state.db, validation.modelId)
    : getVisualIndexCandidates(state.db);

  const entry = entryId ? (state.visualIndexTasks.get(entryId) ?? null) : null;
  if (entry) {
    entry.snapshot.total = candidates.length;
    entry.snapshot.status = candidates.length === 0 ? "completed" : "running";
    emit(window, "visual-index-task-updated", entry.snapshot.id);
  }

  let indexed = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (const candidate of candidates) {
    if (entry?.cancelled) {
      entry.snapshot.status = "cancelled";
      entry.snapshot.processed = processed;
      entry.snapshot.indexedCount = indexed;
      entry.snapshot.failureCount = failed;
      entry.snapshot.skippedCount = skipped + Math.max(0, candidates.length - processed);
      entry.snapshot.currentFileId = null;
      entry.snapshot.currentFileName = null;
      emit(window, "visual-index-task-updated", entry.snapshot.id);
      return {
        total: candidates.length,
        indexed,
        failed,
        skipped: skipped + Math.max(0, candidates.length - processed),
      };
    }

    if (entry) {
      entry.snapshot.currentFileId = candidate.file.id;
      entry.snapshot.currentFileName = candidate.file.name;
      emit(window, "visual-index-task-updated", entry.snapshot.id);
    }

    try {
      await indexVisualCandidate(state, config, validation, candidate);
      indexed += 1;
    } catch (error) {
      failed += 1;
      markFileVisualEmbeddingError(state.db, {
        fileId: candidate.file.id,
        modelId: validation.modelId,
        sourceSize: candidate.sourceSize,
        sourceModifiedAt: candidate.sourceModifiedAt,
        sourceContentHash: candidate.contentHash,
        error: error instanceof Error ? error.message : String(error),
      });
      log.warn("[visual-search] index failed", {
        fileId: candidate.file.id,
        path: candidate.file.path,
        error,
      });
    }

    processed += 1;
    if (entry) {
      entry.snapshot.processed = processed;
      entry.snapshot.indexedCount = indexed;
      entry.snapshot.failureCount = failed;
      entry.snapshot.skippedCount = skipped;
      entry.snapshot.status =
        processed === candidates.length
          ? failed > 0
            ? "completed_with_errors"
            : "completed"
          : "running";
      emit(window, "visual-index-task-updated", entry.snapshot.id);
    }
  }

  if (entry) {
    entry.snapshot.currentFileId = null;
    entry.snapshot.currentFileName = null;
    emit(window, "visual-index-task-updated", entry.snapshot.id);
  }

  return {
    total: candidates.length,
    indexed,
    failed,
    skipped,
  };
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function extractResponseText(payload: unknown): string | null {
  const value = payload as Record<string, unknown>;
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content ?? first?.text ?? value.output_text;
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const item = part as Record<string, unknown>;
          return typeof item.text === "string" ? item.text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return null;
}

async function postAiJson(
  config: { baseUrl: string; apiKey: string; model: string },
  body: unknown,
): Promise<unknown> {
  const response = await fetch(chatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AI 服务返回错误: ${text}`);
  }
  return JSON.parse(text);
}

async function buildAiImageDataUrl(filePath: string): Promise<string> {
  const bytes = await sharpToJpeg(filePath);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function sharpToJpeg(filePath: string): Promise<Buffer> {
  return sharp(filePath, { animated: false })
    .rotate()
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function sanitizeFilenameStem(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, 80) || fallback;
}

function pickTagColor(name: string): string {
  const colors = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
  ];
  const sum = [...name].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[sum % colors.length];
}

async function analyzeFileMetadata(
  state: AppState,
  fileId: number,
  imageDataUrl?: string,
): Promise<FileRecord> {
  const config = loadAiConfig(state);
  const file = getFileById(state.db, fileId);
  if (!file) throw new Error("文件不存在");
  if (!canAnalyzeImage(file.ext) && !imageDataUrl)
    throw new Error("当前仅支持对图片文件执行 AI 分析");
  if (!fssync.existsSync(file.path)) throw new Error("文件不存在，无法执行 AI 分析");

  const dataUrl = imageDataUrl?.trim() || (await buildAiImageDataUrl(file.path));
  const existingTags =
    getAllTags(state.db)
      .slice(0, 200)
      .map((tag) => tag.name)
      .join("、") || "无";
  const prompt = `请分析这张图片并返回 JSON，格式为 {"filename":"...","tags":["..."],"description":"..."}。\n规则：filename 是文件名主体，不含扩展名和路径；tags 返回 1 到 5 个短标签；description 中文优先，控制在 200 字以内。\n当前文件名：${file.name}\n当前已有标签：${file.tags.map((tag) => tag.name).join("、") || "无"}\n可优先复用的标签池：${existingTags}`;
  const payload = await postAiJson(config, {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          "你是素材库整理助手。请根据图片内容生成适合真实文件系统的名称、标签和备注。只返回 JSON，不要输出额外解释。",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    enable_thinking: false,
    stream: false,
    temperature: 0.2,
    max_tokens: 500,
  });
  const text = extractResponseText(payload);
  if (!text) throw new Error("AI 响应缺少内容");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const suggestion = JSON.parse(json) as {
    filename?: string;
    tags?: string[];
    description?: string;
  };
  const oldPath = file.path;
  const ext = path.extname(oldPath);
  const nextStem = sanitizeFilenameStem(suggestion.filename ?? "", path.basename(file.name, ext));
  const nextName = `${nextStem}${ext}`;
  const nextPath = await resolveAvailableTargetPath(
    state.db,
    oldPath,
    path.dirname(oldPath),
    fileId,
    "ai",
    true,
  ).then((candidate) => path.join(path.dirname(candidate), nextName));
  if (nextPath !== oldPath && !fssync.existsSync(nextPath)) {
    await moveFileWithFallback(oldPath, nextPath);
    updateFileNameRecord(state.db, fileId, nextName, nextPath);
  }
  updateFileMetadata(
    state.db,
    fileId,
    file.rating,
    String(suggestion.description ?? "")
      .trim()
      .slice(0, 200),
    file.sourceUrl,
  );

  const existing = new Map(
    getAllTags(state.db).map((tag) => [tag.name.trim().toLowerCase(), tag.id]),
  );
  for (const tagName of [
    ...new Set((suggestion.tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
  ].slice(0, 5)) {
    const key = tagName.toLowerCase();
    const tagId = existing.get(key) ?? createTag(state.db, tagName, pickTagColor(tagName), null);
    addTagToFile(state.db, fileId, tagId);
  }
  return getFileById(state.db, fileId) as FileRecord;
}

function startAiMetadataTask(
  state: AppState,
  window: BrowserWindow | null,
  fileIds: number[],
): AiMetadataTaskSnapshot {
  const id = `ai-metadata-${taskId()}`;
  const unique = [...new Set(fileIds)];
  const snapshot: AiMetadataTaskSnapshot = {
    id,
    status: "queued",
    total: unique.length,
    processed: 0,
    successCount: 0,
    failureCount: 0,
    results: [],
  };
  state.aiMetadataTasks.set(id, { snapshot, cancelled: false });
  void (async () => {
    const entry = state.aiMetadataTasks.get(id);
    if (!entry) return;
    entry.snapshot.status = "running";
    emit(window, "ai-metadata-task-updated", id);
    for (const [index, fileId] of unique.entries()) {
      if (entry.cancelled) {
        entry.snapshot.status = "cancelled";
        emit(window, "ai-metadata-task-updated", id);
        return;
      }
      try {
        const file = await analyzeFileMetadata(state, fileId);
        entry.snapshot.successCount += 1;
        entry.snapshot.results.push({
          index,
          fileId,
          status: "completed",
          attempts: 1,
          error: null,
          file,
        });
        emit(window, "file-updated", { fileId });
      } catch (error) {
        entry.snapshot.failureCount += 1;
        entry.snapshot.results.push({
          index,
          fileId,
          status: "failed",
          attempts: 1,
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
      emit(window, "ai-metadata-task-updated", id);
    }
  })();
  return snapshot;
}

async function startVisualIndexTask(
  state: AppState,
  window: BrowserWindow | null,
  processUnindexedOnly: boolean,
): Promise<VisualIndexTaskSnapshot> {
  const id = `visual-index-${taskId()}`;
  const snapshot: VisualIndexTaskSnapshot = {
    id,
    status: "queued",
    total: 0,
    processed: 0,
    indexedCount: 0,
    failureCount: 0,
    skippedCount: 0,
    currentFileId: null,
    currentFileName: null,
    processUnindexedOnly,
  };
  state.visualIndexTasks.set(id, { snapshot, cancelled: false });
  void runVisualIndexJob(state, window, id, processUnindexedOnly).catch((error) => {
    const entry = state.visualIndexTasks.get(id);
    if (!entry) {
      return;
    }
    entry.snapshot.status = "failed";
    entry.snapshot.currentFileId = null;
    entry.snapshot.currentFileName = null;
    log.error("[visual-search] visual index task failed", error);
    emit(window, "visual-index-task-updated", id);
  });
  queueMicrotask(() => emit(window, "visual-index-task-updated", id));
  return snapshot;
}

export async function startCollectorServer(state: AppState, getWindow: GetWindow): Promise<void> {
  if (collectorServer) return;
  const server = Fastify({ logger: false });
  await server.register(cors, { origin: true });
  server.get("/api/health", async () => ({ status: "ok" }));
  server.options("/api/health", async () => ({}));
  server.options("/api/import", async () => ({}));
  server.options("/api/import-from-url", async () => ({}));
  server.post("/api/import", async (request) => {
    const body = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(request.body as ArrayBuffer);
    const folder = ensureBrowserCollectionFolder(state);
    try {
      const query = request.query as { filename?: string };
      const filename = typeof query.filename === "string" ? query.filename : "";
      const headerContentType = request.headers["content-type"];
      const contentType = Array.isArray(headerContentType)
        ? headerContentType[0]
        : headerContentType;
      const file = await importBytes(state, {
        bytes: body,
        folderId: folder.id,
        fallbackExt: normalizeImportExtension(
          detectExtensionFromBytes(body, contentType) ?? path.extname(filename),
        ),
        namePrefix: "browser",
      });
      postImport(state, getWindow(), file);
      return { success: true, file_id: file.id, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit(getWindow(), "file-import-error", { error: message });
      return { success: false, file_id: null, error: message };
    }
  });
  server.post("/api/import-from-url", async (request) => {
    const payload = request.body as { image_url?: string; referer?: string };
    if (!payload?.image_url) return { success: false, file_id: null, error: "Missing image_url" };
    try {
      const response = await fetch(payload.image_url, {
        headers: payload.referer ? { referer: payload.referer } : undefined,
      });
      if (!response.ok) throw new Error(`Download failed with status: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const folder = ensureBrowserCollectionFolder(state);
      const contentType = response.headers.get("content-type");
      const file = await importBytes(state, {
        bytes,
        folderId: folder.id,
        fallbackExt: normalizeImportExtension(detectExtensionFromBytes(bytes, contentType)),
        namePrefix: "browser",
        sourceUrl: payload.referer ?? payload.image_url,
      });
      postImport(state, getWindow(), file);
      return { success: true, file_id: file.id, error: null };
    } catch (error) {
      return {
        success: false,
        file_id: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  await server.listen({ host: "127.0.0.1", port: 7845 });
  collectorServer = server;
}

export function registerIpcHandlers(
  state: AppState,
  getWindow: GetWindow,
  assetToUrl: (filePath: string) => string,
): void {
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
      await persistIndexPath(state.appDataDir, indexPath);
      setIndexPath(state.db, indexPath);
      const { app } = await import("electron");
      app.relaunch();
      app.quit();
    },
    sync_index_path: (args) => scanIndexPath(state, stringArg(args, "path")),
    rebuild_library_index: async () => {
      let total = 0;
      for (const indexPath of getIndexPaths(state.db))
        total += await scanIndexPath(state, indexPath);
      return total;
    },
    reindex_all: async () => {
      let total = 0;
      for (const indexPath of getIndexPaths(state.db))
        total += await scanIndexPath(state, indexPath);
      return total;
    },
    get_thumbnail_path: async (args) => {
      const filePath = stringArg(args, "filePath", "file_path");
      const file = getFileByPath(state.db, filePath);
      return getOrCreateThumbnail(
        getIndexPaths(state.db),
        filePath,
        file?.ext ?? path.extname(filePath).slice(1),
        optionalNumberArg(args, "maxEdge", "max_edge") ?? undefined,
      );
    },
    get_thumbnail_data_base64: async (args) => {
      const thumbnail = await commands.get_thumbnail_path(args, getWindow());
      return typeof thumbnail === "string"
        ? (await fs.readFile(thumbnail)).toString("base64")
        : null;
    },
    get_thumbnail_cache_path: (args) =>
      getThumbnailCachePath(
        getIndexPaths(state.db),
        stringArg(args, "filePath", "file_path"),
        optionalNumberArg(args, "maxEdge", "max_edge") ?? undefined,
      ),
    save_thumbnail_cache: async (args) => {
      const cachePath = getThumbnailCachePath(
        getIndexPaths(state.db),
        stringArg(args, "filePath", "file_path"),
        optionalNumberArg(args, "maxEdge", "max_edge") ?? undefined,
      );
      if (!cachePath) return null;
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(
        cachePath,
        Buffer.from(stringArg(args, "dataBase64", "data_base64"), "base64"),
      );
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
      const folderPath = path.join(parentPath, stringArg(args, "name"));
      await fs.mkdir(folderPath, { recursive: true });
      return getFolderById(
        state.db,
        createFolderRecord(
          state.db,
          folderPath,
          stringArg(args, "name"),
          parentId,
          Boolean(args.isSystem ?? args.is_system),
        ),
      );
    },
    delete_folder: async (args) => {
      const id = numberArg(args, "id");
      const folder = getFolderById(state.db, id);
      if (!folder) return;
      if (folder.isSystem) throw new Error("Cannot delete system folder");
      const allFolders = getAllFolders(state.db);
      const childIds = allFolders
        .filter((item) => item.id !== id && pathHasPrefix(item.path, folder.path))
        .map((item) => item.id);
      clearFilesFolderId(state.db, [id, ...childIds]);
      for (const file of attachTags(
        state.db,
        state.db.prepare("SELECT * FROM files").all() as never,
      )) {
        if (pathHasPrefix(file.path, folder.path)) {
          await removeThumbnailForFile(getIndexPaths(state.db), file.path);
          deleteFileByPath(state.db, file.path);
        }
      }
      deleteFolderRecord(state.db, id);
      await fs.rm(folder.path, { recursive: true, force: true });
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
    restore_file: (args) => restoreOneFile(state, numberArg(args, "fileId", "file_id")),
    restore_files: async (args) => {
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids"))
        await restoreOneFile(state, fileId);
    },
    permanent_delete_file: (args) =>
      permanentDeleteOneFile(state, numberArg(args, "fileId", "file_id")),
    permanent_delete_files: async (args) => {
      for (const fileId of numberArrayArg(args, "fileIds", "file_ids"))
        await permanentDeleteOneFile(state, fileId);
    },
    empty_trash: async () => {
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
      const paths = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId)?.path)
        .filter((item): item is string => Boolean(item));
      clipboard.writeText(paths.join("\n"));
    },
    start_drag_files: (args, window) => {
      const paths = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId)?.path)
        .filter((item): item is string => Boolean(item));
      if (!paths.length || !window) throw new Error("No files selected");
      window.webContents.startDrag({
        file: paths[0],
        icon: getDragIconPath(),
      });
    },
    open_file: async (args) => {
      const file = getFileById(state.db, numberArg(args, "fileId", "file_id"));
      if (!file) throw new Error("File not found");
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
  };

  ipcMain.handle(
    "shiguang:invoke",
    async (event, command: string, args: Record<string, unknown> = {}) => {
      const handler = commands[command];
      if (!handler) {
        throw new Error(`Unknown desktop command: ${command}`);
      }
      return handler(args, BrowserWindow.fromWebContents(event.sender));
    },
  );

  ipcMain.handle("shiguang:dialog:open", async (_event, options: Electron.OpenDialogOptions) => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled
      ? null
      : options.properties?.includes("multiSelections")
        ? result.filePaths
        : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(
    "shiguang:fs:exists",
    (_event, filePath: string) =>
      fssync.existsSync(filePath) && isPathAllowedForRead(filePath, getIndexPaths(state.db)),
  );
  ipcMain.handle("shiguang:fs:readFile", async (_event, filePath: string) => {
    if (!isPathAllowedForRead(filePath, getIndexPaths(state.db)))
      throw new Error("Path is not allowed");
    return new Uint8Array(await fs.readFile(filePath));
  });
  ipcMain.handle("shiguang:fs:readTextFile", async (_event, filePath: string) => {
    if (!isPathAllowedForRead(filePath, getIndexPaths(state.db)))
      throw new Error("Path is not allowed");
    return fs.readFile(filePath, "utf8");
  });
  ipcMain.handle("shiguang:asset:toUrl", (_event, filePath: string) => assetToUrl(filePath));
  ipcMain.handle("shiguang:log", (_event, level: string, message: string) => {
    const writer =
      level === "error"
        ? log.error
        : level === "warn"
          ? log.warn
          : level === "debug"
            ? log.debug
            : log.info;
    writer(message);
  });
}

function appDocumentsDir(): string {
  return app.getPath("documents");
}

async function copyOneFile(
  state: AppState,
  window: BrowserWindow | null,
  fileId: number,
  targetFolderId: number | null,
): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) throw new Error("File not found");
  const targetDir = getTargetDir(state, targetFolderId);
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = await resolveAvailableTargetPath(
    state.db,
    file.path,
    targetDir,
    null,
    "copy",
    false,
  );
  const bytes = await fs.readFile(file.path);
  const imported = await importBytes(state, {
    bytes,
    folderId: targetFolderId,
    fallbackExt: file.ext,
    targetPath,
    rating: file.rating,
    description: file.description,
    sourceUrl: file.sourceUrl,
  });
  postImport(state, window, imported);
}

async function moveOneFile(
  state: AppState,
  fileId: number,
  targetFolderId: number | null,
): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) throw new Error("File not found");
  const targetDir = getTargetDir(state, targetFolderId);
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = await resolveAvailableTargetPath(
    state.db,
    file.path,
    targetDir,
    fileId,
    "moved",
    true,
  );
  if (path.resolve(targetPath) !== path.resolve(file.path) && fssync.existsSync(file.path)) {
    await moveFileWithFallback(file.path, targetPath);
  }
  updateFilePathAndFolder(state.db, fileId, targetPath, targetFolderId);
}

async function deleteFileCommand(state: AppState, fileId: number): Promise<void> {
  if (getDeleteMode(state.db)) {
    softDeleteFile(state.db, fileId);
  } else {
    await permanentDeleteOneFile(state, fileId);
  }
}

async function restoreOneFile(state: AppState, fileId: number): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) return;
  if (file.folderId !== null && !getFolderById(state.db, file.folderId)) {
    const root = getIndexPaths(state.db)[0] ?? state.indexPath;
    const targetPath = path.join(root, path.basename(file.path));
    if (fssync.existsSync(file.path) && path.resolve(file.path) !== path.resolve(targetPath)) {
      await moveFileWithFallback(file.path, targetPath);
    }
    updateFilePathAndFolder(state.db, fileId, targetPath, null);
  }
  restoreFileRecord(state.db, fileId);
}

async function permanentDeleteOneFile(state: AppState, fileId: number): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) return;
  await removeThumbnailForFile(getIndexPaths(state.db), file.path);
  permanentDeleteFileRecord(state.db, fileId);
  await fs.rm(file.path, { force: true }).catch(() => undefined);
}
