import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {
  adjustFolderTrashEntryFileCount,
  deleteFolderRecord,
  deleteFolderTrashEntry,
  getAllFolders,
  getAllFoldersIncludingDeleted,
  getDeleteMode,
  getFileById,
  getFolderById,
  getFolderByIdIncludingDeleted,
  getFolderTrashEntry,
  getIndexPaths,
  getOrCreateFolder,
  moveFileWithFallback,
  permanentDeleteFileRecord,
  resolveAvailableTargetPath,
  restoreFileRecord,
  restoreFolderSubtreeRecords,
  softDeleteFile,
  updateFilePathAndFolder,
} from "../database";
import { pathHasPrefix, replacePathPrefix } from "../path-utils";
import { removeThumbnailForFile } from "../storage";
import { getDeletedFolderHoldingDir } from "../trash-paths";
import type { AppState, FolderRecord } from "../types";
import { getTargetDir, importBytes, postImport } from "./import-service";

export async function ensureDeletedFolderHoldingDir(appDataDir: string): Promise<string> {
  const dir = getDeletedFolderHoldingDir(appDataDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function getFilesUnderFolderPath(
  db: AppState["db"],
  folderPath: string,
): Array<{ id: number; path: string; contentHash: string | null }> {
  const rows = db.prepare("SELECT id, path, content_hash FROM files").all() as Array<{
    id: number;
    path: string;
    content_hash: string | null;
  }>;
  return rows
    .filter((row) => pathHasPrefix(row.path, folderPath))
    .map((row) => ({
      id: row.id,
      path: row.path,
      contentHash: row.content_hash ?? null,
    }));
}

export function getFoldersUnderFolderPath(
  db: AppState["db"],
  folderPath: string,
  includeDeleted = false,
): FolderRecord[] {
  const folders = includeDeleted ? getAllFoldersIncludingDeleted(db) : getAllFolders(db);
  return folders.filter((folder) => pathHasPrefix(folder.path, folderPath));
}

function findTrashedFolderForPath(
  state: AppState,
  filePath: string,
): {
  folderId: number;
  originalPath: string;
  tempPath: string;
  sourcePath: string;
} | null {
  const rows = state.db
    .prepare(
      `SELECT f.id, f.path, te.temp_path
     FROM folders f
     INNER JOIN folder_trash_entries te ON te.folder_id = f.id
     WHERE f.deleted_at IS NOT NULL`,
    )
    .all() as Array<{ id: number; path: string; temp_path: string }>;
  for (const row of rows) {
    const sourcePath = replacePathPrefix(filePath, row.path, row.temp_path);
    if (sourcePath) {
      return {
        folderId: row.id,
        originalPath: row.path,
        tempPath: row.temp_path,
        sourcePath,
      };
    }
  }
  return null;
}

function normalizeFolderRestoreName(name: string, suffix?: number): string {
  if (!suffix || suffix <= 1) {
    return `${name} (已恢复)`;
  }
  return `${name} (已恢复 ${suffix})`;
}

function resolveAvailableFolderRestorePath(indexPath: string, originalPath: string): string {
  const originalParent = path.dirname(originalPath);
  const originalName = path.basename(originalPath);
  const restoreParent = pathHasPrefix(originalParent, indexPath) ? originalParent : indexPath;

  const direct = path.join(restoreParent, originalName);
  if (!fssync.existsSync(direct)) {
    return direct;
  }

  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = path.join(restoreParent, normalizeFolderRestoreName(originalName, attempt));
    if (!fssync.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("无法为恢复的文件夹找到可用路径");
}

export async function moveDirectoryWithFallback(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

export async function permanentlyDeleteTrashedFolder(
  state: AppState,
  folderId: number,
): Promise<{ removedFileCount: number }> {
  const folder = getFolderByIdIncludingDeleted(state.db, folderId);
  const trashEntry = getFolderTrashEntry(state.db, folderId);
  if (!folder || !trashEntry) {
    return { removedFileCount: 0 };
  }

  const affectedFiles = getFilesUnderFolderPath(state.db, folder.path);
  for (const file of affectedFiles) {
    await removeThumbnailForFile(getIndexPaths(state.db), file.path, file.contentHash);
    permanentDeleteFileRecord(state.db, file.id);
  }

  deleteFolderTrashEntry(state.db, folderId);
  deleteFolderRecord(state.db, folderId);
  await fs.rm(trashEntry.tempPath, { recursive: true, force: true }).catch(() => undefined);
  return { removedFileCount: affectedFiles.length };
}

export async function restoreTrashedFolder(
  state: AppState,
  folderId: number,
): Promise<{ restoredPath: string; originalPath: string }> {
  const folder = getFolderByIdIncludingDeleted(state.db, folderId);
  const trashEntry = getFolderTrashEntry(state.db, folderId);
  if (!folder || !trashEntry) {
    throw new Error("找不到已删除的文件夹");
  }

  const indexPath = getIndexPaths(state.db)[0] ?? state.indexPath;
  const restoredPath = resolveAvailableFolderRestorePath(indexPath, folder.path);
  await fs.mkdir(path.dirname(restoredPath), { recursive: true });
  await moveDirectoryWithFallback(trashEntry.tempPath, restoredPath);
  const restoredParentId = getOrCreateFolder(
    state.db,
    path.dirname(restoredPath),
    getIndexPaths(state.db),
  );
  restoreFolderSubtreeRecords(state.db, {
    folderId,
    originalPath: folder.path,
    restoredPath,
    rootParentId: restoredParentId,
  });
  deleteFolderTrashEntry(state.db, folderId);
  return {
    restoredPath,
    originalPath: folder.path,
  };
}

export function appDocumentsDir(): string {
  return app.getPath("documents");
}

export async function copyOneFile(
  state: AppState,
  window: BrowserWindow | null,
  fileId: number,
  targetFolderId: number | null,
): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) throw new Error("File not found");
  const targetDir = getTargetDir(state, targetFolderId);
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = await resolveAvailableTargetPath(
    state.db,
    file.path,
    targetDir,
    null,
    "copy",
    false,
  );
  const bytes = await fs.readFile(file.path);
  const imported = await importBytes(state, {
    bytes,
    folderId: targetFolderId,
    fallbackExt: file.ext,
    targetPath,
    rating: file.rating,
    description: file.description,
    sourceUrl: file.sourceUrl,
    tagIds: file.tags.map((tag) => tag.id),
  });
  postImport(state, window, imported);
}

export async function moveOneFile(
  state: AppState,
  fileId: number,
  targetFolderId: number | null,
): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) throw new Error("File not found");
  const targetDir = getTargetDir(state, targetFolderId);
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = await resolveAvailableTargetPath(
    state.db,
    file.path,
    targetDir,
    fileId,
    "moved",
    true,
  );
  if (path.resolve(targetPath) !== path.resolve(file.path) && fssync.existsSync(file.path)) {
    await moveFileWithFallback(file.path, targetPath);
  }
  updateFilePathAndFolder(state.db, fileId, targetPath, targetFolderId);
}

export async function deleteFileCommand(state: AppState, fileId: number): Promise<void> {
  if (getDeleteMode(state.db)) {
    softDeleteFile(state.db, fileId);
  } else {
    await permanentDeleteOneFile(state, fileId);
  }
}

export async function restoreOneFile(
  state: AppState,
  fileId: number,
): Promise<{ movedToUnclassified: boolean }> {
  const file = getFileById(state.db, fileId);
  if (!file) {
    return { movedToUnclassified: false };
  }

  const trashedFolder = findTrashedFolderForPath(state, file.path);
  if (trashedFolder) {
    const root = getIndexPaths(state.db)[0] ?? state.indexPath;
    const targetPath = await resolveAvailableTargetPath(
      state.db,
      file.path,
      root,
      fileId,
      "restored",
      false,
    );
    if (fssync.existsSync(trashedFolder.sourcePath)) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await moveFileWithFallback(trashedFolder.sourcePath, targetPath);
    }
    adjustFolderTrashEntryFileCount(state.db, trashedFolder.folderId, -1);
    updateFilePathAndFolder(state.db, fileId, targetPath, null);
    restoreFileRecord(state.db, fileId);
    return { movedToUnclassified: true };
  }

  let movedToUnclassified = false;
  if (file.folderId !== null && !getFolderById(state.db, file.folderId)) {
    const root = getIndexPaths(state.db)[0] ?? state.indexPath;
    const targetPath = await resolveAvailableTargetPath(
      state.db,
      file.path,
      root,
      fileId,
      "restored",
      false,
    );
    if (fssync.existsSync(file.path) && path.resolve(file.path) !== path.resolve(targetPath)) {
      await moveFileWithFallback(file.path, targetPath);
    }
    updateFilePathAndFolder(state.db, fileId, targetPath, null);
    movedToUnclassified = true;
  }
  restoreFileRecord(state.db, fileId);
  return { movedToUnclassified };
}

export async function permanentDeleteOneFile(state: AppState, fileId: number): Promise<void> {
  const file = getFileById(state.db, fileId);
  if (!file) return;
  await removeThumbnailForFile(getIndexPaths(state.db), file.path, file.contentHash);
  const trashedFolder = findTrashedFolderForPath(state, file.path);
  if (trashedFolder && fssync.existsSync(trashedFolder.sourcePath)) {
    await fs.rm(trashedFolder.sourcePath, { force: true }).catch(() => undefined);
    adjustFolderTrashEntryFileCount(state.db, trashedFolder.folderId, -1);
  }
  permanentDeleteFileRecord(state.db, fileId);
  await fs.rm(file.path, { force: true }).catch(() => undefined);
}
