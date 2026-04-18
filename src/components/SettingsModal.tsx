import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  testAiEndpoint,
  type AiEndpointTarget as TauriAiEndpointTarget,
} from "@/services/tauri/files";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  formatShortcutDisplay,
  normalizeShortcut,
  type ShortcutActionId,
} from "@/lib/shortcuts";
import { useSettingsStore, type AiConfigTarget } from "@/stores/settingsStore";
import { useVisualIndexTaskStore } from "@/stores/visualIndexTaskStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
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
  const aiBatchAnalyzeConcurrency = useSettingsStore((state) => state.aiBatchAnalyzeConcurrency);
  const setAiBatchAnalyzeConcurrency = useSettingsStore(
    (state) => state.setAiBatchAnalyzeConcurrency,
  );
  const visualSearch = useSettingsStore((state) => state.visualSearch);
  const setVisualSearchField = useSettingsStore((state) => state.setVisualSearchField);
  const setVisualSearchRuntimeField = useSettingsStore(
    (state) => state.setVisualSearchRuntimeField,
  );
  const autoAnalyzeOnImport = useSettingsStore((state) => state.autoAnalyzeOnImport);
  const setAutoAnalyzeOnImport = useSettingsStore((state) => state.setAutoAnalyzeOnImport);
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
  const [testingTargets, setTestingTargets] = useState<Record<AiConfigTarget, boolean>>({
    metadata: false,
  });
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  useEffect(() => {
    if (!open) return;
    void loadSettings();
  }, [loadSettings, open]);

  useEffect(() => {
    if (!open || activeSection !== "ai") return;
    void refreshVisualSearchStatus();
  }, [activeSection, open, refreshVisualSearchStatus]);

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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <SettingsSidebar activeSection={activeSection} onSelectSection={setActiveSection} />

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {activeSection === "general" ? (
              <GeneralSettingsSection
                currentIndexPath={currentIndexPath}
                isAdding={isAdding}
                isRebuilding={isRebuilding}
                useTrash={useTrash}
                theme={theme}
                previewTrackpadZoomSpeed={previewTrackpadZoomSpeed}
                onAddPath={() => void handleAddPath()}
                onRebuildIndex={() => void handleRebuildIndex()}
                onSetDeleteMode={(enabled) => void setDeleteMode(enabled)}
                onSetPreviewTrackpadZoomSpeed={(value) => void setPreviewTrackpadZoomSpeed(value)}
                onResetPreviewTrackpadZoomSpeed={() => void setPreviewTrackpadZoomSpeed(1)}
                onSetTheme={(nextTheme) => void setTheme(nextTheme)}
              />
            ) : activeSection === "ai" ? (
              <AiSettingsSection
                aiConfig={aiConfig}
                testingTargets={testingTargets}
                autoAnalyzeOnImport={autoAnalyzeOnImport}
                aiBatchAnalyzeConcurrency={aiBatchAnalyzeConcurrency}
                visualSearch={visualSearch}
                visualIndexStatus={visualIndexStatus}
                visualIndexTask={visualIndexTask}
                visualModelValidation={visualModelValidation}
                isSelectingModelDir={isSelectingModelDir}
                isValidatingModelDir={isValidatingModelDir}
                onSetAiConfigField={setAiConfigField}
                onTestAiEndpoint={(target, endpointTarget) =>
                  void handleTestAiEndpoint(target, endpointTarget)
                }
                onSetAutoAnalyzeOnImport={(enabled) => void setAutoAnalyzeOnImport(enabled)}
                onSetAiBatchAnalyzeConcurrency={(value) => void setAiBatchAnalyzeConcurrency(value)}
                onSetVisualSearchField={setVisualSearchField}
                onSetVisualSearchRuntimeField={setVisualSearchRuntimeField}
                onSelectModelDir={() => void handleSelectModelDir()}
                onValidateModelDir={(modelPath) => void handleValidateModelDir(modelPath)}
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
      </DialogContent>
    </Dialog>
  );
}
