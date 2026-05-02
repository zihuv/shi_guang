import fs from "node:fs/promises";
import fssync from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import {
  addTagToFile,
  currentTimestamp,
  getFileById,
  getFileByPath,
  getFolderById,
  getIndexPaths,
  upsertFile,
  type UpsertFileInput,
} from "../database";
import {
  buildThumbHash,
  canBackendDecodeImage,
  computeVisualContentHash,
  detectExtensionFromBytes,
  detectExtensionFromPath,
  extractColorDistributionFromInput,
  getImageDimensions,
  isBlockedUnsupportedExtension,
  isScanSupportedExtension,
} from "../media";
import type { AppState, FileRecord } from "../types";
import { copyFileWithCloneFallback, ensureDir } from "../file-operations";
import { taskId } from "./common";

const recentImports = new Map<string, number>();
const pendingImportTargetPaths = new Set<string>();

export async function collectFilesFromDirectory(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectFilesFromDirectory(fullPath);
      results.push(...sub);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
      if (ext && isScanSupportedExtension(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export async function collectFilesFromDirectoryWithRel(
  dirPath: string,
  basePath?: string,
): Promise<Array<{ abs: string; relDir: string }>> {
  const base = basePath ?? dirPath;
  const results: Array<{ abs: string; relDir: string }> = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectFilesFromDirectoryWithRel(fullPath, base);
      results.push(...sub);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
      if (ext && isScanSupportedExtension(ext)) {
        const relDir = path.relative(base, path.dirname(fullPath));
        results.push({ abs: fullPath, relDir });
      }
    }
  }
  return results;
}

export function timestampFromStats(stats: Stats, key: "birthtime" | "mtime"): string {
  const value = key === "birthtime" ? stats.birthtime : stats.mtime;
  return currentTimestamp(Number.isFinite(value.getTime()) ? value : new Date());
}

export function normalizeImportExtension(ext: string | null | undefined): string {
  const normalized = ext?.trim().replace(/^\./, "").toLowerCase();
  return normalized || "bin";
}

function fallbackExtensionFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).replace(/^\./, "").trim().toLowerCase();
  return ext || null;
}

function assertSupportedImportExtension(ext: string): void {
  if (!isScanSupportedExtension(ext)) {
    throw new Error(`不支持的文件格式: ${ext.toUpperCase()}`);
  }
}

function assertFallbackExtensionAllowed(ext: string | null | undefined): void {
  const normalized = normalizeImportExtension(ext);
  if (normalized !== "bin" && isBlockedUnsupportedExtension(normalized)) {
    throw new Error(`不支持的文件格式: ${normalized.toUpperCase()}`);
  }
}

function generatedImportName(prefix: string | null, ext: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const id = taskId();
  return prefix ? `${prefix}_${stamp}_${id}.${ext}` : `${stamp}_${id}.${ext}`;
}

export function getTargetDir(state: AppState, folderId: number | null): string {
  if (folderId !== null) {
    const folder = getFolderById(state.db, folderId);
    if (folder) {
      return folder.path;
    }
  }
  const indexPath = getIndexPaths(state.db)[0] ?? state.indexPath;
  return indexPath;
}

export async function buildFileInputFromPath(
  filePath: string,
  folderId: number | null,
  knownBytes?: Buffer,
  options: {
    includeExpensiveMetadata?: boolean;
  } = {},
): Promise<UpsertFileInput> {
  const stats = await fs.stat(filePath);
  const ext = normalizeImportExtension(
    (knownBytes ? detectExtensionFromBytes(knownBytes) : await detectExtensionFromPath(filePath)) ??
      fallbackExtensionFromPath(filePath),
  );
  assertSupportedImportExtension(ext);
  const canExtractVisualMetadata = canBackendDecodeImage(ext);
  const dimensions = canExtractVisualMetadata
    ? await getImageDimensions(filePath, ext)
    : { width: 0, height: 0 };
  const includeExpensiveMetadata = options.includeExpensiveMetadata !== false;
  const colors =
    canExtractVisualMetadata && includeExpensiveMetadata
      ? await extractColorDistributionFromInput(filePath)
      : [];
  const dominantColor = colors[0]?.color ?? "";
  const contentHash =
    canExtractVisualMetadata && includeExpensiveMetadata
      ? await computeVisualContentHash(filePath)
      : null;
  const thumbHash =
    canExtractVisualMetadata && includeExpensiveMetadata ? await buildThumbHash(filePath, ext) : "";
  return {
    path: filePath,
    name: path.basename(filePath),
    ext,
    size: stats.size,
    width: dimensions.width,
    height: dimensions.height,
    folderId,
    createdAt: timestampFromStats(stats, "birthtime"),
    modifiedAt: timestampFromStats(stats, "mtime"),
    dominantColor,
    colorDistribution: JSON.stringify(colors),
    thumbHash,
    contentHash,
  };
}

export async function importExistingFilePath(
  state: AppState,
  request: {
    filePath: string;
    folderId: number | null;
    createdAt?: string;
    modifiedAt?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
    includeExpensiveMetadata?: boolean;
  },
): Promise<FileRecord> {
  const input = await buildFileInputFromPath(request.filePath, request.folderId, undefined, {
    includeExpensiveMetadata: request.includeExpensiveMetadata,
  });
  const fileId = upsertFile(state.db, {
    ...input,
    createdAt: request.createdAt ?? input.createdAt,
    modifiedAt: request.modifiedAt ?? input.modifiedAt,
    rating: request.rating,
    description: request.description,
    sourceUrl: request.sourceUrl,
  });
  for (const tagId of new Set(request.tagIds ?? [])) {
    addTagToFile(state.db, fileId, tagId);
  }
  return getFileById(state.db, fileId) as FileRecord;
}

async function resolveImportTargetPath(
  state: AppState,
  sourcePath: string,
  folderId: number | null,
): Promise<string> {
  const targetDir = getTargetDir(state, folderId);
  await ensureDir(targetDir);

  const hasConflict = (candidate: string) => {
    const resolved = path.resolve(candidate);
    return (
      pendingImportTargetPaths.has(resolved) ||
      fssync.existsSync(candidate) ||
      Boolean(getFileByPath(state.db, candidate))
    );
  };

  const desiredPath = path.join(targetDir, path.basename(sourcePath));
  if (!hasConflict(desiredPath)) {
    pendingImportTargetPaths.add(path.resolve(desiredPath));
    return desiredPath;
  }

  const ext = path.extname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = path.join(
      targetDir,
      `${stem}_import_${Date.now().toString(16)}_${attempt}${ext}`,
    );
    if (!hasConflict(candidate)) {
      pendingImportTargetPaths.add(path.resolve(candidate));
      return candidate;
    }
  }

  throw new Error("Failed to resolve available import target path");
}

async function importFileFromPath(
  state: AppState,
  request: {
    sourcePath: string;
    folderId: number | null;
    fallbackExt?: string | null;
    createdAt?: string;
    modifiedAt?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const detectedExt = await detectExtensionFromPath(request.sourcePath);
  const recordExt = normalizeImportExtension(
    detectedExt ?? request.fallbackExt ?? fallbackExtensionFromPath(request.sourcePath),
  );
  assertSupportedImportExtension(recordExt);
  const targetPath = await resolveImportTargetPath(state, request.sourcePath, request.folderId);
  const targetKey = path.resolve(targetPath);

  try {
    await copyFileWithCloneFallback(request.sourcePath, targetPath);
    return await importExistingFilePath(state, {
      filePath: targetPath,
      folderId: request.folderId,
      createdAt: request.createdAt,
      modifiedAt: request.modifiedAt,
      rating: request.rating,
      description: request.description,
      sourceUrl: request.sourceUrl,
      tagIds: request.tagIds,
      includeExpensiveMetadata: false,
    });
  } finally {
    pendingImportTargetPaths.delete(targetKey);
  }
}

export async function importBytes(
  state: AppState,
  request: {
    bytes: Buffer;
    folderId: number | null;
    fallbackExt?: string | null;
    targetPath?: string | null;
    namePrefix?: string | null;
    createdAt?: string;
    modifiedAt?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const detectedExt = detectExtensionFromBytes(request.bytes);
  assertFallbackExtensionAllowed(request.fallbackExt);
  const storageExt = normalizeImportExtension(detectedExt ?? request.fallbackExt);
  const recordExt = normalizeImportExtension(detectedExt ?? request.fallbackExt);
  assertSupportedImportExtension(recordExt);
  const targetPath =
    request.targetPath ??
    path.join(
      getTargetDir(state, request.folderId),
      generatedImportName(request.namePrefix ?? null, storageExt),
    );

  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, request.bytes);
  const stats = await fs.stat(targetPath);
  const canExtractVisualMetadata = canBackendDecodeImage(recordExt);
  const dimensions = canExtractVisualMetadata
    ? await getImageDimensions(targetPath, recordExt)
    : { width: 0, height: 0 };
  const fileId = upsertFile(state.db, {
    path: targetPath,
    name: path.basename(targetPath),
    ext: recordExt,
    size: stats.size,
    width: dimensions.width,
    height: dimensions.height,
    folderId: request.folderId,
    createdAt: request.createdAt ?? currentTimestamp(),
    modifiedAt: request.modifiedAt ?? currentTimestamp(),
    rating: request.rating ?? 0,
    description: request.description ?? "",
    sourceUrl: request.sourceUrl ?? "",
    dominantColor: "",
    colorDistribution: "[]",
    thumbHash: "",
    contentHash: null,
  });
  for (const tagId of new Set(request.tagIds ?? [])) {
    addTagToFile(state.db, fileId, tagId);
  }
  return getFileById(state.db, fileId) as FileRecord;
}

export async function importFilePath(
  state: AppState,
  sourcePath: string,
  folderId: number | null,
): Promise<FileRecord> {
  const now = Date.now();
  const recent = recentImports.get(sourcePath);
  if (recent && now - recent < 3000) {
    throw new Error("Duplicate import skipped");
  }
  recentImports.set(sourcePath, now);

  const stats = await fs.stat(sourcePath);
  if (!stats.isFile()) {
    throw new Error("Source file does not exist");
  }
  return importFileFromPath(state, {
    sourcePath,
    folderId,
    fallbackExt: path.extname(sourcePath),
    createdAt: timestampFromStats(stats, "birthtime"),
    modifiedAt: timestampFromStats(stats, "mtime"),
  });
}

export async function importClipboardFile(
  state: AppState,
  request: {
    sourcePath: string;
    folderId: number | null;
    ext?: string;
    rating?: number;
    description?: string;
    sourceUrl?: string;
    tagIds?: number[];
  },
): Promise<FileRecord> {
  const stats = await fs.stat(request.sourcePath);
  if (!stats.isFile()) {
    throw new Error("Clipboard source file does not exist");
  }

  return importFileFromPath(state, {
    sourcePath: request.sourcePath,
    folderId: request.folderId,
    fallbackExt: request.ext ?? path.extname(request.sourcePath),
    createdAt: timestampFromStats(stats, "birthtime"),
    modifiedAt: timestampFromStats(stats, "mtime"),
    rating: request.rating,
    description: request.description,
    sourceUrl: request.sourceUrl,
    tagIds: request.tagIds,
  });
}
