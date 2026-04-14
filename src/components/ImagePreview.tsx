import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { copyFilesToClipboard } from "@/lib/clipboard";
import { startExternalFileDrag } from "@/lib/externalDrag";
import {
  AI_IMAGE_EXTENSIONS,
  BASE_WHEEL_ZOOM_SENSITIVITY,
  BUTTON_ZOOM_FACTOR,
  FIT_MODE_SNAP_EPSILON,
  IS_MACOS,
  clampValue,
  clampZoom,
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
import { updateFileDimensions } from "@/services/tauri/files";
import { openFile, showInExplorer } from "@/services/tauri/system";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTrashStore } from "@/stores/trashStore";
import {
  buildAiImageDataUrl,
  getFilePreviewMode,
  getFileSrc,
  getTextPreviewContent,
  isPdfFile,
  isVideoFile,
} from "@/utils";

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
  const deleteFile = useTrashStore((state) => state.deleteFile);

  const { folders, selectedFolderId } = useFolderStore();
  const previewTrackpadZoomSpeed = useSettingsStore((state) => state.previewTrackpadZoomSpeed);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [imageError, setImageError] = useState(false);
  const [zoom, setZoom] = useState<number | "auto">("auto");
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [loadedImageSize, setLoadedImageSize] = useState({ width: 0, height: 0 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastMenuActionRef = useRef<{ key: string; timestamp: number } | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const previousZoomRef = useRef<number | "auto">("auto");
  const shouldCenterImageRef = useRef(false);
  const lastPreviewFileIdRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const persistedDimensionsRef = useRef<Record<number, string>>({});

  const currentFolderName = selectedFolderId
    ? folders.find((folder) => folder.id === selectedFolderId)?.name || "未知文件夹"
    : "全部文件";

  const currentFile = previewFiles[previewIndex];
  const previewType = currentFile ? getFilePreviewMode(currentFile.ext) : "none";
  const isVideo = currentFile ? isVideoFile(currentFile.ext) : false;
  const isPdf = currentFile ? isPdfFile(currentFile.ext) : false;
  const isImageLike = previewType === "image";
  const canAnalyzeWithAi = currentFile
    ? AI_IMAGE_EXTENSIONS.has(currentFile.ext.toLowerCase())
    : false;
  const supportsZoom = previewType === "image";
  const wheelZoomSensitivity = BASE_WHEEL_ZOOM_SENSITIVITY * previewTrackpadZoomSpeed;

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
    if (!currentFile) {
      lastPreviewFileIdRef.current = null;
      return;
    }

    const previousFileId = lastPreviewFileIdRef.current;
    if (previousFileId !== null && previousFileId !== currentFile.id) {
      shouldCenterImageRef.current = false;
      pendingScrollRef.current = null;
      setZoom("auto");
      panStateRef.current = null;
      setIsPanning(false);
    }

    lastPreviewFileIdRef.current = currentFile.id;
  }, [currentFile]);

  useEffect(() => {
    setLoadedImageSize({ width: 0, height: 0 });
  }, [currentFile?.id]);

  useEffect(() => {
    if (!currentFile) return;

    let mounted = true;
    setIsLoading(true);
    setImageError(false);
    setImageSrc(null);
    setTextContent("");

    if (previewType === "none") {
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    if (previewType === "text") {
      getTextPreviewContent(currentFile.path, currentFile.size).then((content) => {
        if (mounted) {
          setTextContent(content);
          setIsLoading(false);
        }
      });

      return () => {
        mounted = false;
      };
    }

    getFileSrc(currentFile.path).then((src) => {
      if (!mounted) return;
      if (src) {
        setImageSrc(src);
      } else {
        setImageError(true);
      }
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [currentFile, previewType]);

  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

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

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const updateViewportSize = () => {
      setViewportSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateViewportSize();

    const observer = new ResizeObserver(() => {
      updateViewportSize();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [isFullscreen, previewIndex, previewMode]);

  useLayoutEffect(() => {
    const container = viewportRef.current;
    if (!container) {
      previousZoomRef.current = zoom;
      return;
    }

    if (zoom === "auto") {
      pendingScrollRef.current = null;
      container.scrollLeft = 0;
      container.scrollTop = 0;
      shouldCenterImageRef.current = false;
      previousZoomRef.current = zoom;
      return;
    }

    const pendingScroll = pendingScrollRef.current;
    if (pendingScroll) {
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

      container.scrollLeft = clampValue(pendingScroll.left, 0, maxScrollLeft);
      container.scrollTop = clampValue(pendingScroll.top, 0, maxScrollTop);
      pendingScrollRef.current = null;
      shouldCenterImageRef.current = false;
      previousZoomRef.current = zoom;
      return;
    }

    if (previousZoomRef.current === "auto" || shouldCenterImageRef.current) {
      container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
      container.scrollTop = Math.max(0, (container.scrollHeight - container.clientHeight) / 2);
      shouldCenterImageRef.current = false;
    }

    previousZoomRef.current = zoom;
  }, [isFullscreen, previewIndex, viewportSize.height, viewportSize.width, zoom]);

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

  const handleExternalDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    void startExternalFileDrag([currentFile.id]).catch((error) => {
      console.error("Failed to start external drag:", error);
      toast.error("拖拽到外部应用失败");
    });
  };

  const suppressExternalDragEvent = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleExternalDragMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (!IS_MACOS || event.button !== 0) return;

    suppressExternalDragEvent(event);

    void startExternalFileDrag([currentFile.id]).catch((error) => {
      console.error("Failed to start external drag:", error);
      toast.error("拖拽到外部应用失败");
    });
  };

  const getExternalDragProps = () => {
    if (IS_MACOS) {
      return {
        onMouseDown: handleExternalDragMouseDown,
        onClick: suppressExternalDragEvent,
      };
    }

    return {
      draggable: true,
      onDragStart: handleExternalDragStart,
    };
  };

  const externalDragProps = getExternalDragProps();

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

  const isFitMode = zoom === "auto";
  const canPanImage = isImageLike && !isFitMode;
  const manualZoomScale = typeof zoom === "number" ? zoom / 100 : 1;
  const imageWidth =
    currentFile?.width > 0
      ? currentFile.width
      : loadedImageSize.width > 0
        ? loadedImageSize.width
        : null;
  const imageHeight =
    currentFile?.height > 0
      ? currentFile.height
      : loadedImageSize.height > 0
        ? loadedImageSize.height
        : null;
  const fitZoomPercent =
    imageWidth && imageHeight && viewportSize.width > 0 && viewportSize.height > 0
      ? clampZoom(
          Math.min(
            100,
            Math.floor(
              Math.min(
                Math.max(1, viewportSize.width - 32) / imageWidth,
                Math.max(1, viewportSize.height - 32) / imageHeight,
              ) * 100,
            ),
          ),
        )
      : 100;
  const scaledImageWidth =
    !isFitMode && imageWidth ? Math.max(1, Math.round(imageWidth * manualZoomScale)) : null;
  const scaledImageHeight =
    !isFitMode && imageHeight ? Math.max(1, Math.round(imageHeight * manualZoomScale)) : null;

  const applyZoom = useCallback(
    (
      nextZoomInput: number | ((currentZoom: number) => number),
      anchor?: { x: number; y: number },
    ) => {
      const container = viewportRef.current;
      if (!container) return;

      const anchorX = anchor?.x ?? container.clientWidth / 2;
      const anchorY = anchor?.y ?? container.clientHeight / 2;
      const currentScrollLeft = container.scrollLeft;
      const currentScrollTop = container.scrollTop;

      setZoom((prevZoom) => {
        const baseZoom = prevZoom === "auto" ? fitZoomPercent : prevZoom;
        const nextZoom = clampZoom(
          typeof nextZoomInput === "function" ? nextZoomInput(baseZoom) : nextZoomInput,
        );

        if (nextZoom <= fitZoomPercent + FIT_MODE_SNAP_EPSILON) {
          pendingScrollRef.current = null;
          shouldCenterImageRef.current = false;
          return "auto";
        }

        const currentScale = baseZoom / 100;
        const nextScale = nextZoom / 100;

        if (imageWidth && imageHeight) {
          const currentCanvasWidth = Math.max(imageWidth * currentScale, viewportSize.width);
          const currentCanvasHeight = Math.max(imageHeight * currentScale, viewportSize.height);
          const currentImageOffsetLeft = Math.max(
            0,
            (currentCanvasWidth - imageWidth * currentScale) / 2,
          );
          const currentImageOffsetTop = Math.max(
            0,
            (currentCanvasHeight - imageHeight * currentScale) / 2,
          );
          const nextCanvasWidth = Math.max(imageWidth * nextScale, viewportSize.width);
          const nextCanvasHeight = Math.max(imageHeight * nextScale, viewportSize.height);
          const nextImageOffsetLeft = Math.max(0, (nextCanvasWidth - imageWidth * nextScale) / 2);
          const nextImageOffsetTop = Math.max(0, (nextCanvasHeight - imageHeight * nextScale) / 2);

          const imageCoordinateX = clampValue(
            (currentScrollLeft + anchorX - currentImageOffsetLeft) / currentScale,
            0,
            imageWidth,
          );
          const imageCoordinateY = clampValue(
            (currentScrollTop + anchorY - currentImageOffsetTop) / currentScale,
            0,
            imageHeight,
          );

          pendingScrollRef.current = {
            left: nextImageOffsetLeft + imageCoordinateX * nextScale - anchorX,
            top: nextImageOffsetTop + imageCoordinateY * nextScale - anchorY,
          };
        } else {
          shouldCenterImageRef.current = true;
        }

        return Math.round(nextZoom * 100) / 100;
      });
    },
    [fitZoomPercent, imageHeight, imageWidth, viewportSize.height, viewportSize.width],
  );

  const handleZoomOut = () => {
    applyZoom((currentZoom) => currentZoom / BUTTON_ZOOM_FACTOR);
  };

  const handleZoomIn = () => {
    applyZoom((currentZoom) => currentZoom * BUTTON_ZOOM_FACTOR);
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const handleNativeWheel = useCallback(
    (event: WheelEvent) => {
      if (!supportsZoom) return;
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const container = viewportRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const deltaY =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;

      applyZoom((currentZoom) => currentZoom * Math.exp(-deltaY * wheelZoomSensitivity), {
        x: pointerX,
        y: pointerY,
      });
    },
    [applyZoom, supportsZoom, wheelZoomSensitivity],
  );

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleNativeWheel);
    };
  }, [handleNativeWheel, isFullscreen, previewIndex, previewMode]);

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
    [currentFile],
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;
      hydrateCurrentFileDimensions(target.naturalWidth, target.naturalHeight);
    },
    [hydrateCurrentFileDimensions],
  );

  const finishPan = (pointerId: number) => {
    const container = viewportRef.current;
    if (container?.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId);
    }
    panStateRef.current = null;
    setIsPanning(false);
  };

  const handleFitToView = () => {
    const panState = panStateRef.current;
    if (panState) {
      finishPan(panState.pointerId);
    }

    pendingScrollRef.current = null;
    shouldCenterImageRef.current = false;
    setZoom("auto");
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPanImage || event.button !== 0) return;

    const container = viewportRef.current;
    if (!container) return;

    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    container.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    const container = viewportRef.current;
    if (!panState || !container || panState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    container.scrollLeft = panState.scrollLeft - deltaX;
    container.scrollTop = panState.scrollTop - deltaY;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) return;
    finishPan(event.pointerId);
  };

  if (!previewMode || !currentFile) return null;

  const totalFiles = previewFiles.length;
  const currentNum = previewIndex + 1;
  const canGoPrev = previewIndex > 0;
  const canGoNext = previewIndex < totalFiles - 1;
  const previewMeta = getPreviewMetaText(currentFile, loadedImageSize);

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
    ) : isPdf ? (
      <div className="h-full min-h-full p-4">
        <object
          data={imageSrc}
          type="application/pdf"
          className="h-full w-full rounded-lg bg-white"
        >
          <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
            <p>当前环境不支持 PDF 内嵌预览</p>
            <p className="text-xs">可以使用右键菜单用默认应用打开</p>
          </div>
        </object>
      </div>
    ) : isImageLike ? (
      isFitMode || scaledImageWidth === null || scaledImageHeight === null ? (
        <div className="flex h-full min-h-full items-center justify-center p-4">
          <img
            src={imageSrc}
            alt={currentFile.name}
            className="max-h-full max-w-full cursor-grab select-none object-contain active:cursor-grabbing"
            onLoad={handleImageLoad}
            {...externalDragProps}
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
      externalDragProps={externalDragProps}
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
