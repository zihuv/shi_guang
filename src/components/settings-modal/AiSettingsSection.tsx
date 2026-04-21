import type {
  AiEndpointTarget as TauriAiEndpointTarget,
  VisualIndexStatus,
  VisualModelValidationResult,
} from "@/services/tauri/files";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  MAX_AI_BATCH_ANALYZE_CONCURRENCY,
  MIN_AI_BATCH_ANALYZE_CONCURRENCY,
  type AiConfig,
  type AiConfigTarget,
  type AiServiceConfig,
  type VisualSearchConfig,
  type VisualSearchProviderPolicy,
  type VisualSearchRuntimeConfig,
  type VisualSearchRuntimeDevice,
} from "@/stores/settingsStore";
import {
  TERMINAL_VISUAL_INDEX_TASK_STATUSES,
  type VisualIndexTaskSnapshot,
} from "@/stores/fileTypes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select, SelectContent, SelectItem } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { StatusBadge, type StatusTone } from "./StatusBadge";

const AI_BATCH_ANALYZE_CONCURRENCY_OPTIONS = Array.from(
  {
    length: MAX_AI_BATCH_ANALYZE_CONCURRENCY - MIN_AI_BATCH_ANALYZE_CONCURRENCY + 1,
  },
  (_, index) => MIN_AI_BATCH_ANALYZE_CONCURRENCY + index,
);

const RUNTIME_DEFAULT_SELECT_VALUE = "__default__";
const FGCLIP_MAX_PATCH_OPTIONS = [128, 256, 576, 784, 1024] as const;
const DEFAULT_CUSTOM_INTRA_THREADS = 4;
const THREAD_MODE_AUTO = "auto";
const THREAD_MODE_CUSTOM = "custom";
const VISUAL_SEARCH_DEVICE_OPTIONS: Array<{
  value: VisualSearchRuntimeDevice;
  label: string;
}> = [
  { value: "auto", label: "自动" },
  { value: "gpu", label: "GPU" },
  { value: "cpu", label: "CPU" },
];
const VISUAL_SEARCH_PROVIDER_POLICY_OPTIONS: Array<{
  value: VisualSearchProviderPolicy;
  label: string;
}> = [
  { value: "interactive", label: "Interactive" },
  { value: "service", label: "Service" },
  { value: "auto", label: "Auto" },
];

function parseOptionalPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatRequestedDeviceLabel(value: VisualIndexStatus["requestedDevice"]) {
  switch (value) {
    case "gpu":
      return "GPU";
    case "cpu":
      return "CPU";
    case "auto":
      return "自动";
    default:
      return "未设置";
  }
}

function formatProviderPolicyLabel(value: VisualIndexStatus["providerPolicy"]) {
  switch (value) {
    case "interactive":
      return "Interactive";
    case "service":
      return "Service";
    case "auto":
      return "Auto";
    default:
      return "未设置";
  }
}

function formatRuntimeModeLabel(value: VisualIndexStatus["runtimeMode"], runtimeLoaded: boolean) {
  switch (value) {
    case "gpu_enabled":
      return "GPU 已启用";
    case "cpu_only":
      return "仅 CPU";
    case "mixed":
      return "混合";
    case "unknown":
      return "未知";
    case "uninitialized":
      return "未初始化";
    default:
      return runtimeLoaded ? "未知" : "未初始化";
  }
}

function formatEffectiveProviderLabel(
  value: VisualIndexStatus["effectiveProvider"],
  runtimeLoaded: boolean,
) {
  switch (value) {
    case "tensorrt":
      return "gpu/tensorrt";
    case "cuda":
      return "gpu/cuda";
    case "direct_ml":
      return "gpu/directml";
    case "core_ml":
      return "apple/coreml";
    case "cpu":
      return "cpu";
    default:
      return runtimeLoaded ? "未确定" : "未初始化";
  }
}

interface AiSettingsSectionProps {
  aiConfig: AiConfig;
  testingTargets: Record<AiConfigTarget, boolean>;
  autoAnalyzeOnImport: boolean;
  aiBatchAnalyzeConcurrency: number;
  visualSearch: VisualSearchConfig;
  visualIndexStatus: VisualIndexStatus | null;
  visualIndexTask: VisualIndexTaskSnapshot | null;
  visualModelValidation: VisualModelValidationResult | null;
  isSelectingModelDir: boolean;
  isValidatingModelDir: boolean;
  onSetAiConfigField: <K extends keyof AiServiceConfig>(
    target: AiConfigTarget,
    field: K,
    value: AiServiceConfig[K],
  ) => void;
  onTestAiEndpoint: (target: AiConfigTarget, endpointTarget: TauriAiEndpointTarget) => void;
  onSetAutoAnalyzeOnImport: (enabled: boolean) => void;
  onSetAiBatchAnalyzeConcurrency: (value: number) => void;
  onSetVisualSearchField: <K extends keyof VisualSearchConfig>(
    field: K,
    value: VisualSearchConfig[K],
  ) => void;
  onSetVisualSearchRuntimeField: <K extends keyof VisualSearchRuntimeConfig>(
    field: K,
    value: VisualSearchRuntimeConfig[K],
  ) => void;
  onSelectModelDir: () => void;
  onValidateModelDir: (modelPath?: string) => void;
  onStartVisualIndexTask: () => void;
  onCancelVisualIndexTask: () => void;
}

function AiConfigCard({
  title,
  description,
  target,
  endpointTarget,
  modelLabel,
  modelPlaceholder,
  config,
  isTesting,
  onSetField,
  onTest,
}: {
  title: string;
  description: string;
  target: AiConfigTarget;
  endpointTarget: TauriAiEndpointTarget;
  modelLabel: string;
  modelPlaceholder: string;
  config: AiConfig[AiConfigTarget];
  isTesting: boolean;
  onSetField: <K extends keyof AiServiceConfig>(
    target: AiConfigTarget,
    field: K,
    value: AiServiceConfig[K],
  ) => void;
  onTest: (target: AiConfigTarget, endpointTarget: TauriAiEndpointTarget) => void;
}) {
  const baseUrlInputId = `ai-${target}-base-url`;
  const apiKeyInputId = `ai-${target}-api-key`;
  const modelInputId = `ai-${target}-model`;

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
          模型配置
        </p>
        <h4 className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h4>
        <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">{description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor={baseUrlInputId}
            className="text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            Base URL
          </label>
          <Input
            id={baseUrlInputId}
            value={config.baseUrl}
            onChange={(event) => onSetField(target, "baseUrl", event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor={apiKeyInputId}
            className="text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            API Key
          </label>
          <Input
            id={apiKeyInputId}
            type="password"
            value={config.apiKey}
            onChange={(event) => onSetField(target, "apiKey", event.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label
            htmlFor={modelInputId}
            className="text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            {modelLabel}
          </label>
          <Input
            id={modelInputId}
            value={config.model}
            onChange={(event) => onSetField(target, "model", event.target.value)}
            placeholder={modelPlaceholder}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between dark:border-dark-border">
        <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">
          会发送一次最小真实请求，用于验证 Base URL、API Key 和模型是否可用。
        </p>
        <Button
          variant="outline"
          disabled={isTesting}
          onClick={() => onTest(target, endpointTarget)}
        >
          {isTesting ? "测试中..." : "测试接口"}
        </Button>
      </div>
    </div>
  );
}

function FeatureToggle({
  title,
  description,
  enabled,
  onChange,
  hint,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{title}</p>
          <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">{description}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Switch checked={enabled} onCheckedChange={onChange} aria-label={title} />
          <span
            className={cn(
              "text-xs font-medium",
              enabled
                ? "text-primary-700 dark:text-primary-300"
                : "text-gray-500 dark:text-gray-400",
            )}
          />
        </div>
      </div>

      {hint ? (
        <div className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{hint}</div>
      ) : null}
    </div>
  );
}

export function AiSettingsSection({
  aiConfig,
  testingTargets,
  autoAnalyzeOnImport,
  aiBatchAnalyzeConcurrency,
  visualSearch,
  visualIndexStatus,
  visualIndexTask,
  visualModelValidation,
  isSelectingModelDir,
  isValidatingModelDir,
  onSetAiConfigField,
  onTestAiEndpoint,
  onSetAutoAnalyzeOnImport,
  onSetAiBatchAnalyzeConcurrency,
  onSetVisualSearchField,
  onSetVisualSearchRuntimeField,
  onSelectModelDir,
  onValidateModelDir,
  onStartVisualIndexTask,
  onCancelVisualIndexTask,
}: AiSettingsSectionProps) {
  const [customIntraThreadsInput, setCustomIntraThreadsInput] = useState(() =>
    typeof visualSearch.runtime.intraThreads === "number"
      ? String(visualSearch.runtime.intraThreads)
      : String(DEFAULT_CUSTOM_INTRA_THREADS),
  );

  useEffect(() => {
    if (typeof visualSearch.runtime.intraThreads === "number") {
      setCustomIntraThreadsInput(String(visualSearch.runtime.intraThreads));
    }
  }, [visualSearch.runtime.intraThreads]);

  const metadataConfig = aiConfig.metadata;
  const metadataDraftExists =
    Boolean(metadataConfig.baseUrl.trim()) ||
    Boolean(metadataConfig.apiKey.trim()) ||
    Boolean(metadataConfig.model.trim());
  const metadataConfigured =
    Boolean(metadataConfig.baseUrl.trim()) &&
    Boolean(metadataConfig.apiKey.trim()) &&
    Boolean(metadataConfig.model.trim());
  const metadataStatusTone: StatusTone = metadataConfigured
    ? "success"
    : metadataDraftExists
      ? "warning"
      : "neutral";
  const metadataStatusLabel = metadataConfigured
    ? "已配置"
    : metadataDraftExists
      ? "待补全"
      : "未配置";

  const visualModelReady = Boolean(visualModelValidation?.valid);
  const visualSearchStatusTone: StatusTone = !visualSearch.enabled
    ? "neutral"
    : visualModelReady
      ? "success"
      : "warning";
  const visualSearchStatusLabel = !visualSearch.enabled
    ? "未启用"
    : visualModelReady
      ? "模型就绪"
      : visualSearch.modelPath.trim()
        ? "待校验"
        : "待配置";

  const indexedCount = visualIndexStatus?.indexedCount ?? 0;
  const totalImageCount = visualIndexStatus?.totalImageCount ?? 0;
  const pendingCount = visualIndexStatus?.pendingCount ?? 0;
  const failedCount = visualIndexStatus?.failedCount ?? 0;
  const outdatedCount = visualIndexStatus?.outdatedCount ?? 0;
  const unindexedCount = pendingCount + failedCount + outdatedCount;
  const isVisualIndexRunning =
    !!visualIndexTask && !TERMINAL_VISUAL_INDEX_TASK_STATUSES.has(visualIndexTask.status);
  const visualIndexProgress = visualIndexTask?.total
    ? Math.min(100, Math.round((visualIndexTask.processed / visualIndexTask.total) * 100))
    : 0;
  const visualIndexCountLabel = `${visualIndexTask?.processed ?? 0}/${visualIndexTask?.total ?? 0}`;
  const visualIndexActionLabel = visualSearch.processUnindexedOnly
    ? "处理未索引图片"
    : "重建视觉索引";
  const visualIndexTaskTitle =
    visualIndexTask?.status === "queued"
      ? "正在准备视觉索引任务"
      : visualIndexTask?.processUnindexedOnly
        ? "正在处理未索引图片"
        : "正在重建视觉索引";
  const intraThreadsMode =
    typeof visualSearch.runtime.intraThreads === "number" ? THREAD_MODE_CUSTOM : THREAD_MODE_AUTO;

  const handleIntraThreadsModeChange = (value: string) => {
    if (value === THREAD_MODE_AUTO) {
      onSetVisualSearchRuntimeField("intraThreads", "auto");
      return;
    }

    const fallback =
      parseOptionalPositiveInteger(customIntraThreadsInput) ??
      (typeof visualSearch.runtime.intraThreads === "number"
        ? visualSearch.runtime.intraThreads
        : DEFAULT_CUSTOM_INTRA_THREADS);

    setCustomIntraThreadsInput(String(fallback));
    onSetVisualSearchRuntimeField("intraThreads", fallback);
  };

  const handleCustomIntraThreadsChange = (value: string) => {
    setCustomIntraThreadsInput(value);

    const parsed = parseOptionalPositiveInteger(value);
    if (parsed != null) {
      onSetVisualSearchRuntimeField("intraThreads", parsed);
    }
  };

  const handleCustomIntraThreadsBlur = () => {
    if (intraThreadsMode !== THREAD_MODE_CUSTOM) {
      return;
    }

    const nextValue =
      parseOptionalPositiveInteger(customIntraThreadsInput) ??
      (typeof visualSearch.runtime.intraThreads === "number"
        ? visualSearch.runtime.intraThreads
        : DEFAULT_CUSTOM_INTRA_THREADS);

    setCustomIntraThreadsInput(String(nextValue));
    onSetVisualSearchRuntimeField("intraThreads", nextValue);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-5 shadow-sm dark:border-dark-border dark:bg-dark-bg/30">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              AI 元数据分析
            </h3>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              使用多模态模型分析图片，自动生成文件名、标签和备注。
            </p>
          </div>
          <StatusBadge label={metadataStatusLabel} tone={metadataStatusTone} />
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <AiConfigCard
              title=""
              description=""
              target="metadata"
              endpointTarget="metadata"
              modelLabel="多模态模型"
              modelPlaceholder="gpt-4.1-mini"
              config={aiConfig.metadata}
              isTesting={testingTargets.metadata}
              onSetField={onSetAiConfigField}
              onTest={onTestAiEndpoint}
            />
          </div>

          <div className="border-t border-gray-200 pt-4 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-dark-border">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
              功能
            </p>
            <div className="mt-2 divide-y divide-gray-200 dark:divide-dark-border">
              <FeatureToggle
                title="导入后自动 AI 分析"
                description="新导入图片后自动生成文件名、标签和备注。"
                enabled={autoAnalyzeOnImport}
                onChange={onSetAutoAnalyzeOnImport}
              />

              <div className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      批量分析同时处理数量
                    </p>
                    <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
                      右键批量 AI 分析时，后台一次同时分析的图片数量。
                    </p>
                  </div>

                  <Select
                    value={String(aiBatchAnalyzeConcurrency)}
                    displayValue={`${aiBatchAnalyzeConcurrency} 张`}
                    onValueChange={(value) => onSetAiBatchAnalyzeConcurrency(Number(value))}
                    className="w-24 shrink-0"
                    triggerClassName="h-9 rounded-lg border-gray-200 bg-white text-sm text-gray-700 dark:border-dark-border dark:bg-dark-bg dark:text-gray-200"
                  >
                    <SelectContent>
                      {AI_BATCH_ANALYZE_CONCURRENCY_OPTIONS.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value} 张
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-5 shadow-sm dark:border-dark-border dark:bg-dark-bg/30">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              本地自然语言搜索
            </h3>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              使用本地多模态 embedding 模型目录，实现自然语言搜索。
            </p>
          </div>
          <StatusBadge label={visualSearchStatusLabel} tone={visualSearchStatusTone} />
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                功能
              </p>
              <div className="mt-2 divide-y divide-gray-200 dark:divide-dark-border">
                <FeatureToggle
                  title="启用自然语言搜索"
                  description="打开后，顶部搜索框支持自然语言搜索。"
                  enabled={visualSearch.enabled}
                  onChange={(enabled) => onSetVisualSearchField("enabled", enabled)}
                />
                <FeatureToggle
                  title="导入后自动建立视觉索引"
                  description="新导入图片会在后台自动建立视觉索引，便于后续直接搜索。"
                  enabled={visualSearch.autoVectorizeOnImport}
                  onChange={(enabled) => onSetVisualSearchField("autoVectorizeOnImport", enabled)}
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 dark:border-dark-border">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                    模型目录
                  </p>
                </div>
                <StatusBadge
                  label={visualSearch.modelPath.trim() ? "已填写路径" : "未填写路径"}
                  tone={visualSearch.modelPath.trim() ? "neutral" : "warning"}
                />
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex flex-col gap-2 xl:flex-row">
                  <Input
                    id="visual-search-model-path"
                    value={visualSearch.modelPath}
                    onChange={(event) => onSetVisualSearchField("modelPath", event.target.value)}
                    onBlur={() => onValidateModelDir()}
                    placeholder="选择包含 model_config.json 的模型目录"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={onSelectModelDir}
                      disabled={isSelectingModelDir}
                    >
                      {isSelectingModelDir ? "选择中..." : "选择目录"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onValidateModelDir()}
                      disabled={isValidatingModelDir}
                    >
                      {isValidatingModelDir ? "校验中..." : "校验目录"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs leading-6 text-gray-500 dark:text-gray-400">
                <p>目录内应包含 `model_config.json` 以及模型引用的 ONNX、tokenizer 等文件。</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href="https://github.com/zihuv/vl-embedding-test/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-blue-600 transition-colors hover:border-blue-200 hover:bg-blue-50 dark:border-dark-border dark:bg-dark-surface/50 dark:text-blue-400 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10"
                  >
                    模型下载地址
                  </a>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 dark:border-dark-border">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                    运行时配置
                  </p>
                </div>
                <StatusBadge label="可选覆盖" tone="neutral" />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="visual-search-device"
                    className="text-sm font-medium text-gray-700 dark:text-gray-200"
                  >
                    Device
                  </label>
                  <Select
                    value={visualSearch.runtime.device}
                    displayValue={
                      VISUAL_SEARCH_DEVICE_OPTIONS.find(
                        (option) => option.value === visualSearch.runtime.device,
                      )?.label ?? "自动"
                    }
                    onValueChange={(value) =>
                      onSetVisualSearchRuntimeField("device", value as VisualSearchRuntimeDevice)
                    }
                    className="w-full"
                    triggerClassName="h-[34px] rounded-[10px] border-gray-300/90 bg-white/70 text-[13px] text-gray-800 shadow-sm dark:border-gray-600 dark:bg-dark-bg/60 dark:text-gray-200"
                  >
                    <SelectContent>
                      {VISUAL_SEARCH_DEVICE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                    自动会优先尝试 GPU 加速，不可用时回落到 CPU；GPU 会强制启用加速提供者，CPU
                    则固定走纯 CPU。
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="visual-search-intra-threads"
                    className="text-sm font-medium text-gray-700 dark:text-gray-200"
                  >
                    Provider Policy
                  </label>
                  <Select
                    value={visualSearch.runtime.providerPolicy}
                    displayValue={
                      VISUAL_SEARCH_PROVIDER_POLICY_OPTIONS.find(
                        (option) => option.value === visualSearch.runtime.providerPolicy,
                      )?.label ?? "Interactive"
                    }
                    onValueChange={(value) =>
                      onSetVisualSearchRuntimeField(
                        "providerPolicy",
                        value as VisualSearchProviderPolicy,
                      )
                    }
                    className="w-full"
                    triggerClassName="h-[34px] rounded-[10px] border-gray-300/90 bg-white/70 text-[13px] text-gray-800 shadow-sm dark:border-gray-600 dark:bg-dark-bg/60 dark:text-gray-200"
                  >
                    <SelectContent>
                      {VISUAL_SEARCH_PROVIDER_POLICY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                    `Interactive` 优先兼顾冷启动和兼容性，适合桌面交互；`Service`
                    偏向长时间运行下的吞吐；`Auto` 则回到 SDK 默认顺序。
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="visual-search-intra-threads"
                    className="text-sm font-medium text-gray-700 dark:text-gray-200"
                  >
                    Intra Threads
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                    <Select
                      value={intraThreadsMode}
                      displayValue={intraThreadsMode === THREAD_MODE_AUTO ? "自动" : "自定义"}
                      onValueChange={handleIntraThreadsModeChange}
                      className="w-full"
                      triggerClassName="h-[34px] rounded-[10px] border-gray-300/90 bg-white/70 text-[13px] text-gray-800 shadow-sm dark:border-gray-600 dark:bg-dark-bg/60 dark:text-gray-200"
                    >
                      <SelectContent>
                        <SelectItem value={THREAD_MODE_AUTO}>自动</SelectItem>
                        <SelectItem value={THREAD_MODE_CUSTOM}>自定义</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      id="visual-search-intra-threads"
                      type="number"
                      min={1}
                      step={1}
                      value={customIntraThreadsInput}
                      onChange={(event) => handleCustomIntraThreadsChange(event.target.value)}
                      onBlur={handleCustomIntraThreadsBlur}
                      disabled={intraThreadsMode !== THREAD_MODE_CUSTOM}
                      placeholder={String(DEFAULT_CUSTOM_INTRA_THREADS)}
                    />
                  </div>
                  <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                    自动会使用 SDK
                    默认线程数，通常等于当前机器的物理核心数。自定义用于控制单张图片编码时底层并行计算占用的
                    CPU 线程数。
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="visual-search-fgclip-max-patches"
                    className="text-sm font-medium text-gray-700 dark:text-gray-200"
                  >
                    FG-CLIP Max Patches
                  </label>
                  <Select
                    value={String(
                      visualSearch.runtime.fgclipMaxPatches ?? RUNTIME_DEFAULT_SELECT_VALUE,
                    )}
                    displayValue={
                      visualSearch.runtime.fgclipMaxPatches
                        ? String(visualSearch.runtime.fgclipMaxPatches)
                        : "默认"
                    }
                    onValueChange={(value) =>
                      onSetVisualSearchRuntimeField(
                        "fgclipMaxPatches",
                        value === RUNTIME_DEFAULT_SELECT_VALUE ? null : Number(value),
                      )
                    }
                    triggerClassName="h-[34px] rounded-[10px] border-gray-300/90 bg-white/70 text-[13px] text-gray-800 shadow-sm dark:border-gray-600 dark:bg-dark-bg/60 dark:text-gray-200"
                  >
                    <SelectContent>
                      <SelectItem value={RUNTIME_DEFAULT_SELECT_VALUE}>默认</SelectItem>
                      {FGCLIP_MAX_PATCH_OPTIONS.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                    值越高，处理的 Patch
                    数量越多，匹配文字描述的精度通常也越高，但计算开销会相应增大。FG-CLIP2
                    一般推荐从 `576` 开始平衡速度和效果。修改后需要重新建立视觉索引才能生效。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5 border-t border-gray-200 pt-4 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-dark-border">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                  模型状态
                </p>
                <StatusBadge
                  label={
                    visualModelValidation?.valid
                      ? "模型可用"
                      : visualSearch.modelPath.trim()
                        ? "待校验"
                        : "未配置"
                  }
                  tone={
                    visualModelValidation?.valid
                      ? "success"
                      : visualSearch.modelPath.trim()
                        ? "warning"
                        : "neutral"
                  }
                />
              </div>
              <p
                className={cn(
                  "mt-2 text-sm leading-6",
                  visualModelValidation?.valid
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-gray-600 dark:text-gray-300",
                )}
              >
                {visualModelValidation?.message ?? "尚未校验模型目录"}
              </p>
              {visualModelValidation?.valid ? (
                <div className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">
                  <p>模型：{visualModelValidation.modelId}</p>
                  <p>版本：{visualModelValidation.version}</p>
                  <p>
                    向量维度：{visualModelValidation.embeddingDim}
                    {" · "}上下文长度：
                    {visualModelValidation.contextLength}
                  </p>
                </div>
              ) : null}
              {!visualModelValidation?.valid && visualModelValidation?.missingFiles.length ? (
                <p className="mt-2 text-xs leading-6 text-amber-700 dark:text-amber-300">
                  缺少文件：{visualModelValidation.missingFiles.join("、")}
                </p>
              ) : null}
            </div>

            <div className="border-t border-gray-200 pt-4 dark:border-dark-border">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                    索引状态
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    当前模型：{visualIndexStatus?.modelId ?? "未就绪"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={isVisualIndexRunning}
                  onClick={onStartVisualIndexTask}
                >
                  {isVisualIndexRunning ? "处理中..." : visualIndexActionLabel}
                </Button>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {visualIndexStatus?.message ?? "未读取索引状态"}
              </p>
              <div className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">
                <p>
                  总图片数 {totalImageCount} · 已索引 {indexedCount}
                </p>
                <p>
                  待处理 {pendingCount} · 失败 {failedCount} · 已过期 {outdatedCount}
                </p>
                <p>当前未就绪 {unindexedCount}</p>
                <p>
                  请求设备 {formatRequestedDeviceLabel(visualIndexStatus?.requestedDevice ?? null)}
                  {" · "}策略{" "}
                  {formatProviderPolicyLabel(visualIndexStatus?.providerPolicy ?? null)}
                </p>
                <p>
                  当前 Provider{" "}
                  {formatEffectiveProviderLabel(
                    visualIndexStatus?.effectiveProvider ?? null,
                    visualIndexStatus?.runtimeLoaded ?? false,
                  )}
                  {" · "}模式{" "}
                  {formatRuntimeModeLabel(
                    visualIndexStatus?.runtimeMode ?? null,
                    visualIndexStatus?.runtimeLoaded ?? false,
                  )}
                </p>
              </div>
              {visualIndexStatus?.runtimeReason ? (
                <p className="mt-2 text-xs leading-6 text-amber-700 dark:text-amber-300">
                  运行时提示：{visualIndexStatus.runtimeReason}
                </p>
              ) : null}

              <div className="mt-4 rounded-2xl border border-gray-200 bg-white/70 p-4 dark:border-dark-border dark:bg-dark-surface/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      处理未索引图片
                    </p>
                    <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
                      开启后只处理待处理、失败和已过期图片，适合增量更新；关闭后会全量重建所有视觉索引。
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Switch
                      checked={visualSearch.processUnindexedOnly}
                      onCheckedChange={(enabled) =>
                        onSetVisualSearchField("processUnindexedOnly", enabled)
                      }
                      disabled={isVisualIndexRunning}
                      aria-label="处理未索引图片"
                    />
                  </div>
                </div>
              </div>

              {isVisualIndexRunning ? (
                <div
                  className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-950/20"
                  role="status"
                  aria-live="polite"
                  aria-label={`${visualIndexTaskTitle} ${visualIndexCountLabel}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                          {visualIndexTaskTitle}
                        </span>
                        <span className="text-xs font-medium tabular-nums text-amber-700 dark:text-amber-300">
                          {visualIndexCountLabel}
                        </span>
                      </div>
                      {visualIndexTask?.currentFileName ? (
                        <p className="mt-1 truncate text-xs leading-6 text-amber-700/80 dark:text-amber-200/80">
                          当前：{visualIndexTask.currentFileName}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs leading-6 text-amber-700/80 dark:text-amber-200/80">
                        成功 {visualIndexTask?.indexedCount ?? 0} · 失败{" "}
                        {visualIndexTask?.failureCount ?? 0} · 跳过{" "}
                        {visualIndexTask?.skippedCount ?? 0}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onCancelVisualIndexTask}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
                      title="取消视觉索引任务"
                      aria-label="取消视觉索引任务"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-900/30">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                      style={{ width: `${visualIndexProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
