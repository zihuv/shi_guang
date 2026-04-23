import Database from "better-sqlite3";
import type { TagRecord } from "../types";
import { currentTimestamp, generateSyncId } from "./shared";

export function getAllTags(db: Database.Database): TagRecord[] {
  return (
    db
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(f.id) AS count, t.parent_id, t.sort_order
     FROM tags t
     LEFT JOIN file_tags ft ON t.id = ft.tag_id
     LEFT JOIN files f ON f.id = ft.file_id AND f.deleted_at IS NULL AND f.missing_at IS NULL
     GROUP BY t.id
     ORDER BY COALESCE(t.parent_id, t.id), t.sort_order ASC, t.name ASC`,
      )
      .all() as Array<{
      id: number;
      name: string;
      color: string;
      count: number;
      parent_id: number | null;
      sort_order: number;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    count: row.count,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  }));
}

export function createTag(
  db: Database.Database,
  name: string,
  color: string,
  parentId: number | null,
): number {
  db.prepare(
    "INSERT INTO tags (name, color, parent_id, sync_id, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(name, color, parentId, generateSyncId("tag"), currentTimestamp());
  return Number(db.prepare("SELECT last_insert_rowid() AS id").pluck().get());
}

export function updateTag(db: Database.Database, id: number, name: string, color: string): void {
  db.prepare("UPDATE tags SET name = ?, color = ? WHERE id = ?").run(name, color, id);
}

export function deleteTag(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function addTagToFile(db: Database.Database, fileId: number, tagId: number): void {
  db.prepare("INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)").run(fileId, tagId);
}

export function removeTagFromFile(db: Database.Database, fileId: number, tagId: number): void {
  db.prepare("DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?").run(fileId, tagId);
}

export function reorderTags(
  db: Database.Database,
  tagIds: number[],
  parentId: number | null,
): void {
  const transaction = db.transaction(() => {
    tagIds.forEach((tagId, index) => {
      db.prepare("UPDATE tags SET sort_order = ?, parent_id = ? WHERE id = ?").run(
        index,
        parentId,
        tagId,
      );
    });
  });
  transaction();
}

export function moveTag(
  db: Database.Database,
  tagId: number,
  newParentId: number | null,
  sortOrder: number,
): void {
  db.prepare("UPDATE tags SET parent_id = ?, sort_order = ? WHERE id = ?").run(
    newParentId,
    sortOrder,
    tagId,
  );
}
