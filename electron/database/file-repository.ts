import Database from "better-sqlite3";
import fssync from "node:fs";
import path from "node:path";
import { pathHasPrefix } from "../path-utils";
import type { FileRecord, PaginatedFiles, SmartCollectionStats } from "../types";
import { FILE_FORMAT_GROUPS } from "../../src/shared/file-formats";
import {
  attachTags,
  buildOrderSql,
  currentTimestamp,
  FileRow,
  generateSyncId,
  makePlaceholders,
  normalizeStoredPath,
  pageArgs,
  paginated,
  parseHexColor,
} from "./shared";
import { getDuplicateOrSimilarFileIds } from "./similarity-repository";

export function getFileById(db: Database.Database, fileId: number): FileRecord | null {
  const row = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId) as FileRow | undefined;
  return row ? attachTags(db, [row])[0] : null;
}

export function getFileByPath(db: Database.Database, filePath: string): FileRecord | null {
  const row = db
    .prepare("SELECT * FROM files WHERE normalized_path = ?")
    .get(normalizeStoredPath(filePath)) as FileRow | undefined;
  return row ? attachTags(db, [row])[0] : null;
}

export function findMoveCandidateByContentHash(
  db: Database.Database,
  contentHash: string,
): FileRecord | null {
  if (!contentHash) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT *
       FROM files
       WHERE content_hash = ?
         AND deleted_at IS NULL
       ORDER BY missing_at IS NULL DESC, imported_at DESC, id ASC
       LIMIT 8`,
    )
    .all(contentHash) as FileRow[];
  const missing = row.find((item) => item.missing_at);
  const active = row.find((item) => !item.missing_at && !fssync.existsSync(item.path));
  const candidate = missing ?? active;
  return candidate ? attachTags(db, [candidate])[0] : null;
}

export function getAllFiles(db: Database.Database, args: Record<string, unknown>): PaginatedFiles {
  const { page, pageSize, offset } = pageArgs(
    args.page as number | undefined,
    args.pageSize as number | undefined,
  );
  const orderSql = buildOrderSql(
    args.sortBy as string | undefined,
    args.sortDirection as string | undefined,
  );
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE deleted_at IS NULL AND missing_at IS NULL ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    )
    .all(pageSize, offset) as FileRow[];
  const total = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NULL AND missing_at IS NULL",
      )
      .get() as {
      count: number;
    }
  ).count;
  return paginated(db, rows, total, page, pageSize);
}

export function searchFiles(db: Database.Database, args: Record<string, unknown>): PaginatedFiles {
  const { page, pageSize, offset } = pageArgs(
    args.page as number | undefined,
    args.pageSize as number | undefined,
  );
  const query = String(args.query ?? "");
  const orderSql = buildOrderSql(
    args.sortBy as string | undefined,
    args.sortDirection as string | undefined,
  );
  const pattern = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE name LIKE ? AND deleted_at IS NULL AND missing_at IS NULL ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    )
    .all(pattern, pageSize, offset) as FileRow[];
  const total = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM files WHERE name LIKE ? AND deleted_at IS NULL AND missing_at IS NULL",
      )
      .get(pattern) as { count: number }
  ).count;
  return paginated(db, rows, total, page, pageSize);
}

export function getFilesInFolder(
  db: Database.Database,
  args: Record<string, unknown>,
): PaginatedFiles {
  const { page, pageSize, offset } = pageArgs(
    args.page as number | undefined,
    args.pageSize as number | undefined,
  );
  const folderId = args.folderId ?? args.folder_id;
  const orderSql = buildOrderSql(
    args.sortBy as string | undefined,
    args.sortDirection as string | undefined,
  );
  const where = folderId == null ? "folder_id IS NULL" : "folder_id = ?";
  const queryArgs = folderId == null ? [pageSize, offset] : [folderId, pageSize, offset];
  const countArgs = folderId == null ? [] : [folderId];
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE ${where} AND deleted_at IS NULL AND missing_at IS NULL ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    )
    .all(...queryArgs) as FileRow[];
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM files WHERE ${where} AND deleted_at IS NULL AND missing_at IS NULL`,
      )
      .get(...countArgs) as { count: number }
  ).count;
  return paginated(db, rows, total, page, pageSize);
}

const FILE_TYPE_EXTENSIONS: Record<string, readonly string[]> = FILE_FORMAT_GROUPS;

function appendFilterWhere(filter: Record<string, unknown>, params: unknown[]): string {
  const conditions = ["f.deleted_at IS NULL AND f.missing_at IS NULL"];
  const query = String(filter.query ?? "").trim();
  if (query) {
    conditions.push("f.name LIKE ?");
    params.push(`%${query}%`);
  }

  if (typeof filter.folder_id === "number") {
    conditions.push("f.folder_id = ?");
    params.push(filter.folder_id);
  }

  const smartView = String(filter.smart_view ?? "").trim();
  if (smartView === "unclassified") {
    conditions.push("f.folder_id IS NULL");
  } else if (smartView === "untagged") {
    conditions.push("NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)");
  } else if (smartView === "recent") {
    conditions.push("f.last_accessed_at IS NOT NULL");
  }

  const fileTypes = Array.isArray(filter.file_types) ? filter.file_types.map(String) : [];
  const extGroups = fileTypes.flatMap((type) => FILE_TYPE_EXTENSIONS[type] ?? []);
  if (extGroups.length) {
    conditions.push(`LOWER(f.ext) IN (${makePlaceholders(extGroups.length)})`);
    params.push(...extGroups);
  }

  for (const [key, operator] of [
    ["date_start", ">="],
    ["date_end", "<="],
  ] as const) {
    const value = String(filter[key] ?? "").trim();
    if (value) {
      conditions.push(`f.imported_at ${operator} ?`);
      params.push(value);
    }
  }

  if (typeof filter.size_min === "number") {
    conditions.push("f.size >= ?");
    params.push(filter.size_min);
  }
  if (typeof filter.size_max === "number") {
    conditions.push("f.size <= ?");
    params.push(filter.size_max);
  }
  if (typeof filter.min_rating === "number" && filter.min_rating > 0) {
    conditions.push("f.rating >= ?");
    params.push(filter.min_rating);
  }

  const tagIds = Array.isArray(filter.tag_ids)
    ? filter.tag_ids.filter((value) => typeof value === "number")
    : [];
  if (tagIds.length) {
    conditions.push(
      `EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (${makePlaceholders(tagIds.length)}))`,
    );
    params.push(...tagIds);
  }

  const targetColor = String(filter.dominant_color ?? "").trim();
  if (targetColor) {
    const parsed = parseHexColor(targetColor);
    if (parsed) {
      const [r, g, b] = parsed;
      conditions.push(
        "f.dominant_r IS NOT NULL AND f.dominant_g IS NOT NULL AND f.dominant_b IS NOT NULL AND (((f.dominant_r - ?) * (f.dominant_r - ?)) + ((f.dominant_g - ?) * (f.dominant_g - ?)) + ((f.dominant_b - ?) * (f.dominant_b - ?))) <= ?",
      );
      params.push(r, r, g, g, b, b, 85 * 85);
    } else {
      conditions.push("1 = 0");
    }
  }

  return ` WHERE ${conditions.join(" AND ")}`;
}

function queryDuplicateOrSimilarRows(
  db: Database.Database,
  filter: Record<string, unknown>,
  args: { page?: number; pageSize?: number },
): { rows: FileRow[]; total: number; page: number; pageSize: number } {
  const orderedIds = getDuplicateOrSimilarFileIds(db);
  const { page, pageSize, offset } = pageArgs(args.page, args.pageSize);

  if (!orderedIds.length) {
    return { rows: [], total: 0, page, pageSize };
  }

  const params: unknown[] = [];
  const scopedFilter = { ...filter, smart_view: null };
  const where = appendFilterWhere(scopedFilter, params);
  const idListSql = orderedIds.join(", ");
  const orderSql = `CASE f.id ${orderedIds
    .map((id, index) => `WHEN ${id} THEN ${index}`)
    .join(" ")} ELSE ${orderedIds.length} END`;

  const rows = db
    .prepare(
      `SELECT DISTINCT f.*
       FROM files f${where}
         AND f.id IN (${idListSql})
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as FileRow[];
  const total = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT f.id) AS count
         FROM files f${where}
           AND f.id IN (${idListSql})`,
      )
      .get(...params) as { count: number }
  ).count;

  return { rows, total, page, pageSize };
}

export function queryFilteredRows(
  db: Database.Database,
  filter: Record<string, unknown>,
  args: { page?: number; pageSize?: number },
): { rows: FileRow[]; total: number; page: number; pageSize: number } {
  if (String(filter.smart_view ?? "").trim() === "similar") {
    return queryDuplicateOrSimilarRows(db, filter, args);
  }

  const { page, pageSize, offset } = pageArgs(args.page, args.pageSize);
  const params: unknown[] = [];
  const where = appendFilterWhere(filter, params);
  const smartView = String(filter.smart_view ?? "").trim();
  const orderParams: unknown[] = [];
  let orderSql = buildOrderSql(
    filter.sort_by as string | undefined,
    filter.sort_direction as string | undefined,
    "f.",
  );

  if (smartView === "recent") {
    orderSql = "f.last_accessed_at DESC, f.imported_at DESC, f.id ASC";
  } else if (smartView === "random") {
    const rawSeed = Number(filter.smart_seed);
    const seed = Number.isInteger(rawSeed) ? Math.abs(rawSeed) + 1 : 1;
    orderSql = "ABS(((f.id * ?) + ?) % 2147483647) ASC, f.id ASC";
    orderParams.push(seed, seed * 97 + 13);
  }

  const rows = db
    .prepare(`SELECT DISTINCT f.* FROM files f${where} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, ...orderParams, pageSize, offset) as FileRow[];
  const total = (
    db.prepare(`SELECT COUNT(DISTINCT f.id) AS count FROM files f${where}`).get(...params) as {
      count: number;
    }
  ).count;
  return { rows, total, page, pageSize };
}

export function filterFiles(db: Database.Database, args: Record<string, unknown>): PaginatedFiles {
  const filter = (args.filter ?? {}) as Record<string, unknown>;
  const naturalLanguageQuery = String(filter.natural_language_query ?? "").trim();
  if (naturalLanguageQuery) {
    throw new Error("本地自然语言搜图迁移到 Electron 后暂未启用，请先使用文件名、标签或颜色筛选。");
  }

  const { rows, total, page, pageSize } = queryFilteredRows(db, filter, {
    page: args.page as number | undefined,
    pageSize: args.pageSize as number | undefined,
  });
  return paginated(db, rows, total, page, pageSize);
}

export function getSmartCollectionStats(db: Database.Database): SmartCollectionStats {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM files f WHERE f.deleted_at IS NULL AND f.missing_at IS NULL) AS all_count,
         (
           SELECT COUNT(*)
           FROM files f
           WHERE f.deleted_at IS NULL AND f.missing_at IS NULL AND f.folder_id IS NULL
         ) AS unclassified_count,
         (
           SELECT COUNT(*)
           FROM files f
           WHERE
             f.deleted_at IS NULL
             AND f.missing_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)
         ) AS untagged_count`,
    )
    .get() as {
    all_count: number;
    unclassified_count: number;
    untagged_count: number;
  };

  return {
    allCount: row.all_count,
    unclassifiedCount: row.unclassified_count,
    untaggedCount: row.untagged_count,
  };
}

export function touchFileLastAccessed(
  db: Database.Database,
  fileId: number,
  timestamp = currentTimestamp(),
): void {
  db.prepare("UPDATE files SET last_accessed_at = ?, updated_at = ? WHERE id = ?").run(
    timestamp,
    timestamp,
    fileId,
  );
}

export interface UpsertFileInput {
  path: string;
  name: string;
  ext: string;
  size: number;
  width: number;
  height: number;
  folderId: number | null;
  createdAt: string;
  modifiedAt: string;
  importedAt?: string;
  rating?: number;
  description?: string;
  sourceUrl?: string;
  dominantColor?: string;
  colorDistribution?: string;
  thumbHash?: string;
  contentHash?: string | null;
}

export function upsertFile(db: Database.Database, input: UpsertFileInput): number {
  const existing = getFileByPath(db, input.path);
  const importedAt = existing?.importedAt ?? input.importedAt ?? currentTimestamp();
  const rating = existing?.rating ?? input.rating ?? 0;
  const description = existing?.description ?? input.description ?? "";
  const sourceUrl = existing?.sourceUrl ?? input.sourceUrl ?? "";
  const dominantColor = existing?.dominantColor ?? input.dominantColor ?? "";
  const colorDistribution = existing?.colorDistribution ?? input.colorDistribution ?? "[]";
  const thumbHash = existing?.thumbHash ?? input.thumbHash ?? "";
  const rgb = parseHexColor(dominantColor);
  const now = currentTimestamp();
  const syncId = existing
    ? (db.prepare("SELECT sync_id FROM files WHERE id = ?").pluck().get(existing.id) as string)
    : generateSyncId("file");
  const existingContentHash = existing
    ? (db.prepare("SELECT content_hash FROM files WHERE id = ?").pluck().get(existing.id) as
        | string
        | null)
    : null;

  db.prepare(
    `INSERT INTO files (
      path, normalized_path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
      rating, description, source_url, dominant_color, dominant_r, dominant_g, dominant_b,
      color_distribution, thumb_hash, sync_id, content_hash, fs_modified_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_path) DO UPDATE SET
      path = excluded.path,
      normalized_path = excluded.normalized_path,
      name = excluded.name,
      ext = excluded.ext,
      size = excluded.size,
      width = excluded.width,
      height = excluded.height,
      folder_id = excluded.folder_id,
      created_at = excluded.created_at,
      modified_at = excluded.modified_at,
      imported_at = excluded.imported_at,
      rating = excluded.rating,
      description = excluded.description,
      source_url = excluded.source_url,
      dominant_color = excluded.dominant_color,
      dominant_r = excluded.dominant_r,
      dominant_g = excluded.dominant_g,
      dominant_b = excluded.dominant_b,
      color_distribution = excluded.color_distribution,
      thumb_hash = excluded.thumb_hash,
      content_hash = excluded.content_hash,
      fs_modified_at = excluded.fs_modified_at,
      deleted_at = NULL,
      missing_at = NULL`,
  ).run(
    input.path,
    normalizeStoredPath(input.path),
    input.name,
    input.ext.toLowerCase(),
    input.size,
    input.width,
    input.height,
    input.folderId,
    input.createdAt,
    input.modifiedAt,
    importedAt,
    rating,
    description,
    sourceUrl,
    dominantColor,
    rgb?.[0] ?? null,
    rgb?.[1] ?? null,
    rgb?.[2] ?? null,
    colorDistribution,
    thumbHash,
    syncId,
    input.contentHash ?? existingContentHash,
    input.modifiedAt,
    now,
  );
  return (
    db
      .prepare("SELECT id FROM files WHERE normalized_path = ?")
      .get(normalizeStoredPath(input.path)) as { id: number }
  ).id;
}

export function updateFileColorData(
  db: Database.Database,
  fileId: number,
  dominantColor: string,
  colorDistribution: string,
): void {
  const rgb = parseHexColor(dominantColor);
  db.prepare(
    "UPDATE files SET dominant_color = ?, dominant_r = ?, dominant_g = ?, dominant_b = ?, color_distribution = ? WHERE id = ?",
  ).run(
    dominantColor,
    rgb?.[0] ?? null,
    rgb?.[1] ?? null,
    rgb?.[2] ?? null,
    colorDistribution,
    fileId,
  );
}

export function updateFileThumbHash(
  db: Database.Database,
  fileId: number,
  thumbHash: string,
): void {
  db.prepare("UPDATE files SET thumb_hash = ? WHERE id = ?").run(thumbHash, fileId);
}

export function updateFileMetadata(
  db: Database.Database,
  fileId: number,
  rating: number,
  description: string,
  sourceUrl: string,
): void {
  db.prepare("UPDATE files SET rating = ?, description = ?, source_url = ? WHERE id = ?").run(
    rating,
    description,
    sourceUrl,
    fileId,
  );
}

export function updateFileDimensions(
  db: Database.Database,
  fileId: number,
  width: number,
  height: number,
): void {
  db.prepare("UPDATE files SET width = ?, height = ? WHERE id = ?").run(width, height, fileId);
}

export function updateFileNameRecord(
  db: Database.Database,
  fileId: number,
  name: string,
  filePath: string,
): void {
  db.prepare("UPDATE files SET name = ?, path = ?, normalized_path = ? WHERE id = ?").run(
    name,
    filePath,
    normalizeStoredPath(filePath),
    fileId,
  );
}

export function updateFilePathAndFolder(
  db: Database.Database,
  fileId: number,
  filePath: string,
  folderId: number | null,
): void {
  db.prepare(
    "UPDATE files SET path = ?, normalized_path = ?, name = ?, folder_id = ?, modified_at = ?, fs_modified_at = ? WHERE id = ?",
  ).run(
    filePath,
    normalizeStoredPath(filePath),
    path.basename(filePath),
    folderId,
    currentTimestamp(),
    currentTimestamp(),
    fileId,
  );
}

export function updateFileContentHash(
  db: Database.Database,
  fileId: number,
  contentHash: string | null,
): void {
  db.prepare("UPDATE files SET content_hash = ? WHERE id = ?").run(contentHash, fileId);
}

export function deleteFileByPath(db: Database.Database, filePath: string): void {
  db.prepare("DELETE FROM files WHERE normalized_path = ?").run(normalizeStoredPath(filePath));
}

export function markFileMissingByPath(db: Database.Database, filePath: string): boolean {
  const result = db
    .prepare(
      "UPDATE files SET missing_at = ? WHERE normalized_path = ? AND deleted_at IS NULL AND missing_at IS NULL",
    )
    .run(currentTimestamp(), normalizeStoredPath(filePath));
  return result.changes > 0;
}

export function markFilePresent(db: Database.Database, fileId: number): void {
  db.prepare("UPDATE files SET deleted_at = NULL, missing_at = NULL WHERE id = ?").run(fileId);
}

export function softDeleteFile(db: Database.Database, fileId: number): void {
  db.prepare("UPDATE files SET deleted_at = ?, missing_at = NULL WHERE id = ?").run(
    currentTimestamp(),
    fileId,
  );
}

export function restoreFileRecord(db: Database.Database, fileId: number): void {
  db.prepare("UPDATE files SET deleted_at = NULL, missing_at = NULL WHERE id = ?").run(fileId);
}

export function permanentDeleteFileRecord(db: Database.Database, fileId: number): void {
  db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
}

export function filePathsInDir(db: Database.Database, dirPath: string): Set<string> {
  const dirPathKey = normalizeStoredPath(dirPath);
  const rows = db
    .prepare("SELECT path FROM files WHERE normalized_path = ? OR normalized_path LIKE ?")
    .all(dirPathKey, `${dirPathKey}/%`) as Array<{ path: string }>;
  return new Set(rows.filter((row) => pathHasPrefix(row.path, dirPath)).map((row) => row.path));
}

export function isFileUnchanged(
  db: Database.Database,
  filePath: string,
  ext: string,
  size: number,
  modifiedAt: string,
): boolean {
  const row = db
    .prepare("SELECT ext, size, fs_modified_at FROM files WHERE normalized_path = ?")
    .get(normalizeStoredPath(filePath)) as
    | { ext: string; size: number; fs_modified_at: string }
    | undefined;
  return Boolean(
    row &&
    row.ext.toLowerCase() === ext.toLowerCase() &&
    row.size === size &&
    row.fs_modified_at === modifiedAt,
  );
}

export function updateFileBasicInfo(db: Database.Database, input: UpsertFileInput): void {
  db.prepare(
    `UPDATE files
     SET name = ?, ext = ?, size = ?, width = ?, height = ?, folder_id = ?,
         created_at = ?, modified_at = ?, fs_modified_at = ?, thumb_hash = ?, content_hash = ?,
         deleted_at = NULL, missing_at = NULL
     WHERE normalized_path = ?`,
  ).run(
    input.name,
    input.ext,
    input.size,
    input.width,
    input.height,
    input.folderId,
    input.createdAt,
    input.modifiedAt,
    input.modifiedAt,
    input.thumbHash ?? "",
    input.contentHash ?? null,
    normalizeStoredPath(input.path),
  );
}

export async function resolveAvailableTargetPath(
  db: Database.Database,
  sourcePath: string,
  targetFolderPath: string,
  currentFileId: number | null,
  conflictSuffix: string,
  allowSamePath: boolean,
): Promise<string> {
  const desiredPath = path.join(targetFolderPath, path.basename(sourcePath));
  if (allowSamePath && path.resolve(sourcePath) === path.resolve(desiredPath)) {
    return desiredPath;
  }

  const hasConflict = (candidate: string) => {
    const existing = getFileByPath(db, candidate);
    return fssync.existsSync(candidate) || Boolean(existing && existing.id !== currentFileId);
  };

  if (!hasConflict(desiredPath)) {
    return desiredPath;
  }

  const ext = path.extname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const suffix = `${conflictSuffix}_${Date.now().toString(16)}_${attempt}`;
    const candidate = path.join(targetFolderPath, `${stem}_${suffix}${ext}`);
    if (!hasConflict(candidate)) {
      return candidate;
    }
  }

  throw new Error("Failed to resolve available target path");
}
