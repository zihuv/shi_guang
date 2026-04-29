import { useEffect, useRef, useState, type RefObject } from "react";
import { getOrCreateThumbHash } from "@/services/desktop/files";
import { type FileItem } from "@/stores/fileTypes";
import { useThumbnailRefreshStore } from "@/stores/thumbnailRefreshStore";
import { decideThumbnailPlan, getThumbnailGenerationRuntimeForExt } from "@/lib/thumbnailPolicy";
import { thumbHashBase64ToBytes, thumbHashToDataUrl } from "@/lib/thumbhash";
import {
  canGenerateThumbnail,
  getFileSrc,
  getGeneratedThumbnailSrc,
  getThumbnailImageSrc,
  isPdfFile,
  isPsdFile,
  rememberPreviewImageSrc,
  resolveThumbnailRequestMaxEdge,
} from "@/utils";

const OBSERVER_ROOT_MARGIN = "320px";
const IMAGE_SRC_CACHE_LIMIT = 512;
const THUMB_HASH_CACHE_LIMIT = 256;
const MAX_CONCURRENT_VISIBLE_IMAGE_LOADS = 10;
const MAX_CONCURRENT_PREWARM_IMAGE_LOADS = 3;

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
const MAX_CONCURRENT_THUMB_HASH_PREWARMS = 2;
let nextCardThumbnailTaskId = 0;
let activeThumbHashPrewarmTaskCount = 0;
let currentImageLoadGeneration = 0;

class CardThumbnailTaskCancelledError extends Error {
  constructor() {
    super("Card thumbnail task cancelled");
    this.name = "Card thumbnail task cancelled";
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

type PreviewSourceFile = Pick<
  FileItem,
  "path" | "ext" | "width" | "height" | "size" | "modifiedAt"
>;

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

export function resolveCardThumbnailMaxEdge(
  previewWidth: number,
  previewHeight: number = previewWidth,
) {
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
    if (getThumbnailGenerationRuntimeForExt(file.ext) !== "main") {
      continue;
    }

    const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}:thumb-hash`;
    scheduleThumbHashPlaceholderPrewarm(file.path, cacheKey, file.thumbHash);
  }
}

function getImagePreviewCacheKey(file: FileItem) {
  return `${file.path}:${file.modifiedAt}:${file.size}:image-preview`;
}

async function loadPreviewImageSrc(file: PreviewSourceFile, maxEdge: number | undefined) {
  const thumbnailPlan = decideThumbnailPlan(file);
  if (thumbnailPlan.runtime === "renderer") {
    return getGeneratedThumbnailSrc(file, maxEdge);
  }

  if (thumbnailPlan.runtime === "main") {
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
  if (decideThumbnailPlan(file).runtime !== "main") {
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

export function useVisibility(
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

export function useLazyImageSrc(
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

export function useThumbHashPlaceholder(
  path: string,
  ext: string,
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
    if (getThumbnailGenerationRuntimeForExt(ext) !== "main") {
      setPlaceholderSrc("");
      return;
    }

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
  }, [cacheKey, ext, isVisible, path, placeholderSrc, refreshVersion, thumbHash]);

  return placeholderSrc;
}

export function useThumbnailRefreshVersion(fileId: number) {
  return useThumbnailRefreshStore((state) => state.fileVersions[fileId] ?? 0);
}
