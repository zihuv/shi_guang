import {
  DEFAULT_AI_METADATA_ANALYSIS,
  type AiMetadataAnalysisConfig,
  type AiMetadataAnalysisField,
  type AiMetadataAnalysisFieldConfig,
} from "@/lib/aiMetadataDefaults";

export type {
  AiMetadataAnalysisConfig,
  AiMetadataAnalysisField,
  AiMetadataAnalysisFieldConfig,
} from "@/lib/aiMetadataDefaults";

export type LibraryViewMode = "grid" | "list" | "adaptive";
export type LibraryVisibleField = "name" | "ext" | "size" | "dimensions" | "tags";
const LIBRARY_VISIBLE_FIELDS_VERSION = 2;

export const DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED = 1;
export const PREVIEW_TRACKPAD_ZOOM_SPEED_MIN = 0.2;
export const PREVIEW_TRACKPAD_ZOOM_SPEED_MAX = 3;
export const PREVIEW_TRACKPAD_ZOOM_SPEED_STEP = 0.1;
export const DEFAULT_LIBRARY_VIEW_MODE: LibraryViewMode = "grid";
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_DETAIL_PANEL_WIDTH = 288;
export const MIN_SIDEBAR_WIDTH = 120;
export const MAX_SIDEBAR_WIDTH = 420;
export const MIN_DETAIL_PANEL_WIDTH = 160;
export const MAX_DETAIL_PANEL_WIDTH = 560;
export const DEFAULT_LIBRARY_VISIBLE_FIELDS: LibraryVisibleField[] = [
  "name",
  "ext",
  "size",
  "dimensions",
  "tags",
];
export const LIBRARY_VIEW_SCALE_STEP = 0.02;
const SHARED_TILE_VIEW_SCALE_MIN = 0.5;
const SHARED_TILE_VIEW_SCALE_MAX = 1.8;
export const DEFAULT_LIBRARY_VIEW_SCALES: Record<LibraryViewMode, number> = {
  grid: 1,
  list: 1,
  adaptive: 1,
};

const LIBRARY_VIEW_SCALE_LIMITS: Record<LibraryViewMode, { min: number; max: number }> = {
  grid: { min: SHARED_TILE_VIEW_SCALE_MIN, max: SHARED_TILE_VIEW_SCALE_MAX },
  list: { min: 0.82, max: 1.8 },
  adaptive: { min: SHARED_TILE_VIEW_SCALE_MIN, max: SHARED_TILE_VIEW_SCALE_MAX },
};

export type AiConfigTarget = "metadata";

export interface AiServiceConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  analysis: AiMetadataAnalysisConfig;
}

export interface AiConfig {
  metadata: AiServiceConfig;
}

export type VisualSearchRuntimeDevice = "auto" | "cpu" | "gpu";
export type VisualSearchProviderPolicy = "auto" | "interactive" | "service";
export type VisualSearchRuntimeThreadConfig = "auto" | number;

export interface VisualSearchRuntimeConfig {
  device: VisualSearchRuntimeDevice;
  providerPolicy: VisualSearchProviderPolicy;
  intraThreads: VisualSearchRuntimeThreadConfig;
  fgclipMaxPatches: number | null;
}

export interface VisualSearchConfig {
  enabled: boolean;
  modelPath: string;
  autoVectorizeOnImport: boolean;
  processUnindexedOnly: boolean;
  runtime: VisualSearchRuntimeConfig;
}

export interface PanelLayout {
  sidebarWidth: number;
  detailPanelWidth: number;
  isSidebarCollapsed: boolean;
  isDetailPanelCollapsed: boolean;
}

export const DEFAULT_AI_SERVICE_CONFIG: AiServiceConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  analysis: cloneAiMetadataAnalysisConfig(DEFAULT_AI_METADATA_ANALYSIS),
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  metadata: { ...DEFAULT_AI_SERVICE_CONFIG },
};

export const DEFAULT_VISUAL_SEARCH_CONFIG: VisualSearchConfig = {
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

export function cloneAiConfig(config: AiConfig): AiConfig {
  return {
    metadata: {
      ...config.metadata,
      analysis: cloneAiMetadataAnalysisConfig(config.metadata.analysis),
    },
  };
}

export function cloneAiMetadataAnalysisConfig(
  config: AiMetadataAnalysisConfig,
): AiMetadataAnalysisConfig {
  return {
    filename: { ...config.filename },
    tags: { ...config.tags },
    description: { ...config.description },
    rating: { ...config.rating },
  };
}

export function cloneVisualSearchConfig(config: VisualSearchConfig): VisualSearchConfig {
  return {
    enabled: config.enabled,
    modelPath: config.modelPath,
    autoVectorizeOnImport: config.autoVectorizeOnImport,
    processUnindexedOnly: config.processUnindexedOnly,
    runtime: {
      device: config.runtime.device,
      providerPolicy: config.runtime.providerPolicy,
      intraThreads: config.runtime.intraThreads,
      fgclipMaxPatches: config.runtime.fgclipMaxPatches,
    },
  };
}

export function clampPreviewTrackpadZoomSpeed(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED;
  }

  const clamped = Math.max(
    PREVIEW_TRACKPAD_ZOOM_SPEED_MIN,
    Math.min(PREVIEW_TRACKPAD_ZOOM_SPEED_MAX, value),
  );
  return Number(
    (
      Math.round(clamped / PREVIEW_TRACKPAD_ZOOM_SPEED_STEP) * PREVIEW_TRACKPAD_ZOOM_SPEED_STEP
    ).toFixed(1),
  );
}

function resolveOptionalPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.round(parsed);
  return normalized > 0 ? normalized : null;
}

function resolveOptionalFgclipMaxPatches(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  const normalized = resolveOptionalPositiveInteger(value);
  if (normalized == null) {
    return DEFAULT_VISUAL_SEARCH_CONFIG.runtime.fgclipMaxPatches;
  }
  return [128, 256, 576, 784, 1024].includes(normalized)
    ? normalized
    : DEFAULT_VISUAL_SEARCH_CONFIG.runtime.fgclipMaxPatches;
}

function resolveVisualSearchRuntimeDevice(value: unknown): VisualSearchRuntimeDevice {
  if (value === "cpu" || value === "gpu" || value === "auto") {
    return value;
  }
  return DEFAULT_VISUAL_SEARCH_CONFIG.runtime.device;
}

function resolveVisualSearchProviderPolicy(value: unknown): VisualSearchProviderPolicy {
  if (value === "auto" || value === "interactive" || value === "service") {
    return value;
  }
  return DEFAULT_VISUAL_SEARCH_CONFIG.runtime.providerPolicy;
}

function resolveVisualSearchRuntimeThreads(value: unknown): VisualSearchRuntimeThreadConfig {
  if (typeof value === "string" && value.trim().toLowerCase() === "auto") {
    return "auto";
  }

  const normalized = resolveOptionalPositiveInteger(value);
  if (normalized != null) {
    return normalized;
  }

  return DEFAULT_VISUAL_SEARCH_CONFIG.runtime.intraThreads;
}

export function isLibraryViewMode(value: unknown): value is LibraryViewMode {
  return value === "grid" || value === "list" || value === "adaptive";
}

function isLibraryVisibleField(value: unknown): value is LibraryVisibleField {
  return (
    value === "name" ||
    value === "ext" ||
    value === "size" ||
    value === "dimensions" ||
    value === "tags"
  );
}

export function isSharedTileViewMode(viewMode: LibraryViewMode) {
  return viewMode === "grid" || viewMode === "adaptive";
}

export function clampLibraryViewScale(viewMode: LibraryViewMode, value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIBRARY_VIEW_SCALES[viewMode];
  }

  const limits = LIBRARY_VIEW_SCALE_LIMITS[viewMode];
  const clamped = Math.max(limits.min, Math.min(limits.max, value));
  return Number(
    (Math.round(clamped / LIBRARY_VIEW_SCALE_STEP) * LIBRARY_VIEW_SCALE_STEP).toFixed(2),
  );
}

export function getLibraryViewScaleRange(viewMode: LibraryViewMode) {
  return LIBRARY_VIEW_SCALE_LIMITS[viewMode];
}

export function clampSidebarWidth(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value)));
}

export function clampDetailPanelWidth(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_DETAIL_PANEL_WIDTH;
  }

  return Math.round(Math.max(MIN_DETAIL_PANEL_WIDTH, Math.min(MAX_DETAIL_PANEL_WIDTH, value)));
}

export function resolveLibraryViewScales(value?: Partial<Record<LibraryViewMode, unknown>>) {
  const tileScaleSource = value?.grid !== undefined ? Number(value.grid) : Number(value?.adaptive);
  const tileScale = clampLibraryViewScale("grid", tileScaleSource);

  return {
    grid: tileScale,
    list: clampLibraryViewScale("list", Number(value?.list)),
    adaptive: tileScale,
  };
}

export function resolveLibraryVisibleFields(value: unknown, version?: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_LIBRARY_VISIBLE_FIELDS];
  }

  const fields = value.filter(isLibraryVisibleField);
  if (version === LIBRARY_VISIBLE_FIELDS_VERSION) {
    return [...fields];
  }

  if (!fields.includes("tags")) {
    fields.push("tags");
  }
  return [...fields];
}

export function serializeLibraryViewPreferences(
  mode: LibraryViewMode,
  scales: Record<LibraryViewMode, number>,
  visibleFields: LibraryVisibleField[],
) {
  return JSON.stringify({
    mode,
    scales,
    visibleFields,
    visibleFieldsVersion: LIBRARY_VISIBLE_FIELDS_VERSION,
  });
}

export function resolvePanelLayout(value: unknown): PanelLayout {
  if (!value || typeof value !== "object") {
    return {
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      detailPanelWidth: DEFAULT_DETAIL_PANEL_WIDTH,
      isSidebarCollapsed: false,
      isDetailPanelCollapsed: false,
    };
  }

  const layout = value as Partial<Record<keyof PanelLayout, unknown>>;
  return {
    sidebarWidth: clampSidebarWidth(Number(layout.sidebarWidth)),
    detailPanelWidth: clampDetailPanelWidth(Number(layout.detailPanelWidth)),
    isSidebarCollapsed: layout.isSidebarCollapsed === true,
    isDetailPanelCollapsed: layout.isDetailPanelCollapsed === true,
  };
}

export function serializePanelLayout(
  sidebarWidth: number,
  detailPanelWidth: number,
  isSidebarCollapsed: boolean,
  isDetailPanelCollapsed: boolean,
) {
  return JSON.stringify({
    sidebarWidth,
    detailPanelWidth,
    isSidebarCollapsed,
    isDetailPanelCollapsed,
  });
}

export function resolveAiConfig(value: unknown): AiConfig {
  if (!value || typeof value !== "object") {
    return cloneAiConfig(DEFAULT_AI_CONFIG);
  }

  const config = value as Record<string, unknown>;
  const resolveAnalysisField = (
    field: AiMetadataAnalysisField,
    value: unknown,
  ): AiMetadataAnalysisFieldConfig => {
    const defaultField = DEFAULT_AI_SERVICE_CONFIG.analysis[field];
    if (!value || typeof value !== "object") {
      return { ...defaultField };
    }

    const fieldConfig = value as Partial<Record<keyof AiMetadataAnalysisFieldConfig, unknown>>;
    const prompt =
      typeof fieldConfig.prompt === "string" && fieldConfig.prompt.trim()
        ? fieldConfig.prompt
        : defaultField.prompt;

    return {
      enabled:
        typeof fieldConfig.enabled === "boolean" ? fieldConfig.enabled : defaultField.enabled,
      prompt,
    };
  };

  const resolveAnalysisConfig = (value: unknown): AiMetadataAnalysisConfig => {
    const analysisConfig =
      value && typeof value === "object"
        ? (value as Partial<Record<AiMetadataAnalysisField, unknown>>)
        : {};

    return {
      filename: resolveAnalysisField("filename", analysisConfig.filename),
      tags: resolveAnalysisField("tags", analysisConfig.tags),
      description: resolveAnalysisField("description", analysisConfig.description),
      rating: resolveAnalysisField("rating", analysisConfig.rating),
    };
  };

  const resolveServiceConfig = (
    serviceValue: unknown,
    legacyModelKey?: string,
  ): AiServiceConfig => {
    const serviceConfig =
      serviceValue && typeof serviceValue === "object"
        ? (serviceValue as Partial<Record<keyof AiServiceConfig, unknown>>)
        : null;

    const legacyBaseUrl = typeof config.baseUrl === "string" ? config.baseUrl : "";
    const legacyApiKey = typeof config.apiKey === "string" ? config.apiKey : "";
    const legacyModel =
      legacyModelKey && typeof config[legacyModelKey] === "string"
        ? (config[legacyModelKey] as string)
        : "";

    return {
      baseUrl:
        typeof serviceConfig?.baseUrl === "string" && serviceConfig.baseUrl.trim()
          ? serviceConfig.baseUrl
          : legacyBaseUrl.trim()
            ? legacyBaseUrl
            : DEFAULT_AI_SERVICE_CONFIG.baseUrl,
      apiKey: typeof serviceConfig?.apiKey === "string" ? serviceConfig.apiKey : legacyApiKey,
      model: typeof serviceConfig?.model === "string" ? serviceConfig.model : legacyModel,
      analysis: resolveAnalysisConfig(serviceConfig?.analysis),
    };
  };

  return {
    metadata: resolveServiceConfig(config.metadata, "multimodalModel"),
  };
}

export function resolveVisualSearchConfig(value: unknown): VisualSearchConfig {
  if (!value || typeof value !== "object") {
    return cloneVisualSearchConfig(DEFAULT_VISUAL_SEARCH_CONFIG);
  }

  const config = value as Partial<Record<keyof VisualSearchConfig, unknown>>;
  const runtimeValue =
    config.runtime && typeof config.runtime === "object"
      ? (config.runtime as Partial<Record<keyof VisualSearchRuntimeConfig, unknown>>)
      : null;
  return {
    enabled: Boolean(config.enabled),
    modelPath: typeof config.modelPath === "string" ? config.modelPath : "",
    autoVectorizeOnImport: Boolean(config.autoVectorizeOnImport),
    processUnindexedOnly:
      typeof config.processUnindexedOnly === "boolean"
        ? config.processUnindexedOnly
        : DEFAULT_VISUAL_SEARCH_CONFIG.processUnindexedOnly,
    runtime: {
      device: resolveVisualSearchRuntimeDevice(runtimeValue?.device),
      providerPolicy: resolveVisualSearchProviderPolicy(runtimeValue?.providerPolicy),
      intraThreads: resolveVisualSearchRuntimeThreads(runtimeValue?.intraThreads),
      fgclipMaxPatches: resolveOptionalFgclipMaxPatches(runtimeValue?.fgclipMaxPatches),
    },
  };
}
