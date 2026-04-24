import { useEffect, useMemo, useState } from "react";
import { useTrashStore } from "@/stores/trashStore";
import { Button } from "@/components/ui/Button";
import FileTypeIcon from "@/components/FileTypeIcon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";
import { AlertTriangle, Check, Folder, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFilePreviewMode, getFileSrc, getThumbnailImageSrc } from "@/utils";
import type { TrashFileItem, TrashFolderItem, TrashItem } from "@/stores/fileTypes";

interface TrashRowProps {
  item: TrashItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (dateStr: string | null | undefined) => string;
}

interface TrashFileRowProps {
  file: TrashFileItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (dateStr: string | null | undefined) => string;
}

function SelectionMark({ isSelected }: { isSelected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 flex-shrink-0 items-center justify-center rounded-full transition-colors",
        isSelected
          ? "bg-primary-600 text-white"
          : "bg-black/[0.06] text-transparent dark:bg-white/[0.08]",
      )}
      aria-hidden="true"
    >
      <Check className="h-3.5 w-3.5" />
    </span>
  );
}

function TrashFileRow({
  file,
  isSelected,
  onToggleSelect,
  formatFileSize,
  formatDate,
}: TrashFileRowProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const previewType = getFilePreviewMode(file.ext);

  useEffect(() => {
    let mounted = true;
    setImageSrc(null);
    setImageError(false);

    if (previewType !== "image" && previewType !== "thumbnail") {
      return () => {
        mounted = false;
      };
    }

    const loader =
      previewType === "thumbnail"
        ? getThumbnailImageSrc(file.path, file.ext)
        : getFileSrc(file.path);

    loader.then((src) => {
      if (mounted) {
        setImageSrc(src);
      }
    });

    return () => {
      mounted = false;
    };
  }, [file.ext, file.path, previewType]);

  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  return (
    <button
      type="button"
      className={cn(
        "grid min-h-[64px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        isSelected
          ? "bg-primary-50/80 dark:bg-primary-500/12"
          : "hover:bg-black/[0.035] dark:hover:bg-white/[0.055]",
      )}
      aria-pressed={isSelected}
      onClick={onToggleSelect}
    >
      <SelectionMark isSelected={isSelected} />

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.045] dark:bg-white/[0.06]">
          {imageSrc && !imageError ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImageError(true)}
            />
          ) : (
            <FileTypeIcon ext={file.ext} className="h-6 w-6" />
          )}
        </div>

        <div className="min-w-0">
          <p
            className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100"
            title={file.name}
          >
            {file.name}
          </p>
          <p className="mt-1 truncate text-[12px] text-gray-500 dark:text-gray-400">
            {file.ext.toUpperCase()} · {formatFileSize(file.size)}
          </p>
        </div>
      </div>

      <span className="hidden whitespace-nowrap text-[12px] text-gray-400 dark:text-gray-500 sm:inline">
        {formatDate(file.deletedAt)}
      </span>
    </button>
  );
}

interface TrashFolderRowProps {
  folder: TrashFolderItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  formatDate: (dateStr: string | null | undefined) => string;
}

function TrashFolderRow({ folder, isSelected, onToggleSelect, formatDate }: TrashFolderRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "grid min-h-[64px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        isSelected
          ? "bg-primary-50/80 dark:bg-primary-500/12"
          : "hover:bg-black/[0.035] dark:hover:bg-white/[0.055]",
      )}
      aria-pressed={isSelected}
      onClick={onToggleSelect}
    >
      <SelectionMark isSelected={isSelected} />

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-300">
          <Folder className="h-6 w-6" />
        </div>

        <div className="min-w-0">
          <p
            className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100"
            title={folder.name}
          >
            {folder.name}
          </p>
          <p className="mt-1 truncate text-[12px] text-gray-500 dark:text-gray-400">
            文件夹 · {folder.fileCount} 个文件
            {folder.subfolderCount > 0 ? ` · ${folder.subfolderCount} 个子文件夹` : ""}
          </p>
        </div>
      </div>

      <span className="hidden whitespace-nowrap text-[12px] text-gray-400 dark:text-gray-500 sm:inline">
        {formatDate(folder.deletedAt)}
      </span>
    </button>
  );
}

function TrashRow(props: TrashRowProps) {
  return props.item.kind === "folder" ? (
    <TrashFolderRow
      folder={props.item}
      isSelected={props.isSelected}
      onToggleSelect={props.onToggleSelect}
      formatDate={props.formatDate}
    />
  ) : (
    <TrashFileRow
      file={props.item}
      isSelected={props.isSelected}
      onToggleSelect={props.onToggleSelect}
      formatFileSize={props.formatFileSize}
      formatDate={props.formatDate}
    />
  );
}

function selectionKey(item: TrashItem) {
  return `${item.kind}:${item.id}`;
}

function isKeyboardShortcutIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='dialog'], [role='menu']",
    ),
  );
}

export default function TrashPanel() {
  const trashItems = useTrashStore((state) => state.trashItems);
  const trashCount = useTrashStore((state) => state.trashCount);
  const loadTrashItems = useTrashStore((state) => state.loadTrashItems);
  const loadTrashCount = useTrashStore((state) => state.loadTrashCount);
  const restoreFiles = useTrashStore((state) => state.restoreFiles);
  const restoreFolders = useTrashStore((state) => state.restoreFolders);
  const permanentDeleteFiles = useTrashStore((state) => state.permanentDeleteFiles);
  const permanentDeleteFolders = useTrashStore((state) => state.permanentDeleteFolders);
  const emptyTrash = useTrashStore((state) => state.emptyTrash);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState(false);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

  useEffect(() => {
    void loadTrashItems();
    void loadTrashCount();
  }, [loadTrashCount, loadTrashItems]);

  useEffect(() => {
    const handleSelectAllShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.key.toLowerCase() !== "a" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        isKeyboardShortcutIgnored(event.target)
      ) {
        return;
      }

      event.preventDefault();
      setSelectedKeys(trashItems.map(selectionKey));
    };

    document.addEventListener("keydown", handleSelectAllShortcut, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleSelectAllShortcut, { capture: true });
    };
  }, [trashItems]);

  const selectedItems = useMemo(
    () => trashItems.filter((item) => selectedKeys.includes(selectionKey(item))),
    [selectedKeys, trashItems],
  );
  const selectedFileIds = selectedItems
    .filter((item): item is TrashFileItem => item.kind === "file")
    .map((item) => item.id);
  const selectedFolderIds = selectedItems
    .filter((item): item is TrashFolderItem => item.kind === "folder")
    .map((item) => item.id);

  const handleToggleSelect = (item: TrashItem) => {
    const key = selectionKey(item);
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  };

  const handleSelectAll = () => {
    if (selectedKeys.length === trashItems.length) {
      setSelectedKeys([]);
      return;
    }
    setSelectedKeys(trashItems.map(selectionKey));
  };

  const handleRestoreSelected = async () => {
    if (selectedFileIds.length > 0) {
      await restoreFiles(selectedFileIds);
    }
    if (selectedFolderIds.length > 0) {
      await restoreFolders(selectedFolderIds);
    }
    setSelectedKeys([]);
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedItems.length === 0) return;

    if (selectedFolderIds.length > 0) {
      await permanentDeleteFolders(selectedFolderIds);
    }
    if (selectedFileIds.length > 0) {
      await permanentDeleteFiles(selectedFileIds);
    }
    setSelectedKeys([]);
    setShowPermanentDeleteConfirm(false);
  };

  const handleEmptyTrash = async () => {
    await emptyTrash();
    setSelectedKeys([]);
    setShowEmptyConfirm(false);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-white dark:bg-dark-bg">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">回收站</h2>
            <span className="text-[12px] text-gray-400 dark:text-gray-500">{trashCount} 项</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={handleSelectAll} disabled={trashItems.length === 0}>
              {selectedKeys.length === trashItems.length && trashItems.length > 0
                ? "取消全选"
                : "全选"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleRestoreSelected()}
              disabled={selectedKeys.length === 0}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              恢复
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowPermanentDeleteConfirm(true)}
              disabled={selectedKeys.length === 0}
              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <X className="mr-1 h-4 w-4" />
              永久删除
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowEmptyConfirm(true)}
              disabled={trashItems.length === 0}
              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              清空回收站
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-5">
          {trashItems.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
              <Trash2 className="h-12 w-12 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-4 text-[16px] font-medium text-gray-700 dark:text-gray-300">
                回收站为空
              </h3>
            </div>
          ) : (
            <div className="space-y-1">
              {trashItems.map((item) => (
                <TrashRow
                  key={selectionKey(item)}
                  item={item}
                  isSelected={selectedKeys.includes(selectionKey(item))}
                  onToggleSelect={() => handleToggleSelect(item)}
                  formatFileSize={formatFileSize}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={showPermanentDeleteConfirm} onOpenChange={setShowPermanentDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              确认永久删除
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作会永久删除选中的回收站项目，删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            已选择 {selectedItems.length} 个项目
            {selectedFolderIds.length > 0 || selectedFileIds.length > 0
              ? `，其中 ${selectedFileIds.length} 个文件、${selectedFolderIds.length} 个文件夹`
              : ""}
            。
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handlePermanentDeleteSelected()}>
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showEmptyConfirm} onOpenChange={setShowEmptyConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              确认清空回收站
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作会永久删除回收站中的全部文件和文件夹，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            回收站中共有 {trashItems.length} 个项目。
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleEmptyTrash()}>确认清空</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
