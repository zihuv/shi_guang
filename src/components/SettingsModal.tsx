import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  startVisualModelDownload,
  cancelVisualModelDownload,
  testAiEndpoint,
  type AiEndpointTarget,
  type VisualModelDownloadRepoId,
} from "@/services/desktop/files";
import { getDesktopBridge, listenDesktop } from "@/services/desktop/core";
import { checkForUpdates, getAppVersion } from "@/services/desktop/system";
import type { VisualModelDownloadSnapshot } from "@/shared/desktop-types";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  formatShortcutDisplay,
  normalizeShortcut,
  type ShortcutActionId,
} from "@/lib/shortcuts";
import { useSettingsStore, type AiConfigTarget } from "@/stores/settingsStore";
import { useVisualIndexTaskStore } from "@/stores/visualIndexTaskStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { AiSettingsSection } from "@/components/settings-modal/AiSettingsSection";
import { GeneralSettingsSection } from "@/components/settings-modal/GeneralSettingsSection";
import { SettingsSidebar, type SettingsSection } from "@/components/settings-modal/SettingsSidebar";
import { ShortcutsSettingsSection } from "@/components/settings-modal/ShortcutsSettingsSection";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
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
  const setVisualSearchField = useSettingsStore((state) => state.setVisualSearchField);
  const setVisualSearchRuntimeField = useSettingsStore(
    (state) => state.setVisualSearchRuntimeField,
  );
  const autoAnalyzeOnImport = useSettingsStore((state) => state.autoAnalyzeOnImport);
  const setAutoAnalyzeOnImport = useSettingsStore((state) => state.setAutoAnalyzeOnImport);
  const autoCheckUpdates = useSettingsStore((state) => state.autoCheckUpdates);
  const setAutoCheckUpdates = useSettingsStore((state) => state.setAutoCheckUpdates);
  const refreshVisualSearchStatus = useSettingsStore((state) => state.refreshVisualSearchStatus);
  const visualIndexStatus = useSettingsStore((state) => state.visualIndexStatus);
  const visualModelValidation = useSettingsStore((state) => state.visualModelValidation);
  const validateVisualModelPath = useSettingsStore((state) => state.validateVisualModelPath);
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const setShortcut = useSettingsStore((state) => state.setShortcut);
  const resetShortcut = useSettingsStore((state) => state.resetShortcut);
  const previewTrackpadZoomSpeed = useSettingsStore((state) => state.previewTrackpadZoomSpeed);
  const setPreviewTrackpadZoomSpeed = useSettingsStore(
    (state) => state.setPreviewTrackpadZoomSpeed,
  );
  const visualIndexTask = useVisualIndexTaskStore((state) => state.visualIndexTask);
  const startVisualIndexTask = useVisualIndexTaskStore((state) => state.startVisualIndexTask);
  const cancelVisualIndexTask = useVisualIndexTaskStore((state) => state.cancelVisualIndexTask);

  const [isAdding, setIsAdding] = useState(false);
  const [isSelectingModelDir, setIsSelectingModelDir] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isValidatingModelDir, setIsValidatingModelDir] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [visualModelDownloadTask, setVisualModelDownloadTask] =
    useState<VisualModelDownloadSnapshot | null>(null);
  const [testingTargets, setTestingTargets] = useState<Record<AiConfigTarget, boolean>>({
    metadata: false,
  });
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const lastDownloadTerminalKeyRef = useRef("");

  useEffect(() => {
    if (!open) return;
    void loadSettings();
    void getAppVersion()
      .then(setAppVersion)
      .catch((error) => {
        console.error("Failed to load app version:", error);
      });
  }, [loadSettings, open]);

  useEffect(() => {
    if (!open || activeSection !== "ai") return;
    void refreshVisualSearchStatus();
  }, [activeSection, open, refreshVisualSearchStatus]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void listenDesktop<VisualModelDownloadSnapshot>("visual-model-download-updated", (event) => {
      setVisualModelDownloadTask(event.payload);
    })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        cleanup = unsubscribe;
      })
      .catch((error) => {
        console.error("Failed to listen visual model downloads:", error);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!visualModelDownloadTask) return;

    const isTerminal = ["completed", "failed", "cancelled"].includes(
      visualModelDownloadTask.status,
    );
    if (!isTerminal) {
      return;
    }

    const terminalKey = `${visualModelDownloadTask.id}:${visualModelDownloadTask.status}`;
    if (lastDownloadTerminalKeyRef.current === terminalKey) {
      return;
    }
    lastDownloadTerminalKeyRef.current = terminalKey;

    if (visualModelDownloadTask.status === "completed") {
      toast.success("视觉模型下载完成");
      setVisualSearchField("modelPath", visualModelDownloadTask.targetDir);
      void (async () => {
        await validateVisualModelPath(visualModelDownloadTask.targetDir);
        await refreshVisualSearchStatus();
      })();
      return;
    }

    if (visualModelDownloadTask.status === "failed") {
      toast.error(`视觉模型下载失败：${visualModelDownloadTask.error ?? "未知错误"}`);
      return;
    }

    toast.info("视觉模型下载已取消");
  }, [
    refreshVisualSearchStatus,
    setVisualSearchField,
    validateVisualModelPath,
    visualModelDownloadTask,
  ]);

  const currentIndexPath = indexPaths[0] ?? null;

  const handleAddPath = async () => {
    setIsAdding(true);
    try {
      const selected = await getDesktopBridge().dialog.open({
        properties: ["openDirectory"],
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
    } catch (error) {
      console.error("Failed to select directory:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRebuildIndex = async () => {
    setIsRebuilding(true);
    try {
      await rebuildIndex();
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleShortcutChange = async (actionId: ShortcutActionId, nextShortcut: string) => {
    const normalized = normalizeShortcut(nextShortcut);
    if (!normalized) return;

    const conflict = SHORTCUT_ACTIONS.find(
      (action) => action.id !== actionId && shortcuts[action.id] === normalized,
    );

    if (conflict) {
      toast.error(`快捷键冲突：${conflict.label} 已使用 ${formatShortcutDisplay(normalized)}`);
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
      (action) => action.id !== actionId && shortcuts[action.id] === defaultShortcut,
    );

    if (conflict) {
      toast.error(`快捷键冲突：${conflict.label} 已使用 ${formatShortcutDisplay(defaultShortcut)}`);
      return;
    }

    await resetShortcut(actionId);
  };

  const handleTestAiEndpoint = async (target: AiConfigTarget, endpointTarget: AiEndpointTarget) => {
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
      const selected = await getDesktopBridge().dialog.open({
        properties: ["openDirectory"],
        title: "选择视觉搜索模型目录",
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

  const handleStartVisualModelDownload = async (repoId: VisualModelDownloadRepoId) => {
    const selected = await getDesktopBridge().dialog.open({
      properties: ["openDirectory", "createDirectory"],
      title: "选择模型下载位置",
      buttonLabel: "下载到这里",
    });

    if (!selected || typeof selected !== "string") {
      return;
    }

    try {
      const task = await startVisualModelDownload({ repoId, targetParentDir: selected });
      setVisualModelDownloadTask(task);
      toast.info(`开始下载到 ${task.targetDir}`);
    } catch (error) {
      toast.error(`启动模型下载失败：${String(error)}`);
    }
  };

  const handleCancelVisualModelDownload = async () => {
    if (!visualModelDownloadTask) {
      return;
    }
    try {
      await cancelVisualModelDownload(visualModelDownloadTask.id);
    } catch (error) {
      toast.error(`取消模型下载失败：${String(error)}`);
    }
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdates(true);
    const loadingToast = toast.loading("正在检查更新...");

    try {
      const result = await checkForUpdates();
      if (result.status === "error") {
        toast.error(`检查更新失败：${result.message}`, { id: loadingToast });
        return;
      }

      if (result.status === "available") {
        toast.success(result.message, { id: loadingToast });
        return;
      }

      toast.info(result.message, { id: loadingToast });
    } catch (error) {
      toast.error(`检查更新失败：${String(error)}`, { id: loadingToast });
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex h-[42rem] max-h-[86vh] w-[62rem] max-w-[92vw] flex-col overflow-hidden border-transparent bg-[var(--app-surface)] p-0 shadow-[var(--app-shadow)]">
        <DialogHeader className="shrink-0">
          <div className="px-5 pb-2 pt-4">
            <DialogTitle className="text-[15px] font-semibold tracking-[-0.01em]">设置</DialogTitle>
            <DialogDescription className="sr-only">
              管理索引目录、界面外观、AI 能力与快捷键设置。
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <SettingsSidebar activeSection={activeSection} onSelectSection={setActiveSection} />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-2 md:px-6">
            <div className="mx-auto w-full max-w-[52rem]">
              {activeSection === "general" ? (
                <GeneralSettingsSection
                  currentIndexPath={currentIndexPath}
                  isAdding={isAdding}
                  isRebuilding={isRebuilding}
                  useTrash={useTrash}
                  theme={theme}
                  previewTrackpadZoomSpeed={previewTrackpadZoomSpeed}
                  autoCheckUpdates={autoCheckUpdates}
                  appVersion={appVersion}
                  isCheckingUpdates={isCheckingUpdates}
                  onAddPath={() => void handleAddPath()}
                  onRebuildIndex={() => void handleRebuildIndex()}
                  onSetDeleteMode={(enabled) => void setDeleteMode(enabled)}
                  onSetPreviewTrackpadZoomSpeed={(value) => void setPreviewTrackpadZoomSpeed(value)}
                  onResetPreviewTrackpadZoomSpeed={() => void setPreviewTrackpadZoomSpeed(1)}
                  onSetTheme={(nextTheme) => void setTheme(nextTheme)}
                  onSetAutoCheckUpdates={(enabled) => void setAutoCheckUpdates(enabled)}
                  onCheckUpdates={() => void handleCheckUpdates()}
                />
              ) : activeSection === "ai" ? (
                <AiSettingsSection
                  aiConfig={aiConfig}
                  testingTargets={testingTargets}
                  autoAnalyzeOnImport={autoAnalyzeOnImport}
                  visualSearch={visualSearch}
                  visualIndexStatus={visualIndexStatus}
                  visualIndexTask={visualIndexTask}
                  visualModelValidation={visualModelValidation}
                  visualModelDownloadTask={visualModelDownloadTask}
                  isSelectingModelDir={isSelectingModelDir}
                  isValidatingModelDir={isValidatingModelDir}
                  onSetAiConfigField={setAiConfigField}
                  onTestAiEndpoint={(target, endpointTarget) =>
                    void handleTestAiEndpoint(target, endpointTarget)
                  }
                  onSetAutoAnalyzeOnImport={(enabled) => void setAutoAnalyzeOnImport(enabled)}
                  onSetVisualSearchField={setVisualSearchField}
                  onSetVisualSearchRuntimeField={setVisualSearchRuntimeField}
                  onSelectModelDir={() => void handleSelectModelDir()}
                  onValidateModelDir={(modelPath) => void handleValidateModelDir(modelPath)}
                  onStartVisualModelDownload={(repoId) =>
                    void handleStartVisualModelDownload(repoId)
                  }
                  onCancelVisualModelDownload={() => void handleCancelVisualModelDownload()}
                  onStartVisualIndexTask={() =>
                    void startVisualIndexTask(visualSearch.processUnindexedOnly)
                  }
                  onCancelVisualIndexTask={() => void cancelVisualIndexTask()}
                />
              ) : (
                <ShortcutsSettingsSection
                  shortcuts={shortcuts}
                  onShortcutChange={(actionId, nextShortcut) =>
                    void handleShortcutChange(actionId, nextShortcut)
                  }
                  onShortcutClear={(actionId) => void handleShortcutClear(actionId)}
                  onShortcutReset={(actionId) => void handleShortcutReset(actionId)}
                />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
