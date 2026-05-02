import { BrowserWindow } from "electron";
import fssync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  addTagToFile,
  createTag,
  getAllTags,
  getFileById,
  getSetting,
  removeTagFromFile,
  resolveAvailableTargetPath,
  updateFileMetadata,
  updateFileNameRecord,
} from "../database";
import { canAnalyzeImage } from "../media";
import {
  AI_METADATA_FIELDS,
  DEFAULT_AI_METADATA_ANALYSIS,
  type AiMetadataAnalysisConfig,
  type AiMetadataAnalysisField,
  type AiMetadataAnalysisFieldConfig,
} from "../../src/lib/aiMetadataDefaults";
import type { AiMetadataTaskSnapshot, AppState, FileRecord } from "../types";
import { emit, taskId } from "./common";

let aiMetadataJobQueue = Promise.resolve();

interface AiMetadataConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  analysis: AiMetadataAnalysisConfig;
}

function enqueueAiMetadataJob<T>(job: () => Promise<T>): Promise<T> {
  const queued = aiMetadataJobQueue.then(job, job);
  aiMetadataJobQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function resolveAiMetadataAnalysisField(
  field: AiMetadataAnalysisField,
  value: unknown,
): AiMetadataAnalysisFieldConfig {
  const fallback = DEFAULT_AI_METADATA_ANALYSIS[field];
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const fieldConfig = value as Partial<Record<keyof AiMetadataAnalysisFieldConfig, unknown>>;
  const prompt =
    typeof fieldConfig.prompt === "string" && fieldConfig.prompt.trim()
      ? fieldConfig.prompt
      : fallback.prompt;

  return {
    enabled: typeof fieldConfig.enabled === "boolean" ? fieldConfig.enabled : fallback.enabled,
    prompt,
  };
}

function resolveAiMetadataAnalysisConfig(value: unknown): AiMetadataAnalysisConfig {
  const config =
    value && typeof value === "object"
      ? (value as Partial<Record<AiMetadataAnalysisField, unknown>>)
      : {};

  return {
    filename: resolveAiMetadataAnalysisField("filename", config.filename),
    tags: resolveAiMetadataAnalysisField("tags", config.tags),
    description: resolveAiMetadataAnalysisField("description", config.description),
    rating: resolveAiMetadataAnalysisField("rating", config.rating),
  };
}

export function loadAiConfig(state: AppState): AiMetadataConfig {
  const raw = getSetting(state.db, "aiConfig");
  if (!raw) throw new Error("请先在设置中填写 AI 配置");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const endpoint = (parsed.metadata as Record<string, unknown> | undefined) ?? {};
  const baseUrl = String(endpoint.baseUrl ?? parsed.baseUrl ?? "https://api.openai.com/v1").trim();
  const apiKey = String(endpoint.apiKey ?? parsed.apiKey ?? "").trim();
  const model = String(endpoint.model ?? parsed.multimodalModel ?? "").trim();
  if (!baseUrl || !apiKey) throw new Error("图片元数据分析配置不完整，请填写 Base URL 和 API Key");
  if (!model) throw new Error("图片元数据分析配置不完整，请填写模型");
  return { baseUrl, apiKey, model, analysis: resolveAiMetadataAnalysisConfig(endpoint.analysis) };
}

export function hasEnabledAiMetadataAnalysisFields(state: AppState): boolean {
  try {
    const config = loadAiConfig(state);
    return AI_METADATA_FIELDS.some((field) => config.analysis[field].enabled);
  } catch {
    return false;
  }
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

function enabledAiMetadataFields(config: AiMetadataAnalysisConfig): AiMetadataAnalysisField[] {
  return AI_METADATA_FIELDS.filter((field) => config[field].enabled);
}

function buildAiMetadataJsonShape(fields: AiMetadataAnalysisField[]): string {
  const lines = ["{"];
  fields.forEach((field, index) => {
    const comma = index === fields.length - 1 ? "" : ",";
    if (field === "filename") {
      lines.push(`  "filename": "string"${comma}`);
    } else if (field === "tags") {
      lines.push(`  "tags": ["string"]${comma}`);
    } else if (field === "description") {
      lines.push(`  "description": "string"${comma}`);
    } else {
      lines.push(`  "rating": 4${comma}`);
    }
  });
  lines.push("}");
  return lines.join("\n");
}

function buildAiMetadataPrompt(
  file: FileRecord,
  analysis: AiMetadataAnalysisConfig,
  existingTags: string,
): string {
  const fields = enabledAiMetadataFields(analysis);
  if (fields.length === 0) {
    throw new Error("请先在设置中至少启用一个 AI 元数据字段");
  }

  const sections = [
    "你是素材库整理助手。请根据图片内容和提供的信息整理素材元数据。",
    "要求：\n- 只返回合法 JSON。\n- 不要输出解释。\n- 不要编造图片中不可见或原数据中没有的信息。\n- 中文优先。",
  ];
  const sourceLines: string[] = [];

  if (analysis.filename.enabled) {
    sourceLines.push(`当前文件名：${file.name}`);
  }
  if (analysis.tags.enabled) {
    sourceLines.push(`当前已有标签：${file.tags.map((tag) => tag.name).join("、") || "无"}`);
    sourceLines.push(`可复用标签池：${existingTags}`);
  }
  if (analysis.description.enabled) {
    sourceLines.push(`当前备注：${file.description.trim() || "无"}`);
  }
  if (analysis.rating.enabled) {
    sourceLines.push(`当前评价：${file.rating > 0 ? `${file.rating} 分` : "无"}`);
  }

  if (sourceLines.length > 0) {
    sections.push(`可用原数据：\n${sourceLines.join("\n")}`);
  }

  sections.push(`需要生成的 JSON 格式：\n${buildAiMetadataJsonShape(fields)}`);

  for (const field of fields) {
    const title =
      field === "filename"
        ? "文件名规则"
        : field === "tags"
          ? "标签规则"
          : field === "description"
            ? "备注规则"
            : "评价规则";
    sections.push(`${title}：\n${analysis[field].prompt.trim()}`);
  }

  return sections.join("\n\n");
}

function parseAiMetadataSuggestion(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI 响应不是有效 JSON");
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizeSuggestedTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tagName = String(item ?? "").trim();
    const key = tagName.toLowerCase();
    if (!tagName || seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tagName.slice(0, 32));
    if (tags.length >= 5) {
      break;
    }
  }
  return tags;
}

function normalizeSuggestedRating(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rating = Math.round(parsed);
  return rating >= 1 && rating <= 5 ? rating : fallback;
}

function isFileConflictError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

async function moveFileWithoutOverwrite(from: string, to: string): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) {
    return;
  }

  try {
    await fs.link(from, to);
    await fs.rm(from, { force: true });
    return;
  } catch (linkError) {
    if (isFileConflictError(linkError)) {
      throw linkError;
    }
  }

  await fs.copyFile(from, to, fssync.constants.COPYFILE_EXCL);
  await fs.rm(from, { force: true });
}

async function moveFileToAiName(
  state: AppState,
  fileId: number,
  oldPath: string,
  nextName: string,
): Promise<void> {
  const targetDir = path.dirname(oldPath);
  const ext = path.extname(nextName);
  const stem = path.basename(nextName, ext);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidateName =
      attempt === 0 ? nextName : `${stem}_ai_${Date.now().toString(16)}_${attempt}${ext}`;
    const desiredPath = path.join(targetDir, candidateName);
    const nextPath = await resolveAvailableTargetPath(
      state.db,
      desiredPath,
      targetDir,
      fileId,
      "ai",
      path.resolve(desiredPath) === path.resolve(oldPath),
    );

    if (path.resolve(nextPath) === path.resolve(oldPath)) {
      return;
    }

    try {
      await moveFileWithoutOverwrite(oldPath, nextPath);
      updateFileNameRecord(state.db, fileId, path.basename(nextPath), nextPath);
      return;
    } catch (error) {
      if (isFileConflictError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("AI 重命名失败：无法生成不重名的文件名");
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
  const enabledFields = enabledAiMetadataFields(config.analysis);
  if (enabledFields.length === 0) {
    throw new Error("请先在设置中至少启用一个 AI 元数据字段");
  }
  const existingTags = config.analysis.tags.enabled
    ? getAllTags(state.db)
        .slice(0, 200)
        .map((tag) => tag.name)
        .join("、") || "无"
    : "";
  const prompt = buildAiMetadataPrompt(file, config.analysis, existingTags);
  const payload = await postAiJson(config, {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          "你是素材库整理助手。请根据图片内容生成适合真实素材库的元数据。只返回 JSON，不要输出额外解释。",
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
  const suggestion = parseAiMetadataSuggestion(text);
  const oldPath = file.path;
  const ext = path.extname(oldPath);
  if (config.analysis.filename.enabled) {
    const nextStem = sanitizeFilenameStem(
      String(suggestion.filename ?? ""),
      path.basename(file.name, ext),
    );
    const nextName = `${nextStem}${ext}`;
    await moveFileToAiName(state, fileId, oldPath, nextName);
  }

  if (config.analysis.description.enabled || config.analysis.rating.enabled) {
    const suggestedDescription = String(suggestion.description ?? "").trim();
    updateFileMetadata(
      state.db,
      fileId,
      config.analysis.rating.enabled
        ? normalizeSuggestedRating(suggestion.rating, file.rating)
        : file.rating,
      config.analysis.description.enabled && suggestedDescription
        ? suggestedDescription.slice(0, 200)
        : file.description,
      file.sourceUrl,
    );
  }

  if (config.analysis.tags.enabled) {
    const suggestedTags = normalizeSuggestedTags(suggestion.tags);
    if (suggestedTags.length > 0) {
      for (const tag of file.tags) {
        removeTagFromFile(state.db, fileId, tag.id);
      }

      const existing = new Map(
        getAllTags(state.db).map((tag) => [tag.name.trim().toLowerCase(), tag.id]),
      );
      for (const tagName of suggestedTags) {
        const key = tagName.toLowerCase();
        const tagId =
          existing.get(key) ?? createTag(state.db, tagName, pickTagColor(tagName), null);
        existing.set(key, tagId);
        addTagToFile(state.db, fileId, tagId);
      }
    }
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
  void enqueueAiMetadataJob(() => runAiMetadataTask(state, window, id, unique));
  return snapshot;
}

async function runAiMetadataTask(
  state: AppState,
  window: BrowserWindow | null,
  id: string,
  fileIds: number[],
): Promise<void> {
  const entry = state.aiMetadataTasks.get(id);
  if (!entry) return;
  if (entry.cancelled) {
    entry.snapshot.status = "cancelled";
    emit(window, "ai-metadata-task-updated", id);
    return;
  }

  entry.snapshot.status = "running";
  emit(window, "ai-metadata-task-updated", id);
  const maxRetries = 3;
  for (const [index, fileId] of fileIds.entries()) {
    if (entry.cancelled) {
      entry.snapshot.status = "cancelled";
      emit(window, "ai-metadata-task-updated", id);
      return;
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const file = await analyzeFileMetadata(state, fileId);
        entry.snapshot.successCount += 1;
        entry.snapshot.results.push({
          index,
          fileId,
          status: "completed",
          attempts: attempt,
          error: null,
          file,
        });
        emit(window, "file-updated", { fileId });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    if (lastError) {
      entry.snapshot.failureCount += 1;
      entry.snapshot.results.push({
        index,
        fileId,
        status: "failed",
        attempts: maxRetries,
        error: lastError instanceof Error ? lastError.message : String(lastError),
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
}
