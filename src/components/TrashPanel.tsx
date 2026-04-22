import { useEffect, useState } from "react";
import { useTrashStore } from "@/stores/trashStore";
import { Button } from "@/components/ui/Button";
import FileTypeIcon from "@/components/FileTypeIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { AlertTriangle, RotateCcw, Trash2, X } from "lucide-react";
import { getFilePreviewMode, getFileSrc, getThumbnailImageSrc } from "@/utils";

interface TrashFileItemProps {
  file: {
    id: number;
    name: string;
    ext: string;
    size: number;
    path: string;
    deletedAt?: string | null;
  };
  isSelected: boolean;
  onToggleSelect: () => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (dateStr: string | null | undefined) => string;
}

function TrashFileItem({
  file,
  isSelected,
  onToggleSelect,
  formatFileSize,
  formatDate,
}: TrashFileItemProps) {
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

export default function TrashPanel() {
  const trashFiles = useTrashStore((state) => state.trashFiles);
  const trashCount = useTrashStore((state) => state.trashCount);
  const loadTrashFiles = useTrashStore((state) => state.loadTrashFiles);
  const loadTrashCount = useTrashStore((state) => state.loadTrashCount);
  const restoreFiles = useTrashStore((state) => state.restoreFiles);
  const permanentDeleteFiles = useTrashStore((state) => state.permanentDeleteFiles);
  const emptyTrash = useTrashStore((state) => state.emptyTrash);

  const [selectedTrashFiles, setSelectedTrashFiles] = useState<number[]>([]);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

  useEffect(() => {
    void loadTrashFiles();
    void loadTrashCount();
  }, [loadTrashCount, loadTrashFiles]);

  const handleToggleSelect = (fileId: number) => {
    setSelectedTrashFiles((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    );
  };

  const handleSelectAll = () => {
    if (selectedTrashFiles.length === trashFiles.length) {
      setSelectedTrashFiles([]);
      return;
    }
    setSelectedTrashFiles(trashFiles.map((file) => file.id));
  };

  const handleRestoreSelected = async () => {
    if (selectedTrashFiles.length === 0) {
      return;
    }
    await restoreFiles(selectedTrashFiles);
    setSelectedTrashFiles([]);
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedTrashFiles.length === 0) {
      return;
    }
    await permanentDeleteFiles(selectedTrashFiles);
    setSelectedTrashFiles([]);
  };

  const handleEmptyTrash = async () => {
    await emptyTrash();
    setSelectedTrashFiles([]);
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
              共 {trashCount} 个文件，可恢复或永久删除。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleSelectAll} disabled={trashFiles.length === 0}>
              {selectedTrashFiles.length === trashFiles.length && trashFiles.length > 0
                ? "取消全选"
                : "全选"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleRestoreSelected()}
              disabled={selectedTrashFiles.length === 0}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              恢复
            </Button>
            <Button
              variant="outline"
              onClick={() => void handlePermanentDeleteSelected()}
              disabled={selectedTrashFiles.length === 0}
              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <X className="mr-1 h-4 w-4" />
              永久删除
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowEmptyConfirm(true)}
              disabled={trashFiles.length === 0}
              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              清空回收站
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-5">
          {trashFiles.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 text-center dark:border-dark-border">
              <Trash2 className="h-14 w-14 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-5 text-[18px] font-semibold text-gray-900 dark:text-gray-100">
                回收站为空
              </h3>
              <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">
                删除的素材会先进入这里，方便你恢复。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {trashFiles.map((file) => (
                <TrashFileItem
                  key={file.id}
                  file={file}
                  isSelected={selectedTrashFiles.includes(file.id)}
                  onToggleSelect={() => handleToggleSelect(file.id)}
                  formatFileSize={formatFileSize}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={showEmptyConfirm}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowEmptyConfirm(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              确认清空回收站
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-gray-700 dark:text-gray-300">
              确定要清空回收站吗？此操作不可恢复，所有文件将被永久删除。
            </p>
            <p className="mt-2 text-sm text-gray-500">回收站中共有 {trashFiles.length} 个文件</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowEmptyConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void handleEmptyTrash()}>
              确认清空
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
