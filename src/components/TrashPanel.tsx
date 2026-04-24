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
import { AlertTriangle, Folder, RotateCcw, Trash2, X } from "lucide-react";
import { getFilePreviewMode, getFileSrc, getThumbnailImageSrc } from "@/utils";
import type { TrashFileItem, TrashFolderItem, TrashItem } from "@/stores/fileTypes";

interface TrashCardProps {
  item: TrashItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (dateStr: string | null | undefined) => string;
}

interface TrashFileCardProps {
  file: TrashFileItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (dateStr: string | null | undefined) => string;
}

function TrashFileCard({
  file,
  isSelected,
  onToggleSelect,
  formatFileSize,
  formatDate,
}: TrashFileCardProps) {
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
      className={`relative overflow-hidden rounded-2xl border text-left transition-colors ${
        isSelected
          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
          : "border-gray-200 bg-white hover:border-gray-300 dark:border-dark-border dark:bg-dark-surface"
      }`}
      onClick={onToggleSelect}
    >
      <div className="aspect-square overflow-hidden bg-gray-100 dark:bg-dark-bg">
        {imageSrc && !imageError ? (
          <img
            src={imageSrc}
            alt={file.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <FileTypeIcon ext={file.ext} className="h-10 w-10" />
            <span className="text-xs font-medium text-gray-400">{file.ext.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className="space-y-1 px-3 py-3">
        <p
          className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100"
          title={file.name}
        >
          {file.name}
        </p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
        <p className="text-[12px] text-gray-400 dark:text-gray-500">
          删除于 {formatDate(file.deletedAt)}
        </p>
      </div>

      {isSelected && (
        <div className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-xs text-white">
          ✓
        </div>
      )}
    </button>
  );
}

interface TrashFolderCardProps {
  folder: TrashFolderItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  formatDate: (dateStr: string | null | undefined) => string;
}

function TrashFolderCard({ folder, isSelected, onToggleSelect, formatDate }: TrashFolderCardProps) {
  return (
    <button
      type="button"
      className={`relative flex min-h-[250px] flex-col rounded-2xl border p-4 text-left transition-colors ${
        isSelected
          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
          : "border-gray-200 bg-white hover:border-gray-300 dark:border-dark-border dark:bg-dark-surface"
      }`}
      onClick={onToggleSelect}
    >
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-500/10 dark:text-amber-300">
        <Folder className="h-16 w-16" />
      </div>

      <div className="mt-4 space-y-2">
        <p
          className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100"
          title={folder.name}
        >
          {folder.name}
        </p>
        <p className="line-clamp-2 min-h-[36px] text-[12px] text-gray-500 dark:text-gray-400">
          {folder.path}
        </p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          {folder.fileCount} 个文件
          {folder.subfolderCount > 0 ? ` · ${folder.subfolderCount} 个子文件夹` : ""}
        </p>
        <p className="text-[12px] text-gray-400 dark:text-gray-500">
          删除于 {formatDate(folder.deletedAt)}
        </p>
      </div>

      {isSelected && (
        <div className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-xs text-white">
          ✓
        </div>
      )}
    </button>
  );
}

function TrashCard(props: TrashCardProps) {
  return props.item.kind === "folder" ? (
    <TrashFolderCard
      folder={props.item}
      isSelected={props.isSelected}
      onToggleSelect={props.onToggleSelect}
      formatDate={props.formatDate}
    />
  ) : (
    <TrashFileCard
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
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-dark-border">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">回收站</h2>
            <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
              共 {trashCount} 个项目，可恢复或永久删除。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleSelectAll} disabled={trashItems.length === 0}>
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

        <div className="flex-1 overflow-auto px-5 py-5">
          {trashItems.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 text-center dark:border-dark-border">
              <Trash2 className="h-14 w-14 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-5 text-[18px] font-semibold text-gray-900 dark:text-gray-100">
                回收站为空
              </h3>
              <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">
                删除的文件和文件夹会先进入这里，方便你恢复。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {trashItems.map((item) => (
                <TrashCard
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
