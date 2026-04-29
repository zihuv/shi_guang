import { BrowserWindow } from "electron";
import log from "electron-log/main";
import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {
  filePathsInDir,
  findMoveCandidateByContentHash,
  getFileById,
  getFileByPath,
  getIndexPaths,
  getOrCreateFolder,
  isFileUnchanged,
  markFileMissingByPath,
  updateFileBasicInfo,
  updateFileColorData,
  updateFilePathAndFolder,
  upsertFile,
} from "../database";
import {
  detectExtensionFromPath,
  isBlockedUnsupportedExtension,
  isScanSupportedExtension,
} from "../media";
import { isHiddenName } from "../path-utils";
import { removeThumbnailForFile } from "../storage";
import {
  classifyExistingPathSync,
  shouldUseMoveCandidate,
  type LibrarySyncChangeKind,
} from "../library-sync-logic";
import type { AppState } from "../types";
import { emit, type GetWindow } from "./common";
import {
  buildFileInputFromPath,
  normalizeImportExtension,
  runPostImportPipeline,
  timestampFromStats,
} from "./import-service";

let libraryWatcher: FSWatcher | null = null;
let librarySyncQueue = Promise.resolve();
let librarySyncFlushTimer: NodeJS.Timeout | null = null;
let librarySyncScanTimer: NodeJS.Timeout | null = null;
let lastLibrarySyncScanAt = 0;
const pendingLibraryUnlinks = new Map<string, NodeJS.Timeout>();
const pendingLibraryChanges = new Map<string, NodeJS.Timeout>();

interface LibrarySyncSummary {
  added: number;
  updated: number;
  removed: number;
  moved: number;
  skipped: number;
  scanned: number;
  errorCount: number;
}

function emptyLibrarySyncSummary(): LibrarySyncSummary {
  return {
    added: 0,
    updated: 0,
    removed: 0,
    moved: 0,
    skipped: 0,
    scanned: 0,
    errorCount: 0,
  };
}

const pendingLibrarySyncSummary = emptyLibrarySyncSummary();

function hasLibrarySyncChanges(summary: LibrarySyncSummary): boolean {
  return (
    summary.added > 0 ||
    summary.updated > 0 ||
    summary.removed > 0 ||
    summary.moved > 0 ||
    summary.errorCount > 0
  );
}

function recordLibrarySyncChange(
  window: BrowserWindow | null,
  kind: LibrarySyncChangeKind,
  scanned = 1,
): void {
  pendingLibrarySyncSummary.scanned += scanned;
  if (kind === "added") pendingLibrarySyncSummary.added += 1;
  if (kind === "updated") pendingLibrarySyncSummary.updated += 1;
  if (kind === "removed") pendingLibrarySyncSummary.removed += 1;
  if (kind === "moved") pendingLibrarySyncSummary.moved += 1;
  if (kind === "skipped") pendingLibrarySyncSummary.skipped += 1;

  if (librarySyncFlushTimer) {
    return;
  }
  librarySyncFlushTimer = setTimeout(() => {
    librarySyncFlushTimer = null;
    const summary = { ...pendingLibrarySyncSummary };
    Object.assign(pendingLibrarySyncSummary, emptyLibrarySyncSummary());
    if (hasLibrarySyncChanges(summary)) {
      emit(window, "library-sync-updated", summary);
    }
  }, 500);
}

export async function scanFoldersOnly(state: AppState, rootPath: string): Promise<number> {
  const indexPaths = getIndexPaths(state.db);
  let count = 0;

  async function visit(dir: string, depth: number): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || isHiddenName(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (depth >= 0) {
        getOrCreateFolder(state.db, child, indexPaths);
        count += 1;
      }
      await visit(child, depth + 1);
    }
  }

  await visit(rootPath, 0);
  return count;
}

async function waitForStableFile(filePath: string): Promise<boolean> {
  let previousSize = -1;
  let previousMtimeMs = -1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || stats.size <= 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (stats.size === previousSize && stats.mtimeMs === previousMtimeMs) {
        return true;
      }
      previousSize = stats.size;
      previousMtimeMs = stats.mtimeMs;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function syncExistingPath(
  state: AppState,
  filePath: string,
  window: BrowserWindow | null,
  knownExt?: string,
): Promise<LibrarySyncChangeKind> {
  let stats: fssync.Stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return "skipped";
  }
  if (!stats.isFile() || stats.size <= 0 || isHiddenName(path.basename(filePath))) {
    return "skipped";
  }

  const pathExt = normalizeImportExtension(path.extname(filePath));
  if (isBlockedUnsupportedExtension(pathExt)) {
    return "skipped";
  }

  const detectedExt = normalizeImportExtension(
    knownExt ?? (await detectExtensionFromPath(filePath)) ?? pathExt,
  );
  if (!isScanSupportedExtension(detectedExt)) {
    return "skipped";
  }

  const existing = getFileByPath(state.db, filePath);
  if (existing) {
    if (existing.deletedAt) {
      return "skipped";
    }
    const fsModifiedAt = timestampFromStats(stats, "mtime");
    if (
      !existing.missingAt &&
      isFileUnchanged(state.db, filePath, detectedExt, stats.size, fsModifiedAt)
    ) {
      return "skipped";
    }
  }

  const indexPaths = getIndexPaths(state.db);
  const folderId = getOrCreateFolder(state.db, path.dirname(filePath), indexPaths);
  const input = await buildFileInputFromPath(filePath, folderId);

  if (existing) {
    const kind = classifyExistingPathSync(existing, false);
    if (kind === "skipped") {
      return "skipped";
    }
    if (existing.contentHash && existing.contentHash !== input.contentHash) {
      await removeThumbnailForFile(indexPaths, filePath, {
        contentHash: existing.contentHash,
        size: existing.size,
        modifiedAt: existing.modifiedAt,
      });
    } else if (!existing.contentHash) {
      await removeThumbnailForFile(indexPaths, filePath, {
        contentHash: existing.contentHash,
        size: existing.size,
        modifiedAt: existing.modifiedAt,
      });
    }
    updateFileBasicInfo(state.db, input);
    const updatedFile = getFileByPath(state.db, filePath);
    if (updatedFile) {
      updateFileColorData(
        state.db,
        updatedFile.id,
        input.dominantColor ?? "",
        input.colorDistribution ?? "[]",
      );
      runPostImportPipeline(state, window, updatedFile, {
        source: "library_sync",
        notify: false,
        autoAnalyzeMetadata: false,
      });
    }
    return kind;
  }

  const moveCandidate = input.contentHash
    ? findMoveCandidateByContentHash(state.db, input.contentHash)
    : null;
  if (
    moveCandidate &&
    shouldUseMoveCandidate(moveCandidate, filePath, fssync.existsSync(moveCandidate.path))
  ) {
    updateFilePathAndFolder(state.db, moveCandidate.id, filePath, folderId);
    updateFileBasicInfo(state.db, input);
    const movedFile = getFileById(state.db, moveCandidate.id);
    if (movedFile) {
      runPostImportPipeline(state, window, movedFile, {
        source: "library_sync",
        notify: false,
        autoAnalyzeMetadata: false,
      });
    }
    return "moved";
  }

  const fileId = upsertFile(state.db, input);
  const file = getFileById(state.db, fileId);
  if (file) {
    runPostImportPipeline(state, window, file, {
      source: "library_sync",
      notify: false,
      autoAnalyzeMetadata: false,
    });
  }
  return "added";
}

export async function scanIndexPath(
  state: AppState,
  rootPath: string,
  window: BrowserWindow | null = null,
): Promise<number> {
  const existing = filePathsInDir(state.db, rootPath);
  const processed = new Set<string>();
  const summary = emptyLibrarySyncSummary();

  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isHiddenName(entry.name)) continue;
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!entry.isFile()) continue;

      const pathExt = normalizeImportExtension(path.extname(candidate));
      if (isBlockedUnsupportedExtension(pathExt)) continue;

      const ext = normalizeImportExtension((await detectExtensionFromPath(candidate)) ?? pathExt);
      if (!isScanSupportedExtension(ext)) continue;
      processed.add(candidate);
      const kind = await syncExistingPath(state, candidate, window, ext);
      recordLibrarySyncChange(window, kind);
      if (kind === "added") summary.added += 1;
      if (kind === "updated") summary.updated += 1;
      if (kind === "moved") summary.moved += 1;
      if (kind === "skipped") summary.skipped += 1;
      summary.scanned += 1;
    }
  }

  await visit(rootPath);
  for (const stalePath of [...existing].filter((item) => !processed.has(item))) {
    if (markFileMissingByPath(state.db, stalePath)) {
      summary.removed += 1;
      recordLibrarySyncChange(window, "removed");
    }
  }
  return summary.added;
}

function queueLibrarySyncTask(task: () => Promise<void>): void {
  librarySyncQueue = librarySyncQueue
    .then(task)
    .catch((error) => log.warn("[library-sync] task failed", error));
}

function queueLibraryPathSync(
  state: AppState,
  getWindow: GetWindow,
  filePath: string,
  delay = 700,
): void {
  const existingTimer = pendingLibraryChanges.get(filePath);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    pendingLibraryChanges.delete(filePath);
    queueLibrarySyncTask(async () => {
      const stable = await waitForStableFile(filePath);
      if (!stable) {
        recordLibrarySyncChange(getWindow(), "skipped");
        return;
      }
      const kind = await syncExistingPath(state, filePath, getWindow());
      recordLibrarySyncChange(getWindow(), kind);
    });
  }, delay);
  pendingLibraryChanges.set(filePath, timer);
}

function queueLibraryPathMissing(state: AppState, getWindow: GetWindow, filePath: string): void {
  const existingTimer = pendingLibraryUnlinks.get(filePath);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    pendingLibraryUnlinks.delete(filePath);
    queueLibrarySyncTask(async () => {
      if (fssync.existsSync(filePath)) {
        queueLibraryPathSync(state, getWindow, filePath, 0);
        return;
      }
      if (markFileMissingByPath(state.db, filePath)) {
        recordLibrarySyncChange(getWindow(), "removed");
      }
    });
  }, 3000);
  pendingLibraryUnlinks.set(filePath, timer);
}

function scheduleLibraryScan(
  state: AppState,
  getWindow: GetWindow,
  reason: "startup" | "focus" | "manual",
): void {
  if (librarySyncScanTimer) {
    clearTimeout(librarySyncScanTimer);
  }
  const now = Date.now();
  if (reason === "focus" && now - lastLibrarySyncScanAt < 60_000) {
    return;
  }
  librarySyncScanTimer = setTimeout(
    () => {
      librarySyncScanTimer = null;
      lastLibrarySyncScanAt = Date.now();
      queueLibrarySyncTask(async () => {
        emit(getWindow(), "library-sync-status", { status: "running", reason });
        try {
          let total = 0;
          for (const indexPath of getIndexPaths(state.db)) {
            total += await scanIndexPath(state, indexPath, getWindow());
          }
          emit(getWindow(), "library-sync-status", { status: "idle", reason, total });
        } catch (error) {
          recordLibrarySyncChange(getWindow(), "skipped");
          pendingLibrarySyncSummary.errorCount += 1;
          log.warn("[library-sync] scan failed", error);
          emit(getWindow(), "library-sync-status", {
            status: "error",
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    reason === "startup" ? 1000 : 300,
  );
}

export function requestLibrarySyncScan(
  state: AppState,
  getWindow: GetWindow,
  reason: "startup" | "focus" | "manual" = "manual",
): void {
  scheduleLibraryScan(state, getWindow, reason);
}

export function startLibrarySyncService(state: AppState, getWindow: GetWindow): void {
  if (libraryWatcher) {
    return;
  }
  const indexPaths = getIndexPaths(state.db);
  if (!indexPaths.length) {
    return;
  }

  libraryWatcher = chokidar.watch(indexPaths, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 800,
      pollInterval: 150,
    },
    ignored: (candidate) => isHiddenName(path.basename(candidate)),
  });

  libraryWatcher
    .on("add", (filePath) => queueLibraryPathSync(state, getWindow, filePath))
    .on("change", (filePath) => queueLibraryPathSync(state, getWindow, filePath))
    .on("unlink", (filePath) => queueLibraryPathMissing(state, getWindow, filePath))
    .on("addDir", (dirPath) => {
      if (isHiddenName(path.basename(dirPath))) {
        return;
      }
      const indexPaths = getIndexPaths(state.db);
      getOrCreateFolder(state.db, dirPath, indexPaths);
      recordLibrarySyncChange(getWindow(), "updated");
    })
    .on("unlinkDir", (dirPath) => {
      for (const file of filePathsInDir(state.db, dirPath)) {
        queueLibraryPathMissing(state, getWindow, file);
      }
      recordLibrarySyncChange(getWindow(), "updated");
    })
    .on("error", (error) => {
      pendingLibrarySyncSummary.errorCount += 1;
      recordLibrarySyncChange(getWindow(), "skipped");
      log.warn("[library-sync] watcher error", error);
    });

  scheduleLibraryScan(state, getWindow, "startup");
}
