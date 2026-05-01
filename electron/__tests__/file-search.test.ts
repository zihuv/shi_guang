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

describe("file fuzzy search", () => {
  it("matches filenames by acronym and ordered characters after filters", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { createSchemaTables } = await import("../database/migrations/schema");
    const { createFolderRecord, filterFiles, upsertFile } = await import("../database");
    const db = new Database(":memory:");
    createSchemaTables(db);

    const folderId = createFolderRecord(db, "/library/design", "设计", null, false, 0);
    upsertFile(db, {
      path: "/library/design/Music Player.png",
      name: "Music Player.png",
      ext: "png",
      size: 1,
      width: 100,
      height: 100,
      folderId,
      createdAt: "2026-05-01T00:00:00.000Z",
      modifiedAt: "2026-05-01T00:00:00.000Z",
    });
    upsertFile(db, {
      path: "/library/design/Design Pattern.jpg",
      name: "Design Pattern.jpg",
      ext: "jpg",
      size: 1,
      width: 100,
      height: 100,
      folderId,
      createdAt: "2026-05-01T00:00:00.000Z",
      modifiedAt: "2026-05-01T00:00:00.000Z",
    });
    upsertFile(db, {
      path: "/library/other/Music Player.png",
      name: "Music Player.png",
      ext: "png",
      size: 1,
      width: 100,
      height: 100,
      folderId: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      modifiedAt: "2026-05-01T00:00:00.000Z",
    });

    expect(
      filterFiles(db, {
        filter: { query: "mpy", folder_id: folderId },
        page: 1,
        pageSize: 20,
      }).files.map((file) => file.name),
    ).toEqual(["Music Player.png"]);
    expect(
      filterFiles(db, {
        filter: { query: "desip", folder_id: folderId },
        page: 1,
        pageSize: 20,
      }).files.map((file) => file.name),
    ).toEqual(["Design Pattern.jpg"]);

    db.close();
  });
});
