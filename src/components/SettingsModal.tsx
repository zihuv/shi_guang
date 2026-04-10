import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  testAiEndpoint,
  type AiEndpointTarget as TauriAiEndpointTarget,
} from "@/services/tauri/files";
import {
  DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED,
  PREVIEW_TRACKPAD_ZOOM_SPEED_MAX,
  PREVIEW_TRACKPAD_ZOOM_SPEED_MIN,
  PREVIEW_TRACKPAD_ZOOM_SPEED_STEP,
  type AiConfigTarget,
  useSettingsStore,
} from "@/stores/settingsStore";
import ShortcutRecorder from "@/components/ShortcutRecorder";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  formatShortcutDisplay,
  normalizeShortcut,
  type ShortcutActionId,
} from "@/lib/shortcuts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";
import { Sun, Moon, Plus, Trash, AlertTriangle, RotateCcw } from "lucide-react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsSection = "general" | "ai" | "shortcuts";

interface VisualIndexProgressPayload {
  processed: number;
  total: number;
}

type StatusTone = "neutral" | "success" | "warning";

function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          : tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            : "border-gray-200 bg-white/90 text-gray-600 dark:border-dark-border dark:bg-dark-bg/60 dark:text-gray-300",
      )}
    >
      {label}
    </span>
  );
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const indexPaths = useSettingsStore((state) => state.indexPaths);
  const switchIndexPath = useSettingsStore((state) => state.switchIndexPath);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const useTrash = useSettingsStore((state) => state.useTrash);
  const setDeleteMode = useSettingsStore((state) => state.setDeleteMode);
  const rebuildIndex = useSettingsStore((state) => state.rebuildIndex);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const aiConfig = useSettingsStore((state) => state.aiConfig);
  const setAiConfigField = useSettingsStore((state) => state.setAiConfigField);
  const visualSearch = useSettingsStore((state) => state.visualSearch);
  const setVisualSearchField = useSettingsStore(
    (state) => state.setVisualSearchField,
  );
  const autoAnalyzeOnImport = useSettingsStore(
    (state) => state.autoAnalyzeOnImport,
  );
  const setAutoAnalyzeOnImport = useSettingsStore(
    (state) => state.setAutoAnalyzeOnImport,
  );
  const rebuildVisualIndex = useSettingsStore(
    (state) => state.rebuildVisualIndex,
  );
  const refreshVisualSearchStatus = useSettingsStore(
    (state) => state.refreshVisualSearchStatus,
  );
  const visualIndexStatus = useSettingsStore(
    (state) => state.visualIndexStatus,
  );
  const visualModelValidation = useSettingsStore(
    (state) => state.visualModelValidation,
  );
  const validateVisualModelPath = useSettingsStore(
    (state) => state.validateVisualModelPath,
  );
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const setShortcut = useSettingsStore((state) => state.setShortcut);
  const resetShortcut = useSettingsStore((state) => state.resetShortcut);
  const previewTrackpadZoomSpeed = useSettingsStore(
    (state) => state.previewTrackpadZoomSpeed,
  );
  const setPreviewTrackpadZoomSpeed = useSettingsStore(
    (state) => state.setPreviewTrackpadZoomSpeed,
  );
  const [isAdding, setIsAdding] = useState(false);
  const [isSelectingModelDir, setIsSelectingModelDir] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isRebuildingVisual, setIsRebuildingVisual] = useState(false);
  const [isValidatingModelDir, setIsValidatingModelDir] = useState(false);
  const [testingTargets, setTestingTargets] = useState<
    Record<AiConfigTarget, boolean>
  >({
    metadata: false,
  });
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");

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

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadSettings();
  }, [open, loadSettings]);

  useEffect(() => {
    if (!open || activeSection !== "ai") {
      return;
    }

    void refreshVisualSearchStatus();
  }, [open, activeSection, refreshVisualSearchStatus]);

  const currentIndexPath = indexPaths[0] ?? null;

  const handleAddPath = async () => {
    setIsAdding(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择素材目录",
      });
      if (selected && typeof selected === "string") {
        if (selected === currentIndexPath) {
          toast.info("当前已经是这个索引目录");
          return;
        }

        toast.info("正在切换索引目录，应用将自动重启");
        await switchIndexPath(selected);
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
    } finally {
      setIsAdding(false);
    }
  };

  const handleShortcutChange = async (
    actionId: ShortcutActionId,
    nextShortcut: string,
  ) => {
    const normalized = normalizeShortcut(nextShortcut);
    if (!normalized) {
      return;
    }

    const conflict = SHORTCUT_ACTIONS.find(
      (action) => action.id !== actionId && shortcuts[action.id] === normalized,
    );

    if (conflict) {
      toast.error(
        `快捷键冲突：${conflict.label} 已使用 ${formatShortcutDisplay(normalized)}`,
      );
      return;
    }

    await setShortcut(actionId, normalized);
  };

  const handleShortcutClear = async (actionId: ShortcutActionId) => {
    await setShortcut(actionId, "");
  };

  const handleShortcutReset = async (actionId: ShortcutActionId) => {
    const defaultShortcut = DEFAULT_SHORTCUTS[actionId];
    const conflict = SHORTCUT_ACTIONS.find(
      (action) =>
        action.id !== actionId && shortcuts[action.id] === defaultShortcut,
    );

    if (conflict) {
      toast.error(
        `快捷键冲突：${conflict.label} 已使用 ${formatShortcutDisplay(defaultShortcut)}`,
      );
      return;
    }

    await resetShortcut(actionId);
  };

  const handleTestAiEndpoint = async (
    target: AiConfigTarget,
    endpointTarget: TauriAiEndpointTarget,
  ) => {
    setTestingTargets((state) => ({ ...state, [target]: true }));
    const loadingToast = toast.loading("正在测试接口...");

    try {
      const message = await testAiEndpoint(endpointTarget);
      toast.success(message, { id: loadingToast });
    } catch (error) {
      toast.error(`接口测试失败: ${String(error)}`, { id: loadingToast });
    } finally {
      setTestingTargets((state) => ({ ...state, [target]: false }));
    }
  };

  const handleSelectModelDir = async () => {
    setIsSelectingModelDir(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择 fgclip2 ONNX 模型目录",
      });

      if (selected && typeof selected === "string") {
        setVisualSearchField("modelPath", selected);
        await validateVisualModelPath(selected);
        await refreshVisualSearchStatus();
      }
    } catch (error) {
      console.error("Failed to select model directory:", error);
    } finally {
      setIsSelectingModelDir(false);
    }
  };

  const handleValidateModelDir = async (modelPath?: string) => {
    setIsValidatingModelDir(true);
    try {
      await validateVisualModelPath(modelPath);
      await refreshVisualSearchStatus();
    } finally {
      setIsValidatingModelDir(false);
    }
  };

  const handleRebuildVisualIndex = async () => {
    setIsRebuildingVisual(true);
    const loadingToast = toast.loading("正在重建视觉索引...");
    let unlistenProgress: UnlistenFn | null = null;

    try {
      unlistenProgress = await listen<VisualIndexProgressPayload>(
        "visual-index-progress",
        (event) => {
          const { processed, total } = event.payload;
          if (total <= 0) {
            toast.loading("正在重建视觉索引...", { id: loadingToast });
            return;
          }

          toast.loading(`正在重建视觉索引... ${processed}/${total}`, {
            id: loadingToast,
          });
        },
      );

      const result = await rebuildVisualIndex();
      toast.success(
        `视觉索引完成：成功 ${result.indexed}，失败 ${result.failed}，跳过 ${result.skipped}`,
        { id: loadingToast },
      );
    } catch (error) {
      toast.error(`重建视觉索引失败: ${String(error)}`, {
        id: loadingToast,
      });
    } finally {
      unlistenProgress?.();
      setIsRebuildingVisual(false);
    }
  };

  const renderAiConfigCard = (args: {
    title: string;
    description: string;
    target: AiConfigTarget;
    endpointTarget: TauriAiEndpointTarget;
    modelLabel: string;
    modelPlaceholder: string;
  }) => {
    const {
      title,
      description,
      target,
      endpointTarget,
      modelLabel,
      modelPlaceholder,
    } = args;
    const config = aiConfig[target];
    const baseUrlInputId = `ai-${target}-base-url`;
    const apiKeyInputId = `ai-${target}-api-key`;
    const modelInputId = `ai-${target}-model`;

    return (
      <div className="space-y-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
            模型配置
          </p>
          <h4 className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {title}
          </h4>
          <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
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
              onChange={(event) =>
                setAiConfigField(target, "baseUrl", event.target.value)
              }
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
              onChange={(event) =>
                setAiConfigField(target, "apiKey", event.target.value)
              }
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
              onChange={(event) =>
                setAiConfigField(target, "model", event.target.value)
              }
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
            disabled={testingTargets[target]}
            onClick={() => void handleTestAiEndpoint(target, endpointTarget)}
          >
            {testingTargets[target] ? "测试中..." : "测试接口"}
          </Button>
        </div>
      </div>
    );
  };

  const renderFeatureToggle = (args: {
    title: string;
    description: string;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    hint?: string;
  }) => {
    const { title, description, enabled, onChange, hint } = args;

    return (
      <div className="py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
              {title}
            </p>
            <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
              {description}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={onChange}
              aria-label={title}
            />
            <span
              className={cn(
                "text-xs font-medium",
                enabled
                  ? "text-primary-700 dark:text-primary-300"
                  : "text-gray-500 dark:text-gray-400",
              )}
            ></span>
          </div>
        </div>

        {hint ? (
          <div className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
            {hint}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex h-[42rem] max-h-[85vh] w-[64rem] max-w-[92vw] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0">
          <div className="border-b border-gray-200 px-6 py-5 dark:border-dark-border">
            <DialogTitle>设置</DialogTitle>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              调整素材目录、删除方式、外观、AI 和快捷键。
            </p>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden flex-col md:flex-row">
          <aside className="border-b border-gray-200 bg-gray-50/70 px-4 py-4 dark:border-dark-border dark:bg-dark-bg/40 md:w-52 md:border-b-0 md:border-r">
            <div className="flex gap-2 md:flex-col">
              <button
                type="button"
                onClick={() => setActiveSection("general")}
                className={`rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors ${
                  activeSection === "general"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100"
                    : "text-gray-500 hover:bg-white/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-dark-surface/70 dark:hover:text-gray-200"
                }`}
              >
                通用
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("ai")}
                className={`rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors ${
                  activeSection === "ai"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100"
                    : "text-gray-500 hover:bg-white/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-dark-surface/70 dark:hover:text-gray-200"
                }`}
              >
                AI
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("shortcuts")}
                className={`rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors ${
                  activeSection === "shortcuts"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100"
                    : "text-gray-500 hover:bg-white/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-dark-surface/70 dark:hover:text-gray-200"
                }`}
              >
                快捷键
              </button>
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {activeSection === "general" ? (
              <div className="space-y-8">
                <section className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        素材目录
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        当前只支持 1 个索引目录，更换后应用会自动重启。
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        onClick={handleAddPath}
                        disabled={isAdding}
                      >
                        <Plus className="w-4 h-4" />
                        {isAdding
                          ? "选择中..."
                          : currentIndexPath
                            ? "更换目录"
                            : "选择目录"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={isRebuilding}
                        onClick={async () => {
                          setIsRebuilding(true);
                          try {
                            await rebuildIndex();
                          } finally {
                            setIsRebuilding(false);
                          }
                        }}
                      >
                        {isRebuilding ? "重建中..." : "重建索引"}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50/80 dark:border-dark-border dark:bg-dark-bg/40">
                    {currentIndexPath === null ? (
                      <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                        暂无素材目录
                      </p>
                    ) : (
                      <div className="px-4 py-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          当前索引目录
                        </p>
                        <p className="mt-2 break-all text-sm text-gray-700 dark:text-gray-300">
                          {currentIndexPath}
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-4 border-t border-gray-200 pt-8 dark:border-dark-border">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      偏好
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      调整删除方式和主题。
                    </p>
                  </div>

                  <div className="rounded-xl border border-gray-200 dark:border-dark-border">
                    <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          删除方式
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          选择删除后是进入回收站，还是直接永久删除。
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-dark-border dark:bg-dark-bg">
                        <button
                          type="button"
                          onClick={() => setDeleteMode(true)}
                          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                            useTrash
                              ? "bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100"
                              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                          }`}
                        >
                          <Trash className="h-4 w-4" />
                          回收站
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteMode(false)}
                          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                            !useTrash
                              ? "bg-white text-red-600 shadow-sm dark:bg-dark-surface dark:text-red-300"
                              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                          }`}
                        >
                          <AlertTriangle className="h-4 w-4" />
                          直接删除
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-dark-border" />

                    <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          触控板缩放速度
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          调整预览页里按住 Ctrl / Cmd
                          并滚动触控板或滚轮时的缩放灵敏度。
                        </p>
                      </div>
                      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-dark-border dark:bg-dark-bg/40">
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>慢</span>
                          <span>快</span>
                        </div>
                        <div className="mt-2">
                          <input
                            type="range"
                            min={PREVIEW_TRACKPAD_ZOOM_SPEED_MIN}
                            max={PREVIEW_TRACKPAD_ZOOM_SPEED_MAX}
                            step={PREVIEW_TRACKPAD_ZOOM_SPEED_STEP}
                            value={previewTrackpadZoomSpeed}
                            onChange={(e) =>
                              void setPreviewTrackpadZoomSpeed(
                                Number(e.target.value),
                              )
                            }
                            className="w-full"
                          />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                            {previewTrackpadZoomSpeed.toFixed(1)}x
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void setPreviewTrackpadZoomSpeed(
                                DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED,
                              )
                            }
                            disabled={
                              previewTrackpadZoomSpeed ===
                              DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED
                            }
                          >
                            默认
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-dark-border" />

                    <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          外观
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          选择应用主题。
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant={theme === "light" ? "default" : "outline"}
                          onClick={() => setTheme("light")}
                          className="justify-start"
                        >
                          <Sun className="w-4 h-4" />
                          浅色
                        </Button>
                        <Button
                          variant={theme === "dark" ? "default" : "outline"}
                          onClick={() => setTheme("dark")}
                          className="justify-start"
                        >
                          <Moon className="w-4 h-4" />
                          深色
                        </Button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : activeSection === "ai" ? (
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
                    <StatusBadge
                      label={metadataStatusLabel}
                      tone={metadataStatusTone}
                    />
                  </div>

                  <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div>
                      {renderAiConfigCard({
                        title: "",
                        description: "",
                        target: "metadata",
                        endpointTarget: "metadata",
                        modelLabel: "多模态模型",
                        modelPlaceholder: "gpt-4.1-mini",
                      })}
                    </div>

                    <div className="border-t border-gray-200 pt-4 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-dark-border">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                        功能
                      </p>
                      <div className="mt-2 divide-y divide-gray-200 dark:divide-dark-border">
                        {renderFeatureToggle({
                          title: "导入后自动 AI 分析",
                          description:
                            "新导入图片后自动生成文件名、标签和备注。",
                          enabled: autoAnalyzeOnImport,
                          onChange: (enabled) => {
                            void setAutoAnalyzeOnImport(enabled);
                          },
                        })}
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
                        使用特调 fgclip2
                        模型，实现自然语言搜索，将额外占用~600MB内存。
                      </p>
                    </div>
                    <StatusBadge
                      label={visualSearchStatusLabel}
                      tone={visualSearchStatusTone}
                    />
                  </div>

                  <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
                    <div className="space-y-5">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                          功能
                        </p>
                        <div className="mt-2 divide-y divide-gray-200 dark:divide-dark-border">
                          {renderFeatureToggle({
                            title: "启用自然语言搜索",
                            description: "打开后，顶部搜索框支持自然语言搜索。",
                            enabled: visualSearch.enabled,
                            onChange: (enabled) =>
                              setVisualSearchField("enabled", enabled),
                          })}
                          {renderFeatureToggle({
                            title: "导入后自动建立视觉索引",
                            description:
                              "新导入图片会在后台自动建立视觉索引，便于后续直接搜索。",
                            enabled: visualSearch.autoVectorizeOnImport,
                            onChange: (enabled) =>
                              setVisualSearchField(
                                "autoVectorizeOnImport",
                                enabled,
                              ),
                          })}
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
                            label={
                              visualSearch.modelPath.trim()
                                ? "已填写路径"
                                : "未填写路径"
                            }
                            tone={
                              visualSearch.modelPath.trim()
                                ? "neutral"
                                : "warning"
                            }
                          />
                        </div>

                        <div className="mt-3 space-y-2">
                          <div className="flex flex-col gap-2 xl:flex-row">
                            <Input
                              id="visual-search-model-path"
                              value={visualSearch.modelPath}
                              onChange={(event) =>
                                setVisualSearchField(
                                  "modelPath",
                                  event.target.value,
                                )
                              }
                              onBlur={() => void handleValidateModelDir()}
                              placeholder=""
                            />
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => void handleSelectModelDir()}
                                disabled={isSelectingModelDir}
                              >
                                {isSelectingModelDir ? "选择中..." : "选择目录"}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => void handleValidateModelDir()}
                                disabled={isValidatingModelDir}
                              >
                                {isValidatingModelDir
                                  ? "校验中..."
                                  : "校验目录"}
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
                        {!visualModelValidation?.valid &&
                        visualModelValidation?.missingFiles.length ? (
                          <p className="mt-2 text-xs leading-6 text-amber-700 dark:text-amber-300">
                            缺少文件：
                            {visualModelValidation.missingFiles.join("、")}
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
                            disabled={isRebuildingVisual}
                            onClick={() => void handleRebuildVisualIndex()}
                          >
                            {isRebuildingVisual ? "重建中..." : "重建视觉索引"}
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
                            待处理 {pendingCount} · 失败 {failedCount} · 已过期{" "}
                            {visualIndexStatus?.outdatedCount ?? 0}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    快捷键
                  </h3>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-dark-border">
                  {SHORTCUT_ACTIONS.map((action, index) => (
                    <div
                      key={action.id}
                      className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
                        index !== SHORTCUT_ACTIONS.length - 1
                          ? "border-b border-gray-200 dark:border-dark-border"
                          : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {action.label}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {action.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ShortcutRecorder
                          shortcut={shortcuts[action.id]}
                          onChange={(nextShortcut) =>
                            handleShortcutChange(action.id, nextShortcut)
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleShortcutClear(action.id)}
                          disabled={!shortcuts[action.id]}
                        >
                          清空
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleShortcutReset(action.id)}
                          disabled={
                            shortcuts[action.id] ===
                            DEFAULT_SHORTCUTS[action.id]
                          }
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          默认
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
