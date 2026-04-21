import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { Tokenizer as HuggingFaceTokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { BertWordPieceTokenizer } from "./bert-wordpiece.js";

export type ClipRuntimeDevice = "auto" | "cpu" | "gpu";
export type ClipProviderPolicy = "auto" | "interactive" | "service";
export type ClipRuntimeThreadConfig = "auto" | number;
export type ClipEffectiveProvider = "tensorrt" | "cuda" | "direct_ml" | "core_ml" | "cpu";
type OrtExecutionProvider = "cpu" | "dml" | "coreml";

export interface ClipRuntimeConfig {
  device: ClipRuntimeDevice;
  providerPolicy: ClipProviderPolicy;
  intraThreads: ClipRuntimeThreadConfig;
  fgclipMaxPatches: number | null;
}

export interface ClipModelValidationResult {
  valid: boolean;
  message: string;
  normalizedModelPath: string;
  modelId: string | null;
  version: string | null;
  embeddingDim: number | null;
  contextLength: number | null;
  missingFiles: string[];
}

export interface ClipRuntimeSnapshot {
  runtimeLoaded: boolean;
  runtimeMode: "uninitialized" | "cpu_only" | "gpu_enabled" | "mixed" | "unknown" | null;
  effectiveProvider: ClipEffectiveProvider | null;
  runtimeReason: string | null;
}

export type FlatManifest = {
  format: string;
  schema_version: number;
  family: "chinese_clip" | "fg_clip" | "open_clip" | string;
  model_id: string;
  model_revision?: string;
  embedding_dim: number;
  normalize_output?: boolean;
  text: {
    onnx: string;
    output_name: string;
    tokenizer: string;
    context_length: number;
    input:
      | {
          kind: "bert_like";
          input_ids_name: string;
          attention_mask_name: string;
          token_type_ids_name?: string;
        }
      | {
          kind: "token_embeds";
        }
      | {
          kind: string;
          input_ids_name?: string;
          attention_mask_name?: string;
          token_type_ids_name?: string;
        };
    token_embedding?: {
      file: string;
      dtype: "f16" | "f32" | string;
      embedding_dim: number;
    };
  };
  image: {
    onnx: string;
    output_name: string;
    preprocess:
      | {
          kind: "clip_image";
          image_size: number;
          resize_shortest_edge?: number;
          crop?: "none" | "center";
          mean: number[];
          std: number[];
        }
      | {
          kind: "fgclip_patch_tokens";
          patch_size: number;
          default_max_patches: number;
          vision_pos_embedding: string;
        }
      | {
          kind: string;
          image_size?: number;
          resize_shortest_edge?: number;
          crop?: "none" | "center";
          mean?: number[];
          std?: number[];
          patch_size?: number;
          default_max_patches?: number;
          vision_pos_embedding?: string;
        };
  };
};

type ResolvedClipModel = {
  manifest: FlatManifest;
  normalizedModelPath: string;
  textModelPath: string;
  imageModelPath: string;
  tokenizerPath: string;
  tokenEmbeddingPath: string | null;
  visionPosEmbeddingPath: string | null;
};

type ChineseClipRuntime = {
  kind: "chinese_clip";
  tokenizer: BertWordPieceTokenizer;
};

type FgClipRuntime = {
  kind: "fg_clip";
  tokenizer: HuggingFaceTokenizer;
  tokenEmbeddingPath: string;
  tokenEmbeddingRows: number;
  tokenEmbeddingDtype: "f16" | "f32";
  tokenEmbeddingDim: number;
  defaultMaxPatches: number;
  patchSize: number;
  basePosEmbedding: Float32Array;
  baseGridHeight: number;
  baseGridWidth: number;
};

type RuntimeHandle = {
  key: string;
  model: ResolvedClipModel;
  textSession: ort.InferenceSession;
  imageSession: ort.InferenceSession;
  familyRuntime: ChineseClipRuntime | FgClipRuntime;
  runtimeSnapshot: ClipRuntimeSnapshot;
};

type ProviderAttempt = {
  providers: OrtExecutionProvider[];
  effectiveProvider: ClipEffectiveProvider;
  runtimeMode: ClipRuntimeSnapshot["runtimeMode"];
  reason: string;
};

type FgClipImageInputs = {
  pixelValues: Float32Array;
  pixelAttentionMask: Int32Array;
  posEmbed: Float32Array;
  maxPatches: number;
  channels: number;
};

const SUPPORTED_FGCLIP_PATCH_BUCKETS = [128, 256, 576, 784, 1024];

let runtimeHandle: RuntimeHandle | null = null;
let runtimePromise: Promise<RuntimeHandle> | null = null;
let runtimePromiseKey: string | null = null;
let lastRuntimeSnapshot: ClipRuntimeSnapshot = {
  runtimeLoaded: false,
  runtimeMode: "uninitialized",
  effectiveProvider: null,
  runtimeReason: null,
};

export function normalizeModelPath(modelPath: string): string {
  const trimmed = modelPath.trim().replace(/^["']|["']$/g, "");
  return trimmed ? path.resolve(trimmed) : "";
}

export function createClipRuntimeKey(
  config: ClipRuntimeConfig,
  normalizedModelPath: string,
): string {
  const threads = typeof config.intraThreads === "number" ? String(config.intraThreads) : "auto";
  return [
    normalizedModelPath,
    config.device,
    config.providerPolicy,
    threads,
    String(config.fgclipMaxPatches ?? ""),
  ].join("|");
}

export function cpuOnlyRuntimeSnapshot(
  reason: string | null,
  runtimeLoaded: boolean,
): ClipRuntimeSnapshot {
  return {
    runtimeLoaded,
    runtimeMode: runtimeLoaded ? "cpu_only" : "uninitialized",
    effectiveProvider: runtimeLoaded ? "cpu" : null,
    runtimeReason: reason,
  };
}

function providerSnapshot(
  effectiveProvider: ClipEffectiveProvider,
  runtimeMode: ClipRuntimeSnapshot["runtimeMode"],
  reason: string | null,
): ClipRuntimeSnapshot {
  return {
    runtimeLoaded: true,
    runtimeMode,
    effectiveProvider,
    runtimeReason: reason,
  };
}

export async function readFlatManifest(modelPath: string): Promise<FlatManifest> {
  return JSON.parse(
    await fs.readFile(path.join(modelPath, "model_config.json"), "utf8"),
  ) as FlatManifest;
}

export function missingFilesForManifest(modelPath: string, manifest: FlatManifest): string[] {
  const required = [
    "model_config.json",
    manifest.text.onnx,
    manifest.image.onnx,
    manifest.text.tokenizer,
  ];

  if (manifest.family === "fg_clip") {
    if (manifest.text.token_embedding?.file) {
      required.push(manifest.text.token_embedding.file);
    } else {
      required.push("text.token_embedding.file");
    }
    if (
      manifest.image.preprocess.kind === "fgclip_patch_tokens" &&
      manifest.image.preprocess.vision_pos_embedding
    ) {
      required.push(manifest.image.preprocess.vision_pos_embedding);
    } else {
      required.push("image.preprocess.vision_pos_embedding");
    }
  }

  return required.filter((relativePath) => {
    if (relativePath.includes(".")) {
      return !fssync.existsSync(path.join(modelPath, relativePath));
    }
    return !fssync.existsSync(path.join(modelPath, relativePath));
  });
}

export function buildClipValidationResult(
  valid: boolean,
  message: string,
  normalizedModelPath: string,
  manifest: FlatManifest | null,
  missingFiles: string[],
): ClipModelValidationResult {
  return {
    valid,
    message,
    normalizedModelPath,
    modelId: manifest?.model_id ?? null,
    version: manifest?.model_revision ?? null,
    embeddingDim: manifest?.embedding_dim ?? null,
    contextLength: manifest?.text.context_length ?? null,
    missingFiles,
  };
}

export function validateFlatClipManifest(
  manifest: FlatManifest,
  normalizedModelPath: string,
): ClipModelValidationResult {
  if (manifest.format !== "omni_flat_v1" || manifest.schema_version !== 1) {
    return buildClipValidationResult(
      false,
      "仅支持 omni_flat_v1 / schema_version=1 的平铺模型目录。",
      normalizedModelPath,
      manifest,
      [],
    );
  }

  if (
    !Number.isFinite(manifest.embedding_dim) ||
    manifest.embedding_dim <= 0 ||
    !Number.isFinite(manifest.text.context_length) ||
    manifest.text.context_length <= 2
  ) {
    return buildClipValidationResult(
      false,
      "模型配置缺少有效的 embedding_dim 或 context_length。",
      normalizedModelPath,
      manifest,
      [],
    );
  }

  if (manifest.family === "chinese_clip") {
    if (manifest.text.input.kind !== "bert_like") {
      return buildClipValidationResult(
        false,
        `chinese_clip 需要 bert_like 文本输入，收到 ${manifest.text.input.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (manifest.image.preprocess.kind !== "clip_image") {
      return buildClipValidationResult(
        false,
        `chinese_clip 需要 clip_image 图片预处理，收到 ${manifest.image.preprocess.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    return buildClipValidationResult(
      true,
      `模型目录可用：${manifest.model_id} (${manifest.model_revision ?? "unknown"})`,
      normalizedModelPath,
      manifest,
      [],
    );
  }

  if (manifest.family === "fg_clip") {
    if (manifest.text.input.kind !== "token_embeds") {
      return buildClipValidationResult(
        false,
        `fg_clip 需要 token_embeds 文本输入，收到 ${manifest.text.input.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (manifest.image.preprocess.kind !== "fgclip_patch_tokens") {
      return buildClipValidationResult(
        false,
        `fg_clip 需要 fgclip_patch_tokens 图片预处理，收到 ${manifest.image.preprocess.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (!manifest.text.token_embedding) {
      return buildClipValidationResult(
        false,
        "fg_clip 模型配置缺少 text.token_embedding。",
        normalizedModelPath,
        manifest,
        ["text.token_embedding.file"],
      );
    }
    if (manifest.text.token_embedding.embedding_dim !== manifest.embedding_dim) {
      return buildClipValidationResult(
        false,
        "fg_clip token embedding 维度和模型 embedding_dim 不一致。",
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (
      manifest.text.token_embedding.dtype !== "f16" &&
      manifest.text.token_embedding.dtype !== "f32"
    ) {
      return buildClipValidationResult(
        false,
        `fg_clip token embedding dtype 暂不支持 ${manifest.text.token_embedding.dtype}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    const patchSize = manifest.image.preprocess.patch_size;
    const defaultMaxPatches = manifest.image.preprocess.default_max_patches;
    if ((patchSize ?? 0) <= 0 || (defaultMaxPatches ?? 0) <= 0) {
      return buildClipValidationResult(
        false,
        "fg_clip patch_size 和 default_max_patches 必须大于 0。",
        normalizedModelPath,
        manifest,
        [],
      );
    }
    return buildClipValidationResult(
      true,
      `模型目录可用：${manifest.model_id} (${manifest.model_revision ?? "unknown"})`,
      normalizedModelPath,
      manifest,
      [],
    );
  }

  return buildClipValidationResult(
    false,
    `当前 Electron 版本仅支持 chinese_clip 和 fg_clip，暂不支持 ${manifest.family}。`,
    normalizedModelPath,
    manifest,
    [],
  );
}

export function getCachedClipRuntimeSnapshot(
  config: ClipRuntimeConfig,
  normalizedModelPath: string,
): ClipRuntimeSnapshot {
  const runtimeKey = createClipRuntimeKey(config, normalizedModelPath);
  if (runtimeHandle && runtimeHandle.key === runtimeKey) {
    return runtimeHandle.runtimeSnapshot;
  }
  if (runtimePromiseKey === runtimeKey) {
    return {
      ...lastRuntimeSnapshot,
      runtimeMode: lastRuntimeSnapshot.runtimeLoaded
        ? lastRuntimeSnapshot.runtimeMode
        : "uninitialized",
    };
  }
  return cpuOnlyRuntimeSnapshot(lastRuntimeSnapshot.runtimeReason, false);
}

export async function encodeClipText(
  config: ClipRuntimeConfig,
  validation: ClipModelValidationResult,
  query: string,
): Promise<Float32Array> {
  const runtime = await loadClipRuntime(config, validation);
  if (runtime.familyRuntime.kind === "fg_clip") {
    return encodeFgClipText(runtime, query);
  }
  return encodeChineseClipText(runtime, query);
}

export async function encodeClipImage(
  config: ClipRuntimeConfig,
  validation: ClipModelValidationResult,
  filePath: string,
): Promise<Float32Array> {
  const runtime = await loadClipRuntime(config, validation);
  if (runtime.familyRuntime.kind === "fg_clip") {
    return encodeFgClipImage(runtime, filePath);
  }
  return encodeChineseClipImage(runtime, filePath);
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(embedding.length * 4);
  for (let index = 0; index < embedding.length; index += 1) {
    buffer.writeFloatLE(embedding[index], index * 4);
  }
  return buffer;
}

async function resolveModel(modelPath: string): Promise<ResolvedClipModel> {
  const normalizedModelPath = normalizeModelPath(modelPath);
  const manifest = await readFlatManifest(normalizedModelPath);
  const preprocess = manifest.image.preprocess;
  const tokenEmbeddingPath =
    manifest.family === "fg_clip" && manifest.text.token_embedding?.file
      ? path.join(normalizedModelPath, manifest.text.token_embedding.file)
      : null;
  const visionPosEmbeddingPath =
    manifest.family === "fg_clip" &&
    preprocess.kind === "fgclip_patch_tokens" &&
    preprocess.vision_pos_embedding
      ? path.join(normalizedModelPath, preprocess.vision_pos_embedding)
      : null;

  return {
    manifest,
    normalizedModelPath,
    textModelPath: path.join(normalizedModelPath, manifest.text.onnx),
    imageModelPath: path.join(normalizedModelPath, manifest.image.onnx),
    tokenizerPath: path.join(normalizedModelPath, manifest.text.tokenizer),
    tokenEmbeddingPath,
    visionPosEmbeddingPath,
  };
}

async function loadClipRuntime(
  config: ClipRuntimeConfig,
  validation: ClipModelValidationResult,
): Promise<RuntimeHandle> {
  if (!validation.valid || !validation.normalizedModelPath) {
    throw new Error(validation.message);
  }

  const runtimeKey = createClipRuntimeKey(config, validation.normalizedModelPath);
  if (runtimeHandle && runtimeHandle.key === runtimeKey) {
    return runtimeHandle;
  }
  if (runtimePromise && runtimePromiseKey === runtimeKey) {
    return runtimePromise;
  }

  if (runtimeHandle && runtimeHandle.key !== runtimeKey) {
    await runtimeHandle.textSession.release().catch(() => undefined);
    await runtimeHandle.imageSession.release().catch(() => undefined);
    runtimeHandle = null;
  }

  runtimePromiseKey = runtimeKey;
  runtimePromise = (async () => {
    const model = await resolveModel(validation.normalizedModelPath);
    const familyRuntime = await loadFamilyRuntime(config, model);
    const sessions = await createClipSessions(model, config);

    const handle: RuntimeHandle = {
      key: runtimeKey,
      model,
      textSession: sessions.textSession,
      imageSession: sessions.imageSession,
      familyRuntime,
      runtimeSnapshot: sessions.runtimeSnapshot,
    };

    runtimeHandle = handle;
    lastRuntimeSnapshot = sessions.runtimeSnapshot;
    return handle;
  })();

  try {
    return await runtimePromise;
  } catch (error) {
    runtimeHandle = null;
    lastRuntimeSnapshot = cpuOnlyRuntimeSnapshot(
      error instanceof Error ? error.message : String(error),
      false,
    );
    throw error;
  } finally {
    runtimePromise = null;
    runtimePromiseKey = null;
  }
}

function listBundledOrtBackends(): Set<string> {
  try {
    return new Set(ort.listSupportedBackends().map((backend) => backend.name));
  } catch {
    return new Set(["cpu"]);
  }
}

function platformAcceleratorProvider(backends = listBundledOrtBackends()): {
  provider: OrtExecutionProvider | null;
  effectiveProvider: ClipEffectiveProvider | null;
  label: string | null;
} {
  if (process.platform === "win32" && backends.has("dml")) {
    return { provider: "dml", effectiveProvider: "direct_ml", label: "DirectML" };
  }
  if (process.platform === "darwin" && process.arch === "arm64" && backends.has("coreml")) {
    return { provider: "coreml", effectiveProvider: "core_ml", label: "CoreML" };
  }
  return { provider: null, effectiveProvider: null, label: null };
}

function providerAttempts(config: ClipRuntimeConfig): ProviderAttempt[] {
  const accelerator = platformAcceleratorProvider();
  if (config.device === "cpu") {
    return [
      {
        providers: ["cpu"],
        effectiveProvider: "cpu",
        runtimeMode: "cpu_only",
        reason: "当前使用 CPU ONNX Runtime。",
      },
    ];
  }

  if (!accelerator.provider || !accelerator.effectiveProvider || !accelerator.label) {
    if (config.device === "gpu") {
      throw new Error("当前平台或 onnxruntime-node 包未提供可用的 GPU 加速 Provider。");
    }
    return [
      {
        providers: ["cpu"],
        effectiveProvider: "cpu",
        runtimeMode: "cpu_only",
        reason: "当前平台未检测到可用 GPU Provider，已使用 CPU ONNX Runtime。",
      },
    ];
  }

  const accelerated: ProviderAttempt = {
    providers: [accelerator.provider, "cpu"],
    effectiveProvider: accelerator.effectiveProvider,
    runtimeMode: "gpu_enabled",
    reason: `当前使用 ${accelerator.label} ONNX Runtime。`,
  };

  if (config.device === "gpu") {
    return [accelerated];
  }

  return [
    accelerated,
    {
      providers: ["cpu"],
      effectiveProvider: "cpu",
      runtimeMode: "cpu_only",
      reason: `${accelerator.label} 初始化失败，已回退到 CPU ONNX Runtime。`,
    },
  ];
}

function sessionOptionsForProviders(
  config: ClipRuntimeConfig,
  executionProviders: OrtExecutionProvider[],
): ort.InferenceSession.SessionOptions {
  return {
    executionProviders,
    graphOptimizationLevel: "all",
    intraOpNumThreads: resolveIntraThreads(config),
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  };
}

async function createSessionsWithAttempt(
  model: ResolvedClipModel,
  config: ClipRuntimeConfig,
  attempt: ProviderAttempt,
): Promise<{ textSession: ort.InferenceSession; imageSession: ort.InferenceSession }> {
  const sessionOptions = sessionOptionsForProviders(config, attempt.providers);
  let textSession: ort.InferenceSession | null = null;
  let imageSession: ort.InferenceSession | null = null;
  try {
    textSession = await ort.InferenceSession.create(model.textModelPath, sessionOptions);
    imageSession = await ort.InferenceSession.create(model.imageModelPath, sessionOptions);
    return { textSession, imageSession };
  } catch (error) {
    await textSession?.release().catch(() => undefined);
    await imageSession?.release().catch(() => undefined);
    throw error;
  }
}

async function createClipSessions(
  model: ResolvedClipModel,
  config: ClipRuntimeConfig,
): Promise<{
  textSession: ort.InferenceSession;
  imageSession: ort.InferenceSession;
  runtimeSnapshot: ClipRuntimeSnapshot;
}> {
  const attempts = providerAttempts(config);
  let lastError: unknown = null;
  for (const [index, attempt] of attempts.entries()) {
    try {
      const sessions = await createSessionsWithAttempt(model, config, attempt);
      const fallbackDetail =
        index > 0 && lastError instanceof Error ? `原因：${lastError.message}` : null;
      return {
        ...sessions,
        runtimeSnapshot: providerSnapshot(
          attempt.effectiveProvider,
          attempt.runtimeMode,
          fallbackDetail ? `${attempt.reason}${fallbackDetail}` : attempt.reason,
        ),
      };
    } catch (error) {
      lastError = error;
      if (config.device === "gpu" || index === attempts.length - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadFamilyRuntime(
  config: ClipRuntimeConfig,
  model: ResolvedClipModel,
): Promise<ChineseClipRuntime | FgClipRuntime> {
  if (model.manifest.family === "chinese_clip") {
    return {
      kind: "chinese_clip",
      tokenizer: await BertWordPieceTokenizer.fromFile(
        model.tokenizerPath,
        model.manifest.text.context_length,
      ),
    };
  }

  if (model.manifest.family !== "fg_clip") {
    throw new Error(`当前 Electron 版本暂不支持 ${model.manifest.family}。`);
  }

  const tokenEmbedding = model.manifest.text.token_embedding;
  const preprocess = model.manifest.image.preprocess;
  if (!tokenEmbedding || !model.tokenEmbeddingPath || preprocess.kind !== "fgclip_patch_tokens") {
    throw new Error("fg_clip 模型目录缺少 token embedding 或 vision position embedding。");
  }
  if (!model.visionPosEmbeddingPath) {
    throw new Error("fg_clip 模型目录缺少 vision position embedding。");
  }

  const tokenEmbeddingDtype = tokenEmbedding.dtype === "f32" ? "f32" : "f16";
  const tokenEmbeddingRows = await resolveTokenEmbeddingRows(
    model.tokenEmbeddingPath,
    tokenEmbeddingDtype,
    tokenEmbedding.embedding_dim,
  );
  const defaultMaxPatches = resolveFgClipMaxPatches(
    preprocess.default_max_patches ?? 0,
    config.fgclipMaxPatches,
  );
  const basePosEmbedding = await readF32File(model.visionPosEmbeddingPath);
  const tokenCount = basePosEmbedding.length / model.manifest.embedding_dim;
  const side = Math.sqrt(tokenCount);
  if (!Number.isInteger(side) || side <= 0) {
    throw new Error(
      `fg_clip vision_pos_embedding 长度异常，无法按 ${model.manifest.embedding_dim} 维组成方形网格。`,
    );
  }

  const tokenizerJson = JSON.parse(await fs.readFile(model.tokenizerPath, "utf8")) as object;
  return {
    kind: "fg_clip",
    tokenizer: new HuggingFaceTokenizer(tokenizerJson, {}),
    tokenEmbeddingPath: model.tokenEmbeddingPath,
    tokenEmbeddingRows,
    tokenEmbeddingDtype,
    tokenEmbeddingDim: tokenEmbedding.embedding_dim,
    defaultMaxPatches,
    patchSize: preprocess.patch_size ?? 0,
    basePosEmbedding,
    baseGridHeight: side,
    baseGridWidth: side,
  };
}

function resolveIntraThreads(config: ClipRuntimeConfig): number | undefined {
  if (typeof config.intraThreads === "number") {
    return config.intraThreads;
  }
  return Math.max(1, os.cpus().length);
}

function resolveFgClipMaxPatches(
  manifestDefaultMaxPatches: number,
  runtimeOverride: number | null,
): number {
  if (runtimeOverride == null) {
    return manifestDefaultMaxPatches;
  }
  if (!SUPPORTED_FGCLIP_PATCH_BUCKETS.includes(runtimeOverride)) {
    throw new Error(
      `fgclipMaxPatches 必须是 ${SUPPORTED_FGCLIP_PATCH_BUCKETS.join("、")} 之一，当前为 ${runtimeOverride}。`,
    );
  }
  if (runtimeOverride > manifestDefaultMaxPatches) {
    throw new Error(
      `fgclipMaxPatches ${runtimeOverride} 不能大于模型 default_max_patches ${manifestDefaultMaxPatches}。`,
    );
  }
  return runtimeOverride;
}

async function resolveTokenEmbeddingRows(
  filePath: string,
  dtype: "f16" | "f32",
  embeddingDim: number,
): Promise<number> {
  const stats = await fs.stat(filePath);
  const rowBytes = (dtype === "f16" ? 2 : 4) * embeddingDim;
  if (stats.size % rowBytes !== 0) {
    throw new Error(`fg_clip token embedding 文件长度异常：${stats.size} bytes。`);
  }
  return stats.size / rowBytes;
}

async function readF32File(filePath: string): Promise<Float32Array> {
  const bytes = await fs.readFile(filePath);
  if (bytes.length % 4 !== 0) {
    throw new Error(`${filePath} 的字节数不能被 4 整除。`);
  }
  const values = new Float32Array(bytes.length / 4);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = bytes.readFloatLE(index * 4);
  }
  return values;
}

function f16ToF32(bits: number): number {
  const sign = (bits & 0x8000) << 16;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  let f32Bits: number;

  if (exponent === 0 && fraction === 0) {
    f32Bits = sign;
  } else if (exponent === 0) {
    let normalizedFraction = fraction;
    let normalizedExponent = -14;
    while ((normalizedFraction & 0x0400) === 0) {
      normalizedFraction <<= 1;
      normalizedExponent -= 1;
    }
    normalizedFraction &= 0x03ff;
    f32Bits = sign | ((normalizedExponent + 127) << 23) | (normalizedFraction << 13);
  } else if (exponent === 0x1f) {
    f32Bits = sign | 0x7f800000 | (fraction << 13);
  } else {
    f32Bits = sign | ((exponent + 112) << 23) | (fraction << 13);
  }

  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, f32Bits, true);
  return new DataView(buffer).getFloat32(0, true);
}

async function gatherTokenEmbeddingRows(
  runtime: FgClipRuntime,
  inputIds: Int32Array,
): Promise<Float32Array> {
  const rowBytes = (runtime.tokenEmbeddingDtype === "f16" ? 2 : 4) * runtime.tokenEmbeddingDim;
  const values = new Float32Array(inputIds.length * runtime.tokenEmbeddingDim);
  const handle = await fs.open(runtime.tokenEmbeddingPath, "r");

  try {
    const row = Buffer.allocUnsafe(rowBytes);
    for (let tokenIndex = 0; tokenIndex < inputIds.length; tokenIndex += 1) {
      const tokenId = inputIds[tokenIndex];
      if (tokenId < 0 || tokenId >= runtime.tokenEmbeddingRows) {
        throw new Error(
          `token id ${tokenId} 超出 fg_clip embedding 表范围 ${runtime.tokenEmbeddingRows}。`,
        );
      }

      await handle.read(row, 0, rowBytes, tokenId * rowBytes);
      const outputOffset = tokenIndex * runtime.tokenEmbeddingDim;
      if (runtime.tokenEmbeddingDtype === "f16") {
        for (let index = 0; index < runtime.tokenEmbeddingDim; index += 1) {
          values[outputOffset + index] = f16ToF32(row.readUInt16LE(index * 2));
        }
      } else {
        for (let index = 0; index < runtime.tokenEmbeddingDim; index += 1) {
          values[outputOffset + index] = row.readFloatLE(index * 4);
        }
      }
    }
  } finally {
    await handle.close();
  }

  return values;
}

function encodeFgClipTokenIds(runtime: RuntimeHandle, query: string): Int32Array {
  if (runtime.familyRuntime.kind !== "fg_clip") {
    throw new Error("当前模型不是 fg_clip。");
  }
  const encoded = runtime.familyRuntime.tokenizer.encode(query.toLowerCase(), {
    add_special_tokens: true,
  });
  const contextLength = runtime.model.manifest.text.context_length;
  const inputIds = new Int32Array(contextLength);
  inputIds.fill(0);
  for (let index = 0; index < Math.min(contextLength, encoded.ids.length); index += 1) {
    inputIds[index] = encoded.ids[index];
  }
  return inputIds;
}

function normalizeEmbedding(embedding: Float32Array): Float32Array {
  let sum = 0;
  for (const value of embedding) {
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm <= 0) {
    return embedding;
  }
  const normalized = new Float32Array(embedding.length);
  for (let index = 0; index < embedding.length; index += 1) {
    normalized[index] = embedding[index] / norm;
  }
  return normalized;
}

function flattenTensorData(tensor: ort.Tensor): Float32Array {
  if (!(tensor.data instanceof Float32Array)) {
    throw new Error(`Unsupported tensor output type: ${tensor.type}`);
  }
  return tensor.data.length === 0 ? new Float32Array() : new Float32Array(tensor.data);
}

function extractEmbeddingFromOutput(
  output: ort.InferenceSession.ReturnType[string],
  expectedDimension: number,
  normalizeOutput: boolean,
): Float32Array {
  if (!(output instanceof ort.Tensor)) {
    throw new Error("模型输出不是 Tensor。");
  }
  const embedding = flattenTensorData(output);
  if (embedding.length !== expectedDimension) {
    throw new Error(`模型输出维度异常：期望 ${expectedDimension}，实际 ${embedding.length}。`);
  }
  return normalizeOutput ? normalizeEmbedding(embedding) : embedding;
}

function getSessionInputType(session: ort.InferenceSession, inputName: string): string | undefined {
  const inputIndex = session.inputNames.indexOf(inputName);
  if (inputIndex < 0) {
    return undefined;
  }
  const metadata = session.inputMetadata[inputIndex];
  return metadata?.isTensor ? metadata.type : undefined;
}

function intTensorForType(
  type: string | undefined,
  values: Int32Array,
  dims: readonly number[],
): ort.Tensor {
  if (type === "int64") {
    return new ort.Tensor(
      "int64",
      BigInt64Array.from(values, (value) => BigInt(value)),
      dims,
    );
  }
  return new ort.Tensor("int32", values, dims);
}

async function encodeChineseClipText(runtime: RuntimeHandle, query: string): Promise<Float32Array> {
  if (runtime.familyRuntime.kind !== "chinese_clip") {
    throw new Error("当前模型不是 chinese_clip。");
  }
  if (runtime.model.manifest.text.input.kind !== "bert_like") {
    throw new Error("chinese_clip 文本输入配置无效。");
  }

  const encoded = runtime.familyRuntime.tokenizer.encode(query);
  const textInput = runtime.model.manifest.text.input;
  const inputIdsName = textInput.input_ids_name;
  const attentionMaskName = textInput.attention_mask_name;
  if (!inputIdsName || !attentionMaskName) {
    throw new Error("chinese_clip 文本输入名称配置无效。");
  }
  const inputDims = [1, runtime.model.manifest.text.context_length] as const;
  const inputIdsType = getSessionInputType(runtime.textSession, inputIdsName);
  const attentionMaskType = getSessionInputType(runtime.textSession, attentionMaskName);
  const tokenTypeIdsName = textInput.token_type_ids_name;
  const tokenTypeIdsType = tokenTypeIdsName
    ? getSessionInputType(runtime.textSession, tokenTypeIdsName)
    : undefined;

  const feeds: Record<string, ort.Tensor> = {
    [inputIdsName]: intTensorForType(inputIdsType, encoded.inputIds, inputDims),
    [attentionMaskName]: intTensorForType(attentionMaskType, encoded.attentionMask, inputDims),
  };
  if (tokenTypeIdsName) {
    feeds[tokenTypeIdsName] = intTensorForType(tokenTypeIdsType, encoded.tokenTypeIds, inputDims);
  }

  const outputs = await runtime.textSession.run(feeds as ort.InferenceSession.FeedsType, [
    runtime.model.manifest.text.output_name,
  ]);
  return extractEmbeddingFromOutput(
    outputs[runtime.model.manifest.text.output_name],
    runtime.model.manifest.embedding_dim,
    runtime.model.manifest.normalize_output !== false,
  );
}

async function encodeFgClipText(runtime: RuntimeHandle, query: string): Promise<Float32Array> {
  if (runtime.familyRuntime.kind !== "fg_clip") {
    throw new Error("当前模型不是 fg_clip。");
  }
  const inputIds = encodeFgClipTokenIds(runtime, query);
  const tokenEmbeds = await gatherTokenEmbeddingRows(runtime.familyRuntime, inputIds);
  const feeds: ort.InferenceSession.FeedsType = {
    token_embeds: new ort.Tensor("float32", tokenEmbeds, [
      1,
      runtime.model.manifest.text.context_length,
      runtime.familyRuntime.tokenEmbeddingDim,
    ]),
  };
  const outputs = await runtime.textSession.run(feeds, [runtime.model.manifest.text.output_name]);
  return extractEmbeddingFromOutput(
    outputs[runtime.model.manifest.text.output_name],
    runtime.model.manifest.embedding_dim,
    runtime.model.manifest.normalize_output !== false,
  );
}

async function preprocessChineseClipImage(
  filePath: string,
  manifest: FlatManifest,
): Promise<Float32Array> {
  const preprocess = manifest.image.preprocess;
  if (preprocess.kind !== "clip_image") {
    throw new Error("chinese_clip 图片预处理配置无效。");
  }

  const imageSize = preprocess.image_size;
  if (
    !imageSize ||
    !Array.isArray(preprocess.mean) ||
    !Array.isArray(preprocess.std) ||
    preprocess.mean.length !== 3 ||
    preprocess.std.length !== 3
  ) {
    throw new Error("chinese_clip 图片预处理配置无效。");
  }
  const cropMode = preprocess.crop ?? "none";
  const pipeline = sharp(filePath, { animated: false }).rotate().removeAlpha();
  const resized =
    cropMode === "center"
      ? pipeline.resize(imageSize, imageSize, {
          fit: "cover",
          position: "centre",
        })
      : pipeline.resize(imageSize, imageSize, {
          fit: "fill",
        });

  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  if (info.channels < 3) {
    throw new Error("图像预处理失败：通道数不足。");
  }

  const tensor = new Float32Array(1 * 3 * imageSize * imageSize);
  const planeSize = imageSize * imageSize;
  for (let y = 0; y < imageSize; y += 1) {
    for (let x = 0; x < imageSize; x += 1) {
      const pixelIndex = (y * imageSize + x) * info.channels;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[pixelIndex + channel] / 255;
        tensor[channel * planeSize + y * imageSize + x] =
          (value - preprocess.mean[channel]) / preprocess.std[channel];
      }
    }
  }
  return tensor;
}

async function encodeChineseClipImage(
  runtime: RuntimeHandle,
  filePath: string,
): Promise<Float32Array> {
  const tensor = await preprocessChineseClipImage(filePath, runtime.model.manifest);
  const preprocess = runtime.model.manifest.image.preprocess;
  if (preprocess.kind !== "clip_image") {
    throw new Error("chinese_clip 图片预处理配置无效。");
  }

  const inputName = runtime.imageSession.inputNames[0];
  const feeds: ort.InferenceSession.FeedsType = {
    [inputName]: new ort.Tensor("float32", tensor, [
      1,
      3,
      preprocess.image_size ?? 0,
      preprocess.image_size ?? 0,
    ]),
  };
  const outputs = await runtime.imageSession.run(feeds, [runtime.model.manifest.image.output_name]);
  return extractEmbeddingFromOutput(
    outputs[runtime.model.manifest.image.output_name],
    runtime.model.manifest.embedding_dim,
    runtime.model.manifest.normalize_output !== false,
  );
}

function determineFgClipMaxPatches(
  width: number,
  height: number,
  patchSize: number,
  defaultMaxPatches: number,
): number {
  const raw = Math.floor(width / patchSize) * Math.floor(height / patchSize);
  const buckets = [
    ...SUPPORTED_FGCLIP_PATCH_BUCKETS.filter((item) => item <= defaultMaxPatches),
    defaultMaxPatches,
  ]
    .sort((left, right) => left - right)
    .filter((item, index, values) => index === 0 || item !== values[index - 1]);
  return buckets.find((candidate) => raw <= candidate) ?? defaultMaxPatches;
}

function scaledPatchSize(scale: number, size: number, patchSize: number): number {
  const scaled = size * scale;
  return Math.max(patchSize, Math.ceil(scaled / patchSize) * patchSize);
}

function getFgClipImageSizeForMaxPatches(
  imageHeight: number,
  imageWidth: number,
  patchSize: number,
  maxPatches: number,
): { targetHeight: number; targetWidth: number } {
  const eps = 1e-5;
  let scaleMin = eps / 10;
  let scaleMax = 100;
  while (scaleMax - scaleMin >= eps) {
    const scale = (scaleMin + scaleMax) / 2;
    const targetHeight = scaledPatchSize(scale, imageHeight, patchSize);
    const targetWidth = scaledPatchSize(scale, imageWidth, patchSize);
    const patchCount = (targetHeight / patchSize) * (targetWidth / patchSize);
    if (patchCount <= maxPatches) {
      scaleMin = scale;
    } else {
      scaleMax = scale;
    }
  }
  return {
    targetHeight: scaledPatchSize(scaleMin, imageHeight, patchSize),
    targetWidth: scaledPatchSize(scaleMin, imageWidth, patchSize),
  };
}

function linearSourceCoordinate(
  outputIndex: number,
  outputSize: number,
  inputSize: number,
): number {
  const source = ((outputIndex + 0.5) * inputSize) / outputSize - 0.5;
  return Math.max(0, Math.min(inputSize - 1, source));
}

function lerp(left: number, right: number, weight: number): number {
  return left + (right - left) * weight;
}

function buildFgClipPositionalEmbedding(
  runtime: FgClipRuntime,
  targetHeight: number,
  targetWidth: number,
  maxPatches: number,
): Float32Array {
  const channels = runtime.tokenEmbeddingDim;
  const output = new Float32Array(maxPatches * channels);
  for (let outY = 0; outY < targetHeight; outY += 1) {
    const inY = linearSourceCoordinate(outY, targetHeight, runtime.baseGridHeight);
    const y0 = Math.max(0, Math.min(runtime.baseGridHeight - 1, Math.floor(inY)));
    const y1 = Math.min(y0 + 1, runtime.baseGridHeight - 1);
    const wy = inY - y0;

    for (let outX = 0; outX < targetWidth; outX += 1) {
      const inX = linearSourceCoordinate(outX, targetWidth, runtime.baseGridWidth);
      const x0 = Math.max(0, Math.min(runtime.baseGridWidth - 1, Math.floor(inX)));
      const x1 = Math.min(x0 + 1, runtime.baseGridWidth - 1);
      const wx = inX - x0;
      const token = outY * targetWidth + outX;

      for (let channel = 0; channel < channels; channel += 1) {
        const top = lerp(
          runtime.basePosEmbedding[(y0 * runtime.baseGridWidth + x0) * channels + channel],
          runtime.basePosEmbedding[(y0 * runtime.baseGridWidth + x1) * channels + channel],
          wx,
        );
        const bottom = lerp(
          runtime.basePosEmbedding[(y1 * runtime.baseGridWidth + x0) * channels + channel],
          runtime.basePosEmbedding[(y1 * runtime.baseGridWidth + x1) * channels + channel],
          wx,
        );
        output[token * channels + channel] = lerp(top, bottom, wy);
      }
    }
  }

  const valid = targetHeight * targetWidth;
  if (valid > 0 && valid < maxPatches) {
    const first = output.slice(0, channels);
    for (let token = valid; token < maxPatches; token += 1) {
      output.set(first, token * channels);
    }
  }

  return output;
}

async function preprocessFgClipImage(
  filePath: string,
  runtime: FgClipRuntime,
): Promise<FgClipImageInputs> {
  const metadata = await sharp(filePath, { animated: false }).rotate().metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error("图像预处理失败：无法读取图片尺寸。");
  }

  const maxPatches = determineFgClipMaxPatches(
    originalWidth,
    originalHeight,
    runtime.patchSize,
    runtime.defaultMaxPatches,
  );
  const { targetHeight, targetWidth } = getFgClipImageSizeForMaxPatches(
    originalHeight,
    originalWidth,
    runtime.patchSize,
    maxPatches,
  );
  const { data, info } = await sharp(filePath, { animated: false })
    .rotate()
    .removeAlpha()
    .resize(targetWidth, targetHeight, {
      fit: "fill",
      kernel: "linear",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 3) {
    throw new Error("图像预处理失败：通道数不足。");
  }

  const spatialHeight = targetHeight / runtime.patchSize;
  const spatialWidth = targetWidth / runtime.patchSize;
  const validPatches = spatialHeight * spatialWidth;
  const channels = runtime.patchSize * runtime.patchSize * 3;
  if (validPatches > maxPatches) {
    throw new Error(`fg_clip patch 数异常：${validPatches} > ${maxPatches}。`);
  }

  const pixelValues = new Float32Array(maxPatches * channels);
  for (let patchY = 0; patchY < spatialHeight; patchY += 1) {
    for (let patchX = 0; patchX < spatialWidth; patchX += 1) {
      const patchIndex = patchY * spatialWidth + patchX;
      let dst = patchIndex * channels;
      for (let y = 0; y < runtime.patchSize; y += 1) {
        for (let x = 0; x < runtime.patchSize; x += 1) {
          const pixelIndex =
            ((patchY * runtime.patchSize + y) * targetWidth + (patchX * runtime.patchSize + x)) *
            info.channels;
          for (let channel = 0; channel < 3; channel += 1) {
            pixelValues[dst] = data[pixelIndex + channel] / 127.5 - 1;
            dst += 1;
          }
        }
      }
    }
  }

  const pixelAttentionMask = new Int32Array(maxPatches);
  pixelAttentionMask.fill(0);
  for (let index = 0; index < validPatches; index += 1) {
    pixelAttentionMask[index] = 1;
  }

  return {
    pixelValues,
    pixelAttentionMask,
    posEmbed: buildFgClipPositionalEmbedding(runtime, spatialHeight, spatialWidth, maxPatches),
    maxPatches,
    channels,
  };
}

async function encodeFgClipImage(runtime: RuntimeHandle, filePath: string): Promise<Float32Array> {
  if (runtime.familyRuntime.kind !== "fg_clip") {
    throw new Error("当前模型不是 fg_clip。");
  }
  const inputs = await preprocessFgClipImage(filePath, runtime.familyRuntime);
  const maskType = getSessionInputType(runtime.imageSession, "pixel_attention_mask");
  const feeds: ort.InferenceSession.FeedsType = {
    pixel_values: new ort.Tensor("float32", inputs.pixelValues, [
      1,
      inputs.maxPatches,
      inputs.channels,
    ]),
    pixel_attention_mask: intTensorForType(maskType, inputs.pixelAttentionMask, [
      1,
      inputs.maxPatches,
    ]),
    pos_embed: new ort.Tensor("float32", inputs.posEmbed, [
      1,
      inputs.maxPatches,
      runtime.model.manifest.embedding_dim,
    ]),
  };
  const outputs = await runtime.imageSession.run(feeds, [runtime.model.manifest.image.output_name]);
  return extractEmbeddingFromOutput(
    outputs[runtime.model.manifest.image.output_name],
    runtime.model.manifest.embedding_dim,
    runtime.model.manifest.normalize_output !== false,
  );
}
