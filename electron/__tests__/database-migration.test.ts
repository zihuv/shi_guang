import type Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
type DatabaseConstructor = typeof Database;

function makeTempDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "shiguang-db-migration-"));
  tempDirs.push(tempDir);
  return tempDir;
}

async function loadDatabaseConstructor(): Promise<DatabaseConstructor | null> {
  const databaseModule = (await import("better-sqlite3")) as unknown as {
    default?: DatabaseConstructor;
  } & DatabaseConstructor;
  const Database = databaseModule.default ?? databaseModule;
  try {
    const db = new Database(":memory:");
    db.close();
    return Database;
  } catch {
    return null;
  }
}

function createLegacyDatabase(Database: DatabaseConstructor, dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT NOT NULL,
      is_system INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      dominant_color TEXT NOT NULL DEFAULT '',
      dominant_r INTEGER,
      dominant_g INTEGER,
      dominant_b INTEGER,
      color_distribution TEXT NOT NULL DEFAULT '[]',
      deleted_at TEXT DEFAULT NULL,
      sync_id TEXT NOT NULL UNIQUE,
      content_hash TEXT,
      fs_modified_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE file_tags (
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (file_id, tag_id)
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE index_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE
    );

    INSERT INTO folders
      (path, name, parent_id, created_at, is_system, sort_order, sync_id, updated_at)
      VALUES ('/library/old-folder', 'old-folder', NULL, '2026-04-20 10:00:00', 0, 0, 'folder_legacy', '2026-04-20 10:00:00');

    INSERT INTO files
      (path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
       rating, description, source_url, dominant_color, dominant_r, dominant_g, dominant_b,
       color_distribution, deleted_at, sync_id, content_hash, fs_modified_at, updated_at)
      VALUES
      ('/library/old-folder/image.png', 'image.png', 'png', 42, 100, 80, 1, '2026-04-20 10:00:00',
       '2026-04-20 10:00:00', '2026-04-20 10:00:00', 3, 'legacy description',
       'https://example.com/image.png', '#112233', 17, 34, 51, '[]', NULL, 'file_legacy',
       'hash_legacy', '2026-04-20 10:00:00', '2026-04-20 10:00:00');
  `);
  db.close();
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("creates fresh databases at the current schema version", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { getIndexPaths, openDatabase } = await import("../database");
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "shiguang.db");
    const db = openDatabase(dbPath, "/library");

    expect(db.pragma("user_version", { simple: true })).toBe(4);
    expect(getIndexPaths(db)).toEqual(["/library"]);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .pluck()
        .get("folder_trash_entries"),
    ).toBe("folder_trash_entries");

    db.close();
  });

  it("migrates legacy unversioned databases, preserves data, and writes a backup", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { getIndexPaths, openDatabase } = await import("../database");
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "shiguang.db");
    createLegacyDatabase(Database, dbPath);

    const db = openDatabase(dbPath, "/library");
    const fileColumns = (
      db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const folderColumns = (
      db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const row = db
      .prepare(
        "SELECT description, thumb_hash, missing_at, last_accessed_at FROM files WHERE id = 1",
      )
      .get() as {
      description: string;
      thumb_hash: string;
      missing_at: string | null;
      last_accessed_at: string | null;
    };

    expect(db.pragma("user_version", { simple: true })).toBe(4);
    expect(fileColumns).toContain("thumb_hash");
    expect(fileColumns).toContain("missing_at");
    expect(fileColumns).toContain("last_accessed_at");
    expect(folderColumns).toContain("deleted_at");
    expect(row).toEqual({
      description: "legacy description",
      thumb_hash: "",
      missing_at: null,
      last_accessed_at: null,
    });
    expect(getIndexPaths(db)).toEqual(["/library"]);
    expect(
      readdirSync(tempDir).some((name) => /^shiguang\.backup-v0-\d+-\d+\.db$/.test(name)),
    ).toBe(true);

    db.close();
  });
});
