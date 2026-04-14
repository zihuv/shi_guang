import type { CSSProperties } from "react";
import { appPanelClass, appPanelHeaderClass, appPanelTitleClass } from "@/lib/ui";

interface AppStartupScreenProps {
  sidebarWidth: number;
  detailPanelWidth: number;
  errorMessage: string | null;
}

const skeletonClass =
  "bg-gray-200/80 dark:bg-dark-border/90 motion-safe:animate-pulse motion-reduce:animate-none";

function SkeletonBlock({ className, style }: { className: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={`${skeletonClass} ${className}`} style={style} />;
}

export default function AppStartupScreen({
  sidebarWidth,
  detailPanelWidth,
  errorMessage,
}: AppStartupScreenProps) {
  const panelBorderStyle = { borderColor: "var(--app-border)" };

  return (
    <div className="app-shell flex h-screen flex-col" aria-busy={!errorMessage}>
      <div className="app-topbar flex items-center gap-3 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 text-sm font-semibold text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100">
            拾
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">拾光</span>
            <span
              className="text-[11px] text-gray-500 dark:text-gray-400"
              aria-live="polite"
              role="status"
            >
              {errorMessage ? "启动遇到问题" : "正在恢复上次位置"}
            </span>
          </div>
        </div>

        <SkeletonBlock className="h-10 flex-1 rounded-2xl" />

        {!errorMessage && (
          <div className="hidden items-center gap-2 rounded-full border border-gray-200/80 bg-white/75 px-3 py-1 text-[11px] text-gray-500 dark:border-dark-border dark:bg-dark-surface/75 dark:text-gray-400 lg:inline-flex">
            <div className="h-2 w-2 rounded-full bg-blue-500 motion-safe:animate-pulse motion-reduce:animate-none" />
            恢复上次位置
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SkeletonBlock className="h-8 w-8 rounded-full" />
          <SkeletonBlock className="h-8 w-8 rounded-full" />
          <SkeletonBlock className="h-8 w-8 rounded-full" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`${appPanelClass} flex-shrink-0 border-r`}
          style={{ ...panelBorderStyle, width: sidebarWidth }}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={appPanelHeaderClass}>
              <h2 className={appPanelTitleClass}>文件夹</h2>
              <SkeletonBlock className="h-7 w-16 rounded-lg" />
            </div>
            <div className="flex-1 overflow-hidden p-2.5">
              <div className="flex flex-col gap-2">
                <div className="rounded-xl bg-blue-500/10 p-2 dark:bg-blue-500/12">
                  <div className="flex items-center gap-2">
                    <SkeletonBlock className="h-4 w-4 rounded-full bg-blue-200/90 dark:bg-blue-500/30" />
                    <SkeletonBlock className="h-3.5 w-28 rounded-md bg-blue-200/90 dark:bg-blue-500/30" />
                    <SkeletonBlock className="ml-auto h-3 w-7 rounded-md bg-blue-200/90 dark:bg-blue-500/30" />
                  </div>
                </div>
                {[120, 92, 108, 76, 96].map((width, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2">
                    <SkeletonBlock className="h-4 w-4 rounded" />
                    <SkeletonBlock className="h-3.5 flex-none rounded-md" style={{ width }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="app-panel-divider border-t" style={panelBorderStyle} />
            <div className="flex-1 overflow-hidden p-2.5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className={appPanelTitleClass}>标签</h2>
                <SkeletonBlock className="h-7 w-7 rounded-lg" />
              </div>
              <div className="flex flex-col gap-2">
                {[84, 72, 90, 68, 80, 58].map((width, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2">
                    <SkeletonBlock className="h-4 w-4 rounded" />
                    <SkeletonBlock className="h-3.5 flex-none rounded-md" style={{ width }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <div className="w-px flex-shrink-0" style={panelBorderStyle} />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b px-4 py-3" style={panelBorderStyle}>
            <div className="flex items-center justify-between gap-4">
              <SkeletonBlock className="h-4 w-36 rounded-md" />
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-8 w-8 rounded-xl" />
                <SkeletonBlock className="h-8 w-8 rounded-xl" />
                <SkeletonBlock className="h-8 w-8 rounded-xl" />
                <SkeletonBlock className="h-8 w-28 rounded-full" />
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-4">
            {errorMessage ? (
              <div className="flex h-full items-center justify-center">
                <div className="app-card-surface w-full max-w-md rounded-3xl p-6">
                  <div className="mb-2 text-sm font-semibold text-red-500">启动失败</div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{errorMessage}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="app-card-surface overflow-hidden rounded-[18px] p-3">
                    <SkeletonBlock className="mb-3 aspect-[4/3] rounded-[14px]" />
                    <SkeletonBlock className="mb-2 h-4 w-4/5 rounded-md" />
                    <SkeletonBlock className="h-3 w-2/3 rounded-md" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t px-4 py-3" style={panelBorderStyle}>
            <div className="flex items-center justify-center gap-2">
              <SkeletonBlock className="h-8 w-14 rounded-lg" />
              <SkeletonBlock className="h-8 w-14 rounded-lg" />
              <SkeletonBlock className="h-4 w-20 rounded-md" />
              <SkeletonBlock className="h-8 w-20 rounded-xl" />
            </div>
          </div>
        </main>

        <div className="w-px flex-shrink-0" style={panelBorderStyle} />

        <aside
          className={`${appPanelClass} flex-shrink-0 border-l`}
          style={{ ...panelBorderStyle, width: detailPanelWidth }}
        >
          <div className={appPanelHeaderClass}>
            <h2 className={appPanelTitleClass}>文件夹详情</h2>
            <SkeletonBlock className="h-7 w-7 rounded-lg" />
          </div>
          <div className="flex flex-col gap-5 p-4">
            <SkeletonBlock className="mx-auto h-24 w-24 rounded-[28px]" />
            {[52, 36, 60].map((width, index) => (
              <div key={index}>
                <SkeletonBlock className="mb-2 h-3 w-16 rounded-md" />
                <SkeletonBlock
                  className="h-4 flex-none rounded-md"
                  style={{ width: `${width}%` }}
                />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
