import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Play } from "lucide-react";
import { type FileItem, getNameWithoutExt } from "@/stores/fileTypes";
import { type LibraryViewMode, type LibraryVisibleField } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { useExternalFileDrag } from "@/hooks/useExternalFileDrag";
import FileTypeIcon from "@/components/FileTypeIcon";
import FileContextMenu from "@/components/FileContextMenu";
import {
  getAdaptiveFooterHeight,
  GRID_PREVIEW_HEIGHT_RATIO,
} from "@/components/file-grid/fileGridLayout";
import { formatSize, isVideoFile } from "@/utils";
import {
  resolveCardThumbnailMaxEdge,
  useLazyImageSrc,
  useThumbHashPlaceholder,
  useThumbnailRefreshVersion,
  useVisibility,
} from "@/components/file-grid/fileGridPreviewLoader";

const ADAPTIVE_OBSERVER_ROOT_MARGIN = "280px";
const MAX_VISIBLE_TAGS = 3;
const LIST_MAX_VISIBLE_TAGS = 2;
const INFO_TOKEN_FIELDS: LibraryVisibleField[] = ["ext", "size", "dimensions"];
const FILE_CARD_BASE_CLASS =
  "file-card group relative flex cursor-pointer flex-col transition-colors duration-75";
const FILE_CARD_PREVIEW_CLASS =
  "relative overflow-hidden rounded-[16px] transition-colors duration-75";
const FILE_CARD_NAME_CLASS =
  "app-text-clamp-2 break-all text-[12px] font-medium leading-[1.35] text-gray-800 dark:text-gray-100";
const FILE_CARD_META_CLASS = "truncate text-[11px] leading-4 text-gray-500 dark:text-gray-400";
type FileCardBaseProps = {
  file: FileItem;
  visibleFields: LibraryVisibleField[];
  isSelected: boolean;
  isMultiSelected: boolean;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
};

type VideoPlayBadgeProps = {
  compact?: boolean;
  className?: string;
};

type FilePreviewFallbackProps = {
  ext: string;
  compact?: boolean;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
};

function ThumbHashPlaceholder({ src, className }: { src: string; className?: string }) {
  if (!src) {
    return null;
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full scale-[1.04] object-cover blur-2xl saturate-150",
        className,
      )}
      draggable={false}
    />
  );
}

function PreviewImage({
  src,
  alt,
  className,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  onError: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(false);
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setIsReady(true);
    }
  }, [src]);

  return (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      className={cn(
        "transition-opacity duration-150 ease-out",
        isReady ? "opacity-100" : "opacity-0",
        className,
      )}
      draggable={false}
      onLoad={() => setIsReady(true)}
      onError={() => {
        setIsReady(false);
        onError();
      }}
    />
  );
}

export function FileCard({
  file,
  visibleFields,
  previewWidth,
  generation,
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { previewWidth: number; generation: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef);
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshVersion(file.id);
  const thumbnailMaxEdge = isVideo ? resolveCardThumbnailMaxEdge(previewWidth) : undefined;
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:${isVideo ? (thumbnailMaxEdge ?? "video") : "image-preview"}`;
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(
    file,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
    generation,
  );
  const thumbHashPlaceholderSrc = useThumbHashPlaceholder(
    file.path,
    file.ext,
    file.thumbHash,
    cacheKey,
    isVisible,
    thumbnailRefreshVersion,
  );
  const showLoadingPreview = imageSrc === null && !imageError;
  const imagePreviewSrc = !imageError && imageSrc ? imageSrc : "";
  const showImagePreview = Boolean(imagePreviewSrc);
  const showName = visibleFields.includes("name");
  const metaTokens = getFileInfoTokens(file, visibleFields);
  const showTags = shouldShowTags(file, visibleFields);
  const { dragHandleProps: externalDragProps } = useExternalFileDrag(file.id);

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef} className="h-full">
        <div
          data-file-id={file.id}
          {...externalDragProps}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            FILE_CARD_BASE_CLASS,
            "h-full",
            isMultiSelected
              ? "text-gray-900 dark:text-gray-100"
              : isSelected
                ? "text-gray-900 dark:text-gray-100"
                : "hover:text-gray-900 dark:hover:text-gray-100",
          )}
        >
          <div
            className={cn(
              FILE_CARD_PREVIEW_CLASS,
              isMultiSelected
                ? "ring-[2.5px] ring-primary-500/80 shadow-[0_10px_24px_rgba(59,130,246,0.14)] dark:ring-primary-500/85 dark:shadow-[0_14px_30px_rgba(0,0,0,0.24)]"
                : isSelected
                  ? "ring-[2.5px] ring-primary-400/75 shadow-[0_8px_22px_rgba(59,130,246,0.1)] dark:ring-primary-500/80 dark:shadow-[0_12px_26px_rgba(0,0,0,0.22)]"
                  : "",
            )}
            style={{ paddingBottom: `${GRID_PREVIEW_HEIGHT_RATIO * 100}%` }}
          >
            {showLoadingPreview && !thumbHashPlaceholderSrc ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="h-8 w-8 animate-pulse text-gray-300 dark:text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            ) : showImagePreview ? (
              <PreviewImage
                src={imagePreviewSrc}
                alt={file.name}
                className="absolute inset-0 h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            ) : !showLoadingPreview ? (
              <FilePreviewFallback ext={file.ext} className="absolute inset-0" />
            ) : null}
            {isVideo && <VideoPlayBadge className="absolute inset-0" />}
          </div>
          <div className={cn("flex min-h-0 flex-col px-0.5 pb-0.5 pt-1", showTags && "flex-1")}>
            {showName && <p className={FILE_CARD_NAME_CLASS}>{getNameWithoutExt(file.name)}</p>}
            {metaTokens.length > 0 && (
              <p className={cn(FILE_CARD_META_CLASS, showName && "mt-0.5")}>
                {metaTokens.join(" · ")}
              </p>
            )}
            {showTags && (
              <div className="mt-auto flex items-center gap-1 overflow-hidden whitespace-nowrap pt-0.5">
                {file.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                  <span
                    key={tag.id}
                    className="min-w-0 max-w-[88px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {file.tags.length > MAX_VISIBLE_TAGS && (
                  <span className="flex-shrink-0 text-[10px] text-gray-400">
                    +{file.tags.length - MAX_VISIBLE_TAGS}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </FileContextMenu>
  );
}

export function AdaptiveFileCard({
  file,
  visibleFields,
  previewWidth,
  generation,
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { previewWidth: number; generation: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(
    scrollRootRef,
    ADAPTIVE_OBSERVER_ROOT_MARGIN,
  );
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshVersion(file.id);
  const previewHeight =
    !file.width || !file.height || file.width <= 0 || file.height <= 0
      ? Math.round(previewWidth * 0.65)
      : Math.max(
          48,
          Math.min(
            Math.round(previewWidth * 1.3),
            Math.round((file.height / file.width) * previewWidth),
          ),
        );
  const thumbnailMaxEdge = isVideo
    ? resolveCardThumbnailMaxEdge(previewWidth, previewHeight)
    : undefined;
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:${isVideo ? (thumbnailMaxEdge ?? "video") : "image-preview"}`;
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(
    file,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
    generation,
  );
  const thumbHashPlaceholderSrc = useThumbHashPlaceholder(
    file.path,
    file.ext,
    file.thumbHash,
    cacheKey,
    isVisible,
    thumbnailRefreshVersion,
  );
  const showLoadingPreview = imageSrc === null && !imageError;
  const imagePreviewSrc = !imageError && imageSrc ? imageSrc : "";
  const showImagePreview = Boolean(imagePreviewSrc);
  const footerHeight = getAdaptiveFooterHeight(file, visibleFields);
  const showName = visibleFields.includes("name");
  const metaTokens = getFileInfoTokens(file, visibleFields);
  const showTags = shouldShowTags(file, visibleFields);
  const { dragHandleProps: externalDragProps } = useExternalFileDrag(file.id);
  const rawRatio =
    !file.width || !file.height || file.width === 0
      ? 65
      : Math.min(130, (file.height / file.width) * 100);
  const aspectRatio = `${rawRatio}%`;

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef}>
        <div
          data-file-id={file.id}
          {...externalDragProps}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            FILE_CARD_BASE_CLASS,
            isMultiSelected
              ? "text-gray-900 dark:text-gray-100"
              : isSelected
                ? "text-gray-900 dark:text-gray-100"
                : "hover:text-gray-900 dark:hover:text-gray-100",
          )}
        >
          <div
            className={cn(
              FILE_CARD_PREVIEW_CLASS,
              isMultiSelected
                ? "ring-[2.5px] ring-primary-500/80 shadow-[0_10px_24px_rgba(59,130,246,0.14)] dark:ring-primary-500/85 dark:shadow-[0_14px_30px_rgba(0,0,0,0.24)]"
                : isSelected
                  ? "ring-[2.5px] ring-primary-400/75 shadow-[0_8px_22px_rgba(59,130,246,0.1)] dark:ring-primary-500/80 dark:shadow-[0_12px_26px_rgba(0,0,0,0.22)]"
                  : "",
            )}
            style={{ paddingBottom: aspectRatio }}
          >
            {showLoadingPreview && !thumbHashPlaceholderSrc ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="h-8 w-8 animate-pulse text-gray-300 dark:text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            ) : showImagePreview ? (
              <PreviewImage
                src={imagePreviewSrc}
                alt={file.name}
                className="absolute inset-0 h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            ) : !showLoadingPreview ? (
              <FilePreviewFallback ext={file.ext} className="absolute inset-0" />
            ) : null}
            {isVideo && <VideoPlayBadge className="absolute inset-0" />}
          </div>
          <div
            className="flex min-h-0 flex-col px-0.5 pb-0.5 pt-1"
            style={{ minHeight: `${footerHeight}px` }}
          >
            {showName && <p className={FILE_CARD_NAME_CLASS}>{getNameWithoutExt(file.name)}</p>}
            {metaTokens.length > 0 && (
              <p className={cn(FILE_CARD_META_CLASS, showName && "mt-0.5")}>
                {metaTokens.join(" · ")}
              </p>
            )}
            {showTags && (
              <div className="mt-auto flex items-center gap-1 overflow-hidden whitespace-nowrap pt-0.5">
                {file.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                  <span
                    key={tag.id}
                    className="min-w-0 max-w-[88px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {file.tags.length > MAX_VISIBLE_TAGS && (
                  <span className="flex-shrink-0 text-[10px] text-gray-400">
                    +{file.tags.length - MAX_VISIBLE_TAGS}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </FileContextMenu>
  );
}

export function FileRow({
  file,
  visibleFields,
  thumbnailSize,
  generation,
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { thumbnailSize: number; generation: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef);
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshVersion(file.id);
  const thumbnailMaxEdge = isVideo ? resolveCardThumbnailMaxEdge(thumbnailSize) : undefined;
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:${isVideo ? (thumbnailMaxEdge ?? "video") : "image-preview"}`;
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(
    file,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
    generation,
  );
  const thumbHashPlaceholderSrc = useThumbHashPlaceholder(
    file.path,
    file.ext,
    file.thumbHash,
    cacheKey,
    isVisible,
    thumbnailRefreshVersion,
  );
  const showLoadingPreview = imageSrc === null && !imageError;
  const imagePreviewSrc = !imageError && imageSrc ? imageSrc : "";
  const showImagePreview = Boolean(imagePreviewSrc);
  const showTags = shouldShowTags(file, visibleFields);
  const visibleTags = showTags ? file.tags.slice(0, LIST_MAX_VISIBLE_TAGS) : [];
  const showName = visibleFields.includes("name");
  const metaTokens = getFileInfoTokens(file, visibleFields);
  const { dragHandleProps: externalDragProps } = useExternalFileDrag(file.id);

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef}>
        <div
          data-file-id={file.id}
          {...externalDragProps}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            "file-card relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-[16px] p-2.5 transition-colors duration-100",
            isMultiSelected
              ? "bg-primary-50/80 dark:bg-primary-900/18"
              : isSelected
                ? "bg-primary-50/90 ring-[1.5px] ring-inset ring-primary-300/90 dark:bg-primary-900/22 dark:ring-primary-600"
                : "hover:bg-black/[0.04] active:bg-black/[0.05] dark:hover:bg-white/[0.045] dark:active:bg-white/[0.06]",
          )}
        >
          <div
            className="relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-black/[0.04] dark:bg-white/[0.05]"
            style={{ height: `${thumbnailSize}px`, width: `${thumbnailSize}px` }}
          >
            <ThumbHashPlaceholder src={thumbHashPlaceholderSrc} className="opacity-80 blur-xl" />
            {showLoadingPreview && !thumbHashPlaceholderSrc ? (
              <svg
                className="h-5 w-5 animate-pulse text-gray-300 dark:text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            ) : showImagePreview ? (
              <PreviewImage
                src={imagePreviewSrc}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
                onError={() => setImageError(true)}
              />
            ) : !showLoadingPreview ? (
              <FilePreviewFallback
                ext={file.ext}
                compact
                className="h-full w-full"
                iconClassName="h-5 w-5"
                labelClassName="text-[9px]"
              />
            ) : null}
            {isVideo && <VideoPlayBadge compact className="absolute inset-0" />}
          </div>
          <div className="min-w-0 flex-1">
            {showName && (
              <p className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">
                {getNameWithoutExt(file.name)}
              </p>
            )}
            <div
              className={cn(
                "flex items-center gap-1 overflow-hidden text-[11px] text-gray-400",
                showName && "mt-0.5",
              )}
            >
              {metaTokens.map((token, index) => (
                <span key={`${token}-${index}`} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <span className="text-gray-300 dark:text-gray-600">·</span>}
                  <span className="truncate">{token}</span>
                </span>
              ))}
              {metaTokens.length > 0 && visibleTags.length > 0 && (
                <span className="text-gray-300 dark:text-gray-600">·</span>
              )}
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex min-w-0 max-w-[84px] items-center gap-1 rounded-full bg-black/[0.04] px-1.5 py-0 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
              ))}
              {showTags && file.tags.length > LIST_MAX_VISIBLE_TAGS && (
                <span className="flex-shrink-0 text-[10px] text-gray-400">
                  +{file.tags.length - LIST_MAX_VISIBLE_TAGS}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </FileContextMenu>
  );
}

export function InfoDisplayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"
      />
      <circle cx="5" cy="6.5" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17.5" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ViewModeIcon({ mode, className }: { mode: LibraryViewMode; className?: string }) {
  if (mode === "list") {
    return (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M6 7h12M6 12h12M6 17h12"
        />
      </svg>
    );
  }

  if (mode === "adaptive") {
    return (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect x="4" y="5" width="6" height="14" rx="1.5" strokeWidth={1.8} />
        <rect x="14" y="5" width="6" height="8" rx="1.5" strokeWidth={1.8} />
        <rect x="14" y="15" width="6" height="4" rx="1.5" strokeWidth={1.8} />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="6" height="6" rx="1.5" strokeWidth={1.8} />
      <rect x="14" y="5" width="6" height="6" rx="1.5" strokeWidth={1.8} />
      <rect x="4" y="13" width="6" height="6" rx="1.5" strokeWidth={1.8} />
      <rect x="14" y="13" width="6" height="6" rx="1.5" strokeWidth={1.8} />
    </svg>
  );
}

function getFileDimensionsText(file: FileItem) {
  if (file.width > 0 && file.height > 0) {
    return `${file.width} × ${file.height}`;
  }

  return null;
}

function shouldShowTags(file: FileItem, visibleFields: LibraryVisibleField[]) {
  return visibleFields.includes("tags") && file.tags.length > 0;
}

function getFileInfoTokens(file: FileItem, visibleFields: LibraryVisibleField[]) {
  const tokens: string[] = [];

  INFO_TOKEN_FIELDS.forEach((field) => {
    if (!visibleFields.includes(field)) {
      return;
    }

    switch (field) {
      case "ext":
        tokens.push(file.ext.toUpperCase());
        break;
      case "size":
        tokens.push(formatSize(file.size));
        break;
      case "dimensions": {
        const dimensionsText = getFileDimensionsText(file);
        if (dimensionsText) {
          tokens.push(dimensionsText);
        }
        break;
      }
      default:
        break;
    }
  });

  return tokens;
}

function VideoPlayBadge({ compact = false, className }: VideoPlayBadgeProps) {
  return (
    <div
      className={cn(
        "pointer-events-none flex items-center justify-center bg-black/20 text-white",
        compact ? "rounded text-[10px]" : "rounded-lg",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-black/60",
          compact ? "h-5 w-5" : "h-9 w-9",
        )}
      >
        <Play className={compact ? "ml-0.5 h-3 w-3 fill-current" : "ml-0.5 h-4 w-4 fill-current"} />
      </span>
    </div>
  );
}

function FilePreviewFallback({
  ext,
  compact = false,
  className,
  iconClassName,
  labelClassName,
}: FilePreviewFallbackProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400 dark:bg-dark-bg dark:text-gray-500",
        compact ? "text-[10px]" : "text-[11px]",
        className,
      )}
    >
      <FileTypeIcon ext={ext} className={cn(compact ? "h-5 w-5" : "h-8 w-8", iconClassName)} />
      <span className={cn("uppercase", labelClassName)}>{ext || "FILE"}</span>
    </div>
  );
}
