const PREVIEW_IMAGE_CACHE_LIMIT = 256;
const rememberedPreviewImageSrcCache = new Map<string, string>();
const decodedPreviewImageInfoCache = new Map<string, { width: number; height: number }>();
const decodedPreviewImagePromiseCache = new Map<
  string,
  Promise<{ width: number; height: number }>
>();

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

export async function decodePreviewImageSrc(
  src: string,
): Promise<{ width: number; height: number }> {
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
