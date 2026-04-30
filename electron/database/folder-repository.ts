import Database from "better-sqlite3";
import fssync from "node:fs";
import path from "node:path";
import { moveDirectoryWithFallback } from "../file-operations";
import { pathHasPrefix, replacePathPrefix } from "../path-utils";
import type { FolderRecord, FolderTreeNode } from "../types";
import { currentTimestamp, FolderRow, generateSyncId, toFolder } from "./shared";
import { getIndexPaths } from "./settings-repository";

export function getAllFoldersIncludingDeleted(db: Database.Database): FolderRecord[] {
  return (
    db
      .prepare(
        "SELECT id, path, name, parent_id, created_at, is_system, sort_order, deleted_at FROM folders ORDER BY sort_order ASC, created_at ASC",
      )
      .all() as FolderRow[]
  ).map(toFolder);
}

export function getAllFolders(db: Database.Database): FolderRecord[] {
  return getAllFoldersIncludingDeleted(db).filter((folder) => !folder.deletedAt);
}

export function getFolderByIdIncludingDeleted(
  db: Database.Database,
  id: number,
): FolderRecord | null {
  const row = db
    .prepare(
      "SELECT id, path, name, parent_id, created_at, is_system, sort_order, deleted_at FROM folders WHERE id = ?",
    )
    .get(id) as FolderRow | undefined;
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
  const row = db
    .prepare(
      "SELECT id, path, name, parent_id, created_at, is_system, sort_order, deleted_at FROM folders WHERE REPLACE(path, '\\\\', '/') = ?",
    )
    .get(folderPath.replace(/\\/g, "/")) as FolderRow | undefined;
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
  db.prepare(
    "INSERT INTO folders (path, name, parent_id, created_at, is_system, sort_order, sync_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    folderPath,
    name,
    parentId,
    currentTimestamp(),
    isSystem ? 1 : 0,
    sortOrder,
    generateSyncId("folder"),
    currentTimestamp(),
  );
  return Number(db.prepare("SELECT last_insert_rowid() AS id").pluck().get());
}

export function getPrependFolderSortOrder(db: Database.Database, parentId: number | null): number {
  const row = (
    parentId === null
      ? db
          .prepare(
            "SELECT MIN(sort_order) AS sort_order FROM folders WHERE parent_id IS NULL AND deleted_at IS NULL",
          )
          .get()
      : db
          .prepare(
            "SELECT MIN(sort_order) AS sort_order FROM folders WHERE parent_id = ? AND deleted_at IS NULL",
          )
          .get(parentId)
  ) as { sort_order: number | null } | undefined;

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
    (
      db
        .prepare(
          "SELECT folder_id, COUNT(*) AS count FROM files WHERE folder_id IS NOT NULL AND deleted_at IS NULL AND missing_at IS NULL GROUP BY folder_id",
        )
        .all() as Array<{ folder_id: number; count: number }>
    ).map((row) => [row.folder_id, row.count]),
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
  db.transaction(() => {
    db.prepare("UPDATE folders SET name = ?, path = ? WHERE id = ?").run(name, newPath, id);
    for (const subfolder of getAllFolders(db)) {
      if (subfolder.id === id || !pathHasPrefix(subfolder.path, oldPath)) continue;
      const replaced = replacePathPrefix(subfolder.path, oldPath, newPath);
      if (replaced)
        db.prepare("UPDATE folders SET path = ? WHERE id = ?").run(replaced, subfolder.id);
    }
    const files = db.prepare("SELECT id, path FROM files").all() as Array<{
      id: number;
      path: string;
    }>;
    for (const file of files) {
      if (!pathHasPrefix(file.path, oldPath)) continue;
      const replaced = replacePathPrefix(file.path, oldPath, newPath);
      if (replaced) db.prepare("UPDATE files SET path = ? WHERE id = ?").run(replaced, file.id);
    }
  })();
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

  db.transaction(() => {
    db.prepare("UPDATE folders SET parent_id = ?, sort_order = ?, path = ? WHERE id = ?").run(
      newParentId,
      sortOrder,
      newPath,
      folderId,
    );
    for (const subfolder of getAllFolders(db)) {
      if (subfolder.id === folderId || !pathHasPrefix(subfolder.path, folder.path)) continue;
      const replaced = replacePathPrefix(subfolder.path, folder.path, newPath);
      if (replaced)
        db.prepare("UPDATE folders SET path = ? WHERE id = ?").run(replaced, subfolder.id);
    }
    const files = db.prepare("SELECT id, path FROM files").all() as Array<{
      id: number;
      path: string;
    }>;
    for (const file of files) {
      if (!pathHasPrefix(file.path, folder.path)) continue;
      const replaced = replacePathPrefix(file.path, folder.path, newPath);
      if (replaced) db.prepare("UPDATE files SET path = ? WHERE id = ?").run(replaced, file.id);
    }
  })();
}

export function reorderFolders(db: Database.Database, folderIds: number[]): void {
  const transaction = db.transaction(() => {
    folderIds.forEach((folderId, index) => {
      db.prepare("UPDATE folders SET sort_order = ? WHERE id = ?").run(index, folderId);
    });
  });
  transaction();
}

export function deleteFolderRecord(db: Database.Database, folderId: number): void {
  db.prepare("DELETE FROM folders WHERE id = ?").run(folderId);
}

export function softDeleteFolderSubtree(
  db: Database.Database,
  folderPath: string,
  deletedAt: string,
): void {
  db.prepare(
    "UPDATE folders SET deleted_at = ? WHERE REPLACE(path, '\\\\', '/') = ? OR REPLACE(path, '\\\\', '/') LIKE ?",
  ).run(deletedAt, folderPath.replace(/\\/g, "/"), `${folderPath.replace(/\\/g, "/")}/%`);
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
  const normalizedOriginal = input.originalPath.replace(/\\/g, "/");
  const normalizedRestored = input.restoredPath.replace(/\\/g, "/");
  const now = currentTimestamp();
  const transaction = db.transaction(() => {
    const folders = db.prepare("SELECT id, path FROM folders").all() as Array<{
      id: number;
      path: string;
    }>;
    for (const folder of folders) {
      if (!pathHasPrefix(folder.path, normalizedOriginal)) {
        continue;
      }
      const nextPath =
        replacePathPrefix(folder.path, normalizedOriginal, normalizedRestored) ?? folder.path;
      if (folder.id === input.folderId) {
        db.prepare(
          "UPDATE folders SET path = ?, name = ?, parent_id = ?, deleted_at = NULL, updated_at = ? WHERE id = ?",
        ).run(nextPath, path.basename(nextPath), input.rootParentId, now, folder.id);
        continue;
      }
      db.prepare(
        "UPDATE folders SET path = ?, name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?",
      ).run(nextPath, path.basename(nextPath), now, folder.id);
    }

    const files = db.prepare("SELECT id, path FROM files").all() as Array<{
      id: number;
      path: string;
    }>;
    for (const file of files) {
      if (!pathHasPrefix(file.path, normalizedOriginal)) {
        continue;
      }
      const nextPath =
        replacePathPrefix(file.path, normalizedOriginal, normalizedRestored) ?? file.path;
      db.prepare("UPDATE files SET path = ?, name = ?, missing_at = NULL WHERE id = ?").run(
        nextPath,
        path.basename(nextPath),
        file.id,
      );
    }
  });
  transaction();
}

export function clearFilesFolderId(db: Database.Database, folderIds: number[]): void {
  const transaction = db.transaction(() => {
    for (const folderId of folderIds) {
      db.prepare("UPDATE files SET folder_id = NULL WHERE folder_id = ?").run(folderId);
    }
  });
  transaction();
}
