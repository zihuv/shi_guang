import { utilityProcess, type UtilityProcess } from "electron";
import log from "electron-log/main";
import crypto from "node:crypto";
import path from "node:path";
import { createClipRuntimeKey, type ClipRuntimeSnapshot } from "./clip-runtime.js";
import type { VisualModelValidationResult, VisualSearchConfig } from "./index.js";

const VISUAL_INDEX_UTILITY_IDLE_MS = 15_000;

type EncodeTextRequest = {
  type: "encode_text";
  id: string;
  config: VisualSearchConfig;
  validation: VisualModelValidationResult;
  query: string;
};

type EncodeImageRequest = {
  type: "encode_image";
  id: string;
  config: VisualSearchConfig;
  validation: VisualModelValidationResult;
  filePath: string;
};

type UtilityRequest = EncodeTextRequest | EncodeImageRequest;

type EncodeSuccess = {
  type: "encode_text_result" | "encode_image_result";
  id: string;
  embedding: Float32Array | number[];
  runtimeSnapshot: ClipRuntimeSnapshot;
};

type EncodeFailure = {
  type: "encode_text_error" | "encode_image_error";
  id: string;
  error: string;
  runtimeSnapshot: ClipRuntimeSnapshot | null;
};

type PendingRequest = {
  resolve: (embedding: Float32Array) => void;
  reject: (error: Error) => void;
};

const idleRuntimeSnapshot: ClipRuntimeSnapshot = {
  runtimeLoaded: false,
  runtimeMode: "uninitialized",
  effectiveProvider: null,
  runtimeReason: null,
};

let visualIndexUtility: UtilityProcess | null = null;
let visualIndexUtilityKey: string | null = null;
let visualIndexUtilitySpawnPromise: Promise<UtilityProcess> | null = null;
let visualIndexUtilityIdleTimer: ReturnType<typeof setTimeout> | null = null;
let visualIndexUtilitySuspended = false;
const pendingRequests = new Map<string, PendingRequest>();
const runtimeSnapshots = new Map<string, ClipRuntimeSnapshot>();

function utilityModulePath(): string {
  return path.join(__dirname, "visual-index-utility.cjs");
}

function clearVisualIndexUtilityIdleTimer(): void {
  if (!visualIndexUtilityIdleTimer) {
    return;
  }
  clearTimeout(visualIndexUtilityIdleTimer);
  visualIndexUtilityIdleTimer = null;
}

function scheduleVisualIndexUtilityIdleStop(): void {
  clearVisualIndexUtilityIdleTimer();
  if (pendingRequests.size > 0 || !visualIndexUtility || !visualIndexUtility.pid) {
    return;
  }
  visualIndexUtilityIdleTimer = setTimeout(() => {
    resetVisualIndexUtility("视觉索引后台进程空闲后已停止。");
  }, VISUAL_INDEX_UTILITY_IDLE_MS);
  visualIndexUtilityIdleTimer.unref?.();
}

function resetVisualIndexUtility(reason: string): void {
  clearVisualIndexUtilityIdleTimer();
  for (const [requestId, pending] of pendingRequests) {
    pending.reject(new Error(reason));
    pendingRequests.delete(requestId);
  }

  if (visualIndexUtilityKey) {
    runtimeSnapshots.delete(visualIndexUtilityKey);
  }

  if (visualIndexUtility) {
    visualIndexUtility.removeAllListeners();
    if (visualIndexUtility.pid) {
      visualIndexUtility.kill();
    }
  }

  visualIndexUtility = null;
  visualIndexUtilityKey = null;
  visualIndexUtilitySpawnPromise = null;
}

function attachVisualIndexUtilityListeners(child: UtilityProcess): void {
  child.on("message", (message: EncodeSuccess | EncodeFailure) => {
    if (!message || typeof message !== "object" || typeof message.id !== "string") {
      return;
    }

    if (visualIndexUtilityKey && "runtimeSnapshot" in message && message.runtimeSnapshot) {
      runtimeSnapshots.set(visualIndexUtilityKey, message.runtimeSnapshot);
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(message.id);

    if (message.type === "encode_text_result" || message.type === "encode_image_result") {
      const embedding =
        message.embedding instanceof Float32Array
          ? message.embedding
          : new Float32Array(message.embedding);
      pending.resolve(embedding);
      scheduleVisualIndexUtilityIdleStop();
      return;
    }

    const failure = message as EncodeFailure;
    pending.reject(new Error(failure.error));
    scheduleVisualIndexUtilityIdleStop();
  });

  child.on("exit", (code) => {
    const reason =
      code === 0 ? "视觉索引后台进程已退出。" : `视觉索引后台进程异常退出（code=${code}）。`;
    resetVisualIndexUtility(reason);
  });

  child.on("error", (_type, location) => {
    log.error("[visual-search] utility process fatal error", { location });
  });

  child.stderr?.on("data", (chunk) => {
    log.warn("[visual-search] utility stderr", String(chunk).trim());
  });
}

function waitForUtilitySpawn(child: UtilityProcess): Promise<UtilityProcess> {
  if (child.pid) {
    return Promise.resolve(child);
  }

  return new Promise<UtilityProcess>((resolve, reject) => {
    const handleSpawn = () => {
      child.off("exit", handleExit);
      resolve(child);
    };
    const handleExit = (code: number) => {
      child.off("spawn", handleSpawn);
      reject(new Error(`视觉索引后台进程启动失败（code=${code}）。`));
    };

    child.once("spawn", handleSpawn);
    child.once("exit", handleExit);
  });
}

async function ensureVisualIndexUtility(
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
): Promise<UtilityProcess> {
  if (visualIndexUtilitySuspended) {
    throw new Error("视觉索引后台服务已暂停。");
  }

  if (!validation.normalizedModelPath) {
    throw new Error("模型路径无效，无法启动视觉索引后台进程。");
  }

  const runtimeKey = createClipRuntimeKey(config.runtime, validation.normalizedModelPath);
  clearVisualIndexUtilityIdleTimer();
  if (visualIndexUtility && visualIndexUtilityKey === runtimeKey) {
    if (visualIndexUtility.pid) {
      return visualIndexUtility;
    }
    if (visualIndexUtilitySpawnPromise) {
      return visualIndexUtilitySpawnPromise;
    }
  }

  if (visualIndexUtility && visualIndexUtilityKey !== runtimeKey) {
    resetVisualIndexUtility("视觉索引运行时配置已变更，正在重启后台进程。");
  }

  const child = utilityProcess.fork(utilityModulePath(), [], {
    stdio: "pipe",
  });
  visualIndexUtility = child;
  visualIndexUtilityKey = runtimeKey;
  runtimeSnapshots.set(runtimeKey, idleRuntimeSnapshot);
  attachVisualIndexUtilityListeners(child);
  visualIndexUtilitySpawnPromise = waitForUtilitySpawn(child).finally(() => {
    visualIndexUtilitySpawnPromise = null;
  });
  return visualIndexUtilitySpawnPromise;
}

function sendUtilityRequest(
  request: UtilityRequest,
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
): Promise<Float32Array> {
  return ensureVisualIndexUtility(config, validation).then(
    (child) =>
      new Promise<Float32Array>((resolve, reject) => {
        pendingRequests.set(request.id, { resolve, reject });
        child.postMessage(request);
      }),
  );
}

export function getVisualIndexUtilitySnapshot(
  config: VisualSearchConfig,
  normalizedModelPath: string,
): ClipRuntimeSnapshot {
  const runtimeKey = createClipRuntimeKey(config.runtime, normalizedModelPath);
  return runtimeSnapshots.get(runtimeKey) ?? idleRuntimeSnapshot;
}

export function stopVisualIndexUtility(): void {
  resetVisualIndexUtility("视觉索引后台进程已停止。");
}

export function setVisualIndexUtilitySuspended(suspended: boolean): void {
  visualIndexUtilitySuspended = suspended;
  if (suspended) {
    resetVisualIndexUtility("视觉索引后台进程已暂停。");
  }
}

export function isVisualIndexUtilitySuspended(): boolean {
  return visualIndexUtilitySuspended;
}

export function encodeVisualSearchTextInUtility(
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
  query: string,
): Promise<Float32Array> {
  return sendUtilityRequest(
    {
      type: "encode_text",
      id: crypto.randomUUID(),
      config,
      validation,
      query,
    },
    config,
    validation,
  );
}

export function encodeVisualSearchImageInUtility(
  config: VisualSearchConfig,
  validation: VisualModelValidationResult,
  filePath: string,
): Promise<Float32Array> {
  return sendUtilityRequest(
    {
      type: "encode_image",
      id: crypto.randomUUID(),
      config,
      validation,
      filePath,
    },
    config,
    validation,
  );
}
