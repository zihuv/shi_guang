import type {
  AiEndpointTarget,
  VisualModelDownloadRepoId,
  VisualIndexStatus,
  VisualModelValidationResult,
} from "@/services/desktop/files";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { VISUAL_MODEL_DOWNLOAD_OPTIONS as MODEL_DOWNLOAD_OPTIONS } from "@/services/desktop/files";
import { AI_METADATA_FIELDS } from "@/lib/aiMetadataDefaults";
import { formatSize } from "@/utils";
import {
  type AiConfig,
  type AiConfigTarget,
  type AiMetadataAnalysisField,
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
import type { VisualModelDownloadSnapshot } from "@/shared/desktop-types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select, SelectContent, SelectItem } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { SettingsRow, SettingsSectionBlock, StatusPill } from "./SettingsPrimitives";

const RUNTIME_DEFAULT_SELECT_VALUE = "__default__";
const FGCLIP_MAX_PATCH_OPTIONS = [128, 256, 576, 784, 1024] as const;
const DEFAULT_CUSTOM_INTRA_THREADS = 4;
const THREAD_MODE_AUTO = "auto";
const THREAD_MODE_CUSTOM = "custom";
const SETTINGS_SELECT_TRIGGER_CLASS_NAME =
  "h-[34px] rounded-[10px] border-transparent bg-black/[0.035] text-[13px] text-gray-800 dark:bg-white/[0.05] dark:text-gray-200";
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
const AI_METADATA_FIELD_LABELS: Record<AiMetadataAnalysisField, string> = {
  filename: "文件名",
  tags: "标签",
  description: "备注",
  rating: "评价",
};

function parseOptionalPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface AiSettingsSectionProps {
  aiConfig: AiConfig;
  testingTargets: Record<AiConfigTarget, boolean>;
  autoAnalyzeOnImport: boolean;
  visualSearch: VisualSearchConfig;
  visualIndexStatus: VisualIndexStatus | null;
  visualIndexTask: VisualIndexTaskSnapshot | null;
  visualModelValidation: VisualModelValidationResult | null;
  visualModelDownloadTask: VisualModelDownloadSnapshot | null;
  isSelectingModelDir: boolean;
  isValidatingModelDir: boolean;
  onSetAiConfigField: <K extends keyof AiServiceConfig>(
    target: AiConfigTarget,
    field: K,
    value: AiServiceConfig[K],
  ) => void;
  onTestAiEndpoint: (target: AiConfigTarget, endpointTarget: AiEndpointTarget) => void;
  onSetAutoAnalyzeOnImport: (enabled: boolean) => void;
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
  onStartVisualModelDownload: (repoId: VisualModelDownloadRepoId) => void;
  onCancelVisualModelDownload: () => void;
  onStartVisualIndexTask: () => void;
  onCancelVisualIndexTask: () => void;
}

function AiConfigCard({
  target,
  endpointTarget,
  modelLabel,
  modelPlaceholder,
  config,
  isTesting,
  onSetField,
  onTest,
}: {
  target: AiConfigTarget;
  endpointTarget: AiEndpointTarget;
  modelLabel: string;
  modelPlaceholder: string;
  config: AiConfig[AiConfigTarget];
  isTesting: boolean;
  onSetField: <K extends keyof AiServiceConfig>(
    target: AiConfigTarget,
    field: K,
    value: AiServiceConfig[K],
  ) => void;
  onTest: (target: AiConfigTarget, endpointTarget: AiEndpointTarget) => void;
}) {
  const baseUrlInputId = `ai-${target}-base-url`;
  const apiKeyInputId = `ai-${target}-api-key`;
  const modelInputId = `ai-${target}-model`;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
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

        <div className="flex flex-col gap-2">
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

        <div className="flex flex-col gap-2 md:col-span-2">
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

      <div className="flex justify-end">
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
  enabled,
  onChange,
  hint,
}: {
  title: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  hint?: string;
}) {
  return (
    <SettingsRow title={title} className="py-2">
      <Switch checked={enabled} onCheckedChange={onChange} aria-label={title} />
      {hint ? (
        <div className="basis-full text-xs leading-5 text-amber-700 dark:text-amber-300">
          {hint}
        </div>
      ) : null}
    </SettingsRow>
  );
}

function AiMetadataPromptRow({
  field,
  enabled,
  prompt,
  onSetEnabled,
  onSetPrompt,
}: {
  field: AiMetadataAnalysisField;
  enabled: boolean;
  prompt: string;
  onSetEnabled: (enabled: boolean) => void;
  onSetPrompt: (prompt: string) => void;
}) {
  const label = AI_METADATA_FIELD_LABELS[field];

  return (
    <SettingsRow title={label} className="items-start md:items-start">
      <div className="flex w-full min-w-0 flex-col gap-2 md:w-[min(32rem,52vw)]">
        <div className="flex items-center justify-end">
          <Switch checked={enabled} onCheckedChange={onSetEnabled} aria-label={`${label}分析`} />
        </div>
        <Textarea
          value={prompt}
          onChange={(event) => onSetPrompt(event.target.value)}
          disabled={!enabled}
          rows={field === "rating" ? 5 : 7}
          className="min-h-[104px]"
        />
      </div>
    </SettingsRow>
  );
}

export function AiSettingsSection({
  aiConfig,
  testingTargets,
  autoAnalyzeOnImport,
  visualSearch,
  visualIndexStatus,
  visualIndexTask,
  visualModelValidation,
  visualModelDownloadTask,
  isSelectingModelDir,
  isValidatingModelDir,
  onSetAiConfigField,
  onTestAiEndpoint,
  onSetAutoAnalyzeOnImport,
  onSetVisualSearchField,
  onSetVisualSearchRuntimeField,
  onSelectModelDir,
  onValidateModelDir,
  onStartVisualModelDownload,
  onCancelVisualModelDownload,
  onStartVisualIndexTask,
  onCancelVisualIndexTask,
}: AiSettingsSectionProps) {
  const [customIntraThreadsInput, setCustomIntraThreadsInput] = useState(() =>
    typeof visualSearch.runtime.intraThreads === "number"
      ? String(visualSearch.runtime.intraThreads)
      : String(DEFAULT_CUSTOM_INTRA_THREADS),
  );
  const [selectedDownloadRepoId, setSelectedDownloadRepoId] = useState<VisualModelDownloadRepoId>(
    "zihuv/fg-clip2-base-onnx",
  );

  useEffect(() => {
    if (typeof visualSearch.runtime.intraThreads === "number") {
      setCustomIntraThreadsInput(String(visualSearch.runtime.intraThreads));
    }
  }, [visualSearch.runtime.intraThreads]);

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
  const isVisualModelDownloadRunning =
    !!visualModelDownloadTask &&
    ["queued", "scanning", "downloading"].includes(visualModelDownloadTask.status);
  const visualModelDownloadProgress =
    visualModelDownloadTask?.totalBytes && visualModelDownloadTask.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (visualModelDownloadTask.downloadedBytes / visualModelDownloadTask.totalBytes) * 100,
          ),
        )
      : 0;
  const visualModelDownloadCountLabel = visualModelDownloadTask
    ? `${visualModelDownloadTask.completedFiles}/${visualModelDownloadTask.totalFiles || 0}`
    : "0/0";
  const selectedDownloadOption =
    MODEL_DOWNLOAD_OPTIONS.find((option) => option.repoId === selectedDownloadRepoId) ??
    MODEL_DOWNLOAD_OPTIONS[0];
  const updateMetadataAnalysisField = (
    field: AiMetadataAnalysisField,
    patch: Partial<(typeof aiConfig.metadata.analysis)[AiMetadataAnalysisField]>,
  ) => {
    onSetAiConfigField("metadata", "analysis", {
      ...aiConfig.metadata.analysis,
      [field]: {
        ...aiConfig.metadata.analysis[field],
        ...patch,
      },
    });
  };
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
    <div className="flex flex-col gap-7">
      <SettingsSectionBlock title="AI 元数据">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <AiConfigCard
            target="metadata"
            endpointTarget="metadata"
            modelLabel="多模态模型"
            modelPlaceholder="gpt-4.1-mini"
            config={aiConfig.metadata}
            isTesting={testingTargets.metadata}
            onSetField={onSetAiConfigField}
            onTest={onTestAiEndpoint}
          />

          <div className="flex flex-col gap-1 xl:pt-8">
            <FeatureToggle
              title="导入后自动分析"
              enabled={autoAnalyzeOnImport}
              onChange={onSetAutoAnalyzeOnImport}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {AI_METADATA_FIELDS.map((field) => (
            <AiMetadataPromptRow
              key={field}
              field={field}
              enabled={aiConfig.metadata.analysis[field].enabled}
              prompt={aiConfig.metadata.analysis[field].prompt}
              onSetEnabled={(enabled) => updateMetadataAnalysisField(field, { enabled })}
              onSetPrompt={(prompt) => updateMetadataAnalysisField(field, { prompt })}
            />
          ))}
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="本地自然语言搜索">
        <FeatureToggle
          title="启用自然语言搜索"
          enabled={visualSearch.enabled}
          onChange={(enabled) => onSetVisualSearchField("enabled", enabled)}
        />
        <FeatureToggle
          title="导入后自动索引"
          enabled={visualSearch.autoVectorizeOnImport}
          onChange={(enabled) => onSetVisualSearchField("autoVectorizeOnImport", enabled)}
        />

        <SettingsRow title="模型目录" className="items-start md:items-start">
          <div className="flex w-full flex-col gap-2 xl:w-[34rem]">
            <Input
              id="visual-search-model-path"
              value={visualSearch.modelPath}
              onChange={(event) => onSetVisualSearchField("modelPath", event.target.value)}
              onBlur={() => onValidateModelDir()}
              placeholder="选择包含 model_config.json 的模型目录"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={onSelectModelDir} disabled={isSelectingModelDir}>
                {isSelectingModelDir ? "选择中..." : "选择目录"}
              </Button>
              <Button
                variant="outline"
                onClick={() => onValidateModelDir()}
                disabled={isValidatingModelDir}
              >
                {isValidatingModelDir ? "校验中..." : "校验目录"}
              </Button>
              <a
                href="https://zihuv.github.io/shiguang/guide/visual-search.html"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium text-gray-500 transition-colors hover:bg-black/[0.04] hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              >
                使用说明
              </a>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="模型下载"
          detail={
            <span className="whitespace-nowrap">
              本下载服务由{" "}
              <a
                href="https://hf-mirror.com/"
                target="_blank"
                rel="noreferrer"
                className="text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-950 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white"
              >
                https://hf-mirror.com/
              </a>{" "}
              提供
            </span>
          }
          className="items-start md:items-start"
        >
          <div className="flex w-full flex-col items-stretch gap-3 xl:w-[34rem]">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select
                value={selectedDownloadRepoId}
                displayValue={selectedDownloadOption.label}
                onValueChange={(value) =>
                  setSelectedDownloadRepoId(value as VisualModelDownloadRepoId)
                }
                className="w-[12rem]"
                triggerClassName={SETTINGS_SELECT_TRIGGER_CLASS_NAME}
              >
                <SelectContent>
                  {MODEL_DOWNLOAD_OPTIONS.map((option) => (
                    <SelectItem key={option.repoId} value={option.repoId}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={isVisualModelDownloadRunning}
                onClick={() => onStartVisualModelDownload(selectedDownloadRepoId)}
              >
                <Download className="h-3.5 w-3.5" />
                {isVisualModelDownloadRunning ? "下载中..." : "下载模型"}
              </Button>
            </div>

            {visualModelDownloadTask ? (
              <div
                className="rounded-xl bg-black/[0.025] px-3 py-3 dark:bg-white/[0.04]"
                role={isVisualModelDownloadRunning ? "status" : undefined}
                aria-live="polite"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                        {visualModelDownloadTask.modelName}
                      </span>
                      <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-400">
                        {visualModelDownloadCountLabel}
                      </span>
                      <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-400">
                        {formatSize(visualModelDownloadTask.downloadedBytes)}
                        {visualModelDownloadTask.totalBytes > 0
                          ? ` / ${formatSize(visualModelDownloadTask.totalBytes)}`
                          : ""}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs leading-5 text-gray-500 dark:text-gray-400">
                      {visualModelDownloadTask.targetDir}
                    </p>
                    {visualModelDownloadTask.currentFileName ? (
                      <p className="truncate text-xs leading-5 text-gray-500 dark:text-gray-400">
                        {visualModelDownloadTask.currentFileName}
                      </p>
                    ) : null}
                    {visualModelDownloadTask.error ? (
                      <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                        {visualModelDownloadTask.error}
                      </p>
                    ) : null}
                  </div>
                  {isVisualModelDownloadRunning ? (
                    <button
                      type="button"
                      onClick={onCancelVisualModelDownload}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-black/[0.06] hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                      title="取消模型下载"
                      aria-label="取消模型下载"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gray-800 transition-[width] duration-300 dark:bg-gray-100"
                    style={{ width: `${visualModelDownloadProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow title="模型状态">
          <div className="flex max-w-[34rem] flex-wrap items-center justify-end gap-2">
            <StatusPill tone={visualModelValidation?.valid ? "success" : "neutral"}>
              {visualModelValidation?.message ?? "尚未校验"}
            </StatusPill>
            {visualModelValidation?.valid ? (
              <>
                <StatusPill>{visualModelValidation.modelId}</StatusPill>
                <StatusPill>{visualModelValidation.embeddingDim} 维</StatusPill>
              </>
            ) : null}
            {!visualModelValidation?.valid && visualModelValidation?.missingFiles.length ? (
              <span className="basis-full text-right text-xs leading-5 text-amber-700 dark:text-amber-300">
                缺少：{visualModelValidation.missingFiles.join("、")}
              </span>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow title="运行时配置" className="items-start md:items-start">
          <div className="grid w-full gap-3 md:grid-cols-2 xl:w-[34rem]">
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-gray-500 dark:text-gray-400">
              设备
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
                triggerClassName={SETTINGS_SELECT_TRIGGER_CLASS_NAME}
              >
                <SelectContent>
                  {VISUAL_SEARCH_DEVICE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-gray-500 dark:text-gray-400">
              调度策略
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
                triggerClassName={SETTINGS_SELECT_TRIGGER_CLASS_NAME}
              >
                <SelectContent>
                  {VISUAL_SEARCH_PROVIDER_POLICY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-gray-500 dark:text-gray-400">
              线程
              <div className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                <Select
                  value={intraThreadsMode}
                  displayValue={intraThreadsMode === THREAD_MODE_AUTO ? "自动" : "自定义"}
                  onValueChange={handleIntraThreadsModeChange}
                  className="w-full"
                  triggerClassName={SETTINGS_SELECT_TRIGGER_CLASS_NAME}
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
            </label>

            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-gray-500 dark:text-gray-400">
              图像块上限
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
                triggerClassName={SETTINGS_SELECT_TRIGGER_CLASS_NAME}
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
            </label>
          </div>
        </SettingsRow>

        <SettingsRow
          title="索引状态"
          detail={
            visualIndexStatus?.modelId
              ? `当前模型：${visualIndexStatus.modelId}`
              : "当前模型：未就绪"
          }
          className="items-start md:items-start"
        >
          <div className="flex max-w-[34rem] flex-col items-stretch gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              <StatusPill>总数 {totalImageCount}</StatusPill>
              <StatusPill tone={indexedCount > 0 ? "success" : "neutral"}>
                已索引 {indexedCount}
              </StatusPill>
              <StatusPill tone={unindexedCount > 0 ? "warning" : "neutral"}>
                待处理 {unindexedCount}
              </StatusPill>
              <StatusPill tone={failedCount > 0 ? "warning" : "neutral"}>
                失败 {failedCount}
              </StatusPill>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Switch
                checked={visualSearch.processUnindexedOnly}
                onCheckedChange={(enabled) =>
                  onSetVisualSearchField("processUnindexedOnly", enabled)
                }
                disabled={isVisualIndexRunning}
                aria-label="处理未索引图片"
              />
              <span className="mr-auto text-[12px] text-gray-500 dark:text-gray-400">
                只处理未索引
              </span>
              <Button
                variant="outline"
                disabled={isVisualIndexRunning}
                onClick={onStartVisualIndexTask}
              >
                {isVisualIndexRunning ? "处理中..." : visualIndexActionLabel}
              </Button>
            </div>

            {visualIndexStatus?.message ? (
              <p className="text-right text-xs leading-5 text-gray-500 dark:text-gray-400">
                {visualIndexStatus.message}
              </p>
            ) : null}

            {isVisualIndexRunning ? (
              <div
                className="rounded-xl bg-amber-50/80 px-3 py-3 dark:bg-amber-500/10"
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
                      <p className="mt-1 truncate text-xs leading-5 text-amber-700/80 dark:text-amber-200/80">
                        {visualIndexTask.currentFileName}
                      </p>
                    ) : null}
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
        </SettingsRow>
      </SettingsSectionBlock>
    </div>
  );
}
