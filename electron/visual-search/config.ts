import path from "node:path";
import type { ClipRuntimeConfig } from "./clip-runtime.js";

export type VisualSearchRuntimeDevice = "auto" | "cpu" | "gpu";
export type VisualSearchProviderPolicy = "auto" | "interactive" | "service";
export type VisualSearchRuntimeThreadConfig = "auto" | number;

export interface VisualSearchConfig {
  enabled: boolean;
  modelPath: string;
  autoVectorizeOnImport: boolean;
  processUnindexedOnly: boolean;
  runtime: ClipRuntimeConfig;
}

const DEFAULT_VISUAL_SEARCH_CONFIG: VisualSearchConfig = {
  enabled: false,
  modelPath: "",
  autoVectorizeOnImport: false,
  processUnindexedOnly: true,
  runtime: {
    device: "cpu",
    providerPolicy: "interactive",
    intraThreads: 4,
    fgclipMaxPatches: 256,
  },
};

function isVisualSearchRuntimeDevice(value: unknown): value is VisualSearchRuntimeDevice {
  return value === "auto" || value === "cpu" || value === "gpu";
}

function isVisualSearchProviderPolicy(value: unknown): value is VisualSearchProviderPolicy {
  return value === "auto" || value === "interactive" || value === "service";
}

function resolvePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

function resolveRuntimeThreads(value: unknown): VisualSearchRuntimeThreadConfig {
  if (typeof value === "string" && value.trim().toLowerCase() === "auto") {
    return "auto";
  }
  return resolvePositiveInteger(value) ?? DEFAULT_VISUAL_SEARCH_CONFIG.runtime.intraThreads;
}

function resolveRuntimeFgclipMaxPatches(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return resolvePositiveInteger(value) ?? DEFAULT_VISUAL_SEARCH_CONFIG.runtime.fgclipMaxPatches;
}

export function resolveVisualSearchConfig(raw: string | null): VisualSearchConfig {
  if (!raw) {
    return structuredClone(DEFAULT_VISUAL_SEARCH_CONFIG);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VisualSearchConfig>;
    const runtime = (parsed.runtime ?? {}) as Partial<ClipRuntimeConfig>;
    return {
      enabled: parsed.enabled === true,
      modelPath: typeof parsed.modelPath === "string" ? parsed.modelPath : "",
      autoVectorizeOnImport: parsed.autoVectorizeOnImport === true,
      processUnindexedOnly:
        typeof parsed.processUnindexedOnly === "boolean"
          ? parsed.processUnindexedOnly
          : DEFAULT_VISUAL_SEARCH_CONFIG.processUnindexedOnly,
      runtime: {
        device: isVisualSearchRuntimeDevice(runtime.device)
          ? runtime.device
          : DEFAULT_VISUAL_SEARCH_CONFIG.runtime.device,
        providerPolicy: isVisualSearchProviderPolicy(runtime.providerPolicy)
          ? runtime.providerPolicy
          : DEFAULT_VISUAL_SEARCH_CONFIG.runtime.providerPolicy,
        intraThreads: resolveRuntimeThreads(runtime.intraThreads),
        fgclipMaxPatches: resolveRuntimeFgclipMaxPatches(runtime.fgclipMaxPatches),
      },
    };
  } catch {
    return structuredClone(DEFAULT_VISUAL_SEARCH_CONFIG);
  }
}

function normalizeVisualSearchModelPath(modelPath: string): string {
  const trimmed = modelPath.trim().replace(/^["']|["']$/g, "");
  return trimmed ? path.resolve(trimmed) : "";
}

export function getVisualSearchEmbeddingConfigKey(config: VisualSearchConfig): string {
  return JSON.stringify({
    modelPath: normalizeVisualSearchModelPath(config.modelPath),
    fgclipMaxPatches: config.runtime.fgclipMaxPatches ?? null,
  });
}

export function isVisualSearchEmbeddingConfigChanged(
  previousRaw: string | null,
  nextRaw: string | null,
): boolean {
  return (
    getVisualSearchEmbeddingConfigKey(resolveVisualSearchConfig(previousRaw)) !==
    getVisualSearchEmbeddingConfigKey(resolveVisualSearchConfig(nextRaw))
  );
}
