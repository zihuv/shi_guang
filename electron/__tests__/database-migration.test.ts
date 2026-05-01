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
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    INSERT INTO files (path, name) VALUES ('/library/old.png', 'old.png');
  `);
  db.close();
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("creates fresh databases from the Drizzle baseline", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { getIndexPaths, openDatabase } = await import("../database");
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "shiguang.db");
    const db = openDatabase(dbPath, "/library");

    expect(getIndexPaths(db)).toEqual(["/library"]);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .pluck()
        .get("__drizzle_migrations__"),
    ).toBe("__drizzle_migrations__");
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .pluck()
        .get("update_files_updated_at"),
    ).toBe("update_files_updated_at");
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .pluck()
        .get("idx_files_active_imported"),
    ).toBe("idx_files_active_imported");

    db.close();
  });

  it("backs up and resets unmanaged legacy app tables before applying Drizzle migrations", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { openDatabase } = await import("../database");
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "shiguang.db");
    createLegacyDatabase(Database, dbPath);

    const db = openDatabase(dbPath, "/library");

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM files").get() as {
        count: number;
      },
    ).toEqual({ count: 0 });
    expect(
      readdirSync(tempDir).some((name) =>
        /^shiguang\.backup-before-drizzle-\d+-\d+\.db$/.test(name),
      ),
    ).toBe(true);

    db.close();
  });
});
