import { useState } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";
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
import { Sun, Moon, Trash2, Plus, Trash, AlertTriangle, RotateCcw } from "lucide-react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsSection = "general" | "shortcuts";

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    indexPaths,
    addIndexPath,
    removeIndexPath,
    theme,
    setTheme,
    useTrash,
    setDeleteMode,
    rebuildIndex,
    shortcuts,
    setShortcut,
    resetShortcut,
  } =
    useSettingsStore();
  const [isAdding, setIsAdding] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  const handleAddPath = async () => {
    setIsAdding(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择素材目录",
      });
      if (selected && typeof selected === "string") {
        await addIndexPath(selected);
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
    }
    setIsAdding(false);
  };

  const handleShortcutChange = async (actionId: ShortcutActionId, nextShortcut: string) => {
    const normalized = normalizeShortcut(nextShortcut);
    if (!normalized) {
      return;
    }

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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader>
          <div className="border-b border-gray-200 px-6 py-5 dark:border-dark-border">
            <DialogTitle>设置</DialogTitle>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              调整素材目录、删除方式、外观和快捷键。
            </p>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-col md:flex-row">
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
                        管理会被索引的本地目录。
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        onClick={handleAddPath}
                        disabled={isAdding}
                      >
                        <Plus className="w-4 h-4" />
                        {isAdding ? "选择中..." : "添加目录"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={isRebuilding}
                        onClick={async () => {
                          setIsRebuilding(true)
                          try {
                            await rebuildIndex()
                          } finally {
                            setIsRebuilding(false)
                          }
                        }}
                      >
                        {isRebuilding ? "重建中..." : "重建索引"}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50/80 dark:border-dark-border dark:bg-dark-bg/40">
                    {indexPaths.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                        暂无素材目录
                      </p>
                    ) : (
                      indexPaths.map((path) => (
                        <div
                          key={path}
                          className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 dark:border-dark-border"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                            {path}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeIndexPath(path)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))
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
            ) : (
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    快捷键
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Windows / Linux 使用 `Ctrl`，macOS 使用 `Cmd`。录制时按 `Esc` 取消。
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-dark-border">
                  {SHORTCUT_ACTIONS.map((action, index) => (
                    <div
                      key={action.id}
                      className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
                        index !== SHORTCUT_ACTIONS.length - 1 ? "border-b border-gray-200 dark:border-dark-border" : ""
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
                          onChange={(nextShortcut) => handleShortcutChange(action.id, nextShortcut)}
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
                          disabled={shortcuts[action.id] === DEFAULT_SHORTCUTS[action.id]}
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

            <div className="mt-8 border-t border-gray-200 pt-4 dark:border-dark-border">
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                拾光 v0.1.0
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
