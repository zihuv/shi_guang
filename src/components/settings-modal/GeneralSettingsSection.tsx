import {
  DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED,
  PREVIEW_TRACKPAD_ZOOM_SPEED_MAX,
  PREVIEW_TRACKPAD_ZOOM_SPEED_MIN,
  PREVIEW_TRACKPAD_ZOOM_SPEED_STEP,
} from '@/stores/settingsStore'
import { Button } from '@/components/ui/Button'
import { AlertTriangle, Moon, Plus, Sun, Trash } from 'lucide-react'

interface GeneralSettingsSectionProps {
  currentIndexPath: string | null
  isAdding: boolean
  isRebuilding: boolean
  useTrash: boolean
  theme: 'light' | 'dark'
  previewTrackpadZoomSpeed: number
  onAddPath: () => void
  onRebuildIndex: () => void
  onSetDeleteMode: (useTrash: boolean) => void
  onSetPreviewTrackpadZoomSpeed: (value: number) => void
  onResetPreviewTrackpadZoomSpeed: () => void
  onSetTheme: (theme: 'light' | 'dark') => void
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
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">素材目录</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              当前只支持 1 个索引目录，更换后应用会自动重启。
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onAddPath} disabled={isAdding}>
              <Plus className="h-4 w-4" />
              {isAdding ? '选择中...' : currentIndexPath ? '更换目录' : '选择目录'}
            </Button>
            <Button variant="outline" disabled={isRebuilding} onClick={onRebuildIndex}>
              {isRebuilding ? '重建中...' : '重建索引'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50/80 dark:border-dark-border dark:bg-dark-bg/40">
          {currentIndexPath === null ? (
            <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">暂无素材目录</p>
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
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">偏好</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">调整删除方式和主题。</p>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-dark-border">
          <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">删除方式</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                选择删除后是进入回收站，还是直接永久删除。
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-dark-border dark:bg-dark-bg">
              <button
                type="button"
                onClick={() => onSetDeleteMode(true)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  useTrash
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Trash className="h-4 w-4" />
                回收站
              </button>
              <button
                type="button"
                onClick={() => onSetDeleteMode(false)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  !useTrash
                    ? 'bg-white text-red-600 shadow-sm dark:bg-dark-surface dark:text-red-300'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
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
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">触控板缩放速度</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                调整预览页里按住 Ctrl / Cmd 并滚动触控板或滚轮时的缩放灵敏度。
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
                  onChange={(event) => onSetPreviewTrackpadZoomSpeed(Number(event.target.value))}
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
                  onClick={onResetPreviewTrackpadZoomSpeed}
                  disabled={previewTrackpadZoomSpeed === DEFAULT_PREVIEW_TRACKPAD_ZOOM_SPEED}
                >
                  默认
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-dark-border" />

          <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">外观</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">选择应用主题。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                onClick={() => onSetTheme('light')}
                className="justify-start"
              >
                <Sun className="h-4 w-4" />
                浅色
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                onClick={() => onSetTheme('dark')}
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
  )
}
