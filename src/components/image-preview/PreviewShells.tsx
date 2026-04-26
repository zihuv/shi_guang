import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import type { FileItem } from "@/stores/fileTypes";
import { appIconButtonClass, appPanelTitleClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ThumbnailItem } from "@/components/image-preview/PreviewHelpers";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/ContextMenu";
import { OVERLAY_BUTTON_CLASS, OVERLAY_CHIP_CLASS } from "./constants";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Scan,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const FULLSCREEN_CONTROLS_HIDE_DELAY_MS = 900;
const PREVIEW_TOOL_BUTTON_CLASS = cn(appIconButtonClass, "size-8 rounded-lg");
const PREVIEW_THUMB_NAV_BUTTON_CLASS = cn(appIconButtonClass, "size-9 flex-shrink-0 rounded-xl");

interface PreviewViewportProps {
  canPanImage: boolean;
  isPanning: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  renderedPreviewContent: ReactNode;
  previewContextMenu: ReactNode;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
}

interface FullscreenPreviewShellProps extends PreviewViewportProps {
  currentNum: number;
  totalFiles: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  supportsZoom: boolean;
  previewType: string;
  isFitMode: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitToView: () => void;
  onToggleFullscreen: () => void;
  onGoPrev: () => void;
  onGoNext: () => void;
}

interface StandardPreviewShellProps extends PreviewViewportProps {
  currentFolderName: string;
  currentNum: number;
  totalFiles: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  supportsZoom: boolean;
  previewType: string;
  isFullscreen: boolean;
  isFitMode: boolean;
  previewFiles: FileItem[];
  previewIndex: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitToView: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onGoPrev: () => void;
  onGoNext: () => void;
  onSelectPreviewIndex: (index: number) => void;
}

function PreviewViewport({
  canPanImage,
  isPanning,
  viewportRef,
  renderedPreviewContent,
  previewContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: PreviewViewportProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={viewportRef}
          className={`preview-wheel-container flex-1 overflow-auto ${
            canPanImage ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""
          }`}
          style={{ scrollbarGutter: "stable" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {renderedPreviewContent}
        </div>
      </ContextMenuTrigger>
      {previewContextMenu}
    </ContextMenu>
  );
}

export function FullscreenPreviewShell({
  currentNum,
  totalFiles,
  canGoPrev,
  canGoNext,
  supportsZoom,
  previewType,
  isFitMode,
  onZoomOut,
  onZoomIn,
  onFitToView,
  onToggleFullscreen,
  onGoPrev,
  onGoNext,
  ...viewportProps
}: FullscreenPreviewShellProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef<number | null>(null);

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current === null) {
      return;
    }

    window.clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = null;
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    clearHideControlsTimer();
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideControlsTimerRef.current = null;
    }, FULLSCREEN_CONTROLS_HIDE_DELAY_MS);
  }, [clearHideControlsTimer]);

  useEffect(() => {
    showControls();
    return clearHideControlsTimer;
  }, [clearHideControlsTimer, currentNum, previewType, showControls, supportsZoom, totalFiles]);

  const controlsClassName = `transition-opacity duration-200 ${
    controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  return (
    <div className="fixed inset-0 z-[80] bg-black text-white">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="relative h-full w-full bg-black"
            onMouseDown={showControls}
            onMouseMove={showControls}
            onTouchStart={showControls}
          >
            <div
              className={`absolute left-4 top-4 z-20 flex items-center gap-2 ${controlsClassName}`}
            >
              {supportsZoom && (
                <>
                  <button onClick={onZoomOut} className={OVERLAY_BUTTON_CLASS} title="缩小">
                    <ZoomOut className="h-5 w-5" />
                  </button>
                  <button onClick={onZoomIn} className={OVERLAY_BUTTON_CLASS} title="放大">
                    <ZoomIn className="h-5 w-5" />
                  </button>
                  <button
                    onClick={onFitToView}
                    className={OVERLAY_BUTTON_CLASS}
                    title="适应视图"
                    aria-pressed={isFitMode}
                  >
                    <Scan className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            <div
              className={`absolute right-4 top-4 z-20 flex items-center gap-2 ${controlsClassName}`}
            >
              {previewType === "thumbnail" && (
                <span className={OVERLAY_CHIP_CLASS}>快照缩略图</span>
              )}
              {totalFiles > 1 && (
                <span className={OVERLAY_CHIP_CLASS}>
                  {currentNum} / {totalFiles}
                </span>
              )}
              <button
                onClick={onToggleFullscreen}
                className={OVERLAY_BUTTON_CLASS}
                title="退出全屏 (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {totalFiles > 1 && (
              <>
                <button
                  onClick={onGoPrev}
                  disabled={!canGoPrev}
                  className={`${OVERLAY_BUTTON_CLASS} ${controlsClassName} absolute left-4 top-1/2 z-20 -translate-y-1/2`}
                  title="上一张"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={onGoNext}
                  disabled={!canGoNext}
                  className={`${OVERLAY_BUTTON_CLASS} ${controlsClassName} absolute right-4 top-1/2 z-20 -translate-y-1/2`}
                  title="下一张"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}

            <div
              ref={viewportProps.viewportRef}
              className={`preview-wheel-container h-full w-full overflow-auto [&::-webkit-scrollbar]:hidden ${
                viewportProps.canPanImage
                  ? viewportProps.isPanning
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : ""
              }`}
              style={{ scrollbarGutter: "stable", scrollbarWidth: "none" }}
              onPointerDown={viewportProps.onPointerDown}
              onPointerMove={viewportProps.onPointerMove}
              onPointerUp={viewportProps.onPointerUp}
              onPointerCancel={viewportProps.onPointerUp}
            >
              {viewportProps.renderedPreviewContent}
            </div>
          </div>
        </ContextMenuTrigger>
        {viewportProps.previewContextMenu}
      </ContextMenu>
    </div>
  );
}

export function StandardPreviewShell({
  currentFolderName,
  currentNum,
  totalFiles,
  canGoPrev,
  canGoNext,
  supportsZoom,
  previewType,
  isFullscreen,
  isFitMode,
  previewFiles,
  previewIndex,
  onZoomOut,
  onZoomIn,
  onFitToView,
  onToggleFullscreen,
  onClose,
  onGoPrev,
  onGoNext,
  onSelectPreviewIndex,
  ...viewportProps
}: StandardPreviewShellProps) {
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const selectedThumbnailRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const strip = thumbnailStripRef.current;
    const selectedThumbnail = selectedThumbnailRef.current;

    if (!strip || !selectedThumbnail) {
      return;
    }

    const stripRect = strip.getBoundingClientRect();
    const selectedRect = selectedThumbnail.getBoundingClientRect();
    const targetLeft =
      strip.scrollLeft +
      selectedRect.left -
      stripRect.left -
      (strip.clientWidth - selectedRect.width) / 2;

    strip.scrollLeft = Math.max(0, targetLeft);
  }, [previewFiles.length, previewIndex]);

  return (
    <div className="flex h-full flex-col bg-[var(--app-canvas)]">
      <div className="flex h-12 items-center justify-between bg-[var(--app-surface)] px-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className={cn(appPanelTitleClass, "truncate")}>{currentFolderName}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onGoPrev}
            disabled={!canGoPrev}
            className={cn(PREVIEW_TOOL_BUTTON_CLASS, !canGoPrev && "cursor-not-allowed opacity-40")}
            title="上一张"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[60px] text-center text-[14px] font-medium text-gray-600 dark:text-gray-300">
            {currentNum} / {totalFiles}
          </span>
          <button
            onClick={onGoNext}
            disabled={!canGoNext}
            className={cn(PREVIEW_TOOL_BUTTON_CLASS, !canGoNext && "cursor-not-allowed opacity-40")}
            title="下一张"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {previewType === "thumbnail" && (
            <span className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              快照缩略图
            </span>
          )}
          {supportsZoom ? (
            <div className="flex items-center gap-2">
              <button onClick={onZoomOut} className={PREVIEW_TOOL_BUTTON_CLASS} title="缩小">
                <ZoomOut className="h-4 w-4" />
              </button>
              <button onClick={onZoomIn} className={PREVIEW_TOOL_BUTTON_CLASS} title="放大">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <span className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {previewType === "video" ? "视频播放" : "文件预览"}
            </span>
          )}

          {previewType !== "none" && (
            <>
              {supportsZoom && (
                <button
                  onClick={onFitToView}
                  className={PREVIEW_TOOL_BUTTON_CLASS}
                  title="适应视图"
                  aria-pressed={isFitMode}
                >
                  <Scan className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={onToggleFullscreen}
                className={PREVIEW_TOOL_BUTTON_CLASS}
                title={isFullscreen ? "退出全屏 (F)" : "全屏预览 (F)"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
            </>
          )}

          <button onClick={onClose} className={PREVIEW_TOOL_BUTTON_CLASS} title="关闭 (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <PreviewViewport {...viewportProps} />

      <div className="flex h-[72px] items-center gap-2 bg-[var(--app-surface)] px-4">
        <button
          onClick={onGoPrev}
          disabled={!canGoPrev}
          className={cn(
            PREVIEW_THUMB_NAV_BUTTON_CLASS,
            !canGoPrev && "cursor-not-allowed opacity-40",
          )}
          title="上一张"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={thumbnailStripRef}
          className="flex flex-1 items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {previewFiles.map((file, index) => (
            <button
              key={file.id}
              ref={index === previewIndex ? selectedThumbnailRef : undefined}
              onClick={() => onSelectPreviewIndex(index)}
              className={cn(
                "h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg transition-[opacity,box-shadow,transform]",
                index === previewIndex
                  ? "opacity-100 ring-2 ring-inset ring-primary-500/80 shadow-[0_8px_18px_rgba(59,130,246,0.16)]"
                  : "opacity-45 hover:opacity-75",
              )}
              aria-current={index === previewIndex ? "true" : undefined}
            >
              <ThumbnailItem file={file} />
            </button>
          ))}
        </div>

        <button
          onClick={onGoNext}
          disabled={!canGoNext}
          className={cn(
            PREVIEW_THUMB_NAV_BUTTON_CLASS,
            !canGoNext && "cursor-not-allowed opacity-40",
          )}
          title="下一张"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
