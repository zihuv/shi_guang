import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {
  buildClipValidationResult,
  cpuOnlyRuntimeSnapshot,
  createClipRuntimeKey,
  embeddingToBuffer,
  encodeClipImage,
  encodeClipText,
  getCachedClipRuntimeSnapshot,
  missingFilesForManifest,
  normalizeModelPath,
  releaseClipRuntime,
  readFlatManifest,
  validateFlatClipManifest,
  type ClipModelValidationResult,
  type ClipRuntimeSnapshot,
} from "./clip-runtime.js";
export {
  resolveVisualSearchConfig,
  type VisualSearchConfig,
  type VisualSearchProviderPolicy,
  type VisualSearchRuntimeDevice,
  type VisualSearchRuntimeThreadConfig,
} from "./config.js";
import type { VisualSearchConfig } from "./config.js";

export interface VisualModelValidationResult extends ClipModelValidationResult {}
export interface VisualRuntimeSnapshot extends ClipRuntimeSnapshot {}

export async function validateVisualModelPath(
  modelPath: string,
): Promise<VisualModelValidationResult> {
  const normalizedModelPath = normalizeModelPath(modelPath);
  if (!normalizedModelPath) {
    return buildClipValidationResult(
      false,
      "请先选择包含 model_config.json 的模型目录。",
      "",
      null,
      [],
    );
  }

  let stats: fssync.Stats;
  try {
    stats = await fs.stat(normalizedModelPath);
  } catch {
    return buildClipValidationResult(false, "模型目录不存在。", normalizedModelPath, null, [
      "model_config.json",
    ]);
  }

  if (!stats.isDirectory()) {
    return buildClipValidationResult(false, "模型路径不是目录。", normalizedModelPath, null, [
      "model_config.json",
    ]);
  }

  const manifestPath = path.join(normalizedModelPath, "model_config.json");
  if (!fssync.existsSync(manifestPath)) {
    return buildClipValidationResult(false, "未找到 model_config.json", normalizedModelPath, null, [
      "model_config.json",
    ]);
  }

  let manifest: Awaited<ReturnType<typeof readFlatManifest>>;
  try {
    manifest = await readFlatManifest(normalizedModelPath);
  } catch (error) {
    return buildClipValidationResult(
      false,
      `模型配置解析失败: ${error instanceof Error ? error.message : String(error)}`,
      normalizedModelPath,
      null,
      [],
    );
  }

  const missingFiles = missingFilesForManifest(normalizedModelPath, manifest);
  if (missingFiles.length > 0) {
    return buildClipValidationResult(
      false,
      "模型目录不完整，缺少必需文件。",
      normalizedModelPath,
      manifest,
      missingFiles,
    );
  }

  return validateFlatClipManifest(manifest, normalizedModelPath);
}

export async function getRecommendedVisualModelPath(): Promise<string | null> {
  const directCandidates = [
    process.env.SHIGUANG_VISUAL_MODEL_DIR ?? "",
    path.resolve(process.cwd(), ".debug-models", "fgclip2_flat"),
    path.resolve(process.cwd(), ".debug-models", "chinese_clip_flat"),
    path.resolve(process.cwd(), "models", "fgclip2_flat"),
    path.resolve(process.cwd(), "models", "chinese_clip_flat"),
    path.resolve(process.cwd(), "..", "..", "omni_search", "models", "fgclip2_flat"),
    path.resolve(process.cwd(), "..", "..", "omni_search", "models", "chinese_clip_flat"),
  ];

  const scanRoots = [
    path.resolve(process.cwd(), ".debug-models"),
    path.resolve(process.cwd(), "models"),
    path.resolve(process.cwd(), "..", "..", "omni_search", "models"),
  ];

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const candidate of directCandidates) {
    const normalized = normalizeModelPath(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  }

  for (const root of scanRoots) {
    if (!fssync.existsSync(root)) {
      continue;
    }
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const candidate = path.join(root, entry.name);
        const normalized = normalizeModelPath(candidate);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          candidates.push(normalized);
        }
      }
    } catch {
      // Ignore unreadable directories and continue scanning other candidates.
    }
  }

  for (const candidate of candidates) {
    const validation = await validateVisualModelPath(candidate);
    if (validation.valid) {
      return validation.normalizedModelPath;
    }
  }

  return null;
}

export function getCachedVisualRuntimeSnapshot(
  config: VisualSearchConfig,
  normalizedModelPath: string,
): VisualRuntimeSnapshot {
  const runtimeKey = createClipRuntimeKey(config.runtime, normalizedModelPath);
  if (!runtimeKey) {
    return cpuOnlyRuntimeSnapshot(null, false);
  }
  return getCachedClipRuntimeSnapshot(config.runtime, normalizedModelPath);
}

export async function encodeVisualSearchText(
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
  query: string,
): Promise<Float32Array> {
  return encodeClipText(config.runtime, validation, query);
}

export async function encodeVisualSearchImage(
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
  filePath: string,
): Promise<Float32Array> {
  return encodeClipImage(config.runtime, validation, filePath);
}

export async function releaseVisualSearchRuntime(reason?: string | null): Promise<void> {
  await releaseClipRuntime(reason);
}

export { embeddingToBuffer };
