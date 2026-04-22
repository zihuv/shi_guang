import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAiBatchAnalyzeStore } from "@/stores/aiBatchAnalyzeStore";
import { useImportStore } from "@/stores/importStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getDesktopBridge } from "@/services/desktop/core";
import { showCurrentLibraryInExplorer } from "@/services/desktop/system";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import appLogo from "@/assets/app-icon.png";

interface HeaderProps {
  onOpenSettings: () => void;
}

export default function Header({ onOpenSettings }: HeaderProps) {
  const searchQuery = useLibraryQueryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryQueryStore((state) => state.setSearchQuery);
  const importFiles = useImportStore((state) => state.importFiles);
  const importTask = useImportStore((state) => state.importTask);
  const aiMetadataTask = useAiBatchAnalyzeStore((state) => state.aiMetadataTask);
  const cancelBatchAnalyze = useAiBatchAnalyzeStore((state) => state.cancelBatchAnalyze);
  const { theme, setTheme, indexPaths, recentIndexPaths, switchIndexPath, rebuildIndex } =
    useSettingsStore();
  const currentIndexPath = indexPaths[0] ?? null;
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useState(false);
  const [isSelectingLibrary, setIsSelectingLibrary] = useState(false);
  const [isRebuildingLibrary, setIsRebuildingLibrary] = useState(false);
  const libraryMenuRef = useRef<HTMLDivElement>(null);
  const isImporting =
    !!importTask &&
    !["completed", "completed_with_errors", "cancelled", "failed"].includes(importTask.status);
  const importProgress = importTask?.total
    ? Math.min(100, Math.round((importTask.processed / importTask.total) * 100))
    : 0;
  const importCountLabel = `${importTask?.processed ?? 0}/${importTask?.total ?? 0}`;
  const isAiAnalyzing =
    !!aiMetadataTask &&
    !["completed", "completed_with_errors", "cancelled", "failed"].includes(aiMetadataTask.status);
  const aiProgress = aiMetadataTask?.total
    ? Math.min(100, Math.round((aiMetadataTask.processed / aiMetadataTask.total) * 100))
    : 0;
  const aiCountLabel = `${aiMetadataTask?.processed ?? 0}/${aiMetadataTask?.total ?? 0}`;
  const currentLibraryName = useMemo(() => {
    if (!currentIndexPath) {
      return "未选择素材库";
    }
    const parts = currentIndexPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? currentIndexPath;
  }, [currentIndexPath]);
  const recentLibraries = useMemo(
    () =>
      recentIndexPaths.map((libraryPath) => {
        const parts = libraryPath.split(/[\\/]/).filter(Boolean);
        return {
          path: libraryPath,
          name: parts[parts.length - 1] ?? libraryPath,
        };
      }),
    [recentIndexPaths],
  );

  useEffect(() => {
    if (!isLibraryMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!libraryMenuRef.current?.contains(event.target as Node)) {
        setIsLibraryMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsLibraryMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLibraryMenuOpen]);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleSwitchLibrary = async (nextPath: string) => {
    try {
      const normalizedNextPath = nextPath.trim();
      if (!normalizedNextPath) {
        return;
      }

      if (normalizedNextPath === currentIndexPath) {
        toast.info("当前已经是这个素材库");
        return;
      }

      toast.info("正在切换素材库，应用将自动重启");
      setIsLibraryMenuOpen(false);
      await switchIndexPath(normalizedNextPath);
    } catch (error) {
      console.error("Failed to choose library:", error);
      toast.error(`切换素材库失败: ${String(error)}`);
    }
  };

  const handleChooseLibrary = async () => {
    setIsSelectingLibrary(true);
    try {
      const selected = await getDesktopBridge().dialog.open({
        properties: ["openDirectory", "createDirectory"],
        title: "选择素材库文件夹",
      });

      if (!selected || typeof selected !== "string") {
        return;
      }

      await handleSwitchLibrary(selected);
    } finally {
      setIsSelectingLibrary(false);
    }
  };

  const handleOpenCurrentLibrary = async () => {
    try {
      await showCurrentLibraryInExplorer();
      setIsLibraryMenuOpen(false);
    } catch (error) {
      console.error("Failed to open current library in explorer:", error);
      toast.error(`打开素材库失败: ${String(error)}`);
    }
  };

  const handleRebuildLibrary = async () => {
    setIsRebuildingLibrary(true);
    try {
      await rebuildIndex();
      toast.success("素材库索引已重建");
      setIsLibraryMenuOpen(false);
    } catch (error) {
      console.error("Failed to rebuild library:", error);
      toast.error(`重建索引失败: ${String(error)}`);
    } finally {
      setIsRebuildingLibrary(false);
    }
  };

  const handleImport = async () => {
    try {
      const selected = await getDesktopBridge().dialog.open({
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Images",
            extensions: [
              "jpg",
              "jpeg",
              "png",
              "gif",
              "webp",
              "svg",
              "bmp",
              "ico",
              "tiff",
              "tif",
              "psd",
              "ai",
              "eps",
              "raw",
              "cr2",
              "nef",
              "arw",
              "dng",
              "heic",
              "heif",
              "pdf",
              "mp4",
              "avi",
              "mov",
              "mkv",
              "wmv",
              "flv",
              "webm",
              "m4v",
              "3gp",
            ],
          },
        ],
        title: "选择要导入的素材",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        void importFiles(paths);
      }
    } catch (e) {
      console.error("Failed to import files:", e);
    }
  };

  return (
    <header className="app-topbar">
      <div className="flex h-full items-center gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2.5 pr-1">
          <img src={appLogo} alt="" className="size-6 rounded-md" />
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-800 dark:text-gray-100">
              拾光
            </h1>
            <div ref={libraryMenuRef} className="relative min-w-0">
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 max-w-[18rem] items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-gray-600 transition-colors hover:bg-black/5 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/8 dark:hover:text-gray-100",
                  isLibraryMenuOpen &&
                    "bg-black/5 text-gray-900 dark:bg-white/8 dark:text-gray-100",
                )}
                onClick={() => setIsLibraryMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={isLibraryMenuOpen}
                title={currentIndexPath ?? currentLibraryName}
              >
                <span className="truncate font-medium">{currentLibraryName}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 flex-shrink-0 transition-transform",
                    isLibraryMenuOpen && "rotate-180",
                  )}
                />
              </button>

              {isLibraryMenuOpen ? (
                <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-[22rem] rounded-xl border border-black/10 bg-white/96 p-2 shadow-[0_14px_32px_rgba(0,0,0,0.12)] backdrop-blur dark:border-white/10 dark:bg-[#171717]/96">
                  <div className="rounded-lg px-2.5 py-2">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-gray-900 dark:text-gray-100">
                      <span className="truncate">{currentLibraryName}</span>
                      <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                    </div>
                    {currentIndexPath ? (
                      <p className="mt-1 break-all text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                        {currentIndexPath}
                      </p>
                    ) : null}
                  </div>

                  <div className="my-1 h-px bg-black/6 dark:bg-white/8" />

                  <div className="flex flex-col">
                    {recentLibraries.length > 0 ? (
                      <>
                        <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                          最近素材库
                        </div>
                        {recentLibraries.map((library) => (
                          <button
                            key={library.path}
                            type="button"
                            className="flex min-h-11 flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/8"
                            onClick={() => void handleSwitchLibrary(library.path)}
                          >
                            <span className="w-full truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">
                              {library.name}
                            </span>
                            <span className="w-full truncate text-[11px] text-gray-500 dark:text-gray-400">
                              {library.path}
                            </span>
                          </button>
                        ))}
                        <div className="my-1 h-px bg-black/6 dark:bg-white/8" />
                      </>
                    ) : null}

                    <button
                      type="button"
                      className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-gray-700 transition-colors hover:bg-black/5 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/8 dark:hover:text-gray-100"
                      onClick={() => void handleChooseLibrary()}
                      disabled={isSelectingLibrary}
                    >
                      <ChevronDown className="h-4 w-4 -rotate-90" />
                      {isSelectingLibrary ? "选择中..." : "更换素材库"}
                    </button>
                    <button
                      type="button"
                      className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-gray-700 transition-colors hover:bg-black/5 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/8 dark:hover:text-gray-100"
                      onClick={() => void handleOpenCurrentLibrary()}
                    >
                      <FolderOpen className="h-4 w-4" />
                      在资源管理器中打开
                    </button>
                    <button
                      type="button"
                      className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-gray-700 transition-colors hover:bg-black/5 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/8 dark:hover:text-gray-100"
                      onClick={() => void handleRebuildLibrary()}
                      disabled={isRebuildingLibrary}
                    >
                      <RefreshCw className={cn("h-4 w-4", isRebuildingLibrary && "animate-spin")} />
                      {isRebuildingLibrary ? "重建中..." : "重建索引"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0 max-w-[38rem] flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="搜索图片，支持中文自然语言..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-xl border-gray-200/90 bg-white/80 pl-9 shadow-none dark:border-dark-border dark:bg-dark-bg/50"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {isAiAnalyzing && (
            <div
              className="hidden min-w-[124px] items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 sm:flex dark:border-amber-900/40 dark:bg-amber-950/20"
              role="status"
              aria-live="polite"
              aria-label={`AI 分析进度 ${aiCountLabel}`}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
              <span className="text-[11px] font-medium leading-none tabular-nums text-amber-700 dark:text-amber-300">
                {aiCountLabel}
              </span>
              <div className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-900/30">
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                  style={{ width: `${aiProgress}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => void cancelBatchAnalyze()}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
                title="取消 AI 分析任务"
                aria-label="取消 AI 分析任务"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {isImporting && (
            <div
              className="hidden min-w-[96px] items-center gap-2 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 sm:flex dark:border-blue-900/40 dark:bg-blue-950/20"
              role="status"
              aria-live="polite"
              aria-label={`导入进度 ${importCountLabel}`}
            >
              <span className="text-[11px] font-medium leading-none tabular-nums text-blue-700 dark:text-blue-300">
                {importCountLabel}
              </span>
              <div className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}

          <Button
            onClick={handleImport}
            disabled={isImporting}
            title="导入图片"
            className="rounded-xl px-3.5"
          >
            <Download className="h-4 w-4" />
            导入
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            title={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
            className="rounded-xl"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            title="设置"
            className="rounded-xl"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
