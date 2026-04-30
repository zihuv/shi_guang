import Database from "better-sqlite3";
import { currentTimestamp, generateSyncId, normalizeStoredPath } from "../shared";
import { createSchemaTables, createSchemaTriggersAndIndexes } from "./schema";

export function migrateLegacySchemaToCurrent(db: Database.Database): void {
  createSchemaTables(db);
  ensureLegacyColumns(db);
  createSchemaTriggersAndIndexes(db);
}

function getColumnNames(db: Database.Database, tableName: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  if (getColumnNames(db, tableName).has(columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function ensureGeneratedSyncIds(db: Database.Database, tableName: string, prefix: string): void {
  const rows = db
    .prepare(`SELECT id FROM ${tableName} WHERE sync_id IS NULL OR sync_id = ''`)
    .all() as Array<{ id: number }>;
  const update = db.prepare(`UPDATE ${tableName} SET sync_id = ? WHERE id = ?`);
  for (const row of rows) {
    update.run(generateSyncId(prefix), row.id);
  }
}

function ensureTimestampValues(db: Database.Database, tableName: string): void {
  db.prepare(
    `UPDATE ${tableName} SET updated_at = ? WHERE updated_at IS NULL OR updated_at = ''`,
  ).run(currentTimestamp());
}

function ensureNormalizedPathValues(db: Database.Database, tableName: "files" | "folders"): void {
  const rows = db.prepare(`SELECT id, path FROM ${tableName}`).all() as Array<{
    id: number;
    path: string;
  }>;
  const update = db.prepare(`UPDATE ${tableName} SET normalized_path = ? WHERE id = ?`);
  for (const row of rows) {
    update.run(normalizeStoredPath(row.path), row.id);
  }
}

function ensureLegacyColumns(db: Database.Database): void {
  if (hasTable(db, "folders")) {
    addColumnIfMissing(db, "folders", "deleted_at", "TEXT DEFAULT NULL");
    addColumnIfMissing(db, "folders", "normalized_path", "TEXT");
    addColumnIfMissing(db, "folders", "sync_id", "TEXT");
    addColumnIfMissing(db, "folders", "updated_at", "TEXT NOT NULL DEFAULT ''");
    ensureNormalizedPathValues(db, "folders");
    ensureGeneratedSyncIds(db, "folders", "folder");
    ensureTimestampValues(db, "folders");
  }

  if (hasTable(db, "files")) {
    addColumnIfMissing(db, "files", "normalized_path", "TEXT");
    addColumnIfMissing(db, "files", "last_accessed_at", "TEXT DEFAULT NULL");
    addColumnIfMissing(db, "files", "dominant_r", "INTEGER");
    addColumnIfMissing(db, "files", "dominant_g", "INTEGER");
    addColumnIfMissing(db, "files", "dominant_b", "INTEGER");
    addColumnIfMissing(db, "files", "color_distribution", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, "files", "thumb_hash", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "files", "deleted_at", "TEXT DEFAULT NULL");
    addColumnIfMissing(db, "files", "missing_at", "TEXT DEFAULT NULL");
    addColumnIfMissing(db, "files", "sync_id", "TEXT");
    addColumnIfMissing(db, "files", "content_hash", "TEXT");
    addColumnIfMissing(db, "files", "fs_modified_at", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "files", "updated_at", "TEXT NOT NULL DEFAULT ''");
    db.prepare(
      "UPDATE files SET fs_modified_at = modified_at WHERE fs_modified_at IS NULL OR fs_modified_at = ''",
    ).run();
    ensureNormalizedPathValues(db, "files");
    ensureGeneratedSyncIds(db, "files", "file");
    ensureTimestampValues(db, "files");
  }

  if (hasTable(db, "tags")) {
    addColumnIfMissing(db, "tags", "parent_id", "INTEGER");
    addColumnIfMissing(db, "tags", "sort_order", "INTEGER DEFAULT 0");
    addColumnIfMissing(db, "tags", "sync_id", "TEXT");
    addColumnIfMissing(db, "tags", "updated_at", "TEXT NOT NULL DEFAULT ''");
    ensureGeneratedSyncIds(db, "tags", "tag");
    ensureTimestampValues(db, "tags");
  }
}
