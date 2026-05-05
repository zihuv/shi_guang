export type FileFormatGroup = "image" | "video" | "audio" | "document" | "archive";
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
export type ThumbnailGenerationRuntime = "none" | "main" | "renderer";

export interface FileFormatDefinition {
  extension: string;
  kind: FileKind;
  group?: FileFormatGroup;
  mimeType?: string;
  directImage?: boolean;
  wordFile?: boolean;
  spreadsheetFile?: boolean;
  presentationFile?: boolean;
  codeFile?: boolean;
  codeFileOrder?: number;
  plainTextFile?: boolean;
  plainTextFileOrder?: number;
  textPreviewable?: boolean;
  textPreviewOrder?: number;
  backendDecodable?: boolean;
  metadataExtractable?: boolean;
  thumbnailRuntime?: ThumbnailGenerationRuntime;
  aiAnalyzable?: boolean;
  visualSearchable?: boolean;
  directPreviewable?: boolean;
  blockedUnsupported?: boolean;
}

const imageFormat = (
  extension: string,
  mimeType: string | undefined,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind: "image",
  group: "image",
  mimeType,
  directImage: true,
  backendDecodable: true,
  metadataExtractable: true,
  thumbnailRuntime: "main",
  aiAnalyzable: true,
  visualSearchable: true,
  directPreviewable: true,
  ...options,
});

const videoFormat = (
  extension: string,
  mimeType?: string,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind: "video",
  group: "video",
  mimeType,
  thumbnailRuntime: "renderer",
  ...options,
});

const audioFormat = (
  extension: string,
  mimeType?: string,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind: "audio",
  group: "audio",
  mimeType,
  ...options,
});

const documentFormat = (
  extension: string,
  kind: Extract<FileKind, "pdf" | "spreadsheet" | "presentation" | "word" | "text">,
  mimeType?: string,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind,
  group: "document",
  mimeType,
  ...options,
});

const archiveFormat = (
  extension: string,
  mimeType?: string,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind: "archive",
  group: "archive",
  mimeType,
  ...options,
});

const codeFormat = (
  extension: string,
  mimeType?: string,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind: "code",
  mimeType,
  codeFile: true,
  ...options,
});

const plainTextFormat = (
  extension: string,
  options: Partial<FileFormatDefinition> = {},
): FileFormatDefinition => ({
  extension,
  kind: "text",
  plainTextFile: true,
  textPreviewable: true,
  ...options,
});

const unsupportedFormat = (extension: string): FileFormatDefinition => ({
  extension,
  kind: "other",
  blockedUnsupported: true,
});

export const FILE_FORMAT_DEFINITIONS: readonly FileFormatDefinition[] = [
  imageFormat("jpg", "image/jpeg"),
  imageFormat("jpeg", "image/jpeg"),
  imageFormat("jpe", "image/jpeg"),
  imageFormat("jfif", "image/jpeg"),
  imageFormat("png", "image/png"),
  imageFormat("gif", "image/gif"),
  imageFormat("webp", "image/webp"),
  imageFormat("avif", "image/avif"),
  imageFormat("heic", "image/heic", { directPreviewable: false }),
  imageFormat("heif", "image/heif", { directPreviewable: false }),
  imageFormat("svg", "image/svg+xml", {
    aiAnalyzable: false,
    visualSearchable: false,
  }),
  imageFormat("bmp", "image/bmp"),
  imageFormat("ico", "image/x-icon"),
  imageFormat("tif", "image/tiff"),
  imageFormat("tiff", "image/tiff"),
  {
    extension: "psd",
    kind: "image",
    group: "image",
    thumbnailRuntime: "main",
  },

  videoFormat("mp4", "video/mp4"),
  videoFormat("avi", "video/x-msvideo"),
  videoFormat("mov", "video/quicktime"),
  videoFormat("mkv", "video/x-matroska"),
  videoFormat("wmv", "video/x-ms-wmv"),
  videoFormat("flv", "video/x-flv"),
  videoFormat("webm", "video/webm"),
  videoFormat("m4v", "video/mp4"),
  videoFormat("3gp", "video/3gpp"),
  videoFormat("3g2", "video/3gpp2"),
  videoFormat("ts", "video/mp2t", { codeFile: true, codeFileOrder: 2 }),
  videoFormat("swf"),
  videoFormat("rmvb"),
  videoFormat("rm"),
  videoFormat("vob"),
  videoFormat("trp"),
  videoFormat("sct"),
  videoFormat("ogv", "video/ogg"),
  videoFormat("mxf"),
  videoFormat("mpg", "video/mpeg"),
  videoFormat("mpeg", "video/mpeg"),
  videoFormat("m2ts", "video/mp2t"),
  videoFormat("f4v", "video/mp4"),
  videoFormat("dv"),
  videoFormat("dcr"),
  videoFormat("asf", "video/x-ms-asf"),

  audioFormat("mp3", "audio/mpeg"),
  audioFormat("wav", "audio/wav"),
  audioFormat("flac", "audio/flac"),
  audioFormat("aac", "audio/aac"),
  audioFormat("ogg", "audio/ogg"),
  audioFormat("m4a", "audio/mp4"),
  audioFormat("ape"),
  audioFormat("aiff", "audio/aiff"),
  audioFormat("aif", "audio/aiff"),
  audioFormat("amr", "audio/amr"),
  audioFormat("wma", "audio/x-ms-wma"),

  documentFormat("pdf", "pdf", "application/pdf", { thumbnailRuntime: "main" }),
  documentFormat("txt", "text", "text/plain; charset=utf-8", {
    plainTextFile: true,
    plainTextFileOrder: 0,
    textPreviewable: true,
    textPreviewOrder: 0,
  }),
  documentFormat("doc", "word", "application/msword", { wordFile: true }),
  documentFormat(
    "docx",
    "word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    { wordFile: true },
  ),
  documentFormat("rtf", "word", "application/rtf", { wordFile: true }),
  documentFormat("odt", "word", "application/vnd.oasis.opendocument.text", { wordFile: true }),
  documentFormat("htm", "word", "text/html; charset=utf-8", {
    wordFile: true,
    textPreviewable: true,
    textPreviewOrder: 6,
  }),
  documentFormat("html", "word", "text/html; charset=utf-8", {
    wordFile: true,
    codeFile: true,
    codeFileOrder: 5,
    textPreviewable: true,
    textPreviewOrder: 7,
  }),
  documentFormat("mht", "word", "message/rfc822", { wordFile: true }),
  documentFormat("xls", "spreadsheet", "application/vnd.ms-excel", {
    spreadsheetFile: true,
  }),
  documentFormat(
    "xlsx",
    "spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { spreadsheetFile: true },
  ),
  documentFormat("csv", "spreadsheet", "text/csv; charset=utf-8", {
    spreadsheetFile: true,
    textPreviewable: true,
    textPreviewOrder: 3,
  }),
  documentFormat("ods", "spreadsheet", "application/vnd.oasis.opendocument.spreadsheet", {
    spreadsheetFile: true,
  }),
  documentFormat("ppt", "presentation", "application/vnd.ms-powerpoint", {
    presentationFile: true,
  }),
  documentFormat(
    "pptx",
    "presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    { presentationFile: true },
  ),
  documentFormat("odp", "presentation", "application/vnd.oasis.opendocument.presentation", {
    presentationFile: true,
  }),
  documentFormat("pps", "presentation", "application/vnd.ms-powerpoint", {
    presentationFile: true,
  }),
  documentFormat(
    "ppsx",
    "presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    { presentationFile: true },
  ),

  archiveFormat("zip", "application/zip"),
  archiveFormat("rar", "application/vnd.rar"),

  plainTextFormat("log", { plainTextFileOrder: 1, textPreviewOrder: 1 }),
  codeFormat("js", undefined, { codeFileOrder: 0 }),
  codeFormat("jsx", undefined, { codeFileOrder: 1 }),
  codeFormat("tsx", undefined, { codeFileOrder: 3 }),
  codeFormat("json", undefined, { codeFileOrder: 4 }),
  codeFormat("css", undefined, { codeFileOrder: 6 }),
  codeFormat("scss", undefined, { codeFileOrder: 7 }),
  codeFormat("less", undefined, { codeFileOrder: 8 }),
  codeFormat("md", "text/markdown; charset=utf-8", {
    codeFileOrder: 9,
    textPreviewable: true,
    textPreviewOrder: 2,
  }),
  codeFormat("mdx", undefined, { codeFileOrder: 10 }),
  codeFormat("rs", undefined, { codeFileOrder: 11 }),
  codeFormat("py", undefined, { codeFileOrder: 12 }),
  codeFormat("java", undefined, { codeFileOrder: 13 }),
  codeFormat("kt", undefined, { codeFileOrder: 14 }),
  codeFormat("go", undefined, { codeFileOrder: 15 }),
  codeFormat("c", undefined, { codeFileOrder: 16 }),
  codeFormat("cpp", undefined, { codeFileOrder: 17 }),
  codeFormat("h", undefined, { codeFileOrder: 18 }),
  codeFormat("hpp", undefined, { codeFileOrder: 19 }),
  codeFormat("sh", undefined, { codeFileOrder: 20 }),
  codeFormat("ps1", undefined, { codeFileOrder: 21 }),
  codeFormat("yaml", undefined, { codeFileOrder: 22 }),
  codeFormat("yml", undefined, { codeFileOrder: 23 }),
  codeFormat("toml", undefined, { codeFileOrder: 24 }),
  codeFormat("xml", undefined, { codeFileOrder: 25 }),
  plainTextFormat("ini", { plainTextFileOrder: 2, textPreviewOrder: 4 }),
  plainTextFormat("conf", { plainTextFileOrder: 3, textPreviewOrder: 5 }),

  unsupportedFormat("ai"),
  unsupportedFormat("eps"),
  unsupportedFormat("raw"),
  unsupportedFormat("3fr"),
  unsupportedFormat("arw"),
  unsupportedFormat("cr2"),
  unsupportedFormat("cr3"),
  unsupportedFormat("crw"),
  unsupportedFormat("dng"),
  unsupportedFormat("erf"),
  unsupportedFormat("mrw"),
  unsupportedFormat("nef"),
  unsupportedFormat("nrw"),
  unsupportedFormat("orf"),
  unsupportedFormat("otf"),
  unsupportedFormat("pef"),
  unsupportedFormat("raf"),
  unsupportedFormat("rw2"),
  unsupportedFormat("sr2"),
  unsupportedFormat("srw"),
  unsupportedFormat("x3f"),
];

const FILE_FORMATS_BY_EXTENSION = new Map(
  FILE_FORMAT_DEFINITIONS.map((definition) => [definition.extension, definition]),
);

const extensionsWhere = (
  predicate: (definition: FileFormatDefinition) => boolean,
  orderKey?: keyof Pick<
    FileFormatDefinition,
    "codeFileOrder" | "plainTextFileOrder" | "textPreviewOrder"
  >,
): string[] => {
  const definitions = FILE_FORMAT_DEFINITIONS.filter(predicate);
  if (orderKey) {
    definitions.sort((left, right) => (left[orderKey] ?? 0) - (right[orderKey] ?? 0));
  }
  return definitions.map((definition) => definition.extension);
};

export const DIRECT_IMAGE_EXTENSIONS = extensionsWhere((definition) => !!definition.directImage);
export const IMAGE_FILE_EXTENSIONS = extensionsWhere((definition) => definition.group === "image");
export const VIDEO_FILE_EXTENSIONS = extensionsWhere((definition) => definition.group === "video");
export const AUDIO_FILE_EXTENSIONS = extensionsWhere((definition) => definition.group === "audio");
export const WORD_FILE_EXTENSIONS = extensionsWhere((definition) => !!definition.wordFile);
export const SPREADSHEET_FILE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.spreadsheetFile,
);
export const PRESENTATION_FILE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.presentationFile,
);
export const DOCUMENT_FILE_EXTENSIONS = extensionsWhere(
  (definition) => definition.group === "document",
);
export const ARCHIVE_FILE_EXTENSIONS = extensionsWhere(
  (definition) => definition.group === "archive",
);

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

export const BACKEND_DECODABLE_IMAGE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.backendDecodable,
);
export const AI_SUPPORTED_IMAGE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.aiAnalyzable,
);
export const VISUAL_SEARCH_IMAGE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.visualSearchable,
);
export const BLOCKED_UNSUPPORTED_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.blockedUnsupported,
);
export const TEXT_PREVIEW_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.textPreviewable,
  "textPreviewOrder",
);
export const CODE_FILE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.codeFile,
  "codeFileOrder",
);
export const PLAIN_TEXT_FILE_EXTENSIONS = extensionsWhere(
  (definition) => !!definition.plainTextFile,
  "plainTextFileOrder",
);
export const MIME_TYPES_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  FILE_FORMAT_DEFINITIONS.flatMap((definition) =>
    definition.mimeType ? [[definition.extension, definition.mimeType]] : [],
  ),
);

const CONTENT_TYPE_EXTENSION_ALIASES: Record<string, string> = {
  "image/apng": "png",
  "image/jpg": "jpg",
  "image/jfif": "jpg",
  "image/pjpeg": "jpg",
  "image/x-ms-bmp": "bmp",
  "image/vnd.microsoft.icon": "ico",
  "image/tif": "tiff",
  "audio/mp3": "mp3",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "application/x-rar-compressed": "rar",
  "image/vnd.adobe.photoshop": "psd",
};

const PREFERRED_CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/tiff": "tiff",
  "text/html": "html",
};

const EXTENSIONS_BY_CONTENT_TYPE = FILE_FORMAT_DEFINITIONS.reduce<Record<string, string>>(
  (extensions, definition) => {
    if (!definition.mimeType) {
      return extensions;
    }

    const contentType = normalizeContentType(definition.mimeType);
    if (contentType && !extensions[contentType]) {
      extensions[contentType] = definition.extension;
    }

    return extensions;
  },
  {},
);

export const SCAN_SUPPORTED_EXTENSIONS = Object.values(FILE_FORMAT_GROUPS).flat();
export const IMPORT_DIALOG_EXTENSIONS = SCAN_SUPPORTED_EXTENSIONS;

export type LibraryFilterFileType = (typeof LIBRARY_FILTER_FILE_TYPES)[number];

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

export function normalizeContentType(contentType?: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function extensionSet<T extends readonly string[]>(extensions: T): Set<string> {
  return new Set<string>(extensions);
}

export function extensionListIncludes(extensions: readonly string[], ext: string): boolean {
  return extensions.includes(normalizeExtension(ext));
}

export function getFileFormatDefinition(ext: string): FileFormatDefinition | null {
  return FILE_FORMATS_BY_EXTENSION.get(normalizeExtension(ext)) ?? null;
}

export function getMimeTypeForExtension(ext: string): string {
  return getFileFormatDefinition(ext)?.mimeType ?? "application/octet-stream";
}

export function getExtensionForContentType(contentType?: string | null): string | null {
  const normalizedContentType = normalizeContentType(contentType);
  if (!normalizedContentType) {
    return null;
  }

  return (
    CONTENT_TYPE_EXTENSION_ALIASES[normalizedContentType] ??
    PREFERRED_CONTENT_TYPE_EXTENSIONS[normalizedContentType] ??
    EXTENSIONS_BY_CONTENT_TYPE[normalizedContentType] ??
    null
  );
}

export function getFileKind(ext: string): FileKind {
  return getFileFormatDefinition(ext)?.kind ?? "other";
}

export function getFileFormatCapabilities(ext: string): FileFormatCapabilities {
  const definition = getFileFormatDefinition(ext);

  return {
    group: definition?.group ?? null,
    backendDecodable: !!definition?.backendDecodable,
    metadataExtractable: !!definition?.metadataExtractable,
    thumbnailRuntime: definition?.thumbnailRuntime ?? "none",
    aiAnalyzable: !!definition?.aiAnalyzable,
    visualSearchable: !!definition?.visualSearchable,
    directPreviewable: !!definition?.directPreviewable,
    textPreviewable: !!definition?.textPreviewable,
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
