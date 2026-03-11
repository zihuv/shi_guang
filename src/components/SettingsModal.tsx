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
import { Sun, Moon, Trash2, Plus } from "lucide-react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { indexPaths, addIndexPath, removeIndexPath, theme, setTheme } =
    useSettingsStore();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddPath = async () => {
    setIsAdding(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择索引目录",
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
              索引目录
            </h3>
            <div className="space-y-2">
              {indexPaths.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  暂无索引目录
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
