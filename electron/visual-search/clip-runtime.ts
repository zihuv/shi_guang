import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Tokenizer as HuggingFaceTokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import { BertWordPieceTokenizer } from "./bert-wordpiece.js";
import {
  readFlatManifest,
  type ClipEffectiveProvider,
  type ClipModelValidationResult,
  type ClipRuntimeConfig,
  type ClipRuntimeSnapshot,
} from "./clip-manifest.js";
import {
  encodeChineseClipImage,
  encodeChineseClipText,
  encodeFgClipImage,
  encodeFgClipText,
} from "./clip-encoders.js";
import {
  readF32File,
  resolveFgClipMaxPatches,
  resolveTokenEmbeddingRows,
} from "./clip-runtime-data.js";
import type {
  ClipImageRuntime,
  ClipTextRuntime,
  OrtExecutionProvider,
  ProviderAttempt,
  ResolvedClipModel,
  RuntimeHandle,
} from "./clip-runtime-model.js";

export {
  buildClipValidationResult,
  missingFilesForManifest,
  readFlatManifest,
  validateFlatClipManifest,
  type ClipEffectiveProvider,
  type ClipModelValidationResult,
  type ClipProviderPolicy,
  type ClipRuntimeConfig,
  type ClipRuntimeDevice,
  type ClipRuntimeSnapshot,
  type ClipRuntimeThreadConfig,
  type FlatManifest,
} from "./clip-manifest.js";

const CLIP_RUNTIME_IDLE_RELEASE_MS = 30_000;

let runtimeHandle: RuntimeHandle | null = null;
let runtimePromise: Promise<RuntimeHandle> | null = null;
let runtimePromiseKey: string | null = null;
let runtimeReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeInvalidationToken = 0;
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

export function getCachedClipRuntimeSnapshot(
  config: ClipRuntimeConfig,
  normalizedModelPath: string,
): ClipRuntimeSnapshot {
  const runtimeKey = createClipRuntimeKey(config, normalizedModelPath);
  if (runtimeHandle && runtimeHandle.key === runtimeKey) {
    if (
      runtimeHandle.textSession ||
      runtimeHandle.imageSession ||
      runtimeHandle.textSessionPromise ||
      runtimeHandle.imageSessionPromise
    ) {
      return {
        ...lastRuntimeSnapshot,
        runtimeMode: lastRuntimeSnapshot.runtimeLoaded
          ? lastRuntimeSnapshot.runtimeMode
          : "uninitialized",
      };
    }
    return cpuOnlyRuntimeSnapshot(lastRuntimeSnapshot.runtimeReason, false);
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
  try {
    const [textRuntime, textSession] = await Promise.all([
      ensureTextRuntime(runtime, validation),
      ensureSession(runtime, config, "text"),
    ]);
    if (textRuntime.kind === "fg_clip") {
      return encodeFgClipText(runtime.model, textRuntime, textSession, query);
    }
    return encodeChineseClipText(runtime.model, textRuntime, textSession, query);
  } finally {
    scheduleClipRuntimeRelease(runtime.key);
  }
}

export async function encodeClipImage(
  config: ClipRuntimeConfig,
  validation: ClipModelValidationResult,
  filePath: string,
): Promise<Float32Array> {
  const runtime = await loadClipRuntime(config, validation);
  try {
    const [imageRuntime, imageSession] = await Promise.all([
      ensureImageRuntime(runtime, config, validation),
      ensureSession(runtime, config, "image"),
    ]);
    if (imageRuntime.kind === "fg_clip") {
      return encodeFgClipImage(runtime.model, imageRuntime, imageSession, filePath);
    }
    return encodeChineseClipImage(runtime.model, imageSession, filePath);
  } finally {
    scheduleClipRuntimeRelease(runtime.key);
  }
}

export { embeddingToBuffer } from "./clip-runtime-data.js";

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
  clearClipRuntimeReleaseTimer();
  if (runtimeHandle && runtimeHandle.key === runtimeKey) {
    return runtimeHandle;
  }
  if (runtimePromise && runtimePromiseKey === runtimeKey) {
    return runtimePromise;
  }

  if (runtimeHandle && runtimeHandle.key !== runtimeKey) {
    await releaseRuntimeHandle(runtimeHandle);
    runtimeHandle = null;
  }

  runtimePromiseKey = runtimeKey;
  const invalidationToken = runtimeInvalidationToken;
  const loadPromise = (async () => {
    const model = await resolveModel(validation.normalizedModelPath);
    if (invalidationToken !== runtimeInvalidationToken) {
      throw new Error("视觉搜索运行时在加载期间已释放。");
    }

    const handle: RuntimeHandle = {
      key: runtimeKey,
      model,
      providerAttempt: null,
      textRuntime: null,
      textRuntimePromise: null,
      imageRuntime: null,
      imageRuntimePromise: null,
      textSession: null,
      textSessionPromise: null,
      imageSession: null,
      imageSessionPromise: null,
    };

    runtimeHandle = handle;
    return handle;
  })();
  runtimePromise = loadPromise;

  try {
    return await loadPromise;
  } catch (error) {
    if (runtimePromise === loadPromise) {
      runtimeHandle = null;
      lastRuntimeSnapshot = cpuOnlyRuntimeSnapshot(
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
    throw error;
  } finally {
    if (runtimePromise === loadPromise) {
      runtimePromise = null;
      runtimePromiseKey = null;
    }
  }
}

function clearClipRuntimeReleaseTimer(): void {
  if (!runtimeReleaseTimer) {
    return;
  }
  clearTimeout(runtimeReleaseTimer);
  runtimeReleaseTimer = null;
}

function scheduleClipRuntimeRelease(runtimeKey: string): void {
  clearClipRuntimeReleaseTimer();
  runtimeReleaseTimer = setTimeout(() => {
    if (!runtimeHandle || runtimeHandle.key !== runtimeKey || runtimePromise) {
      return;
    }
    void releaseClipRuntime("视觉搜索运行时空闲后已释放。");
  }, CLIP_RUNTIME_IDLE_RELEASE_MS);
  runtimeReleaseTimer.unref?.();
}

export async function releaseClipRuntime(
  reason: string | null = "视觉搜索运行时已释放。",
): Promise<void> {
  clearClipRuntimeReleaseTimer();
  runtimeInvalidationToken += 1;
  runtimePromise = null;
  runtimePromiseKey = null;

  const currentHandle = runtimeHandle;
  runtimeHandle = null;

  if (currentHandle) {
    await releaseRuntimeHandle(currentHandle);
  }

  if (reason !== undefined) {
    lastRuntimeSnapshot = cpuOnlyRuntimeSnapshot(reason, false);
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

function runtimeWasInvalidated(handle: RuntimeHandle, invalidationToken: number): boolean {
  return invalidationToken !== runtimeInvalidationToken || runtimeHandle !== handle;
}

async function releaseLoadedSessions(handle: RuntimeHandle): Promise<void> {
  const textSession = handle.textSession;
  const imageSession = handle.imageSession;
  handle.textSession = null;
  handle.imageSession = null;
  handle.providerAttempt = null;
  await textSession?.release().catch(() => undefined);
  await imageSession?.release().catch(() => undefined);
}

async function releaseRuntimeHandle(handle: RuntimeHandle): Promise<void> {
  await releaseLoadedSessions(handle);
  handle.textRuntime = null;
  handle.textRuntimePromise = null;
  handle.imageRuntime = null;
  handle.imageRuntimePromise = null;
  handle.textSessionPromise = null;
  handle.imageSessionPromise = null;
}

async function createSessionWithAttempt(
  modelPath: string,
  config: ClipRuntimeConfig,
  attempt: ProviderAttempt,
): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(
    modelPath,
    sessionOptionsForProviders(config, attempt.providers),
  );
}

async function createClipSession(
  modelPath: string,
  config: ClipRuntimeConfig,
): Promise<{
  session: ort.InferenceSession;
  attempt: ProviderAttempt;
  runtimeSnapshot: ClipRuntimeSnapshot;
}> {
  const attempts = providerAttempts(config);
  let lastError: unknown = null;
  for (const [index, attempt] of attempts.entries()) {
    try {
      const session = await createSessionWithAttempt(modelPath, config, attempt);
      const fallbackDetail =
        index > 0 && lastError instanceof Error ? `原因：${lastError.message}` : null;
      return {
        session,
        attempt,
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

async function loadTextRuntime(model: ResolvedClipModel): Promise<ClipTextRuntime> {
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
  if (!tokenEmbedding || !model.tokenEmbeddingPath) {
    throw new Error("fg_clip 模型目录缺少 token embedding。");
  }

  const tokenEmbeddingDtype = tokenEmbedding.dtype === "f32" ? "f32" : "f16";
  const tokenEmbeddingRows = await resolveTokenEmbeddingRows(
    model.tokenEmbeddingPath,
    tokenEmbeddingDtype,
    tokenEmbedding.embedding_dim,
  );
  const tokenizerJson = JSON.parse(await fs.readFile(model.tokenizerPath, "utf8")) as object;
  return {
    kind: "fg_clip",
    tokenizer: new HuggingFaceTokenizer(tokenizerJson, {}),
    tokenEmbeddingPath: model.tokenEmbeddingPath,
    tokenEmbeddingRows,
    tokenEmbeddingDtype,
    tokenEmbeddingDim: tokenEmbedding.embedding_dim,
  };
}

async function loadImageRuntime(
  config: ClipRuntimeConfig,
  model: ResolvedClipModel,
): Promise<ClipImageRuntime> {
  if (model.manifest.family === "chinese_clip") {
    return { kind: "chinese_clip" };
  }

  if (model.manifest.family !== "fg_clip") {
    throw new Error(`当前 Electron 版本暂不支持 ${model.manifest.family}。`);
  }

  const preprocess = model.manifest.image.preprocess;
  if (preprocess.kind !== "fgclip_patch_tokens") {
    throw new Error("fg_clip 模型目录缺少 vision position embedding。");
  }
  if (!model.visionPosEmbeddingPath) {
    throw new Error("fg_clip 模型目录缺少 vision position embedding。");
  }

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

  return {
    kind: "fg_clip",
    tokenEmbeddingDim: model.manifest.embedding_dim,
    defaultMaxPatches,
    patchSize: preprocess.patch_size ?? 0,
    basePosEmbedding,
    baseGridHeight: side,
    baseGridWidth: side,
  };
}

async function ensureTextRuntime(
  handle: RuntimeHandle,
  validation: ClipModelValidationResult,
): Promise<ClipTextRuntime> {
  if (handle.textRuntime) {
    return handle.textRuntime;
  }
  if (handle.textRuntimePromise) {
    return handle.textRuntimePromise;
  }

  const invalidationToken = runtimeInvalidationToken;
  const loadPromise = (async () => {
    const textRuntime = await loadTextRuntime(handle.model);
    if (runtimeWasInvalidated(handle, invalidationToken)) {
      throw new Error("视觉搜索文本运行时在加载期间已释放。");
    }
    return textRuntime;
  })();
  handle.textRuntimePromise = loadPromise;

  try {
    const textRuntime = await loadPromise;
    if (handle.textRuntimePromise === loadPromise) {
      handle.textRuntime = textRuntime;
    }
    return textRuntime;
  } catch (error) {
    if (handle.textRuntimePromise === loadPromise) {
      lastRuntimeSnapshot = cpuOnlyRuntimeSnapshot(
        error instanceof Error ? error.message : validation.message,
        false,
      );
    }
    throw error;
  } finally {
    if (handle.textRuntimePromise === loadPromise) {
      handle.textRuntimePromise = null;
    }
  }
}

async function ensureImageRuntime(
  handle: RuntimeHandle,
  config: ClipRuntimeConfig,
  validation: ClipModelValidationResult,
): Promise<ClipImageRuntime> {
  if (handle.imageRuntime) {
    return handle.imageRuntime;
  }
  if (handle.imageRuntimePromise) {
    return handle.imageRuntimePromise;
  }

  const invalidationToken = runtimeInvalidationToken;
  const loadPromise = (async () => {
    const imageRuntime = await loadImageRuntime(config, handle.model);
    if (runtimeWasInvalidated(handle, invalidationToken)) {
      throw new Error("视觉搜索图片运行时在加载期间已释放。");
    }
    return imageRuntime;
  })();
  handle.imageRuntimePromise = loadPromise;

  try {
    const imageRuntime = await loadPromise;
    if (handle.imageRuntimePromise === loadPromise) {
      handle.imageRuntime = imageRuntime;
    }
    return imageRuntime;
  } catch (error) {
    if (handle.imageRuntimePromise === loadPromise) {
      lastRuntimeSnapshot = cpuOnlyRuntimeSnapshot(
        error instanceof Error ? error.message : validation.message,
        false,
      );
    }
    throw error;
  } finally {
    if (handle.imageRuntimePromise === loadPromise) {
      handle.imageRuntimePromise = null;
    }
  }
}

async function ensureSession(
  handle: RuntimeHandle,
  config: ClipRuntimeConfig,
  kind: "text" | "image",
): Promise<ort.InferenceSession> {
  const currentSession = kind === "text" ? handle.textSession : handle.imageSession;
  if (currentSession) {
    return currentSession;
  }

  const currentPromise = kind === "text" ? handle.textSessionPromise : handle.imageSessionPromise;
  if (currentPromise) {
    return currentPromise;
  }

  const modelPath = kind === "text" ? handle.model.textModelPath : handle.model.imageModelPath;
  const invalidationToken = runtimeInvalidationToken;
  const loadPromise = (async () => {
    if (handle.providerAttempt) {
      try {
        const session = await createSessionWithAttempt(modelPath, config, handle.providerAttempt);
        if (runtimeWasInvalidated(handle, invalidationToken)) {
          await session.release().catch(() => undefined);
          throw new Error("视觉搜索会话在加载期间已释放。");
        }
        return session;
      } catch {
        await releaseLoadedSessions(handle);
      }
    }

    const { session, attempt, runtimeSnapshot } = await createClipSession(modelPath, config);
    if (runtimeWasInvalidated(handle, invalidationToken)) {
      await session.release().catch(() => undefined);
      throw new Error("视觉搜索会话在加载期间已释放。");
    }
    handle.providerAttempt = attempt;
    lastRuntimeSnapshot = runtimeSnapshot;
    return session;
  })();

  if (kind === "text") {
    handle.textSessionPromise = loadPromise;
  } else {
    handle.imageSessionPromise = loadPromise;
  }

  try {
    const session = await loadPromise;
    if (kind === "text") {
      if (handle.textSessionPromise === loadPromise) {
        handle.textSession = session;
      }
    } else if (handle.imageSessionPromise === loadPromise) {
      handle.imageSession = session;
    }
    return session;
  } catch (error) {
    if (kind === "text") {
      if (handle.textSessionPromise === loadPromise) {
        handle.textSession = null;
      }
    } else if (handle.imageSessionPromise === loadPromise) {
      handle.imageSession = null;
    }
    if (!handle.textSession && !handle.imageSession) {
      lastRuntimeSnapshot = cpuOnlyRuntimeSnapshot(
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
    throw error;
  } finally {
    if (kind === "text") {
      if (handle.textSessionPromise === loadPromise) {
        handle.textSessionPromise = null;
      }
    } else if (handle.imageSessionPromise === loadPromise) {
      handle.imageSessionPromise = null;
    }
  }
}

function resolveIntraThreads(config: ClipRuntimeConfig): number | undefined {
  if (typeof config.intraThreads === "number") {
    return config.intraThreads;
  }
  return Math.max(1, os.cpus().length);
}
