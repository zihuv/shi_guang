import { BrowserWindow } from "electron";
import log from "electron-log/main";
import {
  clearFileVisualEmbeddings,
  getPendingVisualIndexCandidates,
  getSetting,
  getUnindexedVisualIndexCandidates,
  getVisualIndexCandidate,
  getVisualIndexCandidates,
  getVisualIndexCounts,
  isFileVisualEmbeddingReady,
  markFileVisualEmbeddingError,
  upsertFileVisualEmbedding,
} from "../database";
import {
  embeddingToBuffer,
  getCachedVisualRuntimeSnapshot,
  getVisualSearchEmbeddingConfigKey,
  resolveVisualSearchConfig,
  validateVisualModelPath,
  type VisualModelValidationResult,
  type VisualSearchConfig,
} from "../visual-search";
import {
  encodeVisualSearchImageInUtility,
  getVisualIndexUtilitySnapshot,
  isVisualIndexUtilitySuspended,
} from "../visual-search/visual-index-utility-service.js";
import type { AppState, FileRecord, VisualIndexTaskSnapshot } from "../types";
import { emit, taskId } from "./common";

export {
  analyzeFileMetadata,
  extractResponseText,
  hasEnabledAiMetadataAnalysisFields,
  loadAiConfig,
  postAiJson,
  startAiMetadataTask,
} from "./ai-metadata-service";

let visualIndexJobQueue = Promise.resolve();
let autoVisualIndexRunner: Promise<void> | null = null;
let autoVisualIndexWindow: BrowserWindow | null = null;
let autoVisualIndexWakePending = false;

class VisualIndexConfigChangedError extends Error {
  constructor() {
    super("视觉模型配置已变更，本次索引任务已取消。");
  }
}

function isVisualIndexConfigChangedError(error: unknown): error is VisualIndexConfigChangedError {
  return error instanceof VisualIndexConfigChangedError;
}

function cancelVisualIndexEntry(
  entry: { snapshot: VisualIndexTaskSnapshot; cancelled: boolean },
  window: BrowserWindow | null,
): void {
  entry.cancelled = true;
  entry.snapshot.status = "cancelled";
  entry.snapshot.currentFileId = null;
  entry.snapshot.currentFileName = null;
  emit(window, "visual-index-task-updated", entry.snapshot.id);
}

export function loadVisualSearchConfig(state: AppState): VisualSearchConfig {
  return resolveVisualSearchConfig(getSetting(state.db, "visualSearch"));
}

function ensureVisualIndexConfigCurrent(state: AppState, config: VisualSearchConfig): void {
  const currentConfig = loadVisualSearchConfig(state);
  if (
    getVisualSearchEmbeddingConfigKey(currentConfig) !== getVisualSearchEmbeddingConfigKey(config)
  ) {
    throw new VisualIndexConfigChangedError();
  }
}

export async function loadVisualModelValidation(
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
  const embedding = await encodeVisualSearchImageInUtility(config, validation, candidate.file.path);
  ensureVisualIndexConfigCurrent(state, config);
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

function enqueueVisualIndexJob<T>(job: () => Promise<T>): Promise<T> {
  const queued = visualIndexJobQueue.then(job, job);
  visualIndexJobQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function isAutoVisualIndexWindowActive(window: BrowserWindow | null): boolean {
  return Boolean(
    window && !window.isDestroyed() && window.isVisible() && !isVisualIndexUtilitySuspended(),
  );
}

export async function maybeAutoIndexImportedFile(
  state: AppState,
  file: FileRecord,
  window: BrowserWindow | null,
): Promise<void> {
  if (!isAutoVisualIndexWindowActive(window)) {
    return;
  }

  const config = loadVisualSearchConfig(state);
  if (!config.enabled || !config.autoVectorizeOnImport) {
    return;
  }

  const candidate = getVisualIndexCandidate(state.db, file.id);
  if (!candidate) {
    return;
  }

  wakeAutoVisualIndexing(state, window);
}

export function wakeAutoVisualIndexing(state: AppState, window: BrowserWindow | null): void {
  autoVisualIndexWindow = window;
  autoVisualIndexWakePending = true;
  if (autoVisualIndexRunner) {
    return;
  }

  autoVisualIndexRunner = runAutoVisualIndexing(state).finally(() => {
    autoVisualIndexRunner = null;
    if (autoVisualIndexWakePending && isAutoVisualIndexWindowActive(autoVisualIndexWindow)) {
      wakeAutoVisualIndexing(state, autoVisualIndexWindow);
    }
  });
}

async function runAutoVisualIndexing(state: AppState): Promise<void> {
  while (autoVisualIndexWakePending) {
    autoVisualIndexWakePending = false;
    const window = autoVisualIndexWindow;
    if (!isAutoVisualIndexWindowActive(window)) {
      return;
    }

    const config = loadVisualSearchConfig(state);
    if (!config.enabled || !config.autoVectorizeOnImport) {
      return;
    }

    const validation = await loadVisualModelValidation(state, config);
    if (!validation.valid || !validation.modelId) {
      return;
    }

    const candidates = getPendingVisualIndexCandidates(state.db, validation.modelId);
    if (candidates.length === 0) {
      return;
    }

    try {
      await runVisualIndexJob(state, window, null, true, true);
    } catch (error) {
      if (isVisualIndexUtilitySuspended()) {
        return;
      }
      log.warn("[visual-search] auto index runner failed", error);
      return;
    }
  }
}

export async function getVisualStatus(state: AppState) {
  const config = loadVisualSearchConfig(state);
  const validation = await loadVisualModelValidation(state, config);
  const modelId = validation.valid ? validation.modelId : null;
  const counts = getVisualIndexCounts(state.db, modelId ?? "__visual_search_unconfigured__");
  const runtimeSnapshot =
    validation.valid && validation.normalizedModelPath
      ? (() => {
          const mainRuntimeSnapshot = getCachedVisualRuntimeSnapshot(
            config,
            validation.normalizedModelPath,
          );
          const utilityRuntimeSnapshot = getVisualIndexUtilitySnapshot(
            config,
            validation.normalizedModelPath,
          );
          return utilityRuntimeSnapshot.runtimeLoaded
            ? utilityRuntimeSnapshot
            : mainRuntimeSnapshot;
        })()
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

export async function runVisualIndexJob(
  state: AppState,
  window: BrowserWindow | null,
  entryId: string | null,
  processUnindexedOnly: boolean,
  skipCurrentErrors = false,
) {
  return enqueueVisualIndexJob(() =>
    runVisualIndexJobNow(state, window, entryId, processUnindexedOnly, skipCurrentErrors),
  );
}

async function runVisualIndexJobNow(
  state: AppState,
  window: BrowserWindow | null,
  entryId: string | null,
  processUnindexedOnly: boolean,
  skipCurrentErrors: boolean,
) {
  const config = loadVisualSearchConfig(state);
  if (!config.enabled) {
    throw new Error("请先在设置中启用本地自然语言搜索。");
  }
  if (isVisualIndexUtilitySuspended()) {
    throw new Error("应用已隐藏，视觉索引后台服务已暂停。");
  }

  const validation = await loadVisualModelValidation(state, config);
  if (!validation.valid || !validation.modelId) {
    throw new Error(validation.message);
  }

  if (!processUnindexedOnly) {
    clearFileVisualEmbeddings(state.db);
  }

  const candidates = processUnindexedOnly
    ? skipCurrentErrors
      ? getPendingVisualIndexCandidates(state.db, validation.modelId)
      : getUnindexedVisualIndexCandidates(state.db, validation.modelId)
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
      ensureVisualIndexConfigCurrent(state, config);
      if (isFileVisualEmbeddingReady(state.db, candidate.file.id, validation.modelId)) {
        skipped += 1;
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
        continue;
      }

      await indexVisualCandidate(state, config, validation, candidate);
      indexed += 1;
    } catch (error) {
      if (isVisualIndexConfigChangedError(error)) {
        if (entry) {
          cancelVisualIndexEntry(entry, window);
        }
        return {
          total: candidates.length,
          indexed,
          failed,
          skipped: skipped + Math.max(0, candidates.length - processed),
        };
      }
      if (entry?.cancelled || isVisualIndexUtilitySuspended()) {
        if (entry) {
          cancelVisualIndexEntry(entry, window);
        }
        return {
          total: candidates.length,
          indexed,
          failed,
          skipped: skipped + Math.max(0, candidates.length - processed),
        };
      }
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

export function suspendVisualIndexing(state: AppState, window: BrowserWindow | null): void {
  for (const entry of state.visualIndexTasks.values()) {
    if (entry.cancelled) {
      continue;
    }
    cancelVisualIndexEntry(entry, window);
  }
}

export async function startVisualIndexTask(
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
