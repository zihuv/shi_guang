import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import type { TagRecord } from "../types";
import { getDrizzleDb } from "./client";
import { fileTags, tags } from "./schema";
import { currentTimestamp, generateSyncId } from "./shared";

export function getAllTags(db: Database.Database): TagRecord[] {
  const rows = getDrizzleDb(db).all<{
    id: number;
    name: string;
    color: string;
    count: number;
    parent_id: number | null;
    sort_order: number;
  }>(sql`
    SELECT t.id, t.name, t.color, COUNT(f.id) AS count, t.parent_id, t.sort_order
    FROM tags t
    LEFT JOIN file_tags ft ON t.id = ft.tag_id
    LEFT JOIN files f ON f.id = ft.file_id AND f.deleted_at IS NULL AND f.missing_at IS NULL
    GROUP BY t.id
    ORDER BY COALESCE(t.parent_id, t.id), t.sort_order ASC, t.name ASC
  `);

  return rows.map((row) => ({
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
  return getDrizzleDb(db)
    .insert(tags)
    .values({
      name,
      color,
      parentId,
      syncId: generateSyncId("tag"),
      updatedAt: currentTimestamp(),
    })
    .returning({ id: tags.id })
    .get().id;
}

export function updateTag(db: Database.Database, id: number, name: string, color: string): void {
  getDrizzleDb(db).update(tags).set({ name, color }).where(eq(tags.id, id)).run();
}

export function deleteTag(db: Database.Database, id: number): void {
  getDrizzleDb(db).delete(tags).where(eq(tags.id, id)).run();
}

export function addTagToFile(db: Database.Database, fileId: number, tagId: number): void {
  getDrizzleDb(db).insert(fileTags).values({ fileId, tagId }).onConflictDoNothing().run();
}

export function removeTagFromFile(db: Database.Database, fileId: number, tagId: number): void {
  getDrizzleDb(db)
    .delete(fileTags)
    .where(sql`${fileTags.fileId} = ${fileId} AND ${fileTags.tagId} = ${tagId}`)
    .run();
}

export function reorderTags(
  db: Database.Database,
  tagIds: number[],
  parentId: number | null,
): void {
  getDrizzleDb(db).transaction((tx) => {
    tagIds.forEach((tagId, index) => {
      tx.update(tags).set({ sortOrder: index, parentId }).where(eq(tags.id, tagId)).run();
    });
  });
}

export function moveTag(
  db: Database.Database,
  tagId: number,
  newParentId: number | null,
  sortOrder: number,
): void {
  getDrizzleDb(db)
    .update(tags)
    .set({ parentId: newParentId, sortOrder })
    .where(eq(tags.id, tagId))
    .run();
}
