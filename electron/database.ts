import Database from "better-sqlite3";
import { migrateDatabase } from "./database/migrations";
import { getSetting, setIndexPath, setSetting } from "./database/settings-repository";

export function openDatabase(dbPath: string, indexPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrateDatabase(db, dbPath);
  ensureRuntimeSettings(db, indexPath);
  db.pragma("optimize");
  return db;
}

function ensureRuntimeSettings(db: Database.Database, indexPath: string): void {
  if (getSetting(db, "use_trash") === null) {
    setSetting(db, "use_trash", "true");
  }
  setIndexPath(db, indexPath);
}

export * from "./database/shared";
export * from "./database/settings-repository";
export * from "./database/file-repository";
export * from "./database/visual-repository";
export * from "./database/similarity-repository";
export * from "./database/folder-repository";
export * from "./database/tag-repository";
export * from "./database/trash-repository";
