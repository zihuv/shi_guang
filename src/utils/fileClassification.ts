import {
  AUDIO_FILE_EXTENSIONS,
  ARCHIVE_FILE_EXTENSIONS,
  CODE_FILE_EXTENSIONS,
  DIRECT_IMAGE_EXTENSIONS,
  PLAIN_TEXT_FILE_EXTENSIONS,
  PRESENTATION_FILE_EXTENSIONS,
  SPREADSHEET_FILE_EXTENSIONS,
  TEXT_PREVIEW_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
  WORD_FILE_EXTENSIONS,
  extensionListIncludes,
  getMimeTypeForExtension,
} from "@/shared/file-formats";

export const THUMBNAIL_MAX_EDGE = 768;
export const LIST_THUMBNAIL_MAX_EDGE = THUMBNAIL_MAX_EDGE;
export const MAX_THUMBNAIL_MAX_EDGE = THUMBNAIL_MAX_EDGE;
const THUMBNAIL_VARIANT_MAX_EDGES = [THUMBNAIL_MAX_EDGE] as const;
const DEFAULT_THUMBNAIL_DEVICE_PIXEL_RATIO_CAP = 1;

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
  return getMimeTypeForExtension(ext);
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

export function detectMimeTypeFromContents(bytes: Uint8Array, path: string): string {
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
  return extensionListIncludes(DIRECT_IMAGE_EXTENSIONS, ext);
}

export function isVideoFile(ext: string): boolean {
  return extensionListIncludes(VIDEO_FILE_EXTENSIONS, ext);
}

export function isPdfFile(ext: string): boolean {
  return normalizeExt(ext) === "pdf";
}

export function isPsdFile(ext: string): boolean {
  return normalizeExt(ext) === "psd";
}

export function isTextPreviewFile(ext: string): boolean {
  return extensionListIncludes(TEXT_PREVIEW_EXTENSIONS, ext);
}

export function getFilePreviewMode(ext: string): FilePreviewMode {
  const normalizedExt = normalizeExt(ext);
  if (normalizedExt === "heic" || normalizedExt === "heif") {
    return "thumbnail";
  }
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
  if (extensionListIncludes(AUDIO_FILE_EXTENSIONS, normalizedExt)) {
    return "audio";
  }
  if (extensionListIncludes(ARCHIVE_FILE_EXTENSIONS, normalizedExt)) {
    return "archive";
  }
  if (extensionListIncludes(SPREADSHEET_FILE_EXTENSIONS, normalizedExt)) {
    return "spreadsheet";
  }
  if (extensionListIncludes(PRESENTATION_FILE_EXTENSIONS, normalizedExt)) {
    return "presentation";
  }
  if (extensionListIncludes(WORD_FILE_EXTENSIONS, normalizedExt)) {
    return "word";
  }
  if (extensionListIncludes(CODE_FILE_EXTENSIONS, normalizedExt)) {
    return "code";
  }
  if (extensionListIncludes(PLAIN_TEXT_FILE_EXTENSIONS, normalizedExt)) {
    return "text";
  }
  return "other";
}
