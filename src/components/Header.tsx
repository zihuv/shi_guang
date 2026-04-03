import { useFileStore } from "@/stores/fileStore";
import { useFilterStore } from "@/stores/filterStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Search, Sun, Moon, Settings, Download, Filter } from "lucide-react";

interface HeaderProps {
  onOpenSettings: () => void;
}

export default function Header({ onOpenSettings }: HeaderProps) {
  const { searchQuery, setSearchQuery, importFiles, importTask, cancelImportTask } = useFileStore();
  const { isFilterPanelOpen, toggleFilterPanel, getActiveFilterCount } = useFilterStore();
  const { theme, setTheme } = useSettingsStore();
  const isImporting = !!importTask && !["completed", "completed_with_errors", "cancelled", "failed"].includes(importTask.status);
  const importProgress = importTask?.total ? Math.min(100, Math.round((importTask.processed / importTask.total) * 100)) : 0;

  const activeFilterCount = getActiveFilterCount();

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
    <header className="flex flex-col bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-6 h-6 text-primary-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            拾光
          </h1>
        </div>

        <div className="flex-1 max-w-xl">
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

        <Button
          variant={isFilterPanelOpen ? "default" : "outline"}
          size="sm"
          onClick={toggleFilterPanel}
          className="relative"
        >
          <Filter className="w-4 h-4 mr-1" />
          筛选
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </Button>

        <Button onClick={handleImport} disabled={isImporting} title="导入图片">
          <Download className="w-4 h-4" />
          {isImporting ? `导入中 ${importTask?.processed ?? 0}/${importTask?.total ?? 0}` : "导入"}
        </Button>

        {isImporting && (
          <Button variant="outline" onClick={cancelImportTask} title="取消导入">
            取消
          </Button>
        )}

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

      {isImporting && (
        <div className="border-t border-gray-100 px-4 pb-3 dark:border-dark-border">
          <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2 dark:border-blue-900/40 dark:bg-blue-950/20">
            <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
              <span>后台导入中，可继续浏览和筛选文件</span>
              <span>{importTask?.processed ?? 0}/{importTask?.total ?? 0}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                style={{ width: `${importProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
