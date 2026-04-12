import type { AiEndpointTarget as TauriAiEndpointTarget, VisualIndexStatus, VisualModelValidationResult } from '@/services/tauri/files'
import {
  MAX_AI_BATCH_ANALYZE_CONCURRENCY,
  MIN_AI_BATCH_ANALYZE_CONCURRENCY,
  type AiConfig,
  type AiConfigTarget,
  type AiServiceConfig,
  type VisualSearchConfig,
} from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { StatusBadge, type StatusTone } from './StatusBadge'

const AI_BATCH_ANALYZE_CONCURRENCY_OPTIONS = Array.from(
  {
    length:
      MAX_AI_BATCH_ANALYZE_CONCURRENCY - MIN_AI_BATCH_ANALYZE_CONCURRENCY + 1,
  },
  (_, index) => MIN_AI_BATCH_ANALYZE_CONCURRENCY + index,
)

interface AiSettingsSectionProps {
  aiConfig: AiConfig
  testingTargets: Record<AiConfigTarget, boolean>
  autoAnalyzeOnImport: boolean
  aiBatchAnalyzeConcurrency: number
  visualSearch: VisualSearchConfig
  visualIndexStatus: VisualIndexStatus | null
  visualModelValidation: VisualModelValidationResult | null
  isSelectingModelDir: boolean
  isValidatingModelDir: boolean
  isRebuildingVisual: boolean
  onSetAiConfigField: <K extends keyof AiServiceConfig>(
    target: AiConfigTarget,
    field: K,
    value: AiServiceConfig[K],
  ) => void
  onTestAiEndpoint: (
    target: AiConfigTarget,
    endpointTarget: TauriAiEndpointTarget,
  ) => void
  onSetAutoAnalyzeOnImport: (enabled: boolean) => void
  onSetAiBatchAnalyzeConcurrency: (value: number) => void
  onSetVisualSearchField: <K extends keyof VisualSearchConfig>(
    field: K,
    value: VisualSearchConfig[K],
  ) => void
  onSelectModelDir: () => void
  onValidateModelDir: (modelPath?: string) => void
  onRebuildVisualIndex: () => void
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
  title: string
  description: string
  target: AiConfigTarget
  endpointTarget: TauriAiEndpointTarget
  modelLabel: string
  modelPlaceholder: string
  config: AiConfig[AiConfigTarget]
  isTesting: boolean
  onSetField: <K extends keyof AiServiceConfig>(
    target: AiConfigTarget,
    field: K,
    value: AiServiceConfig[K],
  ) => void
  onTest: (target: AiConfigTarget, endpointTarget: TauriAiEndpointTarget) => void
}) {
  const baseUrlInputId = `ai-${target}-base-url`
  const apiKeyInputId = `ai-${target}-api-key`
  const modelInputId = `ai-${target}-model`

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
            onChange={(event) => onSetField(target, 'baseUrl', event.target.value)}
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
            onChange={(event) => onSetField(target, 'apiKey', event.target.value)}
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
            onChange={(event) => onSetField(target, 'model', event.target.value)}
            placeholder={modelPlaceholder}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between dark:border-dark-border">
        <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">
          会发送一次最小真实请求，用于验证 Base URL、API Key 和模型是否可用。
        </p>
        <Button variant="outline" disabled={isTesting} onClick={() => onTest(target, endpointTarget)}>
          {isTesting ? '测试中...' : '测试接口'}
        </Button>
      </div>
    </div>
  )
}

function FeatureToggle({
  title,
  description,
  enabled,
  onChange,
  hint,
}: {
  title: string
  description: string
  enabled: boolean
  onChange: (enabled: boolean) => void
  hint?: string
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
              'text-xs font-medium',
              enabled
                ? 'text-primary-700 dark:text-primary-300'
                : 'text-gray-500 dark:text-gray-400',
            )}
          />
        </div>
      </div>

      {hint ? (
        <div className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{hint}</div>
      ) : null}
    </div>
  )
}

export function AiSettingsSection({
  aiConfig,
  testingTargets,
  autoAnalyzeOnImport,
  aiBatchAnalyzeConcurrency,
  visualSearch,
  visualIndexStatus,
  visualModelValidation,
  isSelectingModelDir,
  isValidatingModelDir,
  isRebuildingVisual,
  onSetAiConfigField,
  onTestAiEndpoint,
  onSetAutoAnalyzeOnImport,
  onSetAiBatchAnalyzeConcurrency,
  onSetVisualSearchField,
  onSelectModelDir,
  onValidateModelDir,
  onRebuildVisualIndex,
}: AiSettingsSectionProps) {
  const metadataConfig = aiConfig.metadata
  const metadataDraftExists =
    Boolean(metadataConfig.baseUrl.trim()) ||
    Boolean(metadataConfig.apiKey.trim()) ||
    Boolean(metadataConfig.model.trim())
  const metadataConfigured =
    Boolean(metadataConfig.baseUrl.trim()) &&
    Boolean(metadataConfig.apiKey.trim()) &&
    Boolean(metadataConfig.model.trim())
  const metadataStatusTone: StatusTone = metadataConfigured
    ? 'success'
    : metadataDraftExists
      ? 'warning'
      : 'neutral'
  const metadataStatusLabel = metadataConfigured
    ? '已配置'
    : metadataDraftExists
      ? '待补全'
      : '未配置'

  const visualModelReady = Boolean(visualModelValidation?.valid)
  const visualSearchStatusTone: StatusTone = !visualSearch.enabled
    ? 'neutral'
    : visualModelReady
      ? 'success'
      : 'warning'
  const visualSearchStatusLabel = !visualSearch.enabled
    ? '未启用'
    : visualModelReady
      ? '模型就绪'
      : visualSearch.modelPath.trim()
        ? '待校验'
        : '待配置'

  const indexedCount = visualIndexStatus?.indexedCount ?? 0
  const totalImageCount = visualIndexStatus?.totalImageCount ?? 0
  const pendingCount = visualIndexStatus?.pendingCount ?? 0
  const failedCount = visualIndexStatus?.failedCount ?? 0

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
              使用特调 fgclip2 模型，实现自然语言搜索，将额外占用~800MB内存。
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
                  onChange={(enabled) => onSetVisualSearchField('enabled', enabled)}
                />
                <FeatureToggle
                  title="导入后自动建立视觉索引"
                  description="新导入图片会在后台自动建立视觉索引，便于后续直接搜索。"
                  enabled={visualSearch.autoVectorizeOnImport}
                  onChange={(enabled) =>
                    onSetVisualSearchField('autoVectorizeOnImport', enabled)
                  }
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
                  label={visualSearch.modelPath.trim() ? '已填写路径' : '未填写路径'}
                  tone={visualSearch.modelPath.trim() ? 'neutral' : 'warning'}
                />
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex flex-col gap-2 xl:flex-row">
                  <Input
                    id="visual-search-model-path"
                    value={visualSearch.modelPath}
                    onChange={(event) => onSetVisualSearchField('modelPath', event.target.value)}
                    onBlur={() => onValidateModelDir()}
                    placeholder=""
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={onSelectModelDir}
                      disabled={isSelectingModelDir}
                    >
                      {isSelectingModelDir ? '选择中...' : '选择目录'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onValidateModelDir()}
                      disabled={isValidatingModelDir}
                    >
                      {isValidatingModelDir ? '校验中...' : '校验目录'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs leading-6 text-gray-500 dark:text-gray-400">
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
                      ? '模型可用'
                      : visualSearch.modelPath.trim()
                        ? '待校验'
                        : '未配置'
                  }
                  tone={
                    visualModelValidation?.valid
                      ? 'success'
                      : visualSearch.modelPath.trim()
                        ? 'warning'
                        : 'neutral'
                  }
                />
              </div>
              <p
                className={cn(
                  'mt-2 text-sm leading-6',
                  visualModelValidation?.valid
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-gray-600 dark:text-gray-300',
                )}
              >
                {visualModelValidation?.message ?? '尚未校验模型目录'}
              </p>
              {visualModelValidation?.valid ? (
                <div className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">
                  <p>模型：{visualModelValidation.modelId}</p>
                  <p>版本：{visualModelValidation.version}</p>
                  <p>
                    向量维度：{visualModelValidation.embeddingDim}
                    {' · '}上下文长度：
                    {visualModelValidation.contextLength}
                  </p>
                </div>
              ) : null}
              {!visualModelValidation?.valid && visualModelValidation?.missingFiles.length ? (
                <p className="mt-2 text-xs leading-6 text-amber-700 dark:text-amber-300">
                  缺少文件：{visualModelValidation.missingFiles.join('、')}
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
                    当前模型：{visualIndexStatus?.modelId ?? '未就绪'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={isRebuildingVisual}
                  onClick={onRebuildVisualIndex}
                >
                  {isRebuildingVisual ? '重建中...' : '重建视觉索引'}
                </Button>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {visualIndexStatus?.message ?? '未读取索引状态'}
              </p>
              <div className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">
                <p>
                  总图片数 {totalImageCount} · 已索引 {indexedCount}
                </p>
                <p>
                  待处理 {pendingCount} · 失败 {failedCount} · 已过期{' '}
                  {visualIndexStatus?.outdatedCount ?? 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
