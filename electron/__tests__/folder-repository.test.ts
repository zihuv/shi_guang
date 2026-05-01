import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

type DatabaseConstructor = typeof Database;

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

describe("folder repository", () => {
  it("allocates new folder sort order before existing siblings", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { migrateDatabase } = await import("../database/migrations");
    const { createFolderRecord, getPrependFolderSortOrder } = await import("../database");
    const db = new Database(":memory:");
    migrateDatabase(db, ":memory:");

    createFolderRecord(db, "/library/browser", "浏览器采集", null, false, -1);
    createFolderRecord(db, "/library/tests", "测试", null, false, 0);

    expect(getPrependFolderSortOrder(db, null)).toBe(-2);

    const parentId = createFolderRecord(db, "/library/parent", "父级", null, false, 1);
    createFolderRecord(db, "/library/parent/child", "子级", parentId, false, 4);
    const deletedChildId = createFolderRecord(
      db,
      "/library/parent/deleted-child",
      "已删除子级",
      parentId,
      false,
      -10,
    );
    db.prepare("UPDATE folders SET deleted_at = '2026-04-30 12:00:00' WHERE id = ?").run(
      deletedChildId,
    );

    expect(getPrependFolderSortOrder(db, parentId)).toBe(3);
    expect(getPrependFolderSortOrder(db, 999)).toBe(0);

    db.close();
  });
});
