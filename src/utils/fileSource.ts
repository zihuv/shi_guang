import { getDesktopBridge } from "@/services/desktop/core";
import { detectMimeTypeFromContents } from "@/utils/fileClassification";
import {
  buildBrowserDecodedImageDataUrlFromBlob,
  type BrowserDecodedImageOptions,
} from "@/utils/browserImageDecode";
import { decodePreviewImageSrc, rememberPreviewImageSrc } from "@/utils/previewImageCache";
import { isMissingFileError, scheduleMissingFileCleanup } from "@/utils/missingFileSync";

const MAX_TEXT_PREVIEW_SIZE = 512 * 1024;

function exists(path: string) {
  return getDesktopBridge().fs.exists(path);
}

function readFile(path: string) {
  return getDesktopBridge().fs.readFile(path);
}

function readTextFile(path: string) {
  return getDesktopBridge().fs.readTextFile(path);
}

export function toAssetSrc(path: string): Promise<string> {
  return getDesktopBridge().asset.toUrl(path);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function getFileSrc(path: string): Promise<string> {
  try {
    if (!(await exists(path))) {
      scheduleMissingFileCleanup(path);
      return "";
    }

    return await toAssetSrc(path);
  } catch (e: unknown) {
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
    } catch (readError: unknown) {
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
  } catch (e: unknown) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path);
      return "文件不存在或已被删除。";
    }
    console.error("Failed to read text file:", e);
    return "文本预览加载失败。";
  }
}

export async function getImageSrc(path: string): Promise<string> {
  return getFileSrc(path);
}

export async function getCanvasSafeImageSrc(path: string): Promise<string> {
  try {
    const contents = await readFile(path);
    const blob = new Blob([toArrayBuffer(contents)], {
      type: detectMimeTypeFromContents(contents, path),
    });
    return URL.createObjectURL(blob);
  } catch (e: unknown) {
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

export { type BrowserDecodedImageOptions } from "@/utils/browserImageDecode";
