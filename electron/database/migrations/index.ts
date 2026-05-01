import Database from "better-sqlite3";
import fssync from "node:fs";
import path from "node:path";
import { currentTimestamp } from "../shared";
import { migrateLegacySchemaToCurrent } from "./legacy";
import {
  createSchemaTables,
  createSchemaTriggersAndIndexes,
  CURRENT_SCHEMA_VERSION,
} from "./schema";
import { migrateV4ToV5 } from "./v4-to-v5";

const CURRENT_SCHEMA_REQUIRED_COLUMNS: Record<string, string[]> = {
  folders: [
    "id",
    "path",
    "normalized_path",
    "name",
    "parent_id",
    "created_at",
    "is_system",
    "sort_order",
    "deleted_at",
    "sync_id",
    "updated_at",
  ],
  files: [
    "id",
    "path",
    "normalized_path",
    "name",
    "ext",
    "size",
    "width",
    "height",
    "folder_id",
    "created_at",
    "modified_at",
    "imported_at",
    "last_accessed_at",
    "rating",
    "description",
    "source_url",
    "dominant_color",
    "dominant_r",
    "dominant_g",
    "dominant_b",
    "color_distribution",
    "thumb_hash",
    "deleted_at",
    "missing_at",
    "sync_id",
    "content_hash",
    "fs_modified_at",
    "updated_at",
  ],
  tags: ["id", "name", "color", "parent_id", "sort_order", "sync_id", "updated_at"],
  file_tags: ["file_id", "tag_id"],
  settings: ["key", "value"],
  index_paths: ["id", "path"],
  folder_trash_entries: ["folder_id", "temp_path", "deleted_at", "file_count", "subfolder_count"],
  file_visual_embeddings: [
    "file_id",
    "model_id",
    "dimensions",
    "embedding",
    "source_size",
    "source_modified_at",
    "source_content_hash",
    "indexed_at",
    "status",
    "last_error",
  ],
};

export function migrateDatabase(db: Database.Database, dbPath: string): void {
  const userVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const hasSchema = hasTable(db, "files") || hasTable(db, "folders") || hasTable(db, "tags");

  if (!hasSchema) {
    db.transaction(() => {
      createSchemaTables(db);
      createSchemaTriggersAndIndexes(db);
      setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    })();
    return;
  }

  if (userVersion >= CURRENT_SCHEMA_VERSION) {
    ensureCurrentSchema(db, dbPath, userVersion);
    return;
  }

  backupDatabaseBeforeMigration(db, dbPath, userVersion);
  db.transaction(() => {
    runVersionMigrations(db, userVersion);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  })();
}

function runVersionMigrations(db: Database.Database, userVersion: number): void {
  if (userVersion === 0) {
    migrateLegacySchemaToCurrent(db);
  }
  if (userVersion < 5) {
    migrateV4ToV5(db);
  }
}

function ensureCurrentSchema(db: Database.Database, dbPath: string, userVersion: number): void {
  if (hasCurrentSchemaColumns(db)) {
    return;
  }

  backupDatabaseBeforeMigration(db, dbPath, userVersion);
  db.transaction(() => {
    migrateLegacySchemaToCurrent(db);
    migrateV4ToV5(db);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  })();

  if (!hasCurrentSchemaColumns(db)) {
    throw new Error("Database schema repair did not restore the current schema");
  }
}

function hasCurrentSchemaColumns(db: Database.Database): boolean {
  return Object.entries(CURRENT_SCHEMA_REQUIRED_COLUMNS).every(([tableName, columnNames]) => {
    if (!hasTable(db, tableName)) {
      return false;
    }
    const existingColumns = getColumnNames(db, tableName);
    return columnNames.every((columnName) => existingColumns.has(columnName));
  });
}

function backupDatabaseBeforeMigration(
  db: Database.Database,
  dbPath: string,
  userVersion: number,
): void {
  if (dbPath === ":memory:" || !fssync.existsSync(dbPath)) {
    return;
  }

  db.pragma("wal_checkpoint(FULL)");
  const parsed = path.parse(dbPath);
  const timestamp = `${currentTimestamp().replace(/\D/g, "")}-${Date.now()}`;
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.backup-v${userVersion}-${timestamp}${parsed.ext}`,
  );
  fssync.copyFileSync(dbPath, backupPath);
}

function setSchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}

function getColumnNames(db: Database.Database, tableName: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}
