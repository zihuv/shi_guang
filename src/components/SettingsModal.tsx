import { useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Sun, Moon, Trash2, Plus, Trash, AlertTriangle } from "lucide-react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { indexPaths, addIndexPath, removeIndexPath, theme, setTheme, useTrash, setDeleteMode, rebuildIndex } =
    useSettingsStore();
  const [isAdding, setIsAdding] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              素材目录
            </h3>
            <div className="space-y-2">
              {indexPaths.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  暂无素材目录
                </p>
              ) : (
                indexPaths.map((path) => (
                  <div
                    key={path}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-dark-bg rounded-lg"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
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
              <Button
                variant="outline"
                onClick={handleAddPath}
                disabled={isAdding}
                className="w-full"
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
                className="w-full"
              >
                {isRebuilding ? "重建中..." : "完整重建索引"}
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              删除设置
            </h3>
            <div className="space-y-3">
              <div
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  useTrash
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                    : "bg-gray-50 dark:bg-dark-bg border-gray-200 dark:border-dark-border"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      useTrash
                        ? "bg-blue-100 dark:bg-blue-800"
                        : "bg-gray-200 dark:bg-dark-border"
                    }`}
                  >
                    <Trash
                      className={`w-5 h-5 ${
                        useTrash
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      移动到回收站
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      删除的文件可以恢复
                    </p>
                  </div>
                </div>
                <Button
                  variant={useTrash ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDeleteMode(true)}
                >
                  开启
                </Button>
              </div>

              <div
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  !useTrash
                    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                    : "bg-gray-50 dark:bg-dark-bg border-gray-200 dark:border-dark-border"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      !useTrash
                        ? "bg-red-100 dark:bg-red-800"
                        : "bg-gray-200 dark:bg-dark-border"
                    }`}
                  >
                    <AlertTriangle
                      className={`w-5 h-5 ${
                        !useTrash
                          ? "text-red-600 dark:text-red-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      直接删除
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      文件将被永久删除
                    </p>
                  </div>
                </div>
                <Button
                  variant={!useTrash ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDeleteMode(false)}
                  className={!useTrash ? "bg-red-500 hover:bg-red-600" : ""}
                >
                  开启
                </Button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              外观
            </h3>
            <div className="flex gap-3">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => setTheme("light")}
                className="flex-1"
              >
                <Sun className="w-4 h-4" />
                浅色
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => setTheme("dark")}
                className="flex-1"
              >
                <Moon className="w-4 h-4" />
                深色
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-dark-border">
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              拾光 v0.1.0
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
