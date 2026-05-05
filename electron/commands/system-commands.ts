import { app, nativeImage, shell } from "electron";
import fssync from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { writeFilesToClipboard } from "../clipboard-file-references";
import { getFileById, getFolderById, getIndexPaths, touchFileLastAccessed } from "../database";
import { checkForUpdates } from "../app/updater";
import { getLogDir } from "../logger";
import { hasThumbnailCachePath } from "../storage";
import {
  extensionListIncludes,
  AUDIO_FILE_EXTENSIONS,
  ARCHIVE_FILE_EXTENSIONS,
  CODE_FILE_EXTENSIONS,
  DIRECT_IMAGE_EXTENSIONS,
  PLAIN_TEXT_FILE_EXTENSIONS,
  PRESENTATION_FILE_EXTENSIONS,
  SPREADSHEET_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
  WORD_FILE_EXTENSIONS,
} from "../../src/shared/file-formats";
import type { AppState, FileRecord } from "../types";
import { type CommandHandler, numberArg, numberArrayArg } from "./common";

const DRAG_ICON_MAX_EDGE = 128;
const DRAG_DIRECT_IMAGE_BLOCKLIST = new Set(["heic", "heif"]);
const genericDragIconCache = new Map<string, Promise<Electron.NativeImage>>();

type DragFileKind =
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

const dragIconColorMap: Record<DragFileKind, { accent: string; fill: string }> = {
  image: { accent: "#10b981", fill: "#ecfdf5" },
  video: { accent: "#3b82f6", fill: "#eff6ff" },
  pdf: { accent: "#ef4444", fill: "#fef2f2" },
  audio: { accent: "#f97316", fill: "#fff7ed" },
  archive: { accent: "#f59e0b", fill: "#fffbeb" },
  spreadsheet: { accent: "#16a34a", fill: "#f0fdf4" },
  presentation: { accent: "#eab308", fill: "#fefce8" },
  word: { accent: "#0ea5e9", fill: "#f0f9ff" },
  code: { accent: "#8b5cf6", fill: "#f5f3ff" },
  text: { accent: "#64748b", fill: "#f8fafc" },
  other: { accent: "#9ca3af", fill: "#f9fafb" },
};

function resizeDragIconToFit(icon: Electron.NativeImage): Electron.NativeImage {
  const size = icon.getSize();
  const edge = Math.max(size.width, size.height);
  if (!edge || edge <= DRAG_ICON_MAX_EDGE) {
    return icon;
  }

  const scale = DRAG_ICON_MAX_EDGE / edge;
  return icon.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: "best",
  });
}

function getDragFileKind(ext: string): DragFileKind {
  const normalizedExt = ext.trim().replace(/^\./, "").toLowerCase();
  if (extensionListIncludes(DIRECT_IMAGE_EXTENSIONS, normalizedExt)) return "image";
  if (extensionListIncludes(VIDEO_FILE_EXTENSIONS, normalizedExt)) return "video";
  if (normalizedExt === "pdf") return "pdf";
  if (extensionListIncludes(AUDIO_FILE_EXTENSIONS, normalizedExt)) return "audio";
  if (extensionListIncludes(ARCHIVE_FILE_EXTENSIONS, normalizedExt)) return "archive";
  if (extensionListIncludes(SPREADSHEET_FILE_EXTENSIONS, normalizedExt)) return "spreadsheet";
  if (extensionListIncludes(PRESENTATION_FILE_EXTENSIONS, normalizedExt)) return "presentation";
  if (extensionListIncludes(WORD_FILE_EXTENSIONS, normalizedExt)) return "word";
  if (extensionListIncludes(CODE_FILE_EXTENSIONS, normalizedExt)) return "code";
  if (extensionListIncludes(PLAIN_TEXT_FILE_EXTENSIONS, normalizedExt)) return "text";
  return "other";
}

function canUseFilePathAsNativeImage(ext: string): boolean {
  const normalizedExt = ext.trim().replace(/^\./, "").toLowerCase();
  return (
    extensionListIncludes(DIRECT_IMAGE_EXTENSIONS, normalizedExt) &&
    !DRAG_DIRECT_IMAGE_BLOCKLIST.has(normalizedExt)
  );
}

async function createGenericFileDragIcon(ext: string): Promise<Electron.NativeImage> {
  const kind = getDragFileKind(ext);
  const normalizedExt = ext.trim().replace(/^\./, "").toLowerCase();
  const cacheKey = `${kind}:${normalizedExt || "file"}`;
  const cachedIcon = genericDragIconCache.get(cacheKey);
  if (cachedIcon) {
    return cachedIcon;
  }

  const iconPromise = renderGenericFileDragIcon(kind, normalizedExt);
  genericDragIconCache.set(cacheKey, iconPromise);
  return iconPromise;
}

async function renderGenericFileDragIcon(
  kind: DragFileKind,
  normalizedExt: string,
): Promise<Electron.NativeImage> {
  const color = dragIconColorMap[kind];
  const label = normalizedExt.slice(0, 5).toUpperCase() || "FILE";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="${color.fill}"/>
  <path d="M34 18h39l21 21v71H34z" fill="#fff" stroke="${color.accent}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M73 18v22h21" fill="none" stroke="${color.accent}" stroke-width="6" stroke-linejoin="round"/>
  <rect x="34" y="76" width="60" height="26" rx="8" fill="${color.accent}"/>
  <text x="64" y="94" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  const pngBuffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer()
    .catch(() =>
      sharp({
        create: {
          width: DRAG_ICON_MAX_EDGE,
          height: DRAG_ICON_MAX_EDGE,
          channels: 4,
          background: color.fill,
        },
      })
        .png()
        .toBuffer(),
    );
  const icon = nativeImage.createFromBuffer(pngBuffer);
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

async function getFileDragIcon(state: AppState, file: FileRecord): Promise<Electron.NativeImage> {
  const thumbnailPath = hasThumbnailCachePath(getIndexPaths(state.db), file.path, {
    contentHash: file.contentHash,
    size: file.size,
    modifiedAt: file.modifiedAt,
  });
  const thumbnailImage = thumbnailPath ? nativeImage.createFromPath(thumbnailPath) : null;
  if (thumbnailImage && !thumbnailImage.isEmpty()) {
    return resizeDragIconToFit(thumbnailImage);
  }

  if (canUseFilePathAsNativeImage(file.ext)) {
    const directImage = nativeImage.createFromPath(file.path);
    if (!directImage.isEmpty()) {
      return resizeDragIconToFit(directImage);
    }
  }

  return createGenericFileDragIcon(file.ext);
}

async function getFallbackDragIcon(filePath: string): Promise<Electron.NativeImage> {
  const ext = path.extname(filePath).slice(1);
  if (canUseFilePathAsNativeImage(ext)) {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) {
      return resizeDragIconToFit(img);
    }
  }

  const img = await createGenericFileDragIcon(ext);
  if (!img.isEmpty()) {
    return resizeDragIconToFit(img);
  }
  return nativeImage.createEmpty();
}

export function createSystemCommands(state: AppState): Record<string, CommandHandler> {
  return {
    get_app_version: () => app.getVersion(),
    check_for_updates: () => checkForUpdates({ manual: true }),
    copy_files_to_clipboard: (args) => {
      const files = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId))
        .filter((item): item is FileRecord => Boolean(item));
      return writeFilesToClipboard(files);
    },
    start_drag_files: async (args, window) => {
      const files = numberArrayArg(args, "fileIds", "file_ids")
        .map((fileId) => getFileById(state.db, fileId))
        .filter((item): item is FileRecord => Boolean(item));
      const paths = files.map((file) => file.path);
      if (!paths.length || !window) throw new Error("No files selected");
      const firstFile = files[0];
      window.webContents.startDrag({
        file: paths[0],
        files: paths,
        icon: firstFile
          ? await getFileDragIcon(state, firstFile)
          : await getFallbackDragIcon(paths[0]),
      });
    },
    open_file: async (args) => {
      const fileId = numberArg(args, "fileId", "file_id");
      const file = getFileById(state.db, fileId);
      if (!file) throw new Error("File not found");
      touchFileLastAccessed(state.db, fileId);
      const result = await shell.openPath(file.path);
      if (result) throw new Error(result);
    },
    show_in_explorer: (args) => {
      const file = getFileById(state.db, numberArg(args, "fileId", "file_id"));
      if (!file) throw new Error("File not found");
      shell.showItemInFolder(file.path);
    },
    show_folder_in_explorer: async (args) => {
      const folder = getFolderById(state.db, numberArg(args, "folderId", "folder_id"));
      if (!folder) throw new Error("Folder not found");
      const result = await shell.openPath(folder.path);
      if (result) throw new Error(result);
    },
    show_current_library_in_explorer: async () => {
      const result = await shell.openPath(state.indexPath);
      if (result) throw new Error(result);
    },
    open_log_directory: async () => {
      const logDir = getLogDir();
      if (!fssync.existsSync(logDir)) {
        fssync.mkdirSync(logDir, { recursive: true });
      }
      const result = await shell.openPath(logDir);
      if (result) throw new Error(result);
    },
  };
}
