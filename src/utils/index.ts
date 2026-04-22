import {
  getIndexPaths,
  getThumbnailPath,
  saveThumbnailCache,
  syncIndexPath,
} from "@/services/desktop/indexing";
import { getDesktopBridge } from "@/services/desktop/core";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { FolderNode, useFolderStore } from "@/stores/folderStore";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  m4v: "video/mp4",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  "3gp": "video/3gpp",
};

const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp",
  "ico",
  "tif",
  "tiff",
];
const VIDEO_EXTENSIONS = ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v", "3gp"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"];
const ARCHIVE_EXTENSIONS = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"];
const WORD_EXTENSIONS = ["doc", "docx", "rtf", "odt"];
const SPREADSHEET_EXTENSIONS = ["xls", "xlsx", "csv", "ods"];
const PRESENTATION_EXTENSIONS = ["ppt", "pptx", "odp", "key"];
const CODE_EXTENSIONS = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "html",
  "css",
  "scss",
  "less",
  "md",
  "mdx",
  "rs",
  "py",
  "java",
  "kt",
  "go",
  "c",
  "cpp",
  "h",
  "hpp",
  "sh",
  "ps1",
  "yaml",
  "yml",
  "toml",
  "xml",
];
const TEXT_EXTENSIONS = ["txt", "log", "ini", "conf"];
const TEXT_PREVIEW_EXTENSIONS = ["txt", "log", "md", "csv", "ini", "conf"];
const MAX_TEXT_PREVIEW_SIZE = 512 * 1024;
const THUMBNAIL_CACHE_VERSION = "v4";
const THUMBNAIL_MAX_EDGE = 768;
export const LIST_THUMBNAIL_MAX_EDGE = THUMBNAIL_MAX_EDGE;
export const MAX_THUMBNAIL_MAX_EDGE = THUMBNAIL_MAX_EDGE;
const THUMBNAIL_VARIANT_MAX_EDGES = [THUMBNAIL_MAX_EDGE] as const;
const DEFAULT_THUMBNAIL_DEVICE_PIXEL_RATIO_CAP = 1;
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
const BROWSER_IMAGE_DECODE_WORKER_UNAVAILABLE_ERROR = "__browser_image_decode_worker_unavailable__";
const BROWSER_IMAGE_DECODE_TIMEOUT_MS = 15000;

type BrowserImageDecodeWorkerRequest = {
  id: number;
  bytes: ArrayBuffer;
  mimeType: string;
  maxEdge?: number | null;
  targetShortEdge?: number | null;
  quality?: number;
  outputMimeType?: string;
};

type BrowserImageDecodeWorkerResponse = {
  id: number;
  dataUrl?: string;
  error?: string;
};

const browserImageDecodeWorkerState = {
  nextId: 0,
  worker: null as Worker | null,
  pending: new Map<
    number,
    {
      resolve: (value: string) => void;
      reject: (reason?: unknown) => void;
    }
  >(),
};

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

export type FilePreviewMode = "image" | "video" | "thumbnail" | "text" | "none";
export type FileKind =
  | "image"
  | "video"
  | "pdf"
  | "audio"
  | "archive"
  | "spreadsheet"
  | "presentation"
  | "word"
  | "code"
  | "text"
  | "other";

export function normalizeExt(ext: string): string {
  return ext.replace(/^\./, "").toLowerCase();
}

export function getFileMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

function hasSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[offset + index] === value);
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  return Array.from(bytes.slice(start, end))
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function detectMimeTypeFromContents(bytes: Uint8Array, path: string): string {
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (asciiSlice(bytes, 0, 4) === "GIF8") {
    return "image/gif";
  }
  if (asciiSlice(bytes, 0, 4) === "RIFF" && asciiSlice(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (asciiSlice(bytes, 4, 8) === "ftyp") {
    const brands = asciiSlice(bytes, 8, Math.min(bytes.length, 32));
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif";
    }
    if (brands.includes("mif1") || brands.includes("heic") || brands.includes("heif")) {
      return "image/heif";
    }
  }
  if (hasSignature(bytes, [0x42, 0x4d])) {
    return "image/bmp";
  }
  if (
    hasSignature(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    hasSignature(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "image/tiff";
  }
  if (hasSignature(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return "image/x-icon";
  }

  const textHead = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .trimStart();
  if (textHead.startsWith("<svg") || textHead.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return getFileMimeType(path);
}

export function isImageFile(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(normalizeExt(ext));
}

export function isVideoFile(ext: string): boolean {
  return VIDEO_EXTENSIONS.includes(normalizeExt(ext));
}

export function isPdfFile(ext: string): boolean {
  return normalizeExt(ext) === "pdf";
}

export function isPsdFile(ext: string): boolean {
  return normalizeExt(ext) === "psd";
}

export function isTextPreviewFile(ext: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.includes(normalizeExt(ext));
}

export function getFilePreviewMode(ext: string): FilePreviewMode {
  if (isImageFile(ext)) {
    return "image";
  }
  if (isVideoFile(ext)) {
    return "video";
  }
  if (isPdfFile(ext) || isPsdFile(ext)) {
    return "thumbnail";
  }
  if (isTextPreviewFile(ext)) {
    return "text";
  }
  return "none";
}

export function canPreviewFile(ext: string): boolean {
  return getFilePreviewMode(ext) !== "none";
}

export function canGenerateThumbnail(ext: string): boolean {
  return isImageFile(ext) || isVideoFile(ext) || isPdfFile(ext) || isPsdFile(ext);
}

export function resolveThumbnailRequestMaxEdge(
  renderWidth: number,
  renderHeight: number = renderWidth,
  options: {
    devicePixelRatioCap?: number;
  } = {},
): number {
  const safeWidth = Number.isFinite(renderWidth) ? Math.max(1, renderWidth) : THUMBNAIL_MAX_EDGE;
  const safeHeight = Number.isFinite(renderHeight) ? Math.max(1, renderHeight) : safeWidth;
  const devicePixelRatioCap =
    options.devicePixelRatioCap ?? DEFAULT_THUMBNAIL_DEVICE_PIXEL_RATIO_CAP;
  const dpr =
    typeof window === "undefined" || !Number.isFinite(window.devicePixelRatio)
      ? 1
      : Math.min(window.devicePixelRatio, Math.max(1, devicePixelRatioCap));
  const targetEdge = Math.ceil(Math.max(safeWidth, safeHeight) * dpr);

  for (const edge of THUMBNAIL_VARIANT_MAX_EDGES) {
    if (targetEdge <= edge) {
      return edge;
    }
  }

  return THUMBNAIL_VARIANT_MAX_EDGES[THUMBNAIL_VARIANT_MAX_EDGES.length - 1];
}

export function getFileKind(ext: string): FileKind {
  const normalizedExt = normalizeExt(ext);

  if (isImageFile(normalizedExt)) {
    return "image";
  }
  if (isVideoFile(normalizedExt)) {
    return "video";
  }
  if (isPdfFile(normalizedExt)) {
    return "pdf";
  }
  if (AUDIO_EXTENSIONS.includes(normalizedExt)) {
    return "audio";
  }
  if (ARCHIVE_EXTENSIONS.includes(normalizedExt)) {
    return "archive";
  }
  if (SPREADSHEET_EXTENSIONS.includes(normalizedExt)) {
    return "spreadsheet";
  }
  if (PRESENTATION_EXTENSIONS.includes(normalizedExt)) {
    return "presentation";
  }
  if (WORD_EXTENSIONS.includes(normalizedExt)) {
    return "word";
  }
  if (CODE_EXTENSIONS.includes(normalizedExt)) {
    return "code";
  }
  if (TEXT_EXTENSIONS.includes(normalizedExt)) {
    return "text";
  }
  return "other";
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

export interface BrowserDecodedImageOptions {
  maxEdge?: number | null;
  targetShortEdge?: number | null;
  quality?: number;
  outputMimeType?: string;
  preferWorker?: boolean;
  allowImageElementFallback?: boolean;
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

function resetBrowserImageDecodeWorker(reason: unknown) {
  if (browserImageDecodeWorkerState.worker) {
    browserImageDecodeWorkerState.worker.terminate();
    browserImageDecodeWorkerState.worker = null;
  }

  for (const { reject } of browserImageDecodeWorkerState.pending.values()) {
    reject(reason);
  }
  browserImageDecodeWorkerState.pending.clear();
}

function getBrowserImageDecodeWorker(): Worker {
  if (browserImageDecodeWorkerState.worker) {
    return browserImageDecodeWorkerState.worker;
  }

  if (typeof Worker === "undefined") {
    throw new Error(BROWSER_IMAGE_DECODE_WORKER_UNAVAILABLE_ERROR);
  }

  const worker = new Worker(new URL("../workers/browserImageDecodeWorker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent<BrowserImageDecodeWorkerResponse>) => {
    const { id, dataUrl, error } = event.data;
    const pending = browserImageDecodeWorkerState.pending.get(id);
    if (!pending) {
      return;
    }

    browserImageDecodeWorkerState.pending.delete(id);

    if (error) {
      pending.reject(new Error(error));
      return;
    }

    if (!dataUrl) {
      pending.reject(new Error("后台图像转码未返回结果"));
      return;
    }

    pending.resolve(dataUrl);
  };

  worker.onerror = () => {
    resetBrowserImageDecodeWorker(new Error(BROWSER_IMAGE_DECODE_WORKER_UNAVAILABLE_ERROR));
  };

  browserImageDecodeWorkerState.worker = worker;
  return worker;
}

async function buildBrowserDecodedImageDataUrlInWorker(
  blob: Blob,
  mimeType: string,
  options: BrowserDecodedImageOptions = {},
): Promise<string> {
  const worker = getBrowserImageDecodeWorker();
  const bytes = await blob.arrayBuffer();
  const id = browserImageDecodeWorkerState.nextId++;

  return await new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      browserImageDecodeWorkerState.pending.delete(id);
      resetBrowserImageDecodeWorker(new Error("后台图片转码超时"));
      reject(new Error("后台图片转码超时"));
    }, BROWSER_IMAGE_DECODE_TIMEOUT_MS);

    browserImageDecodeWorkerState.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeoutId);
        reject(reason);
      },
    });

    try {
      worker.postMessage(
        {
          id,
          bytes,
          mimeType,
          maxEdge: options.maxEdge,
          targetShortEdge: options.targetShortEdge,
          quality:
            options.quality ??
            ((options.outputMimeType ?? "image/jpeg") === "image/png" ? undefined : 0.85),
          outputMimeType: options.outputMimeType ?? "image/jpeg",
        } satisfies BrowserImageDecodeWorkerRequest,
        [bytes],
      );
    } catch (error) {
      clearTimeout(timeoutId);
      browserImageDecodeWorkerState.pending.delete(id);
      reject(error);
    }
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("无法读取图片输出数据"));
    };
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result) {
        resolve(reader.result);
        return;
      }
      reject(new Error("图片输出数据为空"));
    };
    reader.readAsDataURL(blob);
  });
}

async function exportCanvasAsDataUrl(
  canvas: HTMLCanvasElement,
  outputMimeType: string,
  quality?: number,
): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (value) {
          resolve(value);
          return;
        }
        reject(new Error("浏览器无法导出图片数据"));
      },
      outputMimeType,
      quality,
    );
  });
  return readBlobAsDataUrl(blob);
}

export async function buildBrowserDecodedImageDataUrl(
  path: string,
  options: BrowserDecodedImageOptions = {},
): Promise<string> {
  const { blob, mimeType } = await getCanvasSafeImageBlob(path);
  const outputMimeType = options.outputMimeType ?? "image/jpeg";
  const quality = options.quality ?? (outputMimeType === "image/png" ? undefined : 0.85);
  const maxEdge = options.maxEdge;
  const targetShortEdge = options.targetShortEdge;
  const allowImageElementFallback = options.allowImageElementFallback !== false;

  if (options.preferWorker) {
    try {
      return await buildBrowserDecodedImageDataUrlInWorker(blob, mimeType, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes(BROWSER_IMAGE_DECODE_WORKER_UNAVAILABLE_ERROR) &&
        !allowImageElementFallback
      ) {
        throw error;
      }
    }
  }

  const sourceUrl = URL.createObjectURL(blob);
  const resolveTargetSize = (width: number, height: number) => {
    const scale =
      typeof targetShortEdge === "number" && Number.isFinite(targetShortEdge) && targetShortEdge > 0
        ? resolveShortEdgeScale(width, height, targetShortEdge)
        : typeof maxEdge === "number" && Number.isFinite(maxEdge) && maxEdge > 0
          ? Math.min(1, maxEdge / Math.max(width, height))
          : 1;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  };

  const renderCanvasImageSource = async (
    source: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<string> => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const disposeCanvas = () => {
      canvas.width = 0;
      canvas.height = 0;
    };
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      disposeCanvas();
      throw new Error("无法创建图片画布");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);

    try {
      return await exportCanvasAsDataUrl(canvas, outputMimeType, quality);
    } finally {
      disposeCanvas();
    }
  };

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("createImageBitmap 超时"));
        }, BROWSER_IMAGE_DECODE_TIMEOUT_MS);

        void createImageBitmap(blob)
          .then((value) => {
            clearTimeout(timeoutId);
            resolve(value);
          })
          .catch((error) => {
            clearTimeout(timeoutId);
            reject(error);
          });
      });
      try {
        const targetSize = resolveTargetSize(bitmap.width, bitmap.height);
        return await renderCanvasImageSource(bitmap, targetSize.width, targetSize.height);
      } finally {
        bitmap.close();
      }
    }

    if (!allowImageElementFallback) {
      throw new Error("当前环境缺少安全的图片解码回退路径，已停止兼容回退以避免界面卡死");
    }

    return await new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      const settleResolve = (value: string) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          settleReject(new Error("图片尺寸无效"));
          return;
        }

        const targetSize = resolveTargetSize(width, height);
        void renderCanvasImageSource(image, targetSize.width, targetSize.height)
          .then(settleResolve)
          .catch(settleReject);
      };

      image.onerror = () => {
        settleReject(new Error("浏览器无法解码该图片"));
      };

      timeoutId = setTimeout(() => {
        settleReject(new Error("浏览器图片解码超时"));
      }, BROWSER_IMAGE_DECODE_TIMEOUT_MS);
      image.src = sourceUrl;

      if (typeof image.decode === "function") {
        void image.decode().catch(() => {
          // Keep waiting for onload/onerror or timeout because some engines reject decode()
          // before the image element settles, especially on uncommon formats.
        });
      }
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
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
