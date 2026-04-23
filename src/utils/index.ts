import {
  getIndexPaths,
  getThumbnailPath,
  saveThumbnailCache,
  syncIndexPath,
} from "@/services/desktop/indexing";
import { getDesktopBridge } from "@/services/desktop/core";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { FolderNode, useFolderStore } from "@/stores/folderStore";
import {
  canGenerateThumbnail,
  detectMimeTypeFromContents,
  isImageFile,
  THUMBNAIL_MAX_EDGE,
} from "@/utils/fileClassification";
import {
  buildBrowserDecodedImageDataUrlFromBlob,
  type BrowserDecodedImageOptions,
} from "@/utils/browserImageDecode";

export {
  canGenerateThumbnail,
  canPreviewFile,
  getFileKind,
  getFileMimeType,
  getFilePreviewMode,
  isImageFile,
  isPdfFile,
  isPsdFile,
  isTextPreviewFile,
  isVideoFile,
  LIST_THUMBNAIL_MAX_EDGE,
  MAX_THUMBNAIL_MAX_EDGE,
  normalizeExt,
  resolveThumbnailRequestMaxEdge,
  type FileKind,
  type FilePreviewMode,
} from "@/utils/fileClassification";
export { type BrowserDecodedImageOptions } from "@/utils/browserImageDecode";

const MAX_TEXT_PREVIEW_SIZE = 512 * 1024;
const THUMBNAIL_CACHE_VERSION = "v4";
const THUMBNAIL_BROWSER_OUTPUT_QUALITY = 0.85;
const THUMBNAIL_BROWSER_OUTPUT_MIME = "image/webp";
const PREVIEW_IMAGE_CACHE_LIMIT = 256;
const videoThumbnailPromiseCache = new Map<string, Promise<string>>();
const browserThumbnailPromiseCache = new Map<string, Promise<string>>();
const rememberedPreviewImageSrcCache = new Map<string, string>();
const decodedPreviewImageInfoCache = new Map<string, { width: number; height: number }>();
const decodedPreviewImagePromiseCache = new Map<
  string,
  Promise<{ width: number; height: number }>
>();
const missingFileSyncs = new Set<string>();
const MISSING_FILE_ERROR_MARKERS = [
  "No such file or directory",
  "The system cannot find the file specified",
  "系统找不到指定的文件",
  "(os error 2)",
];
function getThumbnailVariantCacheKey(path: string, maxEdge: number) {
  return `${THUMBNAIL_CACHE_VERSION}:${path}::${maxEdge}`;
}

function canCachePreviewImageSrc(src: string) {
  return Boolean(src) && !src.startsWith("blob:") && !src.startsWith("data:");
}

function trimPreviewImageCache<T>(cache: Map<string, T>) {
  while (cache.size > PREVIEW_IMAGE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function rememberDecodedPreviewImageInfo(src: string, info: { width: number; height: number }) {
  if (!canCachePreviewImageSrc(src)) {
    return;
  }

  decodedPreviewImageInfoCache.delete(src);
  decodedPreviewImageInfoCache.set(src, info);
  trimPreviewImageCache(decodedPreviewImageInfoCache);
}

async function decodePreviewImageSrc(src: string): Promise<{ width: number; height: number }> {
  if (!src) {
    return { width: 0, height: 0 };
  }

  if (canCachePreviewImageSrc(src)) {
    const cached = decodedPreviewImageInfoCache.get(src);
    if (cached) {
      decodedPreviewImageInfoCache.delete(src);
      decodedPreviewImageInfoCache.set(src, cached);
      return cached;
    }

    const pending = decodedPreviewImagePromiseCache.get(src);
    if (pending) {
      return pending;
    }
  }

  const decodePromise = new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    let settled = false;

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      const info = {
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0,
      };

      rememberDecodedPreviewImageInfo(src, info);
      decodedPreviewImagePromiseCache.delete(src);
      resolve(info);
    };

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      decodedPreviewImagePromiseCache.delete(src);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    image.onload = finish;
    image.onerror = () => fail(new Error("浏览器无法解码该图片"));
    image.decoding = "async";
    image.src = src;

    if (image.complete && image.naturalWidth > 0) {
      finish();
      return;
    }

    if (typeof image.decode === "function") {
      void image
        .decode()
        .then(finish)
        .catch(() => {
          // Fallback to onload/onerror for browsers that reject decode() before load settles.
        });
    }
  });

  if (canCachePreviewImageSrc(src)) {
    decodedPreviewImagePromiseCache.set(src, decodePromise);
  }

  return decodePromise;
}

function resolveShortEdgeScale(
  width: number,
  height: number,
  targetShortEdge: number = THUMBNAIL_MAX_EDGE,
) {
  const shortEdge = Math.min(width, height);
  if (!shortEdge || shortEdge <= targetShortEdge) {
    return 1;
  }
  return targetShortEdge / shortEdge;
}

function normalizeFsPath(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function isMissingFileError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? "");
  return MISSING_FILE_ERROR_MARKERS.some((marker) => message.includes(marker));
}

function findMatchingIndexPath(filePath: string, indexPaths: string[]): string | null {
  const normalizedFilePath = normalizeFsPath(filePath);
  let match: string | null = null;

  for (const indexPath of indexPaths) {
    const normalizedIndexPath = normalizeFsPath(indexPath);
    if (
      normalizedFilePath === normalizedIndexPath ||
      normalizedFilePath.startsWith(`${normalizedIndexPath}\\`)
    ) {
      if (!match || normalizedIndexPath.length > normalizeFsPath(match).length) {
        match = indexPath;
      }
    }
  }

  return match;
}

async function refreshVisibleLibraryState() {
  try {
    await useFolderStore.getState().loadFolders();
    const libraryStore = useLibraryQueryStore.getState();
    await libraryStore.loadFilesInFolder(libraryStore.selectedFolderId);
  } catch (error) {
    console.error("Failed to refresh library state:", error);
  }
}

function scheduleMissingFileCleanup(path: string) {
  void (async () => {
    try {
      const indexPaths = await getIndexPaths();
      const matchingIndexPath = findMatchingIndexPath(path, indexPaths);
      if (!matchingIndexPath || missingFileSyncs.has(matchingIndexPath)) {
        return;
      }

      missingFileSyncs.add(matchingIndexPath);
      try {
        await syncIndexPath(matchingIndexPath);
        await refreshVisibleLibraryState();
      } finally {
        missingFileSyncs.delete(matchingIndexPath);
      }
    } catch (error) {
      console.error("Failed to sync missing file cleanup:", error);
    }
  })();
}

function exists(path: string) {
  return getDesktopBridge().fs.exists(path);
}

function readFile(path: string) {
  return getDesktopBridge().fs.readFile(path);
}

function readTextFile(path: string) {
  return getDesktopBridge().fs.readTextFile(path);
}

function toAssetSrc(path: string): Promise<string> {
  return getDesktopBridge().asset.toUrl(path);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function rememberPreviewImageSrc(path: string, src: string) {
  if (!canCachePreviewImageSrc(src)) {
    return;
  }

  rememberedPreviewImageSrcCache.delete(path);
  rememberedPreviewImageSrcCache.set(path, src);
  trimPreviewImageCache(rememberedPreviewImageSrcCache);
}

export function getRememberedPreviewImageSrc(path: string): string {
  const cached = rememberedPreviewImageSrcCache.get(path);
  if (!cached) {
    return "";
  }

  rememberedPreviewImageSrcCache.delete(path);
  rememberedPreviewImageSrcCache.set(path, cached);
  return cached;
}

export async function getFileSrc(path: string): Promise<string> {
  try {
    if (!(await exists(path))) {
      scheduleMissingFileCleanup(path);
      return "";
    }

    return await toAssetSrc(path);
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path);
      return "";
    }
    try {
      const contents = await readFile(path);
      const blob = new Blob([toArrayBuffer(contents)], {
        type: detectMimeTypeFromContents(contents, path),
      });
      return URL.createObjectURL(blob);
    } catch (readError: any) {
      if (isMissingFileError(readError)) {
        scheduleMissingFileCleanup(path);
        return "";
      }
      console.error("Failed to read file:", readError);
      return "";
    }
  }
}

export async function preloadFileImage(
  path: string,
): Promise<{ src: string; width: number; height: number } | null> {
  const src = await getFileSrc(path);
  if (!src) {
    return null;
  }

  rememberPreviewImageSrc(path, src);
  const decoded = await decodePreviewImageSrc(src);
  return {
    src,
    width: decoded.width,
    height: decoded.height,
  };
}

export async function getTextPreviewContent(path: string, size?: number): Promise<string> {
  if (size && size > MAX_TEXT_PREVIEW_SIZE) {
    return "文件较大，暂不显示完整文本预览。";
  }

  try {
    return await readTextFile(path);
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path);
      return "文件不存在或已被删除。";
    }
    console.error("Failed to read text file:", e);
    return "文本预览加载失败。";
  }
}

async function renderVideoThumbnailDataUrl(
  path: string,
  _maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const fileSrc = await getFileSrc(path);
  if (!fileSrc) {
    return "";
  }

  return await new Promise<string>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (fileSrc.startsWith("blob:")) {
        URL.revokeObjectURL(fileSrc);
      }
    };

    const finish = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const captureFrame = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish("");
        return;
      }

      const scale = resolveShortEdgeScale(video.videoWidth, video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        finish("");
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      finish(canvas.toDataURL(THUMBNAIL_BROWSER_OUTPUT_MIME, THUMBNAIL_BROWSER_OUTPUT_QUALITY));
    };

    const seekToCapturePoint = () => {
      const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
      const targetTime = hasDuration ? Math.min(0.1, video.duration / 3) : 0;

      if (targetTime <= 0) {
        if (video.readyState >= 2) {
          captureFrame();
        } else {
          video.addEventListener("loadeddata", captureFrame, { once: true });
        }
        return;
      }

      video.addEventListener("seeked", captureFrame, { once: true });
      try {
        video.currentTime = targetTime;
      } catch {
        captureFrame();
      }
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadedmetadata", seekToCapturePoint, { once: true });
    video.addEventListener("error", () => finish(""), { once: true });
    timeoutId = setTimeout(() => finish(""), 10000);
    video.src = fileSrc;
    video.load();
  });
}

async function persistThumbnailDataUrl(
  path: string,
  dataUrl: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const dataBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  if (!dataBase64) {
    return "";
  }

  try {
    const thumbnailPath = await saveThumbnailCache({
      filePath: path,
      dataBase64,
      maxEdge,
    });
    return thumbnailPath ? await toAssetSrc(thumbnailPath) : "";
  } catch (e) {
    console.error("Failed to persist thumbnail:", e);
    return "";
  }
}

async function getBrowserThumbnailSrc(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const cacheKey = getThumbnailVariantCacheKey(path, maxEdge);
  const pending = browserThumbnailPromiseCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  const nextThumbnailPromise = buildBrowserDecodedImageDataUrl(path, {
    targetShortEdge: THUMBNAIL_MAX_EDGE,
    quality: THUMBNAIL_BROWSER_OUTPUT_QUALITY,
    outputMimeType: THUMBNAIL_BROWSER_OUTPUT_MIME,
  })
    .then(async (thumbnailDataUrl) => {
      if (!thumbnailDataUrl) {
        return "";
      }

      const persistedThumbnailSrc = await persistThumbnailDataUrl(path, thumbnailDataUrl, maxEdge);
      return persistedThumbnailSrc || thumbnailDataUrl;
    })
    .catch((error) => {
      console.error("Failed to generate browser thumbnail:", error);
      return "";
    })
    .finally(() => {
      browserThumbnailPromiseCache.delete(cacheKey);
    });

  browserThumbnailPromiseCache.set(cacheKey, nextThumbnailPromise);
  return nextThumbnailPromise;
}

export async function generateBrowserThumbnailCache(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  return getBrowserThumbnailSrc(path, maxEdge);
}

export async function getVideoThumbnailSrc(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const cachedThumbnailSrc = await getThumbnailImageSrc(path, undefined, maxEdge);
  if (cachedThumbnailSrc) {
    return cachedThumbnailSrc;
  }

  const cacheKey = getThumbnailVariantCacheKey(path, maxEdge);
  const pending = videoThumbnailPromiseCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  const nextThumbnailPromise = renderVideoThumbnailDataUrl(path, maxEdge)
    .then(async (thumbnailDataUrl) => {
      if (!thumbnailDataUrl) {
        return "";
      }

      const persistedThumbnailSrc = await persistThumbnailDataUrl(path, thumbnailDataUrl, maxEdge);
      return persistedThumbnailSrc || thumbnailDataUrl;
    })
    .finally(() => {
      videoThumbnailPromiseCache.delete(cacheKey);
    });

  videoThumbnailPromiseCache.set(cacheKey, nextThumbnailPromise);
  return nextThumbnailPromise;
}

// Helper to get image URL from file path using fs plugin
export async function getImageSrc(path: string): Promise<string> {
  return getFileSrc(path);
}

async function getCanvasSafeImageSrc(path: string): Promise<string> {
  try {
    const contents = await readFile(path);
    const blob = new Blob([toArrayBuffer(contents)], {
      type: detectMimeTypeFromContents(contents, path),
    });
    return URL.createObjectURL(blob);
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path);
      return "";
    }
    console.error("Failed to read canvas-safe image source:", e);
    return "";
  }
}

async function getCanvasSafeImageBlob(path: string): Promise<{ blob: Blob; mimeType: string }> {
  const contents = await readFile(path);
  const mimeType = detectMimeTypeFromContents(contents, path);
  const blob = new Blob([toArrayBuffer(contents)], { type: mimeType });
  return {
    blob,
    mimeType,
  };
}

export async function buildBrowserDecodedImageDataUrl(
  path: string,
  options: BrowserDecodedImageOptions = {},
): Promise<string> {
  const { blob, mimeType } = await getCanvasSafeImageBlob(path);
  return buildBrowserDecodedImageDataUrlFromBlob(blob, mimeType, options);
}

export async function buildAiImageDataUrl(path: string): Promise<string> {
  return buildBrowserDecodedImageDataUrl(path, {
    maxEdge: 1280,
    quality: 0.85,
    outputMimeType: "image/jpeg",
  });
}

export async function getThumbnailImageSrc(
  path: string,
  ext?: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  if (ext && !canGenerateThumbnail(ext)) {
    return "";
  }

  try {
    const thumbnailPath = await getThumbnailPath(path, maxEdge);
    if (thumbnailPath) {
      return await toAssetSrc(thumbnailPath);
    }
  } catch (e) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path);
      return "";
    }
    console.error("Failed to get thumbnail path:", e);
  }

  return "";
}

export async function getThumbnailBlobSrc(
  path: string,
  ext?: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  if (ext && !canGenerateThumbnail(ext)) {
    return "";
  }

  try {
    const thumbnailPath = await getThumbnailPath(path, maxEdge);
    if (thumbnailPath) {
      return await getCanvasSafeImageSrc(thumbnailPath);
    }
  } catch (e) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path);
      return "";
    }
    console.error("Failed to get thumbnail blob source:", e);
  }
  if (ext && isImageFile(ext)) {
    return getCanvasSafeImageSrc(path);
  }

  return "";
}

// Format file size to human readable string
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Find folder by ID in the folder tree
export function findFolderById(folders: FolderNode[], id: number): FolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder;
    }
    const found = findFolderById(folder.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

// Debounce function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}
