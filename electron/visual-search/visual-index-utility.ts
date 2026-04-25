import log from "electron-log/main";
import type { MessagePort } from "node:worker_threads";
import {
  encodeVisualSearchImage,
  encodeVisualSearchText,
  getCachedVisualRuntimeSnapshot,
  type VisualModelValidationResult,
  type VisualSearchConfig,
} from "./index.js";

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

type UtilityResponse =
  | {
      type: "encode_text_result" | "encode_image_result";
      id: string;
      embedding: Float32Array;
      runtimeSnapshot: ReturnType<typeof getRuntimeSnapshot>;
    }
  | {
      type: "encode_text_error" | "encode_image_error";
      id: string;
      error: string;
      runtimeSnapshot: ReturnType<typeof getRuntimeSnapshot>;
    };

type UtilityProcessWithParentPort = NodeJS.Process & {
  parentPort?: MessagePort;
};

const parentPort = (process as UtilityProcessWithParentPort).parentPort;

function getRuntimeSnapshot(config: VisualSearchConfig, validation: VisualModelValidationResult) {
  if (!validation.normalizedModelPath) {
    return {
      runtimeLoaded: false,
      runtimeMode: "uninitialized" as const,
      effectiveProvider: null,
      runtimeReason: null,
    };
  }
  return getCachedVisualRuntimeSnapshot(config, validation.normalizedModelPath);
}

function isUtilityRequest(value: unknown): value is UtilityRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UtilityRequest>;
  if (candidate.type === "encode_text") {
    return typeof candidate.id === "string" && typeof candidate.query === "string";
  }
  if (candidate.type === "encode_image") {
    return typeof candidate.id === "string" && typeof candidate.filePath === "string";
  }
  return false;
}

if (!parentPort) {
  throw new Error("视觉索引后台进程缺少 parentPort。");
}

let queue = Promise.resolve();

async function handleRequest(message: UtilityRequest): Promise<void> {
  try {
    const embedding =
      message.type === "encode_text"
        ? await encodeVisualSearchText(message.config, message.validation, message.query)
        : await encodeVisualSearchImage(message.config, message.validation, message.filePath);
    parentPort?.postMessage({
      type: message.type === "encode_text" ? "encode_text_result" : "encode_image_result",
      id: message.id,
      embedding,
      runtimeSnapshot: getRuntimeSnapshot(message.config, message.validation),
    } satisfies UtilityResponse);
  } catch (error) {
    parentPort?.postMessage({
      type: message.type === "encode_text" ? "encode_text_error" : "encode_image_error",
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
      runtimeSnapshot: getRuntimeSnapshot(message.config, message.validation),
    } satisfies UtilityResponse);
  }
}

parentPort.on("message", (event) => {
  const message = event?.data;
  if (!isUtilityRequest(message)) {
    return;
  }

  queue = queue
    .then(async () => {
      await handleRequest(message);
    })
    .catch((error) => {
      log.error("[visual-search] utility request failed", error);
    });
});
