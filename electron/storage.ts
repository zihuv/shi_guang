import { app } from "electron";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as WebtoonPsd from "@webtoon/psd";
import { definePDFJSModule, renderPageAsImage } from "unpdf";
import { isInsideAnyPath, pathHasPrefix } from "./path-utils";
import {
  getThumbnailGenerationRuntimeForExt,
  normalizeThumbnailExt,
  resolveThumbnailCacheKey,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_WEBP_QUALITY,
} from "./thumbnail";

const LIBRARY_STATE_FILE = "library-state.json";
const MAX_RECENT_INDEX_PATHS = 8;
const thumbnailBuildTasks = new Map<string, Promise<string | null>>();
let pdfJsModuleReady: Promise<void> | null = null;

interface LibraryState {
  version: number;
  currentPath: string | null;
  recentPaths: string[];
}

type PsdParser = {
  parse: (buffer: ArrayBuffer) => {
    width: number;
    height: number;
    composite: () => Promise<Uint8ClampedArray>;
  };
};

function getPsdParser(): PsdParser {
  const candidates = [
    WebtoonPsd,
    (WebtoonPsd as { default?: unknown }).default,
    ((WebtoonPsd as { default?: { default?: unknown } }).default ?? {}).default,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      (typeof candidate === "object" || typeof candidate === "function") &&
      "parse" in candidate &&
      typeof (candidate as { parse?: unknown }).parse === "function"
    ) {
      return candidate as PsdParser;
    }
  }

  throw new Error("Unable to resolve PSD parser export");
}

export function getDefaultIndexPath(): string {
  return path.join(app.getPath("pictures"), "shiguang");
}

export async function ensureStorageDirs(indexPath: string): Promise<void> {
  await fs.mkdir(getDbDir(indexPath), { recursive: true });
  await fs.mkdir(getThumbnailRoot(indexPath), { recursive: true });
}

export function getDbDir(indexPath: string): string {
  return path.join(indexPath, ".shiguang", "db");
}

export function getDbPath(indexPath: string): string {
  return path.join(getDbDir(indexPath), "shiguang.db");
}

export function getThumbnailRoot(indexPath: string): string {
  return path.join(indexPath, ".shiguang", "thumbs");
}

function emptyLibraryState(): LibraryState {
  return {
    version: 1,
    currentPath: null,
    recentPaths: [],
  };
}

function normalizeIndexPathValue(indexPath: string): string {
  return path.resolve(indexPath.trim());
}

function isExistingDirectory(targetPath: string): boolean {
  try {
    return fssync.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function dedupeRecentIndexPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const candidate of paths) {
    const normalized = normalizeIndexPathValue(candidate);
    if (!normalized || seen.has(normalized) || !isExistingDirectory(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
    if (next.length >= MAX_RECENT_INDEX_PATHS) {
      break;
    }
  }

  return next;
}

function sanitizeCurrentIndexPath(indexPath: string | null | undefined): string | null {
  if (typeof indexPath !== "string") {
    return null;
  }

  const trimmed = indexPath.trim();
  if (!trimmed) {
    return null;
  }

  return normalizeIndexPathValue(trimmed);
}

function sanitizeLibraryState(input: Partial<LibraryState>): LibraryState {
  const currentPath = sanitizeCurrentIndexPath(input.currentPath);
  const recentCandidates = Array.isArray(input.recentPaths) ? input.recentPaths : [];
  const recentPaths = dedupeRecentIndexPaths(
    currentPath ? [currentPath, ...recentCandidates] : recentCandidates,
  );

  return {
    version: 1,
    currentPath,
    recentPaths,
  };
}

async function persistLibraryState(
  appDataDir: string,
  state: Partial<LibraryState>,
): Promise<LibraryState> {
  const sanitized = sanitizeLibraryState(state);
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.writeFile(
    path.join(appDataDir, LIBRARY_STATE_FILE),
    JSON.stringify(sanitized, null, 2),
    "utf8",
  );
  return sanitized;
}

async function readPersistedLibraryState(appDataDir: string): Promise<LibraryState | null> {
  try {
    const raw = await fs.readFile(path.join(appDataDir, LIBRARY_STATE_FILE), "utf8");
    return sanitizeLibraryState(JSON.parse(raw) as Partial<LibraryState>);
  } catch {
    return null;
  }
}

async function readLibraryState(appDataDir: string): Promise<LibraryState> {
  const persisted = await readPersistedLibraryState(appDataDir);
  if (persisted) {
    return persisted;
  }

  return emptyLibraryState();
}

export async function readCurrentIndexPath(appDataDir: string): Promise<string | null> {
  const state = await readLibraryState(appDataDir);
  return state.currentPath;
}

export async function persistIndexPath(appDataDir: string, indexPath: string): Promise<void> {
  const state = await readLibraryState(appDataDir);
  await persistLibraryState(appDataDir, {
    ...state,
    currentPath: indexPath,
    recentPaths: [indexPath, ...state.recentPaths],
  });
}

export async function readRecentIndexPaths(appDataDir: string): Promise<string[]> {
  const state = await readLibraryState(appDataDir);
  const currentPath = state.currentPath;
  return state.recentPaths.filter((candidate) => candidate !== currentPath);
}

export async function persistRecentIndexPaths(
  appDataDir: string,
  indexPaths: string[],
): Promise<string[]> {
  const state = await readLibraryState(appDataDir);
  const persisted = await persistLibraryState(appDataDir, {
    ...state,
    recentPaths: state.currentPath ? [state.currentPath, ...indexPaths] : indexPaths,
  });
  return persisted.recentPaths;
}

export async function rememberRecentIndexPaths(
  appDataDir: string,
  indexPaths: string[],
): Promise<string[]> {
  const state = await readLibraryState(appDataDir);
  const persisted = await persistLibraryState(appDataDir, {
    ...state,
    recentPaths: state.currentPath
      ? [state.currentPath, ...indexPaths, ...state.recentPaths]
      : [...indexPaths, ...state.recentPaths],
  });
  return persisted.recentPaths;
}

export async function resolveInitialIndexPath(appDataDir: string): Promise<string> {
  const persisted = await readCurrentIndexPath(appDataDir);
  const indexPath = persisted ?? getDefaultIndexPath();
  await fs.mkdir(indexPath, { recursive: true });
  await ensureStorageDirs(indexPath);
  if (!persisted) {
    await persistIndexPath(appDataDir, indexPath);
  }
  return indexPath;
}

export function isPathAllowedForRead(
  filePath: string,
  indexPaths: string[],
  additionalRoots: string[] = [],
): boolean {
  const thumbnailRoots = indexPaths.map(getThumbnailRoot);
  return (
    isInsideAnyPath(filePath, indexPaths) ||
    isInsideAnyPath(filePath, thumbnailRoots) ||
    isInsideAnyPath(filePath, additionalRoots)
  );
}

function resolveIndexPath(indexPaths: string[], filePath: string): string | null {
  return indexPaths.find((candidate) => pathHasPrefix(filePath, candidate)) ?? null;
}

function canBuildThumbnail(ext: string): boolean {
  return getThumbnailGenerationRuntimeForExt(normalizeThumbnailExt(ext)) === "main";
}

async function ensurePdfJsModule(): Promise<void> {
  if (!pdfJsModuleReady) {
    pdfJsModuleReady = definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  }
  await pdfJsModuleReady;
}

async function buildImageThumbnailBuffer(filePath: string): Promise<Buffer> {
  return sharp(filePath, { animated: false })
    .rotate()
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
}

async function buildPdfThumbnailBuffer(filePath: string): Promise<Buffer> {
  await ensurePdfJsModule();
  const pdfBuffer = new Uint8Array(await fs.readFile(filePath));
  const renderedPage = await renderPageAsImage(pdfBuffer, 1, {
    canvasImport: () => import("@napi-rs/canvas"),
    width: THUMBNAIL_MAX_EDGE,
  });
  return sharp(Buffer.from(renderedPage))
    .rotate()
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
}

async function buildPsdThumbnailBuffer(filePath: string): Promise<Buffer> {
  const source = await fs.readFile(filePath);
  const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const psd = getPsdParser().parse(arrayBuffer);
  const composite = await psd.composite();

  return sharp(Buffer.from(composite), {
    raw: {
      width: psd.width,
      height: psd.height,
      channels: 4,
    },
  })
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
}

async function buildThumbnailBuffer(filePath: string, ext: string): Promise<Buffer> {
  const normalizedExt = normalizeThumbnailExt(ext);
  if (normalizedExt === "pdf") {
    return buildPdfThumbnailBuffer(filePath);
  }
  if (normalizedExt === "psd") {
    return buildPsdThumbnailBuffer(filePath);
  }
  return buildImageThumbnailBuffer(filePath);
}

export function getThumbnailCachePath(
  indexPaths: string[],
  filePath: string,
  contentHash?: string | null,
): string | null {
  const indexPath = resolveIndexPath(indexPaths, filePath);
  if (!indexPath) {
    return null;
  }

  const cacheKey = resolveThumbnailCacheKey(path.resolve(filePath), contentHash);
  return path.join(getThumbnailRoot(indexPath), `${cacheKey}.webp`);
}

export function hasThumbnailCachePath(
  indexPaths: string[],
  filePath: string,
  contentHash?: string | null,
): string | null {
  const cachePath = getThumbnailCachePath(indexPaths, filePath, contentHash);
  if (!cachePath || !fssync.existsSync(cachePath)) {
    return null;
  }
  return cachePath;
}

export async function getOrCreateThumbnail(
  indexPaths: string[],
  input: {
    filePath: string;
    ext: string;
    contentHash?: string | null;
  },
): Promise<string | null> {
  const thumbnailPath = getThumbnailCachePath(indexPaths, input.filePath, input.contentHash);
  if (!thumbnailPath || !canBuildThumbnail(input.ext)) {
    return null;
  }

  if (fssync.existsSync(thumbnailPath)) {
    return thumbnailPath;
  }

  const cacheKey = resolveThumbnailCacheKey(path.resolve(input.filePath), input.contentHash);
  const pendingTask = thumbnailBuildTasks.get(cacheKey);
  if (pendingTask) {
    return pendingTask;
  }

  const task = fs
    .mkdir(path.dirname(thumbnailPath), { recursive: true })
    .then(async () => {
      const thumbnailBuffer = await buildThumbnailBuffer(input.filePath, input.ext);
      await fs.writeFile(thumbnailPath, thumbnailBuffer);
      return thumbnailPath;
    })
    .catch((error) => {
      console.error("[thumbnail] build failed", {
        filePath: input.filePath,
        ext: input.ext,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    })
    .finally(() => {
      thumbnailBuildTasks.delete(cacheKey);
    });

  thumbnailBuildTasks.set(cacheKey, task);
  return task;
}

export async function removeThumbnailForFile(
  indexPaths: string[],
  filePath: string,
  contentHash?: string | null,
): Promise<void> {
  const cachePath = getThumbnailCachePath(indexPaths, filePath, contentHash);
  if (cachePath) {
    await fs.rm(cachePath, { force: true }).catch(() => undefined);
  }
}
