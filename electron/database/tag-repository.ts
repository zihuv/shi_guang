import Database from "better-sqlite3";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { TagRecord } from "../types";
import { getDrizzleDb } from "./client";
import { fileTags, files, tags } from "./schema";
import { currentTimestamp, generateSyncId } from "./shared";

export function getAllTags(db: Database.Database): TagRecord[] {
  const rows = getDrizzleDb(db)
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      count: count(files.id),
      parent_id: tags.parentId,
      sort_order: tags.sortOrder,
    })
    .from(tags)
    .leftJoin(fileTags, eq(tags.id, fileTags.tagId))
    .leftJoin(
      files,
      and(eq(files.id, fileTags.fileId), isNull(files.deletedAt), isNull(files.missingAt)),
    )
    .groupBy(tags.id)
    .orderBy(sql`COALESCE(${tags.parentId}, ${tags.id})`, asc(tags.sortOrder), asc(tags.name))
    .all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    count: row.count,
    parentId: row.parent_id,
    sortOrder: row.sort_order ?? 0,
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
    .where(and(eq(fileTags.fileId, fileId), eq(fileTags.tagId, tagId)))
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
