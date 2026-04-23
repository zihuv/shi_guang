import {
  useEffect,
  useState,
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { type FileItem, getNameWithoutExt } from "@/stores/fileTypes";
import { useFolderStore, FolderNode } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { useTrashStore } from "@/stores/trashStore";
import FileTypeIcon from "@/components/FileTypeIcon";
import FileTagInput from "@/components/FileTagInput";
import {
  getFilePreviewMode,
  getFileSrc,
  getTextPreviewContent,
  getThumbnailImageSrc,
  getVideoThumbnailSrc,
  formatSize,
  findFolderById,
  debounce,
  resolveThumbnailRequestMaxEdge,
} from "@/utils";
import { cn } from "@/lib/utils";
import {
  appIconButtonClass,
  appPanelClass,
  appPanelHeaderClass,
  appPanelMetaClass,
  appPanelTitleClass,
  appPanelValueClass,
  appQuietButtonClass,
  appSectionHeadingClass,
  appSectionLabelClass,
} from "@/lib/ui";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

// Format date to match database format (YYYY-MM-DD HH:MM:SS)
function formatDateTime(isoString: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

interface DetailPanelProps {
  width: number;
}

function PanelIconButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(appIconButtonClass, className)} {...props} />;
}

function PanelActionButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(appQuietButtonClass, className)} {...props} />;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 py-0.5">
      <span className={cn(appPanelMetaClass, "leading-5")}>{label}</span>
      <div
        className={cn(
          appPanelValueClass,
          "min-w-0 whitespace-nowrap text-right text-[12px] font-medium leading-5",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default function DetailPanel({ width }: DetailPanelProps) {
  const selectedFile = useSelectionStore((state) => state.selectedFile);
  const { folders, selectedFolderId } = useFolderStore();

  // Find the selected folder
  const selectedFolder = selectedFolderId ? findFolderById(folders, selectedFolderId) : null;

  // Show empty state when nothing is selected
  if (!selectedFile && !selectedFolder) {
    return (
      <div
        className={`${appPanelClass} flex-shrink-0 items-center justify-center p-6`}
        style={{ width }}
      >
        <svg
          className="mb-4 h-14 w-14 text-gray-300 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-center text-[13px] text-gray-500 dark:text-gray-400">
          选择文件或文件夹查看详情
        </p>
      </div>
    );
  }

  // Show file details when a file is selected (takes priority over folder)
  if (selectedFile) {
    return <FileDetailPanel file={selectedFile} width={width} />;
  }

  // Show folder details when no file is selected
  if (selectedFolder) {
    return <FolderDetailPanel folder={selectedFolder} width={width} />;
  }

  return null;
}

function FolderDetailPanel({ folder, width }: { folder: FolderNode; width: number }) {
  const { deleteFolder: deleteFolderFn } = useFolderStore();
  const selectedFolderId = useFolderStore((state) => state.selectedFolderId);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    const result = await deleteFolderFn(folder.id);
    if (result?.movedToTrash) {
      await useTrashStore.getState().addFolderDeleteToUndoStack({
        folderId: result.folderId,
        folderName: result.folderName,
        folderPath: result.folderPath,
        shouldSelectOnUndo: selectedFolderId === folder.id,
      });
      toast.success(`已删除文件夹“${result.folderName}”，可在回收站恢复或按 Cmd/Ctrl+Z 撤回。`);
    } else if (result) {
      toast.success(`已删除文件夹“${result.folderName}”。`);
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div className={`${appPanelClass} flex-shrink-0`} style={{ width }}>
      <div className={appPanelHeaderClass}>
        <h3 className={appPanelTitleClass}>文件夹详情</h3>
        <div className="flex items-center gap-1">
          {showDeleteConfirm ? (
            <>
              <PanelActionButton
                onClick={handleDelete}
                className="bg-red-500 text-white hover:bg-red-600"
              >
                确认删除
              </PanelActionButton>
              <PanelActionButton
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                取消
              </PanelActionButton>
            </>
          ) : (
            <PanelIconButton
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
              title="删除文件夹"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </PanelIconButton>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 pb-5 pt-5 [&>*]:shrink-0">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <div className="flex size-24 items-center justify-center rounded-[28px] bg-yellow-400/10 dark:bg-yellow-500/12">
            <svg className="h-11 w-11 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          </div>
          <div className="space-y-1.5">
            <h4 className={appSectionLabelClass}>文件夹名称</h4>
            <p className="break-all text-[18px] font-semibold leading-7 text-gray-800 dark:text-gray-100">
              {folder.name}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <h4 className={appSectionLabelClass}>文件数量</h4>
            <p className={appPanelValueClass}>{folder.fileCount} 个文件</p>
          </div>

          <div className="space-y-1.5">
            <h4 className={appSectionLabelClass}>路径</h4>
            <p className="break-all text-[12px] leading-5 text-gray-500 dark:text-gray-400">
              {folder.path}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileDetailPanel({ file, width }: { file: FileItem; width: number }) {
  const deleteFile = useTrashStore((state) => state.deleteFile);
  const updateFileMetadata = useLibraryQueryStore((state) => state.updateFileMetadata);
  const exportFile = useLibraryQueryStore((state) => state.exportFile);
  const updateFileName = useLibraryQueryStore((state) => state.updateFileName);
  const { folders } = useFolderStore();

  // Find folder by file's folderId
  const folder = file.folderId ? findFolderById(folders, file.folderId) : null;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [videoPosterSrc, setVideoPosterSrc] = useState<string>("");
  const [textContent, setTextContent] = useState<string>("");
  const [previewError, setPreviewError] = useState(false);
  const [isImageOriginalOpen, setIsImageOriginalOpen] = useState(false);
  const [isImageOriginalLoading, setIsImageOriginalLoading] = useState(false);
  const [isVideoPlayerOpen, setIsVideoPlayerOpen] = useState(false);
  const [isVideoPlayerLoading, setIsVideoPlayerLoading] = useState(false);
  const previewType = getFilePreviewMode(file.ext);
  const usesThumbnailPreview = previewType === "image" || previewType === "thumbnail";
  const [rating, setRating] = useState(file.rating || 0);
  const [description, setDescription] = useState(file.description || "");
  const [sourceUrl, setSourceUrl] = useState(file.sourceUrl || "");
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [editedName, setEditedName] = useState(getNameWithoutExt(file.name));
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
  const videoLoadVersionRef = useRef(0);
  const imageLoadVersionRef = useRef(0);
  const previewWidth = Math.max(160, width - 28);
  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewThumbnailMaxEdge = resolveThumbnailRequestMaxEdge(previewWidth, previewHeight, {
    devicePixelRatioCap: 2,
  });

  // Helper to get extension
  const getExt = (name: string) => {
    const parts = name.split(".");
    return parts.length > 1 ? parts[parts.length - 1] : "";
  };

  useEffect(() => {
    let mounted = true;
    setPreviewError(false);
    setIsImageOriginalOpen(false);
    setIsImageOriginalLoading(false);
    setIsVideoPlayerOpen(false);
    setIsVideoPlayerLoading(false);
    videoLoadVersionRef.current += 1;
    imageLoadVersionRef.current += 1;

    if (!usesThumbnailPreview) {
      setImageSrc("");
    }

    if (previewType !== "video") {
      setVideoPosterSrc("");
    }

    if (previewType !== "text") {
      setTextContent("");
    }

    if (previewType === "none") {
      return () => {
        mounted = false;
      };
    }

    if (previewType === "text") {
      getTextPreviewContent(file.path, file.size).then((content) => {
        if (mounted) {
          setTextContent(content);
        }
      });

      return () => {
        mounted = false;
      };
    }

    if (usesThumbnailPreview) {
      void (async () => {
        const thumbnailSrc = await getThumbnailImageSrc(
          file.path,
          file.ext,
          previewThumbnailMaxEdge,
        );
        if (!mounted) {
          if (thumbnailSrc.startsWith("blob:")) {
            URL.revokeObjectURL(thumbnailSrc);
          }
          return;
        }

        if (thumbnailSrc) {
          setImageSrc(thumbnailSrc);
          return;
        }

        if (previewType !== "image") {
          setPreviewError(true);
          return;
        }

        const originalSrc = await getFileSrc(file.path);
        if (!mounted) {
          if (originalSrc.startsWith("blob:")) {
            URL.revokeObjectURL(originalSrc);
          }
          return;
        }

        if (originalSrc) {
          setImageSrc(originalSrc);
          setIsImageOriginalOpen(true);
        } else {
          setPreviewError(true);
        }
      })();

      return () => {
        mounted = false;
      };
    }

    if (previewType === "video") {
      getVideoThumbnailSrc(file.path, previewThumbnailMaxEdge).then((src) => {
        if (mounted && src) {
          setVideoPosterSrc(src);
        }
      });
      return () => {
        mounted = false;
      };
    }

    getFileSrc(file.path).then((src) => {
      if (!mounted) return;

      if (src) {
        setImageSrc(src);
      } else {
        setPreviewError(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [
    file.path,
    file.size,
    previewType,
    file.ext,
    previewThumbnailMaxEdge,
    thumbnailRefreshVersion,
    usesThumbnailPreview,
  ]);

  useEffect(() => {
    return () => {
      if (imageSrc.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  useEffect(() => {
    return () => {
      if (videoPosterSrc.startsWith("blob:")) {
        URL.revokeObjectURL(videoPosterSrc);
      }
    };
  }, [videoPosterSrc]);

  // Sync state with file prop when it changes
  useEffect(() => {
    setRating(file.rating || 0);
    setDescription(file.description || "");
    setSourceUrl(file.sourceUrl || "");
    setEditedName(getNameWithoutExt(file.name));
  }, [file.rating, file.description, file.sourceUrl, file.name]);

  const handleDelete = async () => {
    await deleteFile(file.id);
  };

  // Auto-save metadata with debounce
  const saveMetadata = useMemo(
    () =>
      debounce(async (newRating: number, newDescription: string, newSourceUrl: string) => {
        await updateFileMetadata(file.id, newRating, newDescription, newSourceUrl);
      }, 500),
    [file.id, updateFileMetadata],
  );

  const handleRatingChange = (newRating: number) => {
    setRating(newRating);
    saveMetadata(newRating, description, sourceUrl);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    saveMetadata(rating, value, sourceUrl);
  };

  const handleSourceUrlChange = (value: string) => {
    setSourceUrl(value);
    saveMetadata(rating, description, value);
  };

  const handleExport = async () => {
    try {
      await exportFile(file.id);
      setShowExportSuccess(true);
      setTimeout(() => setShowExportSuccess(false), 3000);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  const handleNameSave = async () => {
    const currentNameWithoutExt = getNameWithoutExt(file.name);
    const ext = getExt(file.name);
    if (editedName && editedName !== currentNameWithoutExt) {
      // Add extension back if it exists
      const fullName = ext ? `${editedName}.${ext}` : editedName;
      await updateFileName(file.id, fullName);
    }
  };

  const handleOpenVideoPlayer = async () => {
    if (previewType !== "video" || isVideoPlayerOpen || isVideoPlayerLoading) {
      return;
    }

    const requestVersion = ++videoLoadVersionRef.current;
    setPreviewError(false);
    setIsVideoPlayerLoading(true);

    try {
      const src = await getFileSrc(file.path);
      if (videoLoadVersionRef.current !== requestVersion) {
        if (src.startsWith("blob:")) {
          URL.revokeObjectURL(src);
        }
        return;
      }

      if (src) {
        setImageSrc(src);
        setIsVideoPlayerOpen(true);
      } else {
        setPreviewError(true);
      }
    } finally {
      if (videoLoadVersionRef.current === requestVersion) {
        setIsVideoPlayerLoading(false);
      }
    }
  };

  const handleOpenOriginalImage = async () => {
    if (previewType !== "image" || isImageOriginalOpen || isImageOriginalLoading) {
      return;
    }

    const requestVersion = ++imageLoadVersionRef.current;
    setPreviewError(false);
    setIsImageOriginalLoading(true);

    try {
      const src = await getFileSrc(file.path);
      if (imageLoadVersionRef.current !== requestVersion) {
        if (src.startsWith("blob:")) {
          URL.revokeObjectURL(src);
        }
        return;
      }

      if (src) {
        setImageSrc(src);
        setIsImageOriginalOpen(true);
      } else {
        setPreviewError(true);
      }
    } finally {
      if (imageLoadVersionRef.current === requestVersion) {
        setIsImageOriginalLoading(false);
      }
    }
  };

  return (
    <div className={`${appPanelClass} flex-shrink-0`} style={{ width }}>
      <div className={appPanelHeaderClass}>
        <h3 className={appPanelTitleClass}>文件详情</h3>
        <div className="flex items-center gap-1">
          <PanelIconButton
            onClick={handleExport}
            className="text-blue-500 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30"
            title="导出文件"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </PanelIconButton>
          {showDeleteConfirm ? (
            <>
              <PanelActionButton
                onClick={handleDelete}
                className="bg-red-500 text-white hover:bg-red-600"
              >
                确认删除
              </PanelActionButton>
              <PanelActionButton
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                取消
              </PanelActionButton>
            </>
          ) : (
            <PanelIconButton
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
              title="删除文件"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </PanelIconButton>
          )}
        </div>
      </div>

      {showExportSuccess && (
        <div className="bg-emerald-500/10 px-3.5 py-2 text-[12px] text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300">
          导出成功
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-4 pb-5 pt-4 [&>*]:shrink-0">
        {/* Preview image */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-[20px] bg-black/[0.045] dark:bg-white/[0.045]">
          {usesThumbnailPreview ? (
            <div
              onDoubleClick={
                previewType === "image" ? () => void handleOpenOriginalImage() : undefined
              }
              className={`relative h-full w-full bg-gray-100 dark:bg-dark-bg ${
                previewType === "image" && !isImageOriginalOpen ? "cursor-zoom-in" : ""
              }`}
              title={previewType === "image" && !isImageOriginalOpen ? "双击加载原图" : undefined}
            >
              {imageSrc ? (
                <img src={imageSrc} alt={file.name} className="w-full h-full object-contain" />
              ) : previewError ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                  <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <p className="text-[13px]">预览加载失败</p>
                </div>
              ) : (
                <div className="h-full w-full" />
              )}
            </div>
          ) : previewType === "video" && isVideoPlayerOpen && imageSrc ? (
            <video
              src={imageSrc}
              controls
              playsInline
              autoPlay
              preload="metadata"
              poster={videoPosterSrc || undefined}
              className="h-full w-full bg-black object-contain"
            />
          ) : previewType === "video" ? (
            <button
              type="button"
              onClick={() => void handleOpenVideoPlayer()}
              className="group relative h-full w-full overflow-hidden bg-black text-left"
              title="播放视频预览"
            >
              {videoPosterSrc ? (
                <img
                  src={videoPosterSrc}
                  alt={file.name}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-black/10" />

              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-lg transition-transform duration-200 group-hover:scale-105">
                  <svg className="ml-0.5 h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5.14v13.72c0 .78.85 1.26 1.52.86l10.2-6.86a1 1 0 000-1.72l-10.2-6.86A1 1 0 008 5.14z" />
                  </svg>
                </div>
              </div>
              {previewError && (
                <div className="absolute bottom-2 right-2 rounded bg-red-500/85 px-2 py-1 text-[11px] font-medium text-white">
                  加载失败
                </div>
              )}
            </button>
          ) : previewError && previewType !== "none" ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
              <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-[13px]">预览加载失败</p>
            </div>
          ) : previewType === "text" ? (
            <div className="h-full w-full overflow-auto bg-white p-3 dark:bg-dark-surface">
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-gray-700 dark:text-gray-200">
                {textContent || "空文本文件"}
              </pre>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
              <FileTypeIcon ext={file.ext} className="h-12 w-12" />
              <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-medium dark:bg-black/20">
                {file.ext.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* 色彩分布进度条 */}
        {file.colorDistribution && file.colorDistribution.length > 0 && (
          <div className="h-3 w-full overflow-hidden rounded-full bg-black/[0.035] dark:bg-white/[0.04]">
            <div className="flex w-full h-full">
              {file.colorDistribution.map((colorInfo, index) => (
                <div
                  key={index}
                  className="h-full relative group cursor-pointer"
                  style={{
                    width: `${colorInfo.percentage}%`,
                    minWidth: colorInfo.percentage > 0 ? "4px" : "0",
                  }}
                >
                  <div className="absolute inset-0" style={{ backgroundColor: colorInfo.color }} />
                  {/* 悬停提示 */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                    {colorInfo.color} {colorInfo.percentage.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input fields in order: name, tags, description, source URL */}
        {/* 1. File name - always editable */}
        <div>
          <Input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNameSave();
              if (e.key === "Escape") {
                setEditedName(getNameWithoutExt(file.name));
              }
            }}
            onBlur={handleNameSave}
            placeholder="名称"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* 2. Tags input with tags displayed inside */}
        <FileTagInput fileId={file.id} fileTags={file.tags} />

        {/* 3. Description */}
        <div>
          <Textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="添加备注"
            rows={2}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* 4. Source URL */}
        <div>
          <Input
            type="url"
            value={sourceUrl}
            onChange={(e) => handleSourceUrlChange(e.target.value)}
            placeholder="https://"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* Rating and File info list */}
        <div className="flex flex-col gap-0.5 pt-1">
          <span className={appSectionHeadingClass}>素材信息</span>

          <InfoRow
            label="评级"
            value={
              <div className="flex items-center justify-end gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => handleRatingChange(star === rating ? 0 : star)}
                    className="rounded-sm p-0.5 transition-transform hover:scale-110"
                  >
                    <svg
                      className={`h-3 w-3 ${
                        star <= rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-gray-300 dark:text-gray-600"
                      }`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </button>
                ))}
              </div>
            }
          />
          {folder && <InfoRow label="文件夹" value={folder.name} />}
          {/* File info list - left label, right value */}
          <InfoRow label="尺寸" value={`${file.width} x ${file.height}`} />
          <InfoRow label="大小" value={formatSize(file.size)} />
          <InfoRow label="格式" value={file.ext.toUpperCase()} />
          <InfoRow label="创建时间" value={formatDateTime(file.createdAt)} />
          <InfoRow label="修改时间" value={formatDateTime(file.modifiedAt)} />
          <InfoRow label="导入时间" value={formatDateTime(file.importedAt)} />
        </div>
      </div>
    </div>
  );
}
