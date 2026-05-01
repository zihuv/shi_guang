import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import type { FileRecord, TrashFolderRecord, TrashItemRecord } from "../types";
import { pathHasPrefix, replacePathPrefix } from "../path-utils";
import { attachTags, FileRow } from "./shared";
import { getDrizzleDb } from "./client";
import { files, folderTrashEntries, folders } from "./schema";
import { getSetting, setSetting } from "./settings-repository";

export interface FolderTrashEntryRecord {
  folderId: number;
  tempPath: string;
  deletedAt: string;
  fileCount: number;
  subfolderCount: number;
}

interface TrashedFolderPathRecord {
  originalPath: string;
  tempPath: string;
}

export function createFolderTrashEntry(
  db: Database.Database,
  input: {
    folderId: number;
    tempPath: string;
    deletedAt: string;
    fileCount: number;
    subfolderCount: number;
  },
): void {
  getDrizzleDb(db)
    .insert(folderTrashEntries)
    .values(input)
    .onConflictDoUpdate({
      target: folderTrashEntries.folderId,
      set: {
        tempPath: input.tempPath,
        deletedAt: input.deletedAt,
        fileCount: input.fileCount,
        subfolderCount: input.subfolderCount,
      },
    })
    .run();
}

export function getFolderTrashEntry(
  db: Database.Database,
  folderId: number,
): FolderTrashEntryRecord | null {
  const row = getDrizzleDb(db)
    .select()
    .from(folderTrashEntries)
    .where(eq(folderTrashEntries.folderId, folderId))
    .get();
  if (!row) {
    return null;
  }
  return {
    folderId: row.folderId,
    tempPath: row.tempPath,
    deletedAt: row.deletedAt,
    fileCount: row.fileCount,
    subfolderCount: row.subfolderCount,
  };
}

export function deleteFolderTrashEntry(db: Database.Database, folderId: number): void {
  getDrizzleDb(db)
    .delete(folderTrashEntries)
    .where(eq(folderTrashEntries.folderId, folderId))
    .run();
}

export function adjustFolderTrashEntryFileCount(
  db: Database.Database,
  folderId: number,
  delta: number,
): void {
  getDrizzleDb(db)
    .update(folderTrashEntries)
    .set({ fileCount: sql`MAX(${folderTrashEntries.fileCount} + ${delta}, 0)` })
    .where(eq(folderTrashEntries.folderId, folderId))
    .run();
}

export function getTrashFolders(db: Database.Database): TrashFolderRecord[] {
  return getDrizzleDb(db)
    .select({
      id: folders.id,
      path: folders.path,
      name: folders.name,
      deleted_at: folders.deletedAt,
      file_count: folderTrashEntries.fileCount,
      subfolder_count: folderTrashEntries.subfolderCount,
    })
    .from(folders)
    .innerJoin(folderTrashEntries, eq(folderTrashEntries.folderId, folders.id))
    .where(sql`${folders.deletedAt} IS NOT NULL`)
    .orderBy(sql`${folderTrashEntries.deletedAt} DESC`, folders.id)
    .all()
    .map((row) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      deletedAt: row.deleted_at ?? "",
      fileCount: row.file_count,
      subfolderCount: row.subfolder_count,
    }));
}

function getTrashedFolderPaths(db: Database.Database): TrashedFolderPathRecord[] {
  const rows = getDrizzleDb(db)
    .select({ path: folders.path, temp_path: folderTrashEntries.tempPath })
    .from(folders)
    .innerJoin(folderTrashEntries, eq(folderTrashEntries.folderId, folders.id))
    .where(sql`${folders.deletedAt} IS NOT NULL`)
    .all();
  return rows
    .map((row) => ({
      originalPath: row.path,
      tempPath: row.temp_path,
    }))
    .sort((left, right) => right.originalPath.length - left.originalPath.length);
}

export function resolveTrashPreviewPath(
  filePath: string,
  trashedFolders: TrashedFolderPathRecord[],
): string | null {
  for (const folder of trashedFolders) {
    if (!pathHasPrefix(filePath, folder.originalPath)) {
      continue;
    }
    return replacePathPrefix(filePath, folder.originalPath, folder.tempPath);
  }
  return null;
}

export function getTrashFiles(db: Database.Database): FileRecord[] {
  const rows = getDrizzleDb(db).all<FileRow>(
    sql`SELECT * FROM ${files} WHERE ${files.deletedAt} IS NOT NULL ORDER BY ${files.deletedAt} DESC, ${files.id} ASC`,
  );
  const trashedFolders = getTrashedFolderPaths(db);
  return attachTags(db, rows).map((file) => ({
    ...file,
    trashPreviewPath: resolveTrashPreviewPath(file.path, trashedFolders),
  }));
}

export function getTrashItems(db: Database.Database): TrashItemRecord[] {
  return [
    ...getTrashFolders(db).map((folder) => ({ ...folder, kind: "folder" as const })),
    ...getTrashFiles(db).map((file) => ({ ...file, kind: "file" as const })),
  ].sort((left, right) => {
    const leftDeletedAt = left.deletedAt ?? "";
    const rightDeletedAt = right.deletedAt ?? "";
    return rightDeletedAt.localeCompare(leftDeletedAt) || left.id - right.id;
  });
}

export function getTrashCount(db: Database.Database): number {
  const fileCount = getDrizzleDb(db).get<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM ${files} WHERE ${files.deletedAt} IS NOT NULL`,
  ).count;
  const folderCount = getDrizzleDb(db).get<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM ${folderTrashEntries}`,
  ).count;
  return fileCount + folderCount;
}

export function getDeleteMode(db: Database.Database): boolean {
  return getSetting(db, "use_trash") !== "false";
}

export function setDeleteMode(db: Database.Database, useTrash: boolean): void {
  setSetting(db, "use_trash", useTrash ? "true" : "false");
}
