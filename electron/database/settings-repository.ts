import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { getDrizzleDb } from "./client";
import { indexPaths, settings } from "./schema";

export function getIndexPaths(db: Database.Database): string[] {
  return getDrizzleDb(db)
    .select({ path: indexPaths.path })
    .from(indexPaths)
    .orderBy(indexPaths.id)
    .limit(1)
    .all()
    .map((row) => row.path);
}

export function setIndexPath(db: Database.Database, indexPath: string): void {
  getDrizzleDb(db).transaction((tx) => {
    tx.delete(indexPaths).run();
    tx.insert(indexPaths).values({ path: indexPath }).run();
  });
}

export function addIndexPath(db: Database.Database, indexPath: string): void {
  const current = getIndexPaths(db)[0];
  if (current && current !== indexPath) {
    throw new Error("Only one index path is supported");
  }
  getDrizzleDb(db).insert(indexPaths).values({ path: indexPath }).onConflictDoNothing().run();
}

export function removeIndexPath(db: Database.Database, indexPath: string): void {
  getDrizzleDb(db).delete(indexPaths).where(eq(indexPaths.path, indexPath)).run();
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = getDrizzleDb(db)
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  getDrizzleDb(db)
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
}
