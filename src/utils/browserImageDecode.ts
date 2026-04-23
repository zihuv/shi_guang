import { THUMBNAIL_MAX_EDGE } from "@/utils/fileClassification";

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

export interface BrowserDecodedImageOptions {
  maxEdge?: number | null;
  targetShortEdge?: number | null;
  quality?: number;
  outputMimeType?: string;
  preferWorker?: boolean;
  allowImageElementFallback?: boolean;
}

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

export async function buildBrowserDecodedImageDataUrlFromBlob(
  blob: Blob,
  mimeType: string,
  options: BrowserDecodedImageOptions = {},
): Promise<string> {
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
