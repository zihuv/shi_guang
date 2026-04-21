import { app } from "electron";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { canBackendDecodeImage } from "./media";
import { isInsideAnyPath, pathHasPrefix } from "./path-utils";

const CURRENT_INDEX_PATH_FILE = "current-index-path.txt";
const THUMBNAIL_VERSION = "v3";
const DEFAULT_THUMBNAIL_MAX_EDGE = 320;

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
  return path.join(indexPath, ".shiguang", "thumbnails");
}

export async function readCurrentIndexPath(appDataDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(appDataDir, CURRENT_INDEX_PATH_FILE), "utf8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

export async function persistIndexPath(appDataDir: string, indexPath: string): Promise<void> {
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.writeFile(path.join(appDataDir, CURRENT_INDEX_PATH_FILE), indexPath, "utf8");
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

export function isPathAllowedForRead(filePath: string, indexPaths: string[]): boolean {
  const thumbnailRoots = indexPaths.map(getThumbnailRoot);
  return isInsideAnyPath(filePath, indexPaths) || isInsideAnyPath(filePath, thumbnailRoots);
}

function thumbnailHash(filePath: string, maxEdge: number): string {
  return crypto
    .createHash("sha256")
    .update(THUMBNAIL_VERSION)
    .update("\0")
    .update(path.resolve(filePath))
    .update("\0")
    .update(String(maxEdge))
    .digest("hex");
}

export function getThumbnailCachePath(
  indexPaths: string[],
  filePath: string,
  maxEdge = DEFAULT_THUMBNAIL_MAX_EDGE,
): string | null {
  const indexPath = indexPaths.find((candidate) => pathHasPrefix(filePath, candidate));
  if (!indexPath) {
    return null;
  }

  const hash = thumbnailHash(filePath, maxEdge);
  return path.join(getThumbnailRoot(indexPath), hash.slice(0, 2), `${hash}.webp`);
}

export async function getOrCreateThumbnail(
  indexPaths: string[],
  filePath: string,
  ext: string,
  maxEdge = DEFAULT_THUMBNAIL_MAX_EDGE,
): Promise<string | null> {
  const thumbnailPath = getThumbnailCachePath(indexPaths, filePath, maxEdge);
  if (!thumbnailPath || !canBackendDecodeImage(ext)) {
    return null;
  }

  if (fssync.existsSync(thumbnailPath)) {
    return thumbnailPath;
  }

  try {
    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
    await sharp(filePath, { animated: false })
      .rotate()
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .webp({ lossless: true, quality: 90 })
      .toFile(thumbnailPath);
    return thumbnailPath;
  } catch {
    return null;
  }
}

export async function removeThumbnailForFile(
  indexPaths: string[],
  filePath: string,
): Promise<void> {
  const maxEdges = [160, 224, 320, 448, 640];
  for (const indexPath of indexPaths) {
    for (const maxEdge of maxEdges) {
      const cachePath = getThumbnailCachePath([indexPath], filePath, maxEdge);
      if (cachePath) {
        await fs.rm(cachePath, { force: true }).catch(() => undefined);
      }
    }
  }
}
