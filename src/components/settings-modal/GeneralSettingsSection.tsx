import {
  DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED,
  PREVIEW_TRACKPAD_ZOOM_SPEED_MAX,
  PREVIEW_TRACKPAD_ZOOM_SPEED_MIN,
  PREVIEW_TRACKPAD_ZOOM_SPEED_STEP,
} from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, Moon, Plus, Sun, Trash } from "lucide-react";

interface GeneralSettingsSectionProps {
  currentIndexPath: string | null;
  isAdding: boolean;
  isRebuilding: boolean;
  useTrash: boolean;
  theme: "light" | "dark";
  previewTrackpadZoomSpeed: number;
  onAddPath: () => void;
  onRebuildIndex: () => void;
  onSetDeleteMode: (useTrash: boolean) => void;
  onSetPreviewTrackpadZoomSpeed: (value: number) => void;
  onResetPreviewTrackpadZoomSpeed: () => void;
  onSetTheme: (theme: "light" | "dark") => void;
}

export function GeneralSettingsSection({
  currentIndexPath,
  isAdding,
  isRebuilding,
  useTrash,
  theme,
  previewTrackpadZoomSpeed,
  onAddPath,
  onRebuildIndex,
  onSetDeleteMode,
  onSetPreviewTrackpadZoomSpeed,
  onResetPreviewTrackpadZoomSpeed,
  onSetTheme,
}: GeneralSettingsSectionProps) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">素材目录</h3>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onAddPath} disabled={isAdding}>
              <Plus className="h-4 w-4" />
              {isAdding ? "选择中..." : currentIndexPath ? "更换目录" : "选择目录"}
            </Button>
            <Button variant="outline" disabled={isRebuilding} onClick={onRebuildIndex}>
              {isRebuilding ? "重建中..." : "重建索引"}
            </Button>
          </div>
        </div>

        <div className="py-2">
          <div className="grid gap-2 md:grid-cols-[7rem_minmax(0,1fr)]">
            <span className="text-sm text-gray-500 dark:text-gray-400">当前目录</span>
            <span className="break-all text-sm text-gray-800 dark:text-gray-200">
              {currentIndexPath ?? "暂无素材目录"}
            </span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">偏好</h3>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">删除方式</p>
            </div>
            <div className="inline-flex rounded-[10px] bg-gray-100 p-1 dark:bg-dark-bg">
              <button
                type="button"
                onClick={() => onSetDeleteMode(true)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-sm transition-colors",
                  useTrash
                    ? "bg-white text-gray-900 dark:bg-dark-surface dark:text-gray-100"
                    : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
                )}
              >
                <Trash className="h-4 w-4" />
                回收站
              </button>
              <button
                type="button"
                onClick={() => onSetDeleteMode(false)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-sm transition-colors",
                  !useTrash
                    ? "bg-white text-red-600 dark:bg-dark-surface dark:text-red-300"
                    : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
                )}
              >
                <AlertTriangle className="h-4 w-4" />
                直接删除
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">预览缩放速度</p>
            </div>
            <div className="w-full max-w-sm">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">慢</span>
                <input
                  type="range"
                  min={PREVIEW_TRACKPAD_ZOOM_SPEED_MIN}
                  max={PREVIEW_TRACKPAD_ZOOM_SPEED_MAX}
                  step={PREVIEW_TRACKPAD_ZOOM_SPEED_STEP}
                  value={previewTrackpadZoomSpeed}
                  onChange={(event) => onSetPreviewTrackpadZoomSpeed(Number(event.target.value))}
                  className="w-full"
                />
                <span className="text-right text-xs text-gray-500 dark:text-gray-400">快</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {previewTrackpadZoomSpeed.toFixed(1)}x
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onResetPreviewTrackpadZoomSpeed}
                  disabled={previewTrackpadZoomSpeed === DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED}
                >
                  默认
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">外观</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => onSetTheme("light")}
                className="justify-start"
              >
                <Sun className="h-4 w-4" />
                浅色
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => onSetTheme("dark")}
                className="justify-start"
              >
                <Moon className="h-4 w-4" />
                深色
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
