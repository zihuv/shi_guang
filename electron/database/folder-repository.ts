import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import fssync from "node:fs";
import path from "node:path";
import { moveDirectoryWithFallback } from "../file-operations";
import { pathHasPrefix, replacePathPrefix } from "../path-utils";
import type { FolderRecord, FolderTreeNode } from "../types";
import { currentTimestamp, generateSyncId, normalizeStoredPath, toFolder } from "./shared";
import { getDrizzleDb } from "./client";
import { files, folders } from "./schema";
import { getIndexPaths } from "./settings-repository";

const folderRecordColumns = {
  id: folders.id,
  path: folders.path,
  name: folders.name,
  parent_id: folders.parentId,
  created_at: folders.createdAt,
  is_system: sql<number>`COALESCE(${folders.isSystem}, 0)`,
  sort_order: sql<number>`COALESCE(${folders.sortOrder}, 0)`,
  deleted_at: folders.deletedAt,
};

export function getAllFoldersIncludingDeleted(db: Database.Database): FolderRecord[] {
  return getDrizzleDb(db)
    .select(folderRecordColumns)
    .from(folders)
    .orderBy(folders.sortOrder, folders.createdAt)
    .all()
    .map(toFolder);
}

export function getAllFolders(db: Database.Database): FolderRecord[] {
  return getAllFoldersIncludingDeleted(db).filter((folder) => !folder.deletedAt);
}

export function getFolderByIdIncludingDeleted(
  db: Database.Database,
  id: number,
): FolderRecord | null {
  const row = getDrizzleDb(db)
    .select(folderRecordColumns)
    .from(folders)
    .where(eq(folders.id, id))
    .get();
  return row ? toFolder(row) : null;
}

export function getFolderById(db: Database.Database, id: number): FolderRecord | null {
  const folder = getFolderByIdIncludingDeleted(db, id);
  return folder && !folder.deletedAt ? folder : null;
}

export function getFolderByPathIncludingDeleted(
  db: Database.Database,
  folderPath: string,
): FolderRecord | null {
  const row = getDrizzleDb(db)
    .select(folderRecordColumns)
    .from(folders)
    .where(eq(folders.normalizedPath, normalizeStoredPath(folderPath)))
    .get();
  return row ? toFolder(row) : null;
}

export function getFolderByPath(db: Database.Database, folderPath: string): FolderRecord | null {
  const folder = getFolderByPathIncludingDeleted(db, folderPath);
  return folder && !folder.deletedAt ? folder : null;
}

export function createFolderRecord(
  db: Database.Database,
  folderPath: string,
  name: string,
  parentId: number | null,
  isSystem = false,
  sortOrder = 0,
): number {
  const timestamp = currentTimestamp();
  return getDrizzleDb(db)
    .insert(folders)
    .values({
      path: folderPath,
      normalizedPath: normalizeStoredPath(folderPath),
      name,
      parentId,
      createdAt: timestamp,
      isSystem: isSystem ? 1 : 0,
      sortOrder,
      syncId: generateSyncId("folder"),
      updatedAt: timestamp,
    })
    .returning({ id: folders.id })
    .get().id;
}

export function getPrependFolderSortOrder(db: Database.Database, parentId: number | null): number {
  const row = getDrizzleDb(db)
    .select({ sort_order: sql<number | null>`MIN(${folders.sortOrder})` })
    .from(folders)
    .where(
      parentId === null
        ? sql`${folders.parentId} IS NULL AND ${folders.deletedAt} IS NULL`
        : sql`${folders.parentId} = ${parentId} AND ${folders.deletedAt} IS NULL`,
    )
    .get();

  return typeof row?.sort_order === "number" ? row.sort_order - 1 : 0;
}

export function getOrCreateFolder(
  db: Database.Database,
  folderPath: string,
  indexPaths: string[],
): number | null {
  for (const indexPath of indexPaths) {
    if (!pathHasPrefix(folderPath, indexPath)) {
      continue;
    }

    if (path.resolve(folderPath) === path.resolve(indexPath)) {
      return null;
    }

    const existing = getFolderByPath(db, folderPath);
    if (existing) {
      return existing.id;
    }

    const parentPath = path.dirname(folderPath);
    const parentId =
      parentPath && parentPath !== folderPath
        ? getOrCreateFolder(db, parentPath, indexPaths)
        : null;
    return createFolderRecord(db, folderPath, path.basename(folderPath), parentId, false);
  }
  return null;
}

export function getFolderTree(db: Database.Database): FolderTreeNode[] {
  const folders = getAllFolders(db);
  const counts = new Map<number, number>(
    getDrizzleDb(db)
      .all<{ folder_id: number; count: number }>(sql`
        SELECT ${files.folderId} AS folder_id, COUNT(*) AS count
        FROM ${files}
        WHERE ${files.folderId} IS NOT NULL
          AND ${files.deletedAt} IS NULL
          AND ${files.missingAt} IS NULL
        GROUP BY ${files.folderId}
      `)
      .map((row) => [row.folder_id, row.count]),
  );
  const children = new Map<number | null, FolderRecord[]>();
  for (const folder of folders) {
    const list = children.get(folder.parent_id) ?? [];
    list.push(folder);
    children.set(folder.parent_id, list);
  }

  const build = (folder: FolderRecord): FolderTreeNode => {
    const nested = [...(children.get(folder.id) ?? [])].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"),
    );
    return {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      children: nested.map(build),
      fileCount: counts.get(folder.id) ?? 0,
      isSystem: folder.isSystem,
      sortOrder: folder.sortOrder,
      parentId: folder.parent_id,
    };
  };

  return [...(children.get(null) ?? [])]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"),
    )
    .map(build);
}

export async function renameFolder(db: Database.Database, id: number, name: string): Promise<void> {
  const folder = getFolderById(db, id);
  if (!folder) {
    throw new Error("Folder not found");
  }
  const oldPath = folder.path;
  const newPath = path.join(path.dirname(oldPath), name);
  if (fssync.existsSync(oldPath)) {
    await moveDirectoryWithFallback(oldPath, newPath);
  }
  getDrizzleDb(db).transaction((tx) => {
    tx.update(folders)
      .set({ name, path: newPath, normalizedPath: normalizeStoredPath(newPath) })
      .where(eq(folders.id, id))
      .run();
    const oldPathKey = normalizeStoredPath(oldPath);
    const subfolders = tx
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(
        sql`${folders.id} != ${id} AND (${folders.normalizedPath} = ${oldPathKey} OR ${folders.normalizedPath} LIKE ${`${oldPathKey}/%`})`,
      )
      .all();
    for (const subfolder of subfolders) {
      if (subfolder.id === id || !pathHasPrefix(subfolder.path, oldPath)) continue;
      const replaced = replacePathPrefix(subfolder.path, oldPath, newPath);
      if (replaced)
        tx.update(folders)
          .set({ path: replaced, normalizedPath: normalizeStoredPath(replaced) })
          .where(eq(folders.id, subfolder.id))
          .run();
    }
    const fileRows = tx
      .select({ id: files.id, path: files.path })
      .from(files)
      .where(
        sql`${files.normalizedPath} = ${oldPathKey} OR ${files.normalizedPath} LIKE ${`${oldPathKey}/%`}`,
      )
      .all();
    for (const file of fileRows) {
      if (!pathHasPrefix(file.path, oldPath)) continue;
      const replaced = replacePathPrefix(file.path, oldPath, newPath);
      if (replaced)
        tx.update(files)
          .set({ path: replaced, normalizedPath: normalizeStoredPath(replaced) })
          .where(eq(files.id, file.id))
          .run();
    }
  });
}

export async function moveFolderRecord(
  db: Database.Database,
  folderId: number,
  newParentId: number | null,
  sortOrder: number,
): Promise<void> {
  const folder = getFolderById(db, folderId);
  if (!folder) throw new Error("Folder not found");
  const indexPath = getIndexPaths(db)[0];
  const parentPath = newParentId ? getFolderById(db, newParentId)?.path : indexPath;
  if (!parentPath) throw new Error("No index path configured");
  const newPath = path.join(parentPath, folder.name);
  if (!fssync.existsSync(folder.path))
    throw new Error(`Source folder does not exist: ${folder.path}`);
  if (fssync.existsSync(newPath)) throw new Error(`Destination path already exists: ${newPath}`);
  await moveDirectoryWithFallback(folder.path, newPath);

  getDrizzleDb(db).transaction((tx) => {
    tx.update(folders)
      .set({
        parentId: newParentId,
        sortOrder,
        path: newPath,
        normalizedPath: normalizeStoredPath(newPath),
      })
      .where(eq(folders.id, folderId))
      .run();
    const oldPathKey = normalizeStoredPath(folder.path);
    const subfolders = tx
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(
        sql`${folders.id} != ${folderId} AND (${folders.normalizedPath} = ${oldPathKey} OR ${folders.normalizedPath} LIKE ${`${oldPathKey}/%`})`,
      )
      .all();
    for (const subfolder of subfolders) {
      if (subfolder.id === folderId || !pathHasPrefix(subfolder.path, folder.path)) continue;
      const replaced = replacePathPrefix(subfolder.path, folder.path, newPath);
      if (replaced)
        tx.update(folders)
          .set({ path: replaced, normalizedPath: normalizeStoredPath(replaced) })
          .where(eq(folders.id, subfolder.id))
          .run();
    }
    const fileRows = tx
      .select({ id: files.id, path: files.path })
      .from(files)
      .where(
        sql`${files.normalizedPath} = ${oldPathKey} OR ${files.normalizedPath} LIKE ${`${oldPathKey}/%`}`,
      )
      .all();
    for (const file of fileRows) {
      if (!pathHasPrefix(file.path, folder.path)) continue;
      const replaced = replacePathPrefix(file.path, folder.path, newPath);
      if (replaced)
        tx.update(files)
          .set({ path: replaced, normalizedPath: normalizeStoredPath(replaced) })
          .where(eq(files.id, file.id))
          .run();
    }
  });
}

export function reorderFolders(db: Database.Database, folderIds: number[]): void {
  getDrizzleDb(db).transaction((tx) => {
    folderIds.forEach((folderId, index) => {
      tx.update(folders).set({ sortOrder: index }).where(eq(folders.id, folderId)).run();
    });
  });
}

export function deleteFolderRecord(db: Database.Database, folderId: number): void {
  getDrizzleDb(db).delete(folders).where(eq(folders.id, folderId)).run();
}

export function clearSystemFolderFlagByName(db: Database.Database, name: string): void {
  getDrizzleDb(db)
    .update(folders)
    .set({ isSystem: 0 })
    .where(sql`${folders.name} = ${name} AND ${folders.isSystem} = 1`)
    .run();
}

export function clearSystemFolderFlagById(db: Database.Database, folderId: number): void {
  getDrizzleDb(db).update(folders).set({ isSystem: 0 }).where(eq(folders.id, folderId)).run();
}

export function softDeleteFolderSubtree(
  db: Database.Database,
  folderPath: string,
  deletedAt: string,
): void {
  const folderPathKey = normalizeStoredPath(folderPath);
  getDrizzleDb(db)
    .update(folders)
    .set({ deletedAt })
    .where(
      sql`${folders.normalizedPath} = ${folderPathKey} OR ${folders.normalizedPath} LIKE ${`${folderPathKey}/%`}`,
    )
    .run();
}

export function restoreFolderSubtreeRecords(
  db: Database.Database,
  input: {
    folderId: number;
    originalPath: string;
    restoredPath: string;
    rootParentId: number | null;
  },
): void {
  const originalPathKey = normalizeStoredPath(input.originalPath);
  const now = currentTimestamp();
  getDrizzleDb(db).transaction((tx) => {
    const folderRows = tx
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(
        sql`${folders.normalizedPath} = ${originalPathKey} OR ${folders.normalizedPath} LIKE ${`${originalPathKey}/%`}`,
      )
      .all();
    for (const folder of folderRows) {
      if (!pathHasPrefix(folder.path, input.originalPath)) {
        continue;
      }
      const nextPath =
        replacePathPrefix(folder.path, input.originalPath, input.restoredPath) ?? folder.path;
      if (folder.id === input.folderId) {
        tx.update(folders)
          .set({
            path: nextPath,
            normalizedPath: normalizeStoredPath(nextPath),
            name: path.basename(nextPath),
            parentId: input.rootParentId,
            deletedAt: null,
            updatedAt: now,
          })
          .where(eq(folders.id, folder.id))
          .run();
        continue;
      }
      tx.update(folders)
        .set({
          path: nextPath,
          normalizedPath: normalizeStoredPath(nextPath),
          name: path.basename(nextPath),
          deletedAt: null,
          updatedAt: now,
        })
        .where(eq(folders.id, folder.id))
        .run();
    }

    const fileRows = tx
      .select({ id: files.id, path: files.path })
      .from(files)
      .where(
        sql`${files.normalizedPath} = ${originalPathKey} OR ${files.normalizedPath} LIKE ${`${originalPathKey}/%`}`,
      )
      .all();
    for (const file of fileRows) {
      if (!pathHasPrefix(file.path, input.originalPath)) {
        continue;
      }
      const nextPath =
        replacePathPrefix(file.path, input.originalPath, input.restoredPath) ?? file.path;
      tx.update(files)
        .set({
          path: nextPath,
          normalizedPath: normalizeStoredPath(nextPath),
          name: path.basename(nextPath),
          missingAt: null,
        })
        .where(eq(files.id, file.id))
        .run();
    }
  });
}

export function clearFilesFolderId(db: Database.Database, folderIds: number[]): void {
  getDrizzleDb(db).transaction((tx) => {
    for (const folderId of folderIds) {
      tx.update(files).set({ folderId: null }).where(eq(files.folderId, folderId)).run();
    }
  });
}
