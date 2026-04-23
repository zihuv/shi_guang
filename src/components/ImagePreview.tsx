import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { copyFilesToClipboard } from "@/lib/clipboard";
import {
  AI_IMAGE_EXTENSIONS,
  flattenFolders,
  getPreviewMetaText,
} from "@/components/image-preview/constants";
import { PreviewContextMenuContent } from "@/components/image-preview/PreviewContextMenu";
import {
  TextPreviewPane,
  UnsupportedPreviewState,
} from "@/components/image-preview/PreviewHelpers";
import {
  FullscreenPreviewShell,
  StandardPreviewShell,
} from "@/components/image-preview/PreviewShells";
import { usePreviewSource } from "@/components/image-preview/usePreviewSource";
import { usePreviewZoomPan } from "@/components/image-preview/usePreviewZoomPan";
import { updateFileDimensions } from "@/services/desktop/files";
import { openFile, showInExplorer } from "@/services/desktop/system";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTrashStore } from "@/stores/trashStore";
import { buildAiImageDataUrl, getFilePreviewMode, isVideoFile } from "@/utils";

export default function ImagePreview() {
  const previewMode = usePreviewStore((state) => state.previewMode);
  const previewIndex = usePreviewStore((state) => state.previewIndex);
  const previewFiles = usePreviewStore((state) => state.previewFiles);
  const setPreviewIndex = usePreviewStore((state) => state.setPreviewIndex);
  const closePreview = usePreviewStore((state) => state.closePreview);
  const setSelectedFile = useSelectionStore((state) => state.setSelectedFile);
  const moveFiles = useLibraryQueryStore((state) => state.moveFiles);
  const copyFiles = useLibraryQueryStore((state) => state.copyFiles);
  const analyzeFileMetadata = useLibraryQueryStore((state) => state.analyzeFileMetadata);
  const touchFileLastAccessed = useLibraryQueryStore((state) => state.touchFileLastAccessed);
  const deleteFile = useTrashStore((state) => state.deleteFile);

  const { folders, selectedFolderId } = useFolderStore();
  const previewTrackpadZoomSpeed = useSettingsStore((state) => state.previewTrackpadZoomSpeed);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const lastMenuActionRef = useRef<{ key: string; timestamp: number } | null>(null);
  const persistedDimensionsRef = useRef<Record<number, string>>({});

  const currentFolderName = selectedFolderId
    ? folders.find((folder) => folder.id === selectedFolderId)?.name || "未知文件夹"
    : "全部文件";

  const currentFile = previewFiles[previewIndex];
  const previewType = currentFile ? getFilePreviewMode(currentFile.ext) : "none";
  const isVideo = currentFile ? isVideoFile(currentFile.ext) : false;
  const isImageLike = previewType === "image" || previewType === "thumbnail";
  const canAnalyzeWithAi = currentFile
    ? AI_IMAGE_EXTENSIONS.has(currentFile.ext.toLowerCase())
    : false;
  const {
    imageSrc,
    textContent,
    imageError,
    isPlaceholderImageSrc,
    isLoading,
    loadedImageSize,
    setLoadedImageSize,
  } = usePreviewSource({
    currentFile,
    previewFiles,
    previewIndex,
    previewMode,
    previewType,
  });
  const {
    viewportRef,
    supportsZoom,
    isFitMode,
    canPanImage,
    isPanning,
    scaledImageWidth,
    scaledImageHeight,
    handleZoomOut,
    handleZoomIn,
    handleFitToView,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = usePreviewZoomPan({
    currentFile,
    loadedImageSize,
    isFullscreen,
    isImageLike,
    previewIndex,
    previewMode,
    previewTrackpadZoomSpeed,
  });

  const handleCopyFileToClipboard = useCallback(async () => {
    try {
      await copyFilesToClipboard([currentFile.id]);
    } catch (error) {
      console.error("Failed to copy file to clipboard:", error);
    }
  }, [currentFile]);

  const handleAnalyzeMetadata = async () => {
    if (!currentFile || !canAnalyzeWithAi) {
      toast.error("当前仅支持对图片执行 AI 分析");
      return;
    }

    const loadingToast = toast.loading("AI 分析中...");
    try {
      const imageDataUrl = await buildAiImageDataUrl(currentFile.path);
      await analyzeFileMetadata(currentFile.id, imageDataUrl);
      toast.success("AI 已更新名称、标签和备注", { id: loadingToast });
    } catch (error) {
      console.error("Failed to analyze file metadata:", error);
      toast.error(`AI 分析失败: ${String(error)}`, { id: loadingToast });
    }
  };

  useEffect(() => {
    if (currentFile) {
      setSelectedFile(currentFile);
    }
  }, [currentFile, previewIndex, setSelectedFile]);

  useEffect(() => {
    if (!currentFile?.id) {
      return;
    }

    void touchFileLastAccessed(currentFile.id);
  }, [currentFile?.id, touchFileLastAccessed]);

  const goToPrev = useCallback(() => {
    if (previewIndex > 0) {
      setPreviewIndex(previewIndex - 1);
    }
  }, [previewIndex, setPreviewIndex]);

  const goToNext = useCallback(() => {
    if (previewIndex < previewFiles.length - 1) {
      setPreviewIndex(previewIndex + 1);
    }
  }, [previewFiles.length, previewIndex, setPreviewIndex]);

  useEffect(() => {
    if (!previewMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          if (isFullscreen) {
            setIsFullscreen(false);
          } else {
            closePreview();
          }
          break;
        case "ArrowLeft":
          goToPrev();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "f":
        case "F":
          if (previewType !== "none") {
            setIsFullscreen((prev) => !prev);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, goToNext, goToPrev, isFullscreen, previewMode, previewType]);

  const flatFolders = flattenFolders(folders);

  const handleOpenFile = async () => {
    try {
      await openFile(currentFile.id);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  const handleShowInExplorer = async () => {
    try {
      await showInExplorer(currentFile.id);
    } catch (error) {
      console.error("Failed to open directory:", error);
    }
  };

  const triggerMenuAction = (key: string, action: () => void | Promise<void>) => {
    const now = Date.now();
    const lastAction = lastMenuActionRef.current;
    if (lastAction && lastAction.key === key && now - lastAction.timestamp < 250) {
      return;
    }

    lastMenuActionRef.current = { key, timestamp: now };
    void action();
  };

  const handleCopyFile = async (targetFolderId: number | null) => {
    try {
      await copyFiles([currentFile.id], targetFolderId);
    } catch (error) {
      console.error("Failed to copy file:", error);
      toast.error(`复制文件失败: ${String(error)}`);
    }
  };

  const handleMoveFile = async (targetFolderId: number | null) => {
    try {
      await moveFiles([currentFile.id], targetFolderId);
    } catch (error) {
      console.error("Failed to move file:", error);
      toast.error(`移动文件失败: ${String(error)}`);
    }
  };

  const handleDeleteFile = async () => {
    try {
      await deleteFile(currentFile.id);
      closePreview();
    } catch (error) {
      console.error("Failed to delete file:", error);
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const hydrateCurrentFileDimensions = useCallback(
    (width: number, height: number) => {
      if (!currentFile || width <= 0 || height <= 0) return;

      setLoadedImageSize((current) => {
        if (current.width === width && current.height === height) {
          return current;
        }
        return { width, height };
      });

      if (currentFile.width === width && currentFile.height === height) {
        return;
      }

      const patch = { width, height };

      usePreviewStore.setState((state) => ({
        previewFiles: state.previewFiles.map((file) =>
          file.id === currentFile.id ? { ...file, ...patch } : file,
        ),
      }));

      useLibraryQueryStore.setState((state) => ({
        files: state.files.map((file) =>
          file.id === currentFile.id ? { ...file, ...patch } : file,
        ),
      }));

      const { selectedFile } = useSelectionStore.getState();
      if (selectedFile?.id === currentFile.id) {
        useSelectionStore.getState().setSelectedFile({
          ...selectedFile,
          ...patch,
        });
      }

      const persistedKey = `${width}x${height}`;
      if (
        (currentFile.width <= 0 || currentFile.height <= 0) &&
        persistedDimensionsRef.current[currentFile.id] !== persistedKey
      ) {
        persistedDimensionsRef.current[currentFile.id] = persistedKey;
        void updateFileDimensions({
          fileId: currentFile.id,
          width,
          height,
        }).catch((error) => {
          console.error("Failed to persist file dimensions:", error);
          delete persistedDimensionsRef.current[currentFile.id];
        });
      }
    },
    [currentFile, setLoadedImageSize],
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;

      if (previewType === "thumbnail") {
        setLoadedImageSize((current) => {
          if (current.width === target.naturalWidth && current.height === target.naturalHeight) {
            return current;
          }
          return { width: target.naturalWidth, height: target.naturalHeight };
        });
        return;
      }

      if (isPlaceholderImageSrc) {
        return;
      }

      hydrateCurrentFileDimensions(target.naturalWidth, target.naturalHeight);
    },
    [hydrateCurrentFileDimensions, isPlaceholderImageSrc, previewType, setLoadedImageSize],
  );

  if (!previewMode || !currentFile) return null;

  const totalFiles = previewFiles.length;
  const currentNum = previewIndex + 1;
  const canGoPrev = previewIndex > 0;
  const canGoNext = previewIndex < totalFiles - 1;
  const previewMeta = getPreviewMetaText(
    currentFile,
    previewType === "thumbnail" ? undefined : loadedImageSize,
  );

  const renderedPreviewContent = isLoading ? (
    <div className="flex h-full min-h-full items-center justify-center p-4">
      <svg className="h-10 w-10 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  ) : imageError ? (
    <div className="flex h-full min-h-full flex-col items-center justify-center p-4 text-gray-400">
      <svg className="mb-2 h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
      <p>无法加载预览</p>
    </div>
  ) : previewType === "none" ? (
    <div className="flex h-full min-h-full items-center justify-center p-4">
      <UnsupportedPreviewState file={currentFile} onOpenFile={handleOpenFile} />
    </div>
  ) : previewType === "text" ? (
    <TextPreviewPane content={textContent} />
  ) : imageSrc ? (
    isVideo ? (
      <div className="flex h-full min-h-full items-center justify-center p-4">
        <video
          src={imageSrc}
          controls
          playsInline
          preload="metadata"
          className={`${isFullscreen ? "max-w-6xl shadow-2xl" : "max-w-5xl shadow-lg"} max-h-full w-full rounded-lg bg-black`}
        />
      </div>
    ) : isImageLike ? (
      isFitMode || scaledImageWidth === null || scaledImageHeight === null ? (
        <div className="flex h-full min-h-full items-center justify-center p-4">
          <img
            src={imageSrc}
            alt={currentFile.name}
            className="max-h-full max-w-full cursor-grab select-none object-contain active:cursor-grabbing"
            onLoad={handleImageLoad}
            draggable={false}
          />
        </div>
      ) : (
        <div
          className="grid place-items-center"
          style={{
            width: `${scaledImageWidth}px`,
            height: `${scaledImageHeight}px`,
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          <img
            src={imageSrc}
            alt={currentFile.name}
            draggable={false}
            className="block select-none"
            onLoad={handleImageLoad}
            style={{
              width: `${scaledImageWidth}px`,
              height: `${scaledImageHeight}px`,
            }}
          />
        </div>
      )
    ) : null
  ) : null;

  const previewContextMenu = (
    <PreviewContextMenuContent
      flatFolders={flatFolders}
      canAnalyzeWithAi={canAnalyzeWithAi}
      triggerMenuAction={triggerMenuAction}
      onOpenFile={handleOpenFile}
      onShowInExplorer={handleShowInExplorer}
      onCopyFileToClipboard={handleCopyFileToClipboard}
      onAnalyzeMetadata={handleAnalyzeMetadata}
      onCopyFile={handleCopyFile}
      onMoveFile={handleMoveFile}
      onDeleteFile={handleDeleteFile}
    />
  );

  if (isFullscreen && typeof document !== "undefined") {
    return createPortal(
      <FullscreenPreviewShell
        currentNum={currentNum}
        totalFiles={totalFiles}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        supportsZoom={supportsZoom}
        previewType={previewType}
        isFitMode={isFitMode}
        canPanImage={canPanImage}
        isPanning={isPanning}
        viewportRef={viewportRef}
        renderedPreviewContent={renderedPreviewContent}
        previewContextMenu={previewContextMenu}
        onZoomOut={handleZoomOut}
        onZoomIn={handleZoomIn}
        onFitToView={handleFitToView}
        onToggleFullscreen={toggleFullscreen}
        onGoPrev={goToPrev}
        onGoNext={goToNext}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />,
      document.body,
    );
  }

  return (
    <StandardPreviewShell
      currentFolderName={currentFolderName}
      currentNum={currentNum}
      totalFiles={totalFiles}
      canGoPrev={canGoPrev}
      canGoNext={canGoNext}
      supportsZoom={supportsZoom}
      previewType={previewType}
      isFullscreen={isFullscreen}
      isFitMode={isFitMode}
      canPanImage={canPanImage}
      isPanning={isPanning}
      viewportRef={viewportRef}
      renderedPreviewContent={renderedPreviewContent}
      previewContextMenu={previewContextMenu}
      currentFile={currentFile}
      previewMeta={previewMeta}
      previewFiles={previewFiles}
      previewIndex={previewIndex}
      onZoomOut={handleZoomOut}
      onZoomIn={handleZoomIn}
      onFitToView={handleFitToView}
      onToggleFullscreen={toggleFullscreen}
      onClose={closePreview}
      onGoPrev={goToPrev}
      onGoNext={goToNext}
      onSelectPreviewIndex={setPreviewIndex}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
