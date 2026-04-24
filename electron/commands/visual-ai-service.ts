import { BrowserWindow } from "electron";
import log from "electron-log/main";
import fssync from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  addTagToFile,
  createTag,
  getAllTags,
  getFileById,
  getSetting,
  getUnindexedVisualIndexCandidates,
  getVisualIndexCandidate,
  getVisualIndexCandidates,
  getVisualIndexCounts,
  markFileVisualEmbeddingError,
  moveFileWithFallback,
  resolveAvailableTargetPath,
  updateFileMetadata,
  updateFileNameRecord,
  upsertFileVisualEmbedding,
} from "../database";
import { canAnalyzeImage } from "../media";
import {
  embeddingToBuffer,
  getCachedVisualRuntimeSnapshot,
  resolveVisualSearchConfig,
  validateVisualModelPath,
  type VisualModelValidationResult,
  type VisualSearchConfig,
} from "../visual-search";
import {
  encodeVisualSearchImageInUtility,
  getVisualIndexUtilitySnapshot,
  isVisualIndexUtilitySuspended,
} from "../visual-index-utility-service.js";
import type {
  AiMetadataTaskSnapshot,
  AppState,
  FileRecord,
  VisualIndexTaskSnapshot,
} from "../types";
import { emit, taskId } from "./common";

let autoVisualIndexQueue = Promise.resolve();

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

export async function maybeAutoIndexImportedFile(
  state: AppState,
  file: FileRecord,
  window: BrowserWindow | null,
): Promise<void> {
  if (isVisualIndexUtilitySuspended()) {
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

export function loadAiConfig(state: AppState): { baseUrl: string; apiKey: string; model: string } {
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

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

export function extractResponseText(payload: unknown): string | null {
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

export async function postAiJson(
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

export async function analyzeFileMetadata(
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

export function startAiMetadataTask(
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
