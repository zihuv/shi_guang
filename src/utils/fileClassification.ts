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
