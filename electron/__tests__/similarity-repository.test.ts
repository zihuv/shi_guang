import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
type DatabaseConstructor = typeof Database;

function makeTempDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "shiguang-similarity-"));
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

function embeddingBuffer(values: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(values[index], index * 4);
  }
  return buffer;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("duplicate and similar detection", () => {
  it("orders exact content hash duplicates before visually similar image groups", async () => {
    const Database = await loadDatabaseConstructor();
    if (!Database) {
      return;
    }

    const { filterFiles, getDuplicateOrSimilarFileIds, openDatabase, upsertFileVisualEmbedding } =
      await import("../database");
    const tempDir = makeTempDir();
    const db = openDatabase(path.join(tempDir, "shiguang.db"), tempDir);
    const insertFile = db.prepare(
      `INSERT INTO files (
        path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
        rating, description, source_url, dominant_color, color_distribution, thumb_hash, sync_id,
        content_hash, fs_modified_at, updated_at
      ) VALUES (?, ?, 'png', ?, 100, 100, NULL, ?, ?, ?, 0, '', '', '', '[]', '', ?, ?, ?, ?)`,
    );
    const timestamp = "2026-04-25 10:00:00";
    const ids = [1, 2, 3, 4, 5];

    insertFile.run(
      path.join(tempDir, "exact-a.png"),
      "exact-a.png",
      10,
      timestamp,
      timestamp,
      "2026-04-25 10:01:00",
      "file_exact_a",
      "hash_exact",
      timestamp,
      timestamp,
    );
    insertFile.run(
      path.join(tempDir, "exact-b.png"),
      "exact-b.png",
      11,
      timestamp,
      timestamp,
      "2026-04-25 10:02:00",
      "file_exact_b",
      "hash_exact",
      timestamp,
      timestamp,
    );
    insertFile.run(
      path.join(tempDir, "similar-a.png"),
      "similar-a.png",
      12,
      timestamp,
      timestamp,
      "2026-04-25 10:03:00",
      "file_similar_a",
      "hash_a",
      timestamp,
      timestamp,
    );
    insertFile.run(
      path.join(tempDir, "similar-b.png"),
      "similar-b.png",
      13,
      timestamp,
      timestamp,
      "2026-04-25 10:04:00",
      "file_similar_b",
      "hash_b",
      timestamp,
      timestamp,
    );
    insertFile.run(
      path.join(tempDir, "different.png"),
      "different.png",
      14,
      timestamp,
      timestamp,
      "2026-04-25 10:05:00",
      "file_different",
      "hash_c",
      timestamp,
      timestamp,
    );

    upsertFileVisualEmbedding(db, {
      fileId: ids[1],
      modelId: "clip-test",
      dimensions: 3,
      embedding: embeddingBuffer([1, 0, 0]),
      sourceSize: 11,
      sourceModifiedAt: timestamp,
      sourceContentHash: "hash_exact",
    });
    upsertFileVisualEmbedding(db, {
      fileId: ids[2],
      modelId: "clip-test",
      dimensions: 3,
      embedding: embeddingBuffer([1, 0, 0]),
      sourceSize: 12,
      sourceModifiedAt: timestamp,
      sourceContentHash: "hash_a",
    });
    upsertFileVisualEmbedding(db, {
      fileId: ids[3],
      modelId: "clip-test",
      dimensions: 3,
      embedding: embeddingBuffer([0.95, 0.3122499, 0]),
      sourceSize: 13,
      sourceModifiedAt: timestamp,
      sourceContentHash: "hash_b",
    });
    upsertFileVisualEmbedding(db, {
      fileId: ids[4],
      modelId: "clip-test",
      dimensions: 3,
      embedding: embeddingBuffer([0, 1, 0]),
      sourceSize: 14,
      sourceModifiedAt: timestamp,
      sourceContentHash: "hash_c",
    });

    expect(getDuplicateOrSimilarFileIds(db)).toEqual([2, 1, 4, 3]);
    expect(
      filterFiles(db, {
        filter: { smart_view: "similar" },
        page: 1,
        pageSize: 10,
      }).files.map((file) => file.id),
    ).toEqual([2, 1, 4, 3]);

    db.close();
  });
});
