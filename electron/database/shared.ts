import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import path from "node:path";
import type { FileRecord, FolderRecord, PaginatedFiles, TagRecord } from "../types";
import { getDrizzleDb } from "./client";
import { fileTags, tags } from "./schema";

export const BROWSER_COLLECTION_FOLDER_NAME = "浏览器采集";

let syncCounter = 0;

export function currentTimestamp(date = new Date()): string {
  return date.toISOString();
}

export function normalizeStoredPath(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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

export type FolderRow = {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  created_at: string;
  is_system: number;
  sort_order: number;
  deleted_at?: string | null;
};

export function toFile(row: FileRow, tags: TagRecord[] = []): FileRecord {
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

export function toFolder(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    parent_id: row.parent_id,
    created_at: row.created_at,
    isSystem: row.is_system === 1,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at ?? null,
  };
}

export function makePlaceholders(count: number): string {
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

  const rows = getDrizzleDb(db).all<{
    file_id: number;
    id: number;
    name: string;
    color: string;
    parent_id: number | null;
    sort_order: number;
  }>(sql`
    SELECT ${fileTags.fileId} AS file_id, ${tags.id} AS id, ${tags.name} AS name, ${tags.color} AS color,
      ${tags.parentId} AS parent_id, ${tags.sortOrder} AS sort_order
    FROM ${tags}
    INNER JOIN ${fileTags} ON ${tags.id} = ${fileTags.tagId}
    WHERE ${fileTags.fileId} IN (${sql.join(
      fileIds.map((fileId) => sql`${fileId}`),
      sql`, `,
    )})
    ORDER BY ${fileTags.fileId} ASC, file_tags.rowid ASC
  `);

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

export function buildOrderSql(
  sortBy?: string | null,
  sortDirection?: string | null,
  prefix = "",
): string {
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

export function pageArgs(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; offset: number } {
  const rawPageSize = Number.isFinite(pageSize ?? 100) ? Number(pageSize ?? 100) : 100;
  if (rawPageSize <= 0 || rawPageSize === Number.MAX_SAFE_INTEGER) {
    return {
      page: 1,
      pageSize: 2_147_483_647,
      offset: 0,
    };
  }

  const safePage = Math.max(1, Number.isFinite(page ?? 1) ? Number(page ?? 1) : 1);
  const safePageSize = Math.max(1, Math.min(500, rawPageSize));
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

export function paginated(
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
