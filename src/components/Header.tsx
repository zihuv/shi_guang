import { useAiBatchAnalyzeStore } from "@/stores/aiBatchAnalyzeStore";
import { useImportStore } from "@/stores/importStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Search, Sun, Moon, Settings, Download, Sparkles, X } from "lucide-react";
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
  const { theme, setTheme } = useSettingsStore();
  const isImporting =
    !!importTask &&
    !["completed", "completed_with_errors", "cancelled", "failed"].includes(
      importTask.status,
    );
  const importProgress = importTask?.total
    ? Math.min(100, Math.round((importTask.processed / importTask.total) * 100))
    : 0;
  const importCountLabel = `${importTask?.processed ?? 0}/${importTask?.total ?? 0}`;
  const isAiAnalyzing =
    !!aiMetadataTask &&
    !["completed", "completed_with_errors", "cancelled", "failed"].includes(
      aiMetadataTask.status,
    );
  const aiProgress = aiMetadataTask?.total
    ? Math.min(100, Math.round((aiMetadataTask.processed / aiMetadataTask.total) * 100))
    : 0;
  const aiCountLabel = `${aiMetadataTask?.processed ?? 0}/${aiMetadataTask?.total ?? 0}`;

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: true,
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
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-800 dark:text-gray-100">
            拾光
          </h1>
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
            {theme === "light" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
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
