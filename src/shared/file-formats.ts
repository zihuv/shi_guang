export const DIRECT_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "gif",
  "webp",
  "avif",
  "heic",
  "heif",
  "svg",
  "bmp",
  "ico",
  "tif",
  "tiff",
] as const;

export const IMAGE_FILE_EXTENSIONS = [...DIRECT_IMAGE_EXTENSIONS, "psd"] as const;

export const VIDEO_FILE_EXTENSIONS = [
  "mp4",
  "avi",
  "mov",
  "mkv",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "3gp",
  "3g2",
  "ts",
  "swf",
  "rmvb",
  "rm",
  "vob",
  "trp",
  "sct",
  "ogv",
  "mxf",
  "mpg",
  "mpeg",
  "m2ts",
  "f4v",
  "dv",
  "dcr",
  "asf",
] as const;

export const AUDIO_FILE_EXTENSIONS = [
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "m4a",
  "ape",
  "aiff",
  "aif",
  "amr",
  "wma",
] as const;

export const WORD_FILE_EXTENSIONS = ["doc", "docx", "rtf", "odt", "htm", "html", "mht"] as const;

export const SPREADSHEET_FILE_EXTENSIONS = ["xls", "xlsx", "csv", "ods"] as const;

export const PRESENTATION_FILE_EXTENSIONS = ["ppt", "pptx", "odp", "pps", "ppsx"] as const;

export const DOCUMENT_FILE_EXTENSIONS = [
  "pdf",
  "txt",
  ...WORD_FILE_EXTENSIONS,
  ...SPREADSHEET_FILE_EXTENSIONS,
  ...PRESENTATION_FILE_EXTENSIONS,
] as const;

export const ARCHIVE_FILE_EXTENSIONS = ["zip", "rar"] as const;

export const FILE_FORMAT_GROUPS = {
  image: IMAGE_FILE_EXTENSIONS,
  video: VIDEO_FILE_EXTENSIONS,
  audio: AUDIO_FILE_EXTENSIONS,
  document: DOCUMENT_FILE_EXTENSIONS,
  archive: ARCHIVE_FILE_EXTENSIONS,
} as const;

export const LIBRARY_FILTER_FILE_TYPES = [
  "all",
  "image",
  "video",
  "audio",
  "document",
  "archive",
] as const;

export const BACKEND_DECODABLE_IMAGE_EXTENSIONS = DIRECT_IMAGE_EXTENSIONS;

export const AI_SUPPORTED_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "webp",
  "bmp",
  "gif",
  "tif",
  "tiff",
  "ico",
  "avif",
  "heic",
  "heif",
] as const;

export const VISUAL_SEARCH_IMAGE_EXTENSIONS = AI_SUPPORTED_IMAGE_EXTENSIONS;

export const BLOCKED_UNSUPPORTED_EXTENSIONS = [
  "ai",
  "eps",
  "raw",
  "3fr",
  "arw",
  "cr2",
  "cr3",
  "crw",
  "dng",
  "erf",
  "mrw",
  "nef",
  "nrw",
  "orf",
  "otf",
  "pef",
  "raf",
  "rw2",
  "sr2",
  "srw",
  "x3f",
] as const;

export const TEXT_PREVIEW_EXTENSIONS = [
  "txt",
  "log",
  "md",
  "csv",
  "ini",
  "conf",
  "htm",
  "html",
] as const;

export const CODE_FILE_EXTENSIONS = [
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
] as const;

export const PLAIN_TEXT_FILE_EXTENSIONS = ["txt", "log", "ini", "conf"] as const;

export const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
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
  "3g2": "video/3gpp2",
  ts: "video/mp2t",
  ogv: "video/ogg",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  m2ts: "video/mp2t",
  f4v: "video/mp4",
  asf: "video/x-ms-asf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  amr: "audio/amr",
  wma: "audio/x-ms-wma",
  zip: "application/zip",
  rar: "application/vnd.rar",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  mht: "message/rfc822",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pps: "application/vnd.ms-powerpoint",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  md: "text/markdown; charset=utf-8",
};

export const SCAN_SUPPORTED_EXTENSIONS = Object.values(FILE_FORMAT_GROUPS).flat();
export const IMPORT_DIALOG_EXTENSIONS = SCAN_SUPPORTED_EXTENSIONS;

export type FileFormatGroup = keyof typeof FILE_FORMAT_GROUPS;
export type LibraryFilterFileType = (typeof LIBRARY_FILTER_FILE_TYPES)[number];
export type ThumbnailGenerationRuntime = "none" | "main" | "renderer";

export interface FileFormatCapabilities {
  group: FileFormatGroup | null;
  backendDecodable: boolean;
  metadataExtractable: boolean;
  thumbnailRuntime: ThumbnailGenerationRuntime;
  aiAnalyzable: boolean;
  visualSearchable: boolean;
  directPreviewable: boolean;
  textPreviewable: boolean;
}

export function normalizeExtension(ext: string): string {
  return ext.trim().replace(/^\./, "").toLowerCase();
}

export function extensionSet<T extends readonly string[]>(extensions: T): Set<string> {
  return new Set<string>(extensions);
}

export function extensionListIncludes(extensions: readonly string[], ext: string): boolean {
  return extensions.includes(normalizeExtension(ext));
}

export function getMimeTypeForExtension(ext: string): string {
  return MIME_TYPES_BY_EXTENSION[normalizeExtension(ext)] ?? "application/octet-stream";
}

const DIRECT_IMAGE_EXTENSION_SET = extensionSet(DIRECT_IMAGE_EXTENSIONS);
const VIDEO_EXTENSION_SET = extensionSet(VIDEO_FILE_EXTENSIONS);
const BACKEND_DECODABLE_EXTENSION_SET = extensionSet(BACKEND_DECODABLE_IMAGE_EXTENSIONS);
const AI_ANALYZABLE_EXTENSION_SET = extensionSet(AI_SUPPORTED_IMAGE_EXTENSIONS);
const VISUAL_SEARCH_EXTENSION_SET = extensionSet(VISUAL_SEARCH_IMAGE_EXTENSIONS);
const TEXT_PREVIEW_EXTENSION_SET = extensionSet(TEXT_PREVIEW_EXTENSIONS);
const MAIN_PROCESS_THUMBNAIL_EXTENSION_SET = extensionSet([
  ...DIRECT_IMAGE_EXTENSIONS,
  "pdf",
  "psd",
] as const);
const BROWSER_DIRECT_PREVIEW_BLOCKLIST = extensionSet(["heic", "heif"] as const);

function getFormatGroup(ext: string): FileFormatGroup | null {
  for (const [group, extensions] of Object.entries(FILE_FORMAT_GROUPS)) {
    if (extensionListIncludes(extensions, ext)) {
      return group as FileFormatGroup;
    }
  }
  return null;
}

export function getFileFormatCapabilities(ext: string): FileFormatCapabilities {
  const normalizedExt = normalizeExtension(ext);
  const backendDecodable = BACKEND_DECODABLE_EXTENSION_SET.has(normalizedExt);
  const thumbnailRuntime: ThumbnailGenerationRuntime = VIDEO_EXTENSION_SET.has(normalizedExt)
    ? "renderer"
    : MAIN_PROCESS_THUMBNAIL_EXTENSION_SET.has(normalizedExt)
      ? "main"
      : "none";

  return {
    group: getFormatGroup(normalizedExt),
    backendDecodable,
    metadataExtractable: backendDecodable,
    thumbnailRuntime,
    aiAnalyzable: AI_ANALYZABLE_EXTENSION_SET.has(normalizedExt),
    visualSearchable: VISUAL_SEARCH_EXTENSION_SET.has(normalizedExt),
    directPreviewable:
      DIRECT_IMAGE_EXTENSION_SET.has(normalizedExt) &&
      !BROWSER_DIRECT_PREVIEW_BLOCKLIST.has(normalizedExt),
    textPreviewable: TEXT_PREVIEW_EXTENSION_SET.has(normalizedExt),
  };
}

export function canExtractImageMetadata(ext: string): boolean {
  return getFileFormatCapabilities(ext).metadataExtractable;
}

export function canAnalyzeImageMetadata(ext: string): boolean {
  return getFileFormatCapabilities(ext).aiAnalyzable;
}

export function canVisualSearchImage(ext: string): boolean {
  return getFileFormatCapabilities(ext).visualSearchable;
}
