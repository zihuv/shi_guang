import Database from "better-sqlite3";
import type { FileRecord, TrashFolderRecord, TrashItemRecord } from "../types";
import { attachTags, FileRow } from "./shared";
import { getSetting, setSetting } from "./settings-repository";

export interface FolderTrashEntryRecord {
  folderId: number;
  tempPath: string;
  deletedAt: string;
  fileCount: number;
  subfolderCount: number;
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
  db.prepare(
    `INSERT OR REPLACE INTO folder_trash_entries
       (folder_id, temp_path, deleted_at, file_count, subfolder_count)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.folderId, input.tempPath, input.deletedAt, input.fileCount, input.subfolderCount);
}

export function getFolderTrashEntry(
  db: Database.Database,
  folderId: number,
): FolderTrashEntryRecord | null {
  const row = db
    .prepare(
      `SELECT folder_id, temp_path, deleted_at, file_count, subfolder_count
       FROM folder_trash_entries
       WHERE folder_id = ?`,
    )
    .get(folderId) as
    | {
        folder_id: number;
        temp_path: string;
        deleted_at: string;
        file_count: number;
        subfolder_count: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    folderId: row.folder_id,
    tempPath: row.temp_path,
    deletedAt: row.deleted_at,
    fileCount: row.file_count,
    subfolderCount: row.subfolder_count,
  };
}

export function deleteFolderTrashEntry(db: Database.Database, folderId: number): void {
  db.prepare("DELETE FROM folder_trash_entries WHERE folder_id = ?").run(folderId);
}

export function adjustFolderTrashEntryFileCount(
  db: Database.Database,
  folderId: number,
  delta: number,
): void {
  db.prepare(
    `UPDATE folder_trash_entries
     SET file_count = MAX(file_count + ?, 0)
     WHERE folder_id = ?`,
  ).run(delta, folderId);
}

export function getTrashFolders(db: Database.Database): TrashFolderRecord[] {
  return (
    db
      .prepare(
        `SELECT f.id, f.path, f.name, f.deleted_at, te.file_count, te.subfolder_count
         FROM folders f
         INNER JOIN folder_trash_entries te ON te.folder_id = f.id
         WHERE f.deleted_at IS NOT NULL
         ORDER BY te.deleted_at DESC, f.id ASC`,
      )
      .all() as Array<{
      id: number;
      path: string;
      name: string;
      deleted_at: string;
      file_count: number;
      subfolder_count: number;
    }>
  ).map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    deletedAt: row.deleted_at,
    fileCount: row.file_count,
    subfolderCount: row.subfolder_count,
  }));
}

export function getTrashFiles(db: Database.Database): FileRecord[] {
  const rows = db
    .prepare("SELECT * FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC")
    .all() as FileRow[];
  return attachTags(db, rows);
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
  const fileCount = (
    db.prepare("SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NOT NULL").get() as {
      count: number;
    }
  ).count;
  const folderCount = (
    db.prepare("SELECT COUNT(*) AS count FROM folder_trash_entries").get() as { count: number }
  ).count;
  return fileCount + folderCount;
}

export function getDeleteMode(db: Database.Database): boolean {
  return getSetting(db, "use_trash") !== "false";
}

export function setDeleteMode(db: Database.Database, useTrash: boolean): void {
  setSetting(db, "use_trash", useTrash ? "true" : "false");
}
