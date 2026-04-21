/// <reference lib="webworker" />

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

const WORKER_UNAVAILABLE_ERROR = "__browser_image_decode_worker_unavailable__";

function resolveShortEdgeScale(width: number, height: number, targetShortEdge: number) {
  const shortEdge = Math.min(width, height);
  if (!shortEdge || shortEdge <= targetShortEdge) {
    return 1;
  }
  return targetShortEdge / shortEdge;
}

function resolveTargetSize(
  width: number,
  height: number,
  options: {
    maxEdge?: number | null;
    targetShortEdge?: number | null;
  },
) {
  const { maxEdge, targetShortEdge } = options;
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
}

function readBlobAsDataUrl(blob: Blob): string {
  if (typeof FileReaderSync === "undefined") {
    throw new Error(WORKER_UNAVAILABLE_ERROR);
  }

  const reader = new FileReaderSync();
  return reader.readAsDataURL(blob);
}

self.onmessage = async (event: MessageEvent<BrowserImageDecodeWorkerRequest>) => {
  const { id, bytes, mimeType, maxEdge, targetShortEdge, outputMimeType, quality } = event.data;

  try {
    if (
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas === "undefined" ||
      typeof FileReaderSync === "undefined"
    ) {
      self.postMessage({
        id,
        error: WORKER_UNAVAILABLE_ERROR,
      } satisfies BrowserImageDecodeWorkerResponse);
      return;
    }

    const blob = new Blob([bytes], { type: mimeType });
    const bitmap = await createImageBitmap(blob);

    try {
      const targetSize = resolveTargetSize(bitmap.width, bitmap.height, {
        maxEdge,
        targetShortEdge,
      });
      const canvas = new OffscreenCanvas(targetSize.width, targetSize.height);
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("无法创建后台图片画布");
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, targetSize.width, targetSize.height);

      const encodedBlob = await canvas.convertToBlob({
        type: outputMimeType ?? "image/jpeg",
        quality,
      });

      self.postMessage({
        id,
        dataUrl: readBlobAsDataUrl(encodedBlob),
      } satisfies BrowserImageDecodeWorkerResponse);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies BrowserImageDecodeWorkerResponse);
  }
};

export {};
