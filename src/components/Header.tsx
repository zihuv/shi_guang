import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { INTERNAL_FILE_DRAG_MIME } from "@/components/folder-tree/utils";
import { getNameWithoutExt, isTerminalTaskStatus } from "@/stores/fileTypes";
import { useAiBatchAnalyzeStore } from "@/stores/aiBatchAnalyzeStore";
import { useImportStore } from "@/stores/importStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getDesktopBridge } from "@/services/desktop/core";
import { getFile } from "@/services/desktop/files";
import { showCurrentLibraryInExplorer } from "@/services/desktop/system";
import { Button } from "@/components/ui/Button";
import {
  handlePrimaryClipboardShortcut,
  handlePrimarySelectAll,
} from "@/lib/textSelectionShortcuts";
import { IMPORT_DIALOG_EXTENSIONS } from "@/shared/file-formats";
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
import { appTagPillClass } from "@/lib/ui";
import appLogo from "@/assets/app-icon.png";

interface HeaderProps {
  onOpenSettings: () => void;
}

export default function Header({ onOpenSettings }: HeaderProps) {
  const searchQuery = useLibraryQueryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryQueryStore((state) => state.setSearchQuery);
  const aiSearchEnabled = useLibraryQueryStore((state) => state.aiSearchEnabled);
  const setAiSearchEnabled = useLibraryQueryStore((state) => state.setAiSearchEnabled);
  const imageQueryFile = useLibraryQueryStore((state) => state.imageQueryFile);
  const searchSimilarToFile = useLibraryQueryStore((state) => state.searchSimilarToFile);
  const clearImageQuery = useLibraryQueryStore((state) => state.clearImageQuery);
  const importFiles = useImportStore((state) => state.importFiles);
  const importTask = useImportStore((state) => state.importTask);
  const aiMetadataTask = useAiBatchAnalyzeStore((state) => state.aiMetadataTask);
  const cancelBatchAnalyze = useAiBatchAnalyzeStore((state) => state.cancelBatchAnalyze);
  const {
    theme,
    setTheme,
    indexPaths,
    recentIndexPaths,
    switchIndexPath,
    rebuildIndex,
    visualSearch,
    visualModelValidation,
  } = useSettingsStore();
  const currentIndexPath = indexPaths[0] ?? null;
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useState(false);
  const [isImageSearchDragOver, setIsImageSearchDragOver] = useState(false);
  const [isSelectingLibrary, setIsSelectingLibrary] = useState(false);
  const [isRebuildingLibrary, setIsRebuildingLibrary] = useState(false);
  const libraryMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isImporting = !!importTask && !isTerminalTaskStatus(importTask.status);
  const importProgress = importTask?.total
    ? Math.min(100, Math.round((importTask.processed / importTask.total) * 100))
    : 0;
  const importCountLabel = `${importTask?.processed ?? 0}/${importTask?.total ?? 0}`;
  const isAiAnalyzing = !!aiMetadataTask && !isTerminalTaskStatus(aiMetadataTask.status);
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
  const imageQueryLabel = imageQueryFile ? getNameWithoutExt(imageQueryFile.name) : "";
  const canUseAiSearch = Boolean(visualSearch.modelPath.trim() && visualModelValidation?.valid);
  const aiSearchTitle = canUseAiSearch
    ? aiSearchEnabled
      ? "关闭 AI 搜索"
      : "开启 AI 搜索"
    : "配置本地视觉模型后可用";

  useEffect(() => {
    if (!canUseAiSearch && aiSearchEnabled) {
      setAiSearchEnabled(false);
    }
  }, [aiSearchEnabled, canUseAiSearch, setAiSearchEnabled]);

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
            name: "素材文件",
            extensions: [...IMPORT_DIALOG_EXTENSIONS],
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

  const hasInternalDragMime = (dataTransfer: DataTransfer | null) => {
    return !!dataTransfer && Array.from(dataTransfer.types).includes(INTERNAL_FILE_DRAG_MIME);
  };

  const getDraggingStoreFileId = () => {
    const { draggedPrimaryFileId, draggedFileIds } = useSelectionStore.getState();
    const fileId = draggedPrimaryFileId ?? draggedFileIds[0] ?? null;
    return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
  };

  const isInternalAppFileDrag = (dataTransfer: DataTransfer | null) => {
    if (hasInternalDragMime(dataTransfer)) {
      return true;
    }

    const { isDraggingInternal, draggedFileIds } = useSelectionStore.getState();
    return isDraggingInternal && draggedFileIds.length > 0;
  };

  const getDraggedAppFileId = (dataTransfer: DataTransfer | null) => {
    if (!hasInternalDragMime(dataTransfer)) {
      return getDraggingStoreFileId();
    }

    try {
      if (!dataTransfer) {
        return getDraggingStoreFileId();
      }

      const parsed = JSON.parse(dataTransfer.getData(INTERNAL_FILE_DRAG_MIME)) as unknown;
      const fileId = Array.isArray(parsed) ? Number(parsed[0]) : Number(parsed);
      if (Number.isInteger(fileId) && fileId > 0) {
        return fileId;
      }
    } catch {
      // Electron can expose our drag session while hiding custom MIME data from the drop target.
    }

    return getDraggingStoreFileId();
  };

  const handleSearchDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isInternalAppFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsImageSearchDragOver(true);
  };

  const handleSearchDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isInternalAppFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsImageSearchDragOver(false);
  };

  const handleSearchDrop = async (event: DragEvent<HTMLDivElement>) => {
    const fileId = getDraggedAppFileId(event.dataTransfer);
    if (!fileId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsImageSearchDragOver(false);

    try {
      const selectionStore = useSelectionStore.getState();
      if (selectionStore.currentDragSessionId && !selectionStore.markInternalDropHandled()) {
        return;
      }

      const file = await getFile(fileId);
      await searchSimilarToFile({ id: file.id, name: file.name });
    } catch (error) {
      console.error("Failed to start image search:", error);
      toast.error("以图搜图失败");
    } finally {
      useSelectionStore.getState().clearInternalFileDrag();
    }
  };

  const handleClearImageQuery = () => {
    clearImageQuery();
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (handlePrimarySelectAll(event) || handlePrimaryClipboardShortcut(event)) {
      return;
    }

    if (
      imageQueryFile &&
      !searchQuery &&
      !event.nativeEvent.isComposing &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      handleClearImageQuery();
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
                <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-[22rem] rounded-2xl bg-white/96 p-2 shadow-[0_14px_32px_rgba(0,0,0,0.12)] backdrop-blur dark:bg-[#171717]/96">
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
                        <div className="max-h-[50vh] overflow-y-auto">
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
                        </div>
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
          <div
            className={cn(
              "relative flex h-9 min-w-0 cursor-text items-center gap-1.5 rounded-[14px] border border-transparent bg-black/[0.035] pr-2 text-[13px] text-gray-800 transition-[border-color,box-shadow,background-color,color] focus-within:border-primary-500/35 focus-within:bg-black/[0.05] focus-within:ring-2 focus-within:ring-primary-500/18 dark:bg-white/[0.05] dark:text-gray-200 dark:focus-within:border-primary-500/40 dark:focus-within:bg-white/[0.07]",
              imageQueryFile ? "pl-2" : "pl-9",
              imageQueryFile && "border-primary-500/25 dark:border-primary-500/35",
              isImageSearchDragOver &&
                "border-primary-400 ring-2 ring-primary-400/30 dark:border-primary-500/70",
            )}
            onClick={() => searchInputRef.current?.focus()}
            onDragEnter={handleSearchDragOver}
            onDragOver={handleSearchDragOver}
            onDragLeave={handleSearchDragLeave}
            onDrop={(event) => void handleSearchDrop(event)}
          >
            {!imageQueryFile ? (
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            ) : null}
            {imageQueryFile ? (
              <span
                className={cn(
                  appTagPillClass,
                  "h-6 min-w-0 max-w-[82%] flex-shrink bg-primary-600 py-0 pl-2.5 pr-1 text-[12px] text-primary-50 dark:bg-primary-500 dark:text-white",
                )}
                title={`以图搜图：${imageQueryFile.name}`}
              >
                <span className="truncate">以图搜图：{imageQueryLabel}</span>
                <button
                  type="button"
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/18"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleClearImageQuery();
                  }}
                  title="移除以图搜图"
                  aria-label="移除以图搜图"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : null}
            <input
              ref={searchInputRef}
              type="text"
              placeholder={imageQueryFile ? "" : aiSearchEnabled ? "AI 搜索图片..." : "搜索文件名"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="input-system-font h-full min-w-[48px] flex-1 border-0 bg-transparent p-0 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-gray-200"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button
              type="button"
              role="switch"
              aria-checked={aiSearchEnabled}
              aria-label="AI 搜索"
              disabled={!canUseAiSearch}
              title={aiSearchTitle}
              onClick={(event) => {
                event.stopPropagation();
                setAiSearchEnabled(!aiSearchEnabled);
              }}
              className={cn(
                "inline-flex size-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                aiSearchEnabled
                  ? "bg-primary-600 text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400"
                  : "text-gray-400 hover:bg-black/[0.05] hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/[0.07] dark:hover:text-gray-200",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {isAiAnalyzing && (
            <div
              className="hidden min-w-[124px] items-center gap-2 rounded-full bg-amber-50/75 px-2.5 py-1 sm:flex dark:bg-amber-950/20"
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
              className="hidden min-w-[96px] items-center gap-2 rounded-full bg-blue-50/75 px-2.5 py-1 sm:flex dark:bg-blue-950/20"
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
