import { useState } from "react";
import { useFileStore } from "@/stores/fileStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Search, Sun, Moon, Settings, Download } from "lucide-react";

interface HeaderProps {
  onOpenSettings: () => void;
}

export default function Header({ onOpenSettings }: HeaderProps) {
  const { searchQuery, setSearchQuery, importFiles } = useFileStore();
  const { theme, setTheme } = useSettingsStore();
  const [isImporting, setIsImporting] = useState(false);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleImport = async () => {
    setIsImporting(true);
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
            ],
          },
        ],
        title: "选择要导入的图片",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await importFiles(paths);
      }
    } catch (e) {
      console.error("Failed to import files:", e);
    }
    setIsImporting(false);
  };

  return (
    <header className="flex items-center gap-4 px-4 py-3 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border">
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

      <div className="flex items-center gap-2">
        <Button onClick={handleImport} disabled={isImporting} title="导入图片">
          <Download className="w-4 h-4" />
          {isImporting ? "导入中..." : "导入"}
        </Button>

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
    </header>
  );
}
