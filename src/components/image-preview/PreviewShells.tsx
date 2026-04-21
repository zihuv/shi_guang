import type { PointerEventHandler, ReactNode, RefObject } from "react";
import type { FileItem } from "@/stores/fileTypes";
import { formatSize } from "@/utils";
import FileTypeIcon from "@/components/FileTypeIcon";
import { ThumbnailItem } from "@/components/image-preview/PreviewHelpers";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/ContextMenu";
import { OVERLAY_BUTTON_CLASS, OVERLAY_CHIP_CLASS } from "./constants";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";

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
  currentFile: FileItem;
  previewMeta: string;
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
  isFitMode,
  onZoomOut,
  onZoomIn,
  onFitToView,
  onToggleFullscreen,
  onGoPrev,
  onGoNext,
  ...viewportProps
}: FullscreenPreviewShellProps) {
  return (
    <div className="fixed inset-0 z-[80] bg-black text-white">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative h-full w-full">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/70 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-black/50 to-transparent" />

            <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
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

            <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
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
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {totalFiles > 1 && (
              <>
                <button
                  onClick={onGoPrev}
                  disabled={!canGoPrev}
                  className={`${OVERLAY_BUTTON_CLASS} absolute left-4 top-1/2 z-20 -translate-y-1/2`}
                  title="上一张"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                <button
                  onClick={onGoNext}
                  disabled={!canGoNext}
                  className={`${OVERLAY_BUTTON_CLASS} absolute right-4 top-1/2 z-20 -translate-y-1/2`}
                  title="下一张"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </>
            )}

            <div
              ref={viewportProps.viewportRef}
              className={`preview-wheel-container h-full w-full overflow-auto ${
                viewportProps.canPanImage
                  ? viewportProps.isPanning
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : ""
              }`}
              style={{ scrollbarGutter: "stable" }}
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
  currentFile,
  previewMeta,
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
  return (
    <div className="flex h-full flex-col bg-gray-100 dark:bg-dark-bg">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-dark-border dark:bg-dark-surface">
        <div className="flex items-center gap-4">
          <span className="text-sm">{currentFolderName}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onGoPrev}
            disabled={!canGoPrev}
            className={`rounded p-1.5 ${
              canGoPrev
                ? "hover:bg-gray-200 dark:hover:bg-gray-700"
                : "cursor-not-allowed opacity-50"
            }`}
            title="上一张"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <span className="min-w-[60px] text-center text-sm">
            {currentNum} / {totalFiles}
          </span>
          <button
            onClick={onGoNext}
            disabled={!canGoNext}
            className={`rounded p-1.5 ${
              canGoNext
                ? "hover:bg-gray-200 dark:hover:bg-gray-700"
                : "cursor-not-allowed opacity-50"
            }`}
            title="下一张"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {supportsZoom ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onZoomOut}
                className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                title="缩小"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={onZoomIn}
                className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                title="放大"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <span className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 dark:bg-dark-border dark:text-gray-300">
              {previewType === "video"
                ? "视频播放"
                : previewType === "pdf"
                  ? "PDF 预览"
                  : "文件预览"}
            </span>
          )}

          {previewType !== "none" && (
            <>
              {supportsZoom && (
                <button
                  onClick={onFitToView}
                  className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="适应视图"
                  aria-pressed={isFitMode}
                >
                  <Scan className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={onToggleFullscreen}
                className="rounded px-2 py-1 text-sm hover:bg-gray-200 dark:hover:bg-gray-700"
                title={isFullscreen ? "退出全屏 (F)" : "全屏预览 (F)"}
              >
                {isFullscreen ? "退出全屏" : "全屏"}
              </button>
            </>
          )}

          <button
            onClick={onClose}
            className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
            title="关闭 (Esc)"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      <PreviewViewport {...viewportProps} />

      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-1 text-xs dark:border-dark-border dark:bg-dark-surface">
        <div className="flex min-w-0 items-center gap-2">
          <FileTypeIcon
            ext={currentFile.ext}
            className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400"
          />
          <span className="truncate text-gray-600 dark:text-gray-400">{currentFile.name}</span>
        </div>
        <span className="text-gray-500 dark:text-gray-500">
          {previewMeta} · {formatSize(currentFile.size)}
        </span>
      </div>

      <div className="flex h-20 items-center gap-2 overflow-x-auto border-t border-gray-200 bg-white px-4 dark:border-dark-border dark:bg-dark-surface">
        <button
          onClick={onGoPrev}
          disabled={!canGoPrev}
          className={`flex-shrink-0 rounded p-1 ${
            canGoPrev ? "hover:bg-gray-200 dark:hover:bg-gray-700" : "cursor-not-allowed opacity-50"
          }`}
        >
          <svg
            className="h-5 w-5 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        <div className="flex flex-1 items-center gap-1 overflow-x-auto py-1">
          {previewFiles.map((file, index) => (
            <button
              key={file.id}
              onClick={() => onSelectPreviewIndex(index)}
              className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded transition-all ${
                index === previewIndex ? "ring-2 ring-white" : "opacity-50 hover:opacity-80"
              }`}
            >
              <ThumbnailItem file={file} />
            </button>
          ))}
        </div>

        <button
          onClick={onGoNext}
          disabled={!canGoNext}
          className={`flex-shrink-0 rounded p-1 ${
            canGoNext ? "hover:bg-gray-200 dark:hover:bg-gray-700" : "cursor-not-allowed opacity-50"
          }`}
        >
          <svg
            className="h-5 w-5 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
