import { getThumbnailPath, saveThumbnailCache } from "@/services/desktop/indexing";
import { canGenerateThumbnail, isImageFile, THUMBNAIL_MAX_EDGE } from "@/utils/fileClassification";
import { decideThumbnailPlan, getThumbnailGenerationRuntimeForExt } from "@/lib/thumbnailPolicy";
import {
  buildBrowserDecodedImageDataUrl,
  getCanvasSafeImageSrc,
  getFileSrc,
  toAssetSrc,
} from "@/utils/fileSource";
import { isMissingFileError, scheduleMissingFileCleanup } from "@/utils/missingFileSync";

const THUMBNAIL_CACHE_VERSION = "v4";
const THUMBNAIL_BROWSER_OUTPUT_QUALITY = 0.85;
const THUMBNAIL_BROWSER_OUTPUT_MIME = "image/webp";
const videoThumbnailPromiseCache = new Map<string, Promise<string>>();
const browserThumbnailPromiseCache = new Map<string, Promise<string>>();

type ThumbnailSourceFile = {
  path: string;
  ext: string;
  width: number;
  height: number;
  size: number;
};

function getThumbnailVariantCacheKey(path: string, maxEdge: number) {
  return `${THUMBNAIL_CACHE_VERSION}:${path}::${maxEdge}`;
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
  const cachedThumbnailSrc = await getThumbnailImageSrc(path, undefined, maxEdge, {
    allowBackgroundRequest: false,
  });
  if (cachedThumbnailSrc) {
    return cachedThumbnailSrc;
  }

  return generateVideoThumbnailCache(path, maxEdge);
}

export async function generateVideoThumbnailCache(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
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
    .catch((error) => {
      console.error("Failed to generate video thumbnail:", error);
      return "";
    })
    .finally(() => {
      videoThumbnailPromiseCache.delete(cacheKey);
    });

  videoThumbnailPromiseCache.set(cacheKey, nextThumbnailPromise);
  return nextThumbnailPromise;
}

export async function generateRendererThumbnailCache(
  file: Pick<ThumbnailSourceFile, "path" | "ext">,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const runtime = getThumbnailGenerationRuntimeForExt(file.ext);
  if (runtime !== "renderer") {
    return "";
  }

  return generateVideoThumbnailCache(file.path, maxEdge);
}

export async function getGeneratedThumbnailSrc(
  file: ThumbnailSourceFile,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const plan = decideThumbnailPlan(file);
  if (!plan.shouldGenerate) {
    return "";
  }

  if (plan.runtime === "renderer") {
    return getVideoThumbnailSrc(file.path, maxEdge);
  }

  if (plan.runtime === "main") {
    return getThumbnailImageSrc(file.path, file.ext, maxEdge);
  }

  return "";
}

export async function getThumbnailImageSrc(
  path: string,
  ext?: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
  options: { allowBackgroundRequest?: boolean } = {},
): Promise<string> {
  if (ext && !canGenerateThumbnail(ext)) {
    return "";
  }

  try {
    const thumbnailPath = await getThumbnailPath(path, maxEdge, {
      allowBackgroundRequest: options.allowBackgroundRequest,
    });
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
