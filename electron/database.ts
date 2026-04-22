import Database from "better-sqlite3";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathHasPrefix, replacePathPrefix } from "./path-utils";
import type {
  FileRecord,
  FolderRecord,
  FolderTreeNode,
  PaginatedFiles,
  SmartCollectionStats,
  TagRecord,
} from "./types";

export const BROWSER_COLLECTION_FOLDER_NAME = "浏览器采集";
export const BROWSER_COLLECTION_FOLDER_SORT_ORDER = -1;

let syncCounter = 0;

export function currentTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function generateSyncId(prefix: string): string {
  syncCounter += 1;
  return `${prefix}_${Date.now().toString(16)}${process.pid.toString(16)}${syncCounter.toString(16)}${crypto.randomBytes(4).toString("hex")}`;
}

export function parseHexColor(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function openDatabase(dbPath: string, indexPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT NOT NULL,
      is_system INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
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
      last_accessed_at TEXT DEFAULT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      dominant_color TEXT NOT NULL DEFAULT '',
      dominant_r INTEGER,
      dominant_g INTEGER,
      dominant_b INTEGER,
      color_distribution TEXT NOT NULL DEFAULT '[]',
      thumb_hash TEXT NOT NULL DEFAULT '',
      deleted_at TEXT DEFAULT NULL,
      missing_at TEXT DEFAULT NULL,
      sync_id TEXT NOT NULL UNIQUE,
      content_hash TEXT,
      fs_modified_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      sync_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (file_id, tag_id),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS index_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS file_visual_embeddings (
      file_id INTEGER PRIMARY KEY,
      model_id TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding BLOB,
      source_size INTEGER NOT NULL,
      source_modified_at TEXT NOT NULL,
      source_content_hash TEXT,
      indexed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS update_files_updated_at
    AFTER UPDATE ON files
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE files SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_folders_updated_at
    AFTER UPDATE ON folders
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE folders SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_tags_updated_at
    AFTER UPDATE ON tags
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE tags SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_file_tags_file_updated_at_insert
    AFTER INSERT ON file_tags
    FOR EACH ROW
    BEGIN
      UPDATE files SET updated_at = datetime('now', 'localtime') WHERE id = NEW.file_id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_file_tags_file_updated_at_delete
    AFTER DELETE ON file_tags
    FOR EACH ROW
    BEGIN
      UPDATE files SET updated_at = datetime('now', 'localtime') WHERE id = OLD.file_id;
    END;

    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_files_active_order ON files(deleted_at, imported_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_files_folder_active_order ON files(folder_id, deleted_at, imported_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_files_dominant_rgb ON files(dominant_r, dominant_g, dominant_b);
    CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash);
    CREATE INDEX IF NOT EXISTS idx_files_sync_id ON files(sync_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_sort_order ON folders(parent_id, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_folders_sync_id ON folders(sync_id);
    CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tags_parent_sort_order ON tags(parent_id, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_tags_sync_id ON tags(sync_id);
    CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id_file_id ON file_tags(tag_id, file_id);
    CREATE INDEX IF NOT EXISTS idx_file_visual_embeddings_model_status ON file_visual_embeddings(model_id, status);
  `);

  const fileColumns = (db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
  if (!fileColumns.includes("thumb_hash")) {
    db.exec("ALTER TABLE files ADD COLUMN thumb_hash TEXT NOT NULL DEFAULT ''");
  }
  if (!fileColumns.includes("missing_at")) {
    db.exec("ALTER TABLE files ADD COLUMN missing_at TEXT DEFAULT NULL");
  }
  if (!fileColumns.includes("last_accessed_at")) {
    db.exec("ALTER TABLE files ADD COLUMN last_accessed_at TEXT DEFAULT NULL");
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_files_active_order;
    DROP INDEX IF EXISTS idx_files_folder_active_order;
    CREATE INDEX IF NOT EXISTS idx_files_active_order ON files(deleted_at, missing_at, imported_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_files_folder_active_order ON files(folder_id, deleted_at, missing_at, imported_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_files_missing_at ON files(missing_at);
    CREATE INDEX IF NOT EXISTS idx_files_last_accessed_at ON files(last_accessed_at);
  `);

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('use_trash', 'true')").run();
  db.prepare("INSERT OR IGNORE INTO index_paths (path) VALUES (?)").run(indexPath);
  return db;
}

export type FileRow = {
  id: number;
  path: string;
  name: string;
  ext: string;
  size: number;
  width: number;
  height: number;
  folder_id: number | null;
  created_at: string;
  modified_at: string;
  imported_at: string;
  last_accessed_at: string | null;
  rating: number;
  description: string;
  source_url: string;
  dominant_color: string;
  color_distribution: string;
  thumb_hash: string;
  content_hash: string | null;
  deleted_at?: string | null;
  missing_at?: string | null;
};

type FolderRow = {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  created_at: string;
  is_system: number;
  sort_order: number;
};

function toFile(row: FileRow, tags: TagRecord[] = []): FileRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    ext: row.ext,
    size: row.size,
    width: row.width,
    height: row.height,
    folderId: row.folder_id,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    importedAt: row.imported_at,
    lastAccessedAt: row.last_accessed_at ?? null,
    rating: row.rating,
    description: row.description,
    sourceUrl: row.source_url,
    dominantColor: row.dominant_color,
    colorDistribution: row.color_distribution || "[]",
    thumbHash: row.thumb_hash || "",
    contentHash: row.content_hash ?? null,
    tags,
    deletedAt: row.deleted_at ?? null,
    missingAt: row.missing_at ?? null,
  };
}

function toFolder(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    parent_id: row.parent_id,
    created_at: row.created_at,
    isSystem: row.is_system === 1,
    sortOrder: row.sort_order,
  };
}

function makePlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function getTagsForFiles(
  db: Database.Database,
  fileIds: number[],
): Map<number, TagRecord[]> {
  const map = new Map<number, TagRecord[]>();
  if (!fileIds.length) {
    return map;
  }

  const rows = db
    .prepare(
      `SELECT ft.file_id, t.id, t.name, t.color, t.parent_id, t.sort_order
       FROM tags t
       INNER JOIN file_tags ft ON t.id = ft.tag_id
       WHERE ft.file_id IN (${makePlaceholders(fileIds.length)})
       ORDER BY ft.file_id ASC, ft.rowid ASC`,
    )
    .all(...fileIds) as Array<{
    file_id: number;
    id: number;
    name: string;
    color: string;
    parent_id: number | null;
    sort_order: number;
  }>;

  for (const row of rows) {
    const tags = map.get(row.file_id) ?? [];
    tags.push({
      id: row.id,
      name: row.name,
      color: row.color,
      count: 1,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
    });
    map.set(row.file_id, tags);
  }

  return map;
}

export function attachTags(db: Database.Database, rows: FileRow[]): FileRecord[] {
  const tagMap = getTagsForFiles(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toFile(row, tagMap.get(row.id) ?? []));
}

export function getFileById(db: Database.Database, fileId: number): FileRecord | null {
  const row = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId) as FileRow | undefined;
  return row ? attachTags(db, [row])[0] : null;
}

export function getFileByPath(db: Database.Database, filePath: string): FileRecord | null {
  const row = db.prepare("SELECT * FROM files WHERE path = ?").get(filePath) as FileRow | undefined;
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

export function getIndexPaths(db: Database.Database): string[] {
  return (
    db.prepare("SELECT path FROM index_paths ORDER BY id ASC LIMIT 1").all() as Array<{
      path: string;
    }>
  ).map((row) => row.path);
}

export function setIndexPath(db: Database.Database, indexPath: string): void {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM index_paths").run();
    db.prepare("INSERT INTO index_paths (path) VALUES (?)").run(indexPath);
  });
  transaction();
}

export function addIndexPath(db: Database.Database, indexPath: string): void {
  const current = getIndexPaths(db)[0];
  if (current && current !== indexPath) {
    throw new Error("Only one index path is supported");
  }
  db.prepare("INSERT OR IGNORE INTO index_paths (path) VALUES (?)").run(indexPath);
}

export function removeIndexPath(db: Database.Database, indexPath: string): void {
  db.prepare("DELETE FROM index_paths WHERE path = ?").run(indexPath);
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

function buildOrderSql(sortBy?: string | null, sortDirection?: string | null, prefix = ""): string {
  const direction = sortDirection === "asc" ? "ASC" : "DESC";
  const column = (name: string) => `${prefix}${name}`;
  switch (sortBy ?? "imported_at") {
    case "modified_at":
      return `${column("modified_at")} ${direction}, ${column("imported_at")} DESC, ${column("id")} ASC`;
    case "created_at":
      return `${column("created_at")} ${direction}, ${column("imported_at")} DESC, ${column("id")} ASC`;
    case "name":
      return `LOWER(${column("name")}) ${direction}, ${column("imported_at")} DESC, ${column("id")} ASC`;
    case "ext":
      return `LOWER(${column("ext")}) ${direction}, LOWER(${column("name")}) ASC, ${column("imported_at")} DESC, ${column("id")} ASC`;
    case "size":
      return `${column("size")} ${direction}, ${column("imported_at")} DESC, ${column("id")} ASC`;
    default:
      return `${column("imported_at")} ${direction}, ${column("id")} ASC`;
  }
}

function pageArgs(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; offset: number } {
  const safePage = Math.max(1, Number.isFinite(page ?? 1) ? Number(page ?? 1) : 1);
  const safePageSize = Math.max(
    1,
    Math.min(500, Number.isFinite(pageSize ?? 100) ? Number(pageSize ?? 100) : 100),
  );
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

function paginated(
  db: Database.Database,
  rows: FileRow[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedFiles {
  return {
    files: attachTags(db, rows),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
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

const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  image: [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
    "tiff",
    "tif",
    "avif",
    "psd",
    "ai",
    "eps",
    "raw",
    "cr2",
    "nef",
    "arw",
    "dng",
    "heic",
    "heif",
  ],
  video: ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v", "3gp"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "ods"],
};

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
  if (filter.favorites_only === true) {
    conditions.push("f.rating > 0");
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

type VisualIndexCandidate = {
  file: {
    id: number;
    path: string;
    name: string;
    ext: string;
  };
  sourceSize: number;
  sourceModifiedAt: string;
  contentHash: string | null;
};

type VisualIndexCounts = {
  totalImages: number;
  ready: number;
  error: number;
  pending: number;
  outdated: number;
};

const VISUAL_SEARCH_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "gif",
  "tif",
  "tiff",
  "ico",
  "avif",
  "heic",
  "heif",
]);

function isVisualSearchSupportedExtension(ext: string): boolean {
  return VISUAL_SEARCH_EXTENSIONS.has(ext.trim().toLowerCase());
}

function currentVisualSourceMatchSql(fileAlias = "f", embeddingAlias = "fve"): string {
  return `(
    (
      NULLIF(${embeddingAlias}.source_content_hash, '') IS NOT NULL
      AND NULLIF(${fileAlias}.content_hash, '') IS NOT NULL
      AND ${embeddingAlias}.source_content_hash = ${fileAlias}.content_hash
    )
    OR (
      (
        NULLIF(${embeddingAlias}.source_content_hash, '') IS NULL
        OR NULLIF(${fileAlias}.content_hash, '') IS NULL
      )
      AND ${embeddingAlias}.source_size = ${fileAlias}.size
      AND ${embeddingAlias}.source_modified_at = ${fileAlias}.fs_modified_at
    )
  )`;
}

function outdatedVisualSourceMatchSql(fileAlias = "f", embeddingAlias = "fve"): string {
  return `(
    (
      NULLIF(${embeddingAlias}.source_content_hash, '') IS NOT NULL
      AND NULLIF(${fileAlias}.content_hash, '') IS NOT NULL
      AND ${embeddingAlias}.source_content_hash != ${fileAlias}.content_hash
    )
    OR (
      (
        NULLIF(${embeddingAlias}.source_content_hash, '') IS NULL
        OR NULLIF(${fileAlias}.content_hash, '') IS NULL
      )
      AND (
        ${embeddingAlias}.source_size != ${fileAlias}.size
        OR ${embeddingAlias}.source_modified_at != ${fileAlias}.fs_modified_at
      )
    )
  )`;
}

function queryFilteredRows(
  db: Database.Database,
  filter: Record<string, unknown>,
  args: { page?: number; pageSize?: number },
): { rows: FileRow[]; total: number; page: number; pageSize: number } {
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

export function upsertFileVisualEmbedding(
  db: Database.Database,
  args: {
    fileId: number;
    modelId: string;
    dimensions: number;
    embedding: Buffer;
    sourceSize: number;
    sourceModifiedAt: string;
    sourceContentHash: string;
  },
): void {
  db.prepare(
    `INSERT INTO file_visual_embeddings (
      file_id, model_id, dimensions, embedding, source_size, source_modified_at, source_content_hash,
      indexed_at, status, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', '')
    ON CONFLICT(file_id) DO UPDATE SET
      model_id = excluded.model_id,
      dimensions = excluded.dimensions,
      embedding = excluded.embedding,
      source_size = excluded.source_size,
      source_modified_at = excluded.source_modified_at,
      source_content_hash = excluded.source_content_hash,
      indexed_at = excluded.indexed_at,
      status = 'ready',
      last_error = ''`,
  ).run(
    args.fileId,
    args.modelId,
    args.dimensions,
    args.embedding,
    args.sourceSize,
    args.sourceModifiedAt,
    args.sourceContentHash,
    currentTimestamp(),
  );
}

export function markFileVisualEmbeddingError(
  db: Database.Database,
  args: {
    fileId: number;
    modelId: string;
    sourceSize: number;
    sourceModifiedAt: string;
    sourceContentHash: string | null;
    error: string;
  },
): void {
  db.prepare(
    `INSERT INTO file_visual_embeddings (
      file_id, model_id, dimensions, embedding, source_size, source_modified_at, source_content_hash,
      indexed_at, status, last_error
    ) VALUES (?, ?, 0, NULL, ?, ?, ?, ?, 'error', ?)
    ON CONFLICT(file_id) DO UPDATE SET
      model_id = excluded.model_id,
      dimensions = 0,
      embedding = NULL,
      source_size = excluded.source_size,
      source_modified_at = excluded.source_modified_at,
      source_content_hash = excluded.source_content_hash,
      indexed_at = excluded.indexed_at,
      status = 'error',
      last_error = excluded.last_error`,
  ).run(
    args.fileId,
    args.modelId,
    args.sourceSize,
    args.sourceModifiedAt,
    args.sourceContentHash,
    currentTimestamp(),
    args.error,
  );
}

export function getVisualIndexCandidate(
  db: Database.Database,
  fileId: number,
): VisualIndexCandidate | null {
  const row = db
    .prepare(
      "SELECT id, path, name, ext, size, fs_modified_at, content_hash FROM files WHERE id = ? AND deleted_at IS NULL AND missing_at IS NULL",
    )
    .get(fileId) as
    | {
        id: number;
        path: string;
        name: string;
        ext: string;
        size: number;
        fs_modified_at: string;
        content_hash: string | null;
      }
    | undefined;
  if (!row || !isVisualSearchSupportedExtension(row.ext)) {
    return null;
  }
  return {
    file: {
      id: row.id,
      path: row.path,
      name: row.name,
      ext: row.ext,
    },
    sourceSize: row.size,
    sourceModifiedAt: row.fs_modified_at,
    contentHash: row.content_hash ?? null,
  };
}

export function getVisualIndexCandidates(db: Database.Database): VisualIndexCandidate[] {
  const rows = db
    .prepare(
      "SELECT id, path, name, ext, size, fs_modified_at, content_hash FROM files WHERE deleted_at IS NULL AND missing_at IS NULL ORDER BY imported_at DESC, id ASC",
    )
    .all() as Array<{
    id: number;
    path: string;
    name: string;
    ext: string;
    size: number;
    fs_modified_at: string;
    content_hash: string | null;
  }>;

  return rows
    .filter((row) => isVisualSearchSupportedExtension(row.ext))
    .map((row) => ({
      file: {
        id: row.id,
        path: row.path,
        name: row.name,
        ext: row.ext,
      },
      sourceSize: row.size,
      sourceModifiedAt: row.fs_modified_at,
      contentHash: row.content_hash ?? null,
    }));
}

export function getUnindexedVisualIndexCandidates(
  db: Database.Database,
  modelId: string,
): VisualIndexCandidate[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.path, f.name, f.ext, f.size, f.fs_modified_at, f.content_hash
     FROM files f
     LEFT JOIN file_visual_embeddings fve
       ON fve.file_id = f.id
      AND fve.model_id = ?
     WHERE f.deleted_at IS NULL AND f.missing_at IS NULL
       AND (
         fve.file_id IS NULL
         OR fve.status != 'ready'
         OR fve.embedding IS NULL
         OR ${outdatedVisualSourceMatchSql()}
       )
     ORDER BY f.imported_at DESC, f.id ASC`,
    )
    .all(modelId) as Array<{
    id: number;
    path: string;
    name: string;
    ext: string;
    size: number;
    fs_modified_at: string;
    content_hash: string | null;
  }>;

  return rows
    .filter((row) => isVisualSearchSupportedExtension(row.ext))
    .map((row) => ({
      file: {
        id: row.id,
        path: row.path,
        name: row.name,
        ext: row.ext,
      },
      sourceSize: row.size,
      sourceModifiedAt: row.fs_modified_at,
      contentHash: row.content_hash ?? null,
    }));
}

export function getVisualIndexCounts(db: Database.Database, modelId: string): VisualIndexCounts {
  const rows = db
    .prepare(
      `SELECT f.ext, fve.status, CASE WHEN fve.embedding IS NOT NULL THEN 1 ELSE 0 END AS has_embedding,
            CASE WHEN ${currentVisualSourceMatchSql()} THEN 1 ELSE 0 END AS is_current,
            CASE WHEN ${outdatedVisualSourceMatchSql()} THEN 1 ELSE 0 END AS is_outdated
     FROM files f
     LEFT JOIN file_visual_embeddings fve
       ON fve.file_id = f.id
      AND fve.model_id = ?
     WHERE f.deleted_at IS NULL AND f.missing_at IS NULL`,
    )
    .all(modelId) as Array<{
    ext: string;
    status: string | null;
    has_embedding: number;
    is_current: number;
    is_outdated: number;
  }>;

  let totalImages = 0;
  let ready = 0;
  let error = 0;
  let outdated = 0;

  for (const row of rows) {
    if (!isVisualSearchSupportedExtension(row.ext)) {
      continue;
    }
    totalImages += 1;
    if (row.is_outdated) {
      outdated += 1;
      continue;
    }
    if (row.is_current) {
      if (row.status === "ready" && row.has_embedding) {
        ready += 1;
      } else if (row.status === "error") {
        error += 1;
      }
    }
  }

  return {
    totalImages,
    ready,
    error,
    pending: Math.max(0, totalImages - ready - error - outdated),
    outdated,
  };
}

function decodeEmbeddingBlob(blob: Buffer, dimensions: number): Float32Array | null {
  if (dimensions <= 0 || blob.length !== dimensions * 4) {
    return null;
  }
  const values = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    values[index] = blob.readFloatLE(index * 4);
  }
  return values;
}

function dotProduct(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export function searchFilesByVisualEmbedding(
  db: Database.Database,
  args: Record<string, unknown>,
  modelId: string,
  queryEmbedding: Float32Array,
): PaginatedFiles {
  const filter = {
    ...((args.filter ?? {}) as Record<string, unknown>),
    natural_language_query: null,
  };
  const { page, pageSize } = pageArgs(
    args.page as number | undefined,
    args.pageSize as number | undefined,
  );
  const candidateRows = queryFilteredRows(db, filter, {
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
  }).rows;

  if (!candidateRows.length) {
    return {
      files: [],
      total: 0,
      page,
      page_size: pageSize,
      total_pages: 0,
      debugScores: [],
    };
  }

  const placeholders = makePlaceholders(candidateRows.length);
  const embeddingRows = db
    .prepare(
      `SELECT fve.file_id, fve.dimensions, fve.embedding
     FROM file_visual_embeddings fve
     JOIN files f ON f.id = fve.file_id
     WHERE fve.model_id = ?
       AND fve.status = 'ready'
       AND fve.embedding IS NOT NULL
       AND f.deleted_at IS NULL AND f.missing_at IS NULL
       AND ${currentVisualSourceMatchSql()}
       AND fve.file_id IN (${placeholders})`,
    )
    .all(modelId, ...candidateRows.map((row) => row.id)) as Array<{
    file_id: number;
    dimensions: number;
    embedding: Buffer;
  }>;

  const embeddingMap = new Map<number, Float32Array>();
  for (const row of embeddingRows) {
    const embedding = decodeEmbeddingBlob(row.embedding, row.dimensions);
    if (embedding && embedding.length === queryEmbedding.length) {
      embeddingMap.set(row.file_id, embedding);
    }
  }

  const rankedRows = attachTags(db, candidateRows)
    .map((file) => {
      const embedding = embeddingMap.get(file.id);
      if (!embedding) {
        return null;
      }
      return {
        file,
        score: dotProduct(embedding, queryEmbedding),
      };
    })
    .filter((value): value is { file: FileRecord; score: number } => Boolean(value))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.file.importedAt !== left.file.importedAt) {
        return right.file.importedAt.localeCompare(left.file.importedAt);
      }
      return left.file.id - right.file.id;
    });

  const offset = (page - 1) * pageSize;
  const pageItems = rankedRows.slice(offset, offset + pageSize);

  return {
    files: pageItems.map((item) => item.file),
    total: rankedRows.length,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(rankedRows.length / pageSize),
    debugScores:
      process.env.NODE_ENV === "development"
        ? pageItems.map((item) => ({
            fileId: item.file.id,
            name: item.file.name,
            score: item.score,
          }))
        : undefined,
  };
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
      path, name, ext, size, width, height, folder_id, created_at, modified_at, imported_at,
      rating, description, source_url, dominant_color, dominant_r, dominant_g, dominant_b,
      color_distribution, thumb_hash, sync_id, content_hash, fs_modified_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
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
  return (db.prepare("SELECT id FROM files WHERE path = ?").get(input.path) as { id: number }).id;
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

export function getAllFolders(db: Database.Database): FolderRecord[] {
  return (
    db
      .prepare(
        "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders ORDER BY sort_order ASC, created_at ASC",
      )
      .all() as FolderRow[]
  ).map(toFolder);
}

export function getFolderById(db: Database.Database, id: number): FolderRecord | null {
  const row = db
    .prepare(
      "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders WHERE id = ?",
    )
    .get(id) as FolderRow | undefined;
  return row ? toFolder(row) : null;
}

export function getFolderByPath(db: Database.Database, folderPath: string): FolderRecord | null {
  const row = db
    .prepare(
      "SELECT id, path, name, parent_id, created_at, is_system, sort_order FROM folders WHERE REPLACE(path, '\\\\', '/') = ?",
    )
    .get(folderPath.replace(/\\/g, "/")) as FolderRow | undefined;
  return row ? toFolder(row) : null;
}

export function createFolderRecord(
  db: Database.Database,
  folderPath: string,
  name: string,
  parentId: number | null,
  isSystem = false,
  sortOrder = 0,
): number {
  db.prepare(
    "INSERT INTO folders (path, name, parent_id, created_at, is_system, sort_order, sync_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    folderPath,
    name,
    parentId,
    currentTimestamp(),
    isSystem ? 1 : 0,
    sortOrder,
    generateSyncId("folder"),
    currentTimestamp(),
  );
  return Number(db.prepare("SELECT last_insert_rowid() AS id").pluck().get());
}

export function getOrCreateFolder(
  db: Database.Database,
  folderPath: string,
  indexPaths: string[],
): number | null {
  for (const indexPath of indexPaths) {
    if (!pathHasPrefix(folderPath, indexPath)) {
      continue;
    }

    if (path.resolve(folderPath) === path.resolve(indexPath)) {
      return null;
    }

    const existing = getFolderByPath(db, folderPath);
    if (existing) {
      return existing.id;
    }

    const parentPath = path.dirname(folderPath);
    const parentId =
      parentPath && parentPath !== folderPath
        ? getOrCreateFolder(db, parentPath, indexPaths)
        : null;
    return createFolderRecord(db, folderPath, path.basename(folderPath), parentId, false);
  }
  return null;
}

export function getFolderTree(db: Database.Database): FolderTreeNode[] {
  const folders = getAllFolders(db);
  const counts = new Map<number, number>(
    (
      db
        .prepare(
          "SELECT folder_id, COUNT(*) AS count FROM files WHERE folder_id IS NOT NULL AND deleted_at IS NULL AND missing_at IS NULL GROUP BY folder_id",
        )
        .all() as Array<{ folder_id: number; count: number }>
    ).map((row) => [row.folder_id, row.count]),
  );
  const children = new Map<number | null, FolderRecord[]>();
  for (const folder of folders) {
    const list = children.get(folder.parent_id) ?? [];
    list.push(folder);
    children.set(folder.parent_id, list);
  }

  const build = (folder: FolderRecord): FolderTreeNode => {
    const nested = [...(children.get(folder.id) ?? [])].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"),
    );
    return {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      children: nested.map(build),
      fileCount: counts.get(folder.id) ?? 0,
      isSystem: folder.isSystem,
      sortOrder: folder.sortOrder,
      parentId: folder.parent_id,
    };
  };

  return [...(children.get(null) ?? [])]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"),
    )
    .map(build);
}

export async function renameFolder(db: Database.Database, id: number, name: string): Promise<void> {
  const folder = getFolderById(db, id);
  if (!folder) {
    throw new Error("Folder not found");
  }
  const oldPath = folder.path;
  const newPath = path.join(path.dirname(oldPath), name);
  if (fssync.existsSync(oldPath)) {
    await fs.rename(oldPath, newPath);
  }
  db.transaction(() => {
    db.prepare("UPDATE folders SET name = ?, path = ? WHERE id = ?").run(name, newPath, id);
    for (const subfolder of getAllFolders(db)) {
      if (subfolder.id === id || !pathHasPrefix(subfolder.path, oldPath)) continue;
      const replaced = replacePathPrefix(subfolder.path, oldPath, newPath);
      if (replaced)
        db.prepare("UPDATE folders SET path = ? WHERE id = ?").run(replaced, subfolder.id);
    }
    const files = db.prepare("SELECT id, path FROM files").all() as Array<{
      id: number;
      path: string;
    }>;
    for (const file of files) {
      if (!pathHasPrefix(file.path, oldPath)) continue;
      const replaced = replacePathPrefix(file.path, oldPath, newPath);
      if (replaced) db.prepare("UPDATE files SET path = ? WHERE id = ?").run(replaced, file.id);
    }
  })();
}

async function movePathWithFallback(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

export async function moveFolderRecord(
  db: Database.Database,
  folderId: number,
  newParentId: number | null,
  sortOrder: number,
): Promise<void> {
  const folder = getFolderById(db, folderId);
  if (!folder) throw new Error("Folder not found");
  const indexPath = getIndexPaths(db)[0];
  const parentPath = newParentId ? getFolderById(db, newParentId)?.path : indexPath;
  if (!parentPath) throw new Error("No index path configured");
  const newPath = path.join(parentPath, folder.name);
  if (!fssync.existsSync(folder.path))
    throw new Error(`Source folder does not exist: ${folder.path}`);
  if (fssync.existsSync(newPath)) throw new Error(`Destination path already exists: ${newPath}`);
  await movePathWithFallback(folder.path, newPath);

  db.transaction(() => {
    db.prepare("UPDATE folders SET parent_id = ?, sort_order = ?, path = ? WHERE id = ?").run(
      newParentId,
      sortOrder,
      newPath,
      folderId,
    );
    for (const subfolder of getAllFolders(db)) {
      if (subfolder.id === folderId || !pathHasPrefix(subfolder.path, folder.path)) continue;
      const replaced = replacePathPrefix(subfolder.path, folder.path, newPath);
      if (replaced)
        db.prepare("UPDATE folders SET path = ? WHERE id = ?").run(replaced, subfolder.id);
    }
    const files = db.prepare("SELECT id, path FROM files").all() as Array<{
      id: number;
      path: string;
    }>;
    for (const file of files) {
      if (!pathHasPrefix(file.path, folder.path)) continue;
      const replaced = replacePathPrefix(file.path, folder.path, newPath);
      if (replaced) db.prepare("UPDATE files SET path = ? WHERE id = ?").run(replaced, file.id);
    }
  })();
}

export function getAllTags(db: Database.Database): TagRecord[] {
  return (
    db
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(f.id) AS count, t.parent_id, t.sort_order
     FROM tags t
     LEFT JOIN file_tags ft ON t.id = ft.tag_id
     LEFT JOIN files f ON f.id = ft.file_id AND f.deleted_at IS NULL AND f.missing_at IS NULL
     GROUP BY t.id
     ORDER BY COALESCE(t.parent_id, t.id), t.sort_order ASC, t.name ASC`,
      )
      .all() as Array<{
      id: number;
      name: string;
      color: string;
      count: number;
      parent_id: number | null;
      sort_order: number;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    count: row.count,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  }));
}

export function createTag(
  db: Database.Database,
  name: string,
  color: string,
  parentId: number | null,
): number {
  db.prepare(
    "INSERT INTO tags (name, color, parent_id, sync_id, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(name, color, parentId, generateSyncId("tag"), currentTimestamp());
  return Number(db.prepare("SELECT last_insert_rowid() AS id").pluck().get());
}

export function updateTag(db: Database.Database, id: number, name: string, color: string): void {
  db.prepare("UPDATE tags SET name = ?, color = ? WHERE id = ?").run(name, color, id);
}

export function deleteTag(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function addTagToFile(db: Database.Database, fileId: number, tagId: number): void {
  db.prepare("INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)").run(fileId, tagId);
}

export function removeTagFromFile(db: Database.Database, fileId: number, tagId: number): void {
  db.prepare("DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?").run(fileId, tagId);
}

export function reorderTags(
  db: Database.Database,
  tagIds: number[],
  parentId: number | null,
): void {
  const transaction = db.transaction(() => {
    tagIds.forEach((tagId, index) => {
      db.prepare("UPDATE tags SET sort_order = ?, parent_id = ? WHERE id = ?").run(
        index,
        parentId,
        tagId,
      );
    });
  });
  transaction();
}

export function moveTag(
  db: Database.Database,
  tagId: number,
  newParentId: number | null,
  sortOrder: number,
): void {
  db.prepare("UPDATE tags SET parent_id = ?, sort_order = ? WHERE id = ?").run(
    newParentId,
    sortOrder,
    tagId,
  );
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
  db.prepare("UPDATE files SET name = ?, path = ? WHERE id = ?").run(name, filePath, fileId);
}

export function updateFilePathAndFolder(
  db: Database.Database,
  fileId: number,
  filePath: string,
  folderId: number | null,
): void {
  db.prepare(
    "UPDATE files SET path = ?, name = ?, folder_id = ?, modified_at = ?, fs_modified_at = ? WHERE id = ?",
  ).run(
    filePath,
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
  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
}

export function markFileMissingByPath(db: Database.Database, filePath: string): boolean {
  const result = db
    .prepare(
      "UPDATE files SET missing_at = ? WHERE path = ? AND deleted_at IS NULL AND missing_at IS NULL",
    )
    .run(currentTimestamp(), filePath);
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

export function getTrashFiles(db: Database.Database): FileRecord[] {
  const rows = db
    .prepare("SELECT * FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC")
    .all() as FileRow[];
  return attachTags(db, rows);
}

export function getTrashCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NOT NULL").get() as {
      count: number;
    }
  ).count;
}

export function getDeleteMode(db: Database.Database): boolean {
  return getSetting(db, "use_trash") !== "false";
}

export function setDeleteMode(db: Database.Database, useTrash: boolean): void {
  setSetting(db, "use_trash", useTrash ? "true" : "false");
}

export function reorderFolders(db: Database.Database, folderIds: number[]): void {
  const transaction = db.transaction(() => {
    folderIds.forEach((folderId, index) => {
      db.prepare("UPDATE folders SET sort_order = ? WHERE id = ?").run(index, folderId);
    });
  });
  transaction();
}

export function deleteFolderRecord(db: Database.Database, folderId: number): void {
  db.prepare("DELETE FROM folders WHERE id = ?").run(folderId);
}

export function clearFilesFolderId(db: Database.Database, folderIds: number[]): void {
  const transaction = db.transaction(() => {
    for (const folderId of folderIds) {
      db.prepare("UPDATE files SET folder_id = NULL WHERE folder_id = ?").run(folderId);
    }
  });
  transaction();
}

export function filePathsInDir(db: Database.Database, dirPath: string): Set<string> {
  const rows = db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;
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
    .prepare("SELECT ext, size, fs_modified_at FROM files WHERE path = ?")
    .get(filePath) as { ext: string; size: number; fs_modified_at: string } | undefined;
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
     WHERE path = ?`,
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
    input.path,
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

export async function moveFileWithFallback(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}
