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
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { cn } from "@/lib/utils";
import { useExternalFileDrag } from "@/hooks/useExternalFileDrag";
import FileTypeIcon from "@/components/FileTypeIcon";
import FileContextMenu from "@/components/FileContextMenu";
import {
  getAdaptiveFooterHeight,
  GRID_PREVIEW_HEIGHT_RATIO,
} from "@/components/file-grid/fileGridLayout";
import {
  canGenerateThumbnail,
  formatSize,
  getFileSrc,
  getThumbnailImageSrc,
  getVideoThumbnailSrc,
  isVideoFile,
  rememberPreviewImageSrc,
  resolveThumbnailRequestMaxEdge,
} from "@/utils";

const OBSERVER_ROOT_MARGIN = "96px";
const ADAPTIVE_OBSERVER_ROOT_MARGIN = "72px";
const IMAGE_SRC_CACHE_LIMIT = 192;
const MAX_CONCURRENT_CARD_THUMBNAIL_LOADS = 6;
const MAX_VISIBLE_TAGS = 3;
const LIST_MAX_VISIBLE_TAGS = 2;
const INFO_TOKEN_FIELDS: LibraryVisibleField[] = ["ext", "size", "dimensions"];
const FILE_CARD_BASE_CLASS =
  "file-card group relative flex cursor-pointer flex-col overflow-hidden rounded-[14px] px-1 pb-1 transition-colors duration-75";
const FILE_CARD_PREVIEW_CLASS =
  "relative overflow-hidden rounded-[12px] bg-gray-100 shadow-[0_12px_28px_rgba(15,23,42,0.09)] dark:bg-dark-bg dark:shadow-[0_14px_28px_rgba(0,0,0,0.26)]";
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

const imageSrcCache = new Map<string, string>();
const pendingCardThumbnailTasks: Array<() => void> = [];
let activeCardThumbnailTaskCount = 0;

function isRevocableBlobSrc(src: string | null | undefined): src is string {
  return typeof src === "string" && src.startsWith("blob:");
}

function releaseUnusedImageSrc(src: string | null | undefined) {
  if (isRevocableBlobSrc(src)) {
    URL.revokeObjectURL(src);
  }
}

function shouldCacheImageSrc(src: string) {
  return Boolean(src) && !src.startsWith("blob:") && !src.startsWith("data:");
}

function flushCardThumbnailTaskQueue() {
  while (
    activeCardThumbnailTaskCount < MAX_CONCURRENT_CARD_THUMBNAIL_LOADS &&
    pendingCardThumbnailTasks.length > 0
  ) {
    const nextTask = pendingCardThumbnailTasks.shift();
    nextTask?.();
  }
}

function scheduleCardThumbnailTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const runTask = () => {
      activeCardThumbnailTaskCount += 1;
      task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeCardThumbnailTaskCount = Math.max(0, activeCardThumbnailTaskCount - 1);
          flushCardThumbnailTaskQueue();
        });
    };

    pendingCardThumbnailTasks.push(runTask);
    flushCardThumbnailTaskQueue();
  });
}

function getCachedImageSrc(cacheKey: string) {
  const cached = imageSrcCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  imageSrcCache.delete(cacheKey);
  imageSrcCache.set(cacheKey, cached);
  return cached;
}

function cacheImageSrc(cacheKey: string, src: string) {
  if (!shouldCacheImageSrc(src)) {
    return;
  }

  const existing = imageSrcCache.get(cacheKey);
  if (existing && existing !== src && isRevocableBlobSrc(existing)) {
    URL.revokeObjectURL(existing);
  }

  imageSrcCache.set(cacheKey, src);

  while (imageSrcCache.size > IMAGE_SRC_CACHE_LIMIT) {
    const oldestKey = imageSrcCache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    const oldestSrc = imageSrcCache.get(oldestKey);
    if (isRevocableBlobSrc(oldestSrc)) {
      URL.revokeObjectURL(oldestSrc);
    }
    imageSrcCache.delete(oldestKey);
  }
}

function resolveCardThumbnailMaxEdge(previewWidth: number, previewHeight: number = previewWidth) {
  return resolveThumbnailRequestMaxEdge(previewWidth, previewHeight, {
    devicePixelRatioCap: 1,
  });
}

function useVisibility(
  rootRef: RefObject<HTMLElement | null>,
  rootMargin: string = OBSERVER_ROOT_MARGIN,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    const root = rootRef.current;
    if (!element || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries.some((entry) => entry.isIntersecting));
      },
      {
        root,
        rootMargin,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, rootRef]);

  return { ref, isVisible };
}

function useLazyImageSrc(
  path: string,
  ext: string,
  cacheKey: string,
  isVisible: boolean,
  maxEdge: number | undefined,
  refreshVersion: number,
) {
  const [imageError, setImageError] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(() => getCachedImageSrc(cacheKey));

  useEffect(() => {
    if (!isVisible) {
      setImageSrc(null);
      setImageError(false);
      return;
    }

    if (!canGenerateThumbnail(ext)) {
      setImageError(false);
      setImageSrc("");
      return;
    }

    const cached = getCachedImageSrc(cacheKey);
    if (cached) {
      setImageError(false);
      setImageSrc(cached);
      return;
    }

    let active = true;
    setImageError(false);

    scheduleCardThumbnailTask(async () => {
      if (isVideoFile(ext)) {
        return getVideoThumbnailSrc(path, maxEdge);
      }

      const thumbnailSrc = await getThumbnailImageSrc(path, ext, maxEdge);
      return thumbnailSrc || getFileSrc(path);
    })
      .then((src) => {
        if (!active) {
          releaseUnusedImageSrc(src);
          return;
        }

        cacheImageSrc(cacheKey, src);
        setImageSrc(src);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        console.error("Failed to load card thumbnail:", error);
        setImageError(true);
        setImageSrc("");
      });

    return () => {
      active = false;
    };
  }, [cacheKey, ext, isVisible, maxEdge, path, refreshVersion]);

  useEffect(() => {
    if (imageSrc) {
      rememberPreviewImageSrc(path, imageSrc);
    }
  }, [imageSrc, path]);

  return {
    imageSrc,
    imageError,
    setImageError,
  };
}

export function FileCard({
  file,
  visibleFields,
  footerHeight,
  previewWidth,
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { footerHeight: number; previewWidth: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef);
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
  const thumbnailMaxEdge = isVideo ? resolveCardThumbnailMaxEdge(previewWidth) : undefined;
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:${isVideo ? (thumbnailMaxEdge ?? "video") : "image-preview"}`;
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(
    file.path,
    file.ext,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
  );
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
          onMouseDownCapture={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            FILE_CARD_BASE_CLASS,
            "h-full",
            isMultiSelected
              ? "bg-primary-500/[0.08] ring-2 ring-primary-500/70 shadow-[0_14px_32px_rgba(59,130,246,0.14)] dark:bg-primary-500/12 dark:shadow-[0_18px_34px_rgba(0,0,0,0.3)]"
              : isSelected
                ? "bg-white/35 ring-2 ring-primary-400/70 shadow-[0_12px_28px_rgba(59,130,246,0.1)] dark:bg-white/[0.04] dark:ring-primary-700 dark:shadow-[0_16px_32px_rgba(0,0,0,0.28)]"
                : "hover:bg-white/20 active:bg-white/24 dark:hover:bg-white/[0.03] dark:active:bg-white/[0.05]",
          )}
        >
          <div
            className={FILE_CARD_PREVIEW_CLASS}
            style={{ paddingBottom: `${GRID_PREVIEW_HEIGHT_RATIO * 100}%` }}
          >
            {!isVisible || imageSrc === null ? (
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
            ) : imageSrc && !imageError ? (
              <img
                src={imageSrc}
                alt={file.name}
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
                onError={() => setImageError(true)}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <FilePreviewFallback ext={file.ext} className="absolute inset-0" />
            )}
            {isVideo && <VideoPlayBadge className="absolute inset-0" />}
          </div>
          <div
            className="flex min-h-0 flex-1 flex-col px-1.5 pb-0.5 pt-2"
            style={{ minHeight: `${footerHeight}px` }}
          >
            {showName && <p className={FILE_CARD_NAME_CLASS}>{getNameWithoutExt(file.name)}</p>}
            {metaTokens.length > 0 && (
              <p className={cn(FILE_CARD_META_CLASS, showName && "mt-1")}>
                {metaTokens.join(" · ")}
              </p>
            )}
            {showTags && (
              <div className="mt-auto flex items-center gap-1 overflow-hidden whitespace-nowrap pt-1.5">
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
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { previewWidth: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(
    scrollRootRef,
    ADAPTIVE_OBSERVER_ROOT_MARGIN,
  );
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
  const previewHeight =
    !file.width || !file.height || file.width <= 0 || file.height <= 0
      ? previewWidth
      : Math.max(80, Math.round((file.height / file.width) * previewWidth));
  const thumbnailMaxEdge = isVideo
    ? resolveCardThumbnailMaxEdge(previewWidth, previewHeight)
    : undefined;
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:${isVideo ? (thumbnailMaxEdge ?? "video") : "image-preview"}`;
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(
    file.path,
    file.ext,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
  );
  const footerHeight = getAdaptiveFooterHeight(file, visibleFields);
  const showName = visibleFields.includes("name");
  const metaTokens = getFileInfoTokens(file, visibleFields);
  const showTags = shouldShowTags(file, visibleFields);
  const { dragHandleProps: externalDragProps } = useExternalFileDrag(file.id);
  const aspectRatio =
    !file.width || !file.height || file.width === 0
      ? "100%"
      : `${(file.height / file.width) * 100}%`;

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef}>
        <div
          data-file-id={file.id}
          {...externalDragProps}
          onMouseDownCapture={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            FILE_CARD_BASE_CLASS,
            isMultiSelected
              ? "bg-primary-500/[0.08] ring-2 ring-primary-500/70 shadow-[0_14px_32px_rgba(59,130,246,0.14)] dark:bg-primary-500/12 dark:shadow-[0_18px_34px_rgba(0,0,0,0.3)]"
              : isSelected
                ? "bg-white/35 ring-2 ring-primary-400/70 shadow-[0_12px_28px_rgba(59,130,246,0.1)] dark:bg-white/[0.04] dark:ring-primary-700 dark:shadow-[0_16px_32px_rgba(0,0,0,0.28)]"
                : "hover:bg-white/20 active:bg-white/24 dark:hover:bg-white/[0.03] dark:active:bg-white/[0.05]",
          )}
        >
          <div className={FILE_CARD_PREVIEW_CLASS} style={{ paddingBottom: aspectRatio }}>
            {!isVisible || imageSrc === null ? (
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
            ) : imageSrc && !imageError ? (
              <img
                src={imageSrc}
                alt={file.name}
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
                onError={() => setImageError(true)}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <FilePreviewFallback ext={file.ext} className="absolute inset-0" />
            )}
            {isVideo && <VideoPlayBadge className="absolute inset-0" />}
          </div>
          <div
            className="flex min-h-0 flex-1 flex-col px-1.5 pb-0.5 pt-2"
            style={{ minHeight: `${footerHeight}px` }}
          >
            {showName && <p className={FILE_CARD_NAME_CLASS}>{getNameWithoutExt(file.name)}</p>}
            {metaTokens.length > 0 && (
              <p className={cn(FILE_CARD_META_CLASS, showName && "mt-1")}>
                {metaTokens.join(" · ")}
              </p>
            )}
            {showTags && (
              <div className="mt-auto flex items-center gap-1 overflow-hidden whitespace-nowrap pt-1.5">
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
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { thumbnailSize: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef);
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
  const thumbnailMaxEdge = isVideo ? resolveThumbnailRequestMaxEdge(thumbnailSize) : undefined;
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:${isVideo ? (thumbnailMaxEdge ?? "video") : "image-preview"}`;
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(
    file.path,
    file.ext,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
  );
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
          onMouseDownCapture={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            "file-card relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-[14px] p-2.5 transition-colors duration-75",
            isMultiSelected
              ? "bg-primary-50 dark:bg-primary-900/20"
              : isSelected
                ? "bg-primary-100 dark:bg-primary-900/30 ring-1 ring-inset ring-primary-300 dark:ring-primary-700"
                : "hover:bg-gray-100 active:bg-gray-100/90 dark:hover:bg-dark-border dark:active:bg-dark-border/90",
          )}
        >
          <div
            className="relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-gray-100 dark:bg-dark-bg"
            style={{ height: `${thumbnailSize}px`, width: `${thumbnailSize}px` }}
          >
            {!isVisible || imageSrc === null ? (
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
            ) : imageSrc && !imageError ? (
              <img
                src={imageSrc}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
                draggable={false}
                onError={() => setImageError(true)}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <FilePreviewFallback
                ext={file.ext}
                compact
                className="h-full w-full"
                iconClassName="h-5 w-5"
                labelClassName="text-[9px]"
              />
            )}
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
        d="M6 7h12M10 12h8M10 17h8"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M6.5 6.5h.01v.01H6.5zM6.5 11.5h.01v.01H6.5zM6.5 16.5h.01v.01H6.5z"
      />
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
