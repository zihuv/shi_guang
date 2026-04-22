import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Play } from "lucide-react";
import { getOrCreateThumbHash } from "@/services/desktop/files";
import { type FileItem, getNameWithoutExt } from "@/stores/fileTypes";
import { type LibraryViewMode, type LibraryVisibleField } from "@/stores/settingsStore";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { decideThumbnailGeneration } from "@/lib/thumbnailPolicy";
import { cn } from "@/lib/utils";
import { thumbHashBase64ToBytes, thumbHashToDataUrl } from "@/lib/thumbhash";
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
  isPdfFile,
  isPsdFile,
  isVideoFile,
  rememberPreviewImageSrc,
  resolveThumbnailRequestMaxEdge,
} from "@/utils";

const OBSERVER_ROOT_MARGIN = "320px";
const ADAPTIVE_OBSERVER_ROOT_MARGIN = "280px";
const IMAGE_SRC_CACHE_LIMIT = 512;
const THUMB_HASH_CACHE_LIMIT = 256;
const MAX_CONCURRENT_VISIBLE_IMAGE_LOADS = 10;
const MAX_CONCURRENT_PREWARM_IMAGE_LOADS = 3;
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
const thumbHashPlaceholderCache = new Map<string, string>();
const pendingThumbHashPlaceholderTasks = new Map<string, Promise<string>>();
const queuedThumbHashPrewarmKeys = new Set<string>();
const queuedThumbnailPrewarmKeys = new Set<string>();
const pendingThumbHashPrewarmTasks: Array<() => void> = [];
const pendingVisibleImageLoadTasks: CardThumbnailTaskEntry<unknown>[] = [];
const pendingPrewarmImageLoadTasks: CardThumbnailTaskEntry<unknown>[] = [];
const activeVisibleImageLoadCounts = new Map<number, number>();
const activePrewarmImageLoadCounts = new Map<number, number>();
let nextCardThumbnailTaskId = 0;
let activeThumbHashPrewarmTaskCount = 0;
const MAX_CONCURRENT_THUMB_HASH_PREWARMS = 2;
let currentImageLoadGeneration = 0;

class CardThumbnailTaskCancelledError extends Error {
  constructor() {
    super("Card thumbnail task cancelled");
    this.name = "CardThumbnailTaskCancelledError";
  }
}

type CardThumbnailTaskEntry<T> = {
  id: number;
  generation: number;
  priority: "visible" | "prewarm";
  cancelled: boolean;
  settled: boolean;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

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

function trimStringCache(cache: Map<string, string>, limit: number) {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function getGenerationActiveCount(counts: Map<number, number>, generation: number) {
  return counts.get(generation) ?? 0;
}

function setGenerationActiveCount(
  counts: Map<number, number>,
  generation: number,
  nextCount: number,
) {
  if (nextCount <= 0) {
    counts.delete(generation);
    return;
  }
  counts.set(generation, nextCount);
}

function cleanupQueuedTasksForGeneration(
  tasks: CardThumbnailTaskEntry<unknown>[],
  generation: number,
) {
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    const task = tasks[index];
    if (!task || task.generation >= generation) {
      continue;
    }
    tasks.splice(index, 1);
    if (task.settled) {
      continue;
    }
    task.cancelled = true;
    task.settled = true;
    task.reject(new CardThumbnailTaskCancelledError());
  }
}

export function beginImagePreviewLoadGeneration() {
  currentImageLoadGeneration += 1;
  cleanupQueuedTasksForGeneration(pendingVisibleImageLoadTasks, currentImageLoadGeneration);
  cleanupQueuedTasksForGeneration(pendingPrewarmImageLoadTasks, currentImageLoadGeneration);
  return currentImageLoadGeneration;
}

function flushImageLoadTaskQueue(
  queue: CardThumbnailTaskEntry<unknown>[],
  counts: Map<number, number>,
  limit: number,
) {
  while (getGenerationActiveCount(counts, currentImageLoadGeneration) < limit && queue.length > 0) {
    const nextTask = queue.shift();
    if (!nextTask || nextTask.cancelled || nextTask.generation < currentImageLoadGeneration) {
      if (nextTask && !nextTask.settled) {
        nextTask.cancelled = true;
        nextTask.settled = true;
        nextTask.reject(new CardThumbnailTaskCancelledError());
      }
      continue;
    }

    setGenerationActiveCount(
      counts,
      nextTask.generation,
      getGenerationActiveCount(counts, nextTask.generation) + 1,
    );
    nextTask
      .run()
      .then((value) => {
        if (nextTask.cancelled || nextTask.settled) {
          return;
        }
        nextTask.settled = true;
        nextTask.resolve(value);
      })
      .catch((error) => {
        if (nextTask.cancelled || nextTask.settled) {
          return;
        }
        nextTask.settled = true;
        nextTask.reject(error);
      })
      .finally(() => {
        setGenerationActiveCount(
          counts,
          nextTask.generation,
          getGenerationActiveCount(counts, nextTask.generation) - 1,
        );
        flushImageLoadTaskQueue(queue, counts, limit);
      });
  }
}

function flushAllImageLoadTaskQueues() {
  flushImageLoadTaskQueue(
    pendingVisibleImageLoadTasks,
    activeVisibleImageLoadCounts,
    MAX_CONCURRENT_VISIBLE_IMAGE_LOADS,
  );
  flushImageLoadTaskQueue(
    pendingPrewarmImageLoadTasks,
    activePrewarmImageLoadCounts,
    MAX_CONCURRENT_PREWARM_IMAGE_LOADS,
  );
}

function cancelCardThumbnailTask(taskId: number, priority: "visible" | "prewarm") {
  const queue =
    priority === "visible" ? pendingVisibleImageLoadTasks : pendingPrewarmImageLoadTasks;
  const taskIndex = queue.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) {
    return;
  }

  const [task] = queue.splice(taskIndex, 1);
  if (task && !task.settled) {
    task.cancelled = true;
    task.settled = true;
    task.reject(new CardThumbnailTaskCancelledError());
  }
}

function scheduleCardThumbnailTask<T>(
  task: () => Promise<T>,
  options: { generation: number; priority: "visible" | "prewarm" },
) {
  const taskId = nextCardThumbnailTaskId++;
  const promise = new Promise<T>((resolve, reject) => {
    const taskEntry: CardThumbnailTaskEntry<T> = {
      id: taskId,
      generation: options.generation,
      priority: options.priority,
      cancelled: false,
      settled: false,
      run: task,
      resolve,
      reject,
    };

    const queue =
      options.priority === "visible" ? pendingVisibleImageLoadTasks : pendingPrewarmImageLoadTasks;
    queue.push(taskEntry as CardThumbnailTaskEntry<unknown>);
    flushAllImageLoadTaskQueues();
  });

  return {
    promise,
    cancel: () => {
      cancelCardThumbnailTask(taskId, options.priority);
    },
  };
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

function flushThumbHashPrewarmQueue() {
  while (
    activeThumbHashPrewarmTaskCount < MAX_CONCURRENT_THUMB_HASH_PREWARMS &&
    pendingThumbHashPrewarmTasks.length > 0
  ) {
    const nextTask = pendingThumbHashPrewarmTasks.pop();
    if (!nextTask) {
      continue;
    }

    activeThumbHashPrewarmTaskCount += 1;
    void Promise.resolve()
      .then(nextTask)
      .finally(() => {
        activeThumbHashPrewarmTaskCount = Math.max(0, activeThumbHashPrewarmTaskCount - 1);
        flushThumbHashPrewarmQueue();
      });
  }
}

function getThumbHashPlaceholderSrc(thumbHash: string | null | undefined) {
  const normalizedThumbHash = thumbHash?.trim() ?? "";
  if (!normalizedThumbHash) {
    return "";
  }

  const cached = thumbHashPlaceholderCache.get(normalizedThumbHash);
  if (cached) {
    thumbHashPlaceholderCache.delete(normalizedThumbHash);
    thumbHashPlaceholderCache.set(normalizedThumbHash, cached);
    return cached;
  }

  try {
    const placeholderSrc = thumbHashToDataUrl(thumbHashBase64ToBytes(normalizedThumbHash));
    thumbHashPlaceholderCache.set(normalizedThumbHash, placeholderSrc);
    trimStringCache(thumbHashPlaceholderCache, THUMB_HASH_CACHE_LIMIT);
    return placeholderSrc;
  } catch (error) {
    console.error("Failed to decode thumb hash placeholder:", error);
    return "";
  }
}

async function loadThumbHashPlaceholder(
  path: string,
  cacheKey: string,
  thumbHash: string | null | undefined,
) {
  const directPlaceholder = getThumbHashPlaceholderSrc(thumbHash);
  if (directPlaceholder) {
    return directPlaceholder;
  }

  const pendingTask = pendingThumbHashPlaceholderTasks.get(cacheKey);
  if (pendingTask) {
    return pendingTask;
  }

  const task = getOrCreateThumbHash(path)
    .then((resolvedThumbHash) => getThumbHashPlaceholderSrc(resolvedThumbHash))
    .catch((error) => {
      console.error("Failed to load thumb hash placeholder:", error);
      return "";
    })
    .finally(() => {
      pendingThumbHashPlaceholderTasks.delete(cacheKey);
    });

  pendingThumbHashPlaceholderTasks.set(cacheKey, task);
  return task;
}

function scheduleThumbHashPlaceholderPrewarm(
  path: string,
  cacheKey: string,
  thumbHash: string | null | undefined,
) {
  if (getThumbHashPlaceholderSrc(thumbHash)) {
    return;
  }

  if (pendingThumbHashPlaceholderTasks.has(cacheKey)) {
    return;
  }

  if (queuedThumbHashPrewarmKeys.has(cacheKey)) {
    return;
  }

  queuedThumbHashPrewarmKeys.add(cacheKey);
  pendingThumbHashPrewarmTasks.push(() =>
    loadThumbHashPlaceholder(path, cacheKey, thumbHash)
      .then(() => undefined)
      .finally(() => {
        queuedThumbHashPrewarmKeys.delete(cacheKey);
      }),
  );
  flushThumbHashPrewarmQueue();
}

export function prewarmThumbHashPlaceholders(files: FileItem[]) {
  for (const file of files) {
    const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:thumb-hash`;
    scheduleThumbHashPlaceholderPrewarm(file.path, cacheKey, file.thumbHash);
  }
}

function getImagePreviewCacheKey(file: FileItem) {
  return `${file.path}:${file.modifiedAt}:${file.size}:image-preview`;
}

function shouldUseGeneratedThumbnail(file: Pick<FileItem, "ext" | "width" | "height" | "size">) {
  return decideThumbnailGeneration({
    ext: file.ext,
    width: file.width,
    height: file.height,
    size: file.size,
  }).shouldGenerate;
}

type PreviewSourceFile = Pick<
  FileItem,
  "path" | "ext" | "width" | "height" | "size" | "modifiedAt"
>;

async function loadPreviewImageSrc(file: PreviewSourceFile, maxEdge: number | undefined) {
  if (isVideoFile(file.ext)) {
    return getVideoThumbnailSrc(file.path, maxEdge);
  }

  const shouldGenerateThumbnail = shouldUseGeneratedThumbnail(file);
  if (shouldGenerateThumbnail) {
    const thumbnailSrc = await getThumbnailImageSrc(file.path, file.ext, maxEdge);
    if (thumbnailSrc) {
      return thumbnailSrc;
    }
    if (isPdfFile(file.ext) || isPsdFile(file.ext)) {
      return "";
    }
  }

  return getFileSrc(file.path);
}

function scheduleThumbnailImagePrewarm(file: FileItem, generation: number) {
  if (!canGenerateThumbnail(file.ext) || isVideoFile(file.ext)) {
    return;
  }

  const cacheKey = getImagePreviewCacheKey(file);
  if (getCachedImageSrc(cacheKey)) {
    return;
  }

  if (queuedThumbnailPrewarmKeys.has(cacheKey)) {
    return;
  }

  queuedThumbnailPrewarmKeys.add(cacheKey);
  const scheduledTask = scheduleCardThumbnailTask(
    async () => loadPreviewImageSrc(file, undefined),
    { generation, priority: "prewarm" },
  );

  void scheduledTask.promise
    .then((resolvedSrc) => {
      if (!resolvedSrc || generation < currentImageLoadGeneration) {
        releaseUnusedImageSrc(resolvedSrc);
        return;
      }
      cacheImageSrc(cacheKey, resolvedSrc);
    })
    .catch((error) => {
      if (!(error instanceof CardThumbnailTaskCancelledError)) {
        console.error("Failed to prewarm thumbnail image source:", error);
      }
    })
    .finally(() => {
      queuedThumbnailPrewarmKeys.delete(cacheKey);
    });
}

export function prewarmThumbnailImageSources(files: FileItem[], generation: number) {
  for (const file of files) {
    scheduleThumbnailImagePrewarm(file, generation);
  }
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
  file: PreviewSourceFile,
  cacheKey: string,
  isVisible: boolean,
  maxEdge: number | undefined,
  refreshVersion: number,
  generation: number,
) {
  const [imageError, setImageError] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(() => getCachedImageSrc(cacheKey));

  useEffect(() => {
    setImageSrc(getCachedImageSrc(cacheKey));
    setImageError(false);
  }, [cacheKey]);

  useEffect(() => {
    if (!isVisible) {
      setImageError(false);
      return;
    }

    if (!canGenerateThumbnail(file.ext)) {
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

    const scheduledTask = scheduleCardThumbnailTask(
      async () => loadPreviewImageSrc(file, maxEdge),
      { generation, priority: "visible" },
    );

    scheduledTask.promise
      .then((src) => {
        if (!active || generation < currentImageLoadGeneration) {
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
        if (error instanceof CardThumbnailTaskCancelledError) {
          return;
        }
        console.error("Failed to load card thumbnail:", error);
        setImageError(true);
        setImageSrc("");
      });

    return () => {
      active = false;
      scheduledTask.cancel();
    };
  }, [cacheKey, file, generation, isVisible, maxEdge, refreshVersion]);

  useEffect(() => {
    if (imageSrc) {
      rememberPreviewImageSrc(file.path, imageSrc);
    }
  }, [file.path, imageSrc]);

  return {
    imageSrc,
    imageError,
    setImageError,
  };
}

function useThumbHashPlaceholder(
  path: string,
  thumbHash: string | null | undefined,
  cacheKey: string,
  isVisible: boolean,
  refreshVersion: number,
) {
  const [placeholderSrc, setPlaceholderSrc] = useState(() => getThumbHashPlaceholderSrc(thumbHash));

  useEffect(() => {
    setPlaceholderSrc(getThumbHashPlaceholderSrc(thumbHash));
  }, [cacheKey, thumbHash]);

  useEffect(() => {
    if (!isVisible || placeholderSrc) {
      return;
    }

    let active = true;
    void loadThumbHashPlaceholder(path, cacheKey, thumbHash).then((src) => {
      if (active && src) {
        setPlaceholderSrc(src);
      }
    });

    return () => {
      active = false;
    };
  }, [cacheKey, isVisible, path, placeholderSrc, refreshVersion, thumbHash]);

  return placeholderSrc;
}

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
  footerHeight,
  previewWidth,
  generation,
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { footerHeight: number; previewWidth: number; generation: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef);
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
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
            <ThumbHashPlaceholder src={thumbHashPlaceholderSrc} className="opacity-70" />
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
    file,
    cacheKey,
    isVisible,
    thumbnailMaxEdge,
    thumbnailRefreshVersion,
    generation,
  );
  const thumbHashPlaceholderSrc = useThumbHashPlaceholder(
    file.path,
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
            <ThumbHashPlaceholder src={thumbHashPlaceholderSrc} className="opacity-70" />
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
  generation,
  isSelected,
  isMultiSelected,
  scrollRootRef,
  onClick,
  onDoubleClick,
}: FileCardBaseProps & { thumbnailSize: number; generation: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef);
  const isVideo = isVideoFile(file.ext);
  const thumbnailRefreshVersion = useThumbnailRefreshStore(
    (state) => state.fileVersions[file.id] ?? 0,
  );
  const thumbnailMaxEdge = isVideo ? resolveThumbnailRequestMaxEdge(thumbnailSize) : undefined;
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
