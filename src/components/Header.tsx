import { useImportStore } from "@/stores/importStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Search, Sun, Moon, Settings, Download } from "lucide-react";
import appLogo from "@/assets/app-icon.png";

interface HeaderProps {
  onOpenSettings: () => void;
}

export default function Header({ onOpenSettings }: HeaderProps) {
  const searchQuery = useLibraryQueryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryQueryStore((state) => state.setSearchQuery);
  const importFiles = useImportStore((state) => state.importFiles);
  const importTask = useImportStore((state) => state.importTask);
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
    <header className="border-b border-gray-200 bg-white dark:border-dark-border dark:bg-dark-surface">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <img src={appLogo} alt="" className="h-6 w-6" />
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            拾光
          </h1>
        </div>

        <div className="flex-1 min-w-0 max-w-xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="搜索文件名..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={handleImport}
            disabled={isImporting}
            title="导入图片"
          >
            <Download className="w-4 h-4" />
            导入
          </Button>

          <div className="flex h-9 w-[7.5rem] flex-shrink-0 items-center justify-end">
            {isImporting && (
              <div
                className="w-full rounded-lg border border-blue-200/80 bg-blue-50/80 px-2.5 py-1.5 dark:border-blue-900/40 dark:bg-blue-950/20"
                role="status"
                aria-live="polite"
                aria-label={`导入进度 ${importCountLabel}`}
              >
                <div className="text-right text-[11px] font-medium leading-none tabular-nums text-blue-700 dark:text-blue-300">
                  {importCountLabel}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            title={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
          >
            {theme === "light" ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            title="设置"
          >
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
