import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
type DatabaseConstructor = typeof Database;

function makeTempDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "shiguang-trash-repository-"));
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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("trash repository", () => {
  it("allows reading files from the deleted folder holding directory", async () => {
    const { isPathAllowedForRead } = await import("../storage");
    const { getDeletedFolderHoldingDir } = await import("../trash-paths");
    const tempDir = makeTempDir();
    const libraryDir = path.join(tempDir, "library");
    const holdingDir = getDeletedFolderHoldingDir(tempDir);

    expect(
      isPathAllowedForRead(path.join(holdingDir, "folder-trash-parent", "image.png"), [libraryDir]),
    ).toBe(false);
    expect(
      isPathAllowedForRead(
        path.join(holdingDir, "folder-trash-parent", "image.png"),
        [libraryDir],
        [holdingDir],
      ),
    ).toBe(true);
  });

  it("maps trashed child files to their moved folder preview path", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { createFolderTrashEntry, getTrashFiles, openDatabase } = await import("../database");
    const tempDir = makeTempDir();
    const libraryDir = path.join(tempDir, "library");
    const folderPath = path.join(libraryDir, "parent");
    const childPath = path.join(folderPath, "child", "image.png");
    const tempFolderPath = path.join(tempDir, "deleted-folders-pending", "folder-trash-parent");
    const timestamp = "2026-04-28 10:00:00";
    const db = openDatabase(path.join(tempDir, "shiguang.db"), libraryDir);

    const folderId = db
      .prepare(
        `INSERT INTO folders
          (path, name, parent_id, created_at, is_system, sort_order, deleted_at, sync_id, updated_at)
         VALUES (?, 'parent', NULL, ?, 0, 0, ?, 'folder_parent', ?)
         RETURNING id`,
      )
      .pluck()
      .get(folderPath, timestamp, timestamp, timestamp) as number;
    createFolderTrashEntry(db, {
      folderId,
      tempPath: tempFolderPath,
      deletedAt: timestamp,
      fileCount: 1,
      subfolderCount: 1,
    });

    db.prepare(
      `INSERT INTO files (
        path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
        rating, description, source_url, dominant_color, color_distribution, thumb_hash,
        deleted_at, missing_at, sync_id, content_hash, fs_modified_at, updated_at
      ) VALUES (?, 'image.png', 'png', 42, 100, 100, ?, ?, ?, ?, 0, '', '', '', '[]', '',
        ?, ?, 'file_child_image', NULL, ?, ?)`,
    ).run(
      childPath,
      folderId,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );

    expect(getTrashFiles(db)).toMatchObject([
      {
        path: childPath,
        trashPreviewPath: path.join(tempFolderPath, "child", "image.png"),
      },
    ]);

    db.close();
  });
});
