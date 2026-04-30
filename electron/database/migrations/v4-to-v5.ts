import Database from "better-sqlite3";
import { normalizeStoredPath } from "../shared";
import { createSchemaTriggersAndIndexes } from "./schema";

function getColumnNames(db: Database.Database, tableName: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
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

function populateNormalizedPath(db: Database.Database, tableName: "files" | "folders"): void {
  addColumnIfMissing(db, tableName, "normalized_path", "TEXT");
  const rows = db.prepare(`SELECT id, path FROM ${tableName}`).all() as Array<{
    id: number;
    path: string;
  }>;
  const update = db.prepare(`UPDATE ${tableName} SET normalized_path = ? WHERE id = ?`);
  for (const row of rows) {
    update.run(normalizeStoredPath(row.path), row.id);
  }
}

function dropTimestampTriggers(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS update_files_updated_at;
    DROP TRIGGER IF EXISTS update_folders_updated_at;
    DROP TRIGGER IF EXISTS update_tags_updated_at;
    DROP TRIGGER IF EXISTS update_file_tags_file_updated_at_insert;
    DROP TRIGGER IF EXISTS update_file_tags_file_updated_at_delete;
  `);
}

function toIsoTimestamp(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const legacyMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(
    trimmed,
  );
  if (legacyMatch && !trimmed.endsWith("Z")) {
    const [, year, month, day, hour, minute, second, millisecond = "0"] = legacyMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond.padEnd(3, "0")),
    ).toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function migrateTimestampColumns(
  db: Database.Database,
  tableName: string,
  keyColumn: string,
  columns: string[],
): void {
  const existingColumns = getColumnNames(db, tableName);
  const timestampColumns = columns.filter((column) => existingColumns.has(column));
  if (!timestampColumns.length) {
    return;
  }

  const rows = db
    .prepare(`SELECT ${keyColumn}, ${timestampColumns.join(", ")} FROM ${tableName}`)
    .all() as Array<Record<string, unknown>>;

  for (const row of rows) {
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const column of timestampColumns) {
      const nextValue = toIsoTimestamp(row[column]);
      if (nextValue !== row[column]) {
        updates.push(`${column} = ?`);
        values.push(nextValue);
      }
    }
    if (!updates.length) {
      continue;
    }
    db.prepare(`UPDATE ${tableName} SET ${updates.join(", ")} WHERE ${keyColumn} = ?`).run(
      ...values,
      row[keyColumn],
    );
  }
}

function migrateTimestampsToIso(db: Database.Database): void {
  migrateTimestampColumns(db, "files", "id", [
    "created_at",
    "modified_at",
    "imported_at",
    "last_accessed_at",
    "deleted_at",
    "missing_at",
    "fs_modified_at",
    "updated_at",
  ]);
  migrateTimestampColumns(db, "folders", "id", ["created_at", "deleted_at", "updated_at"]);
  migrateTimestampColumns(db, "tags", "id", ["updated_at"]);
  migrateTimestampColumns(db, "folder_trash_entries", "folder_id", ["deleted_at"]);
  migrateTimestampColumns(db, "file_visual_embeddings", "file_id", [
    "source_modified_at",
    "indexed_at",
  ]);
}

function rebuildTagsWithoutGlobalNameUnique(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS file_tags_backup AS
      SELECT file_id, tag_id FROM file_tags;

    CREATE TABLE tags_v5 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES tags_v5(id) ON DELETE CASCADE
    );

    INSERT INTO tags_v5 (id, name, color, parent_id, sort_order, sync_id, updated_at)
      SELECT id, name, color, parent_id, sort_order, sync_id, updated_at FROM tags;

    DROP TABLE file_tags;
    DROP TABLE tags;
    ALTER TABLE tags_v5 RENAME TO tags;

    CREATE TABLE file_tags (
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (file_id, tag_id),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO file_tags (file_id, tag_id)
      SELECT ft.file_id, ft.tag_id
      FROM file_tags_backup ft
      INNER JOIN files f ON f.id = ft.file_id
      INNER JOIN tags t ON t.id = ft.tag_id;

    DROP TABLE file_tags_backup;
  `);
}

export function migrateV4ToV5(db: Database.Database): void {
  dropTimestampTriggers(db);
  populateNormalizedPath(db, "folders");
  populateNormalizedPath(db, "files");
  migrateTimestampsToIso(db);
  rebuildTagsWithoutGlobalNameUnique(db);
  createSchemaTriggersAndIndexes(db);
}
