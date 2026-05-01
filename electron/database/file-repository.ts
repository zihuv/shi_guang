import Database from "better-sqlite3";
import {
  and,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import fssync from "node:fs";
import path from "node:path";
import { pathHasPrefix } from "../path-utils";
import type { FileRecord, PaginatedFiles, SmartCollectionStats } from "../types";
import { FILE_FORMAT_GROUPS } from "../../src/shared/file-formats";
import { fuzzySearchItems } from "../../src/shared/fuzzySearch";
import {
  attachTags,
  buildOrderSql,
  currentTimestamp,
  FileRow,
  generateSyncId,
  normalizeStoredPath,
  pageArgs,
  paginated,
  parseHexColor,
  toFileRow,
} from "./shared";
import { getDrizzleDb } from "./client";
import { fileTags, files as filesTable } from "./schema";
import { getDuplicateOrSimilarFileIds } from "./similarity-repository";

export function getFileById(db: Database.Database, fileId: number): FileRecord | null {
  const row = getDrizzleDb(db).select().from(filesTable).where(eq(filesTable.id, fileId)).get();
  const fileRow = row ? toFileRow(row) : undefined;
  return fileRow ? attachTags(db, [fileRow])[0] : null;
}

export function getFileByPath(db: Database.Database, filePath: string): FileRecord | null {
  const row = getDrizzleDb(db)
    .select()
    .from(filesTable)
    .where(eq(filesTable.normalizedPath, normalizeStoredPath(filePath)))
    .get();
  const fileRow = row ? toFileRow(row) : undefined;
  return fileRow ? attachTags(db, [fileRow])[0] : null;
}

export function findMoveCandidateByContentHash(
  db: Database.Database,
  contentHash: string,
): FileRecord | null {
  if (!contentHash) {
    return null;
  }
  const row = getDrizzleDb(db)
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.contentHash, contentHash), isNull(filesTable.deletedAt)))
    .orderBy(desc(sql`${filesTable.missingAt} IS NULL`), desc(filesTable.importedAt), filesTable.id)
    .limit(8)
    .all()
    .map(toFileRow);
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
  const activeWhere = and(isNull(filesTable.deletedAt), isNull(filesTable.missingAt));
  const rows = getDrizzleDb(db)
    .select()
    .from(filesTable)
    .where(activeWhere)
    .orderBy(sql.raw(orderSql))
    .limit(pageSize)
    .offset(offset)
    .all()
    .map(toFileRow);
  const total =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(activeWhere)
      .get()?.count ?? 0;
  return paginated(db, rows, total, page, pageSize);
}

export function searchFiles(db: Database.Database, args: Record<string, unknown>): PaginatedFiles {
  const query = String(args.query ?? "");
  return filterFiles(db, {
    filter: {
      query,
      sort_by: args.sortBy,
      sort_direction: args.sortDirection,
    },
    page: args.page,
    pageSize: args.pageSize,
  });
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
  const where = and(
    folderId == null ? isNull(filesTable.folderId) : eq(filesTable.folderId, Number(folderId)),
    isNull(filesTable.deletedAt),
    isNull(filesTable.missingAt),
  );
  const rows = getDrizzleDb(db)
    .select()
    .from(filesTable)
    .where(where)
    .orderBy(sql.raw(orderSql))
    .limit(pageSize)
    .offset(offset)
    .all()
    .map(toFileRow);
  const total =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(where)
      .get()?.count ?? 0;
  return paginated(db, rows, total, page, pageSize);
}

const FILE_TYPE_EXTENSIONS: Record<string, readonly string[]> = FILE_FORMAT_GROUPS;
type FuzzyFileCandidate = Pick<FileRow, "id" | "name">;
const FUZZY_FILE_KEYS = [(file: FuzzyFileCandidate) => path.parse(file.name).name];

function buildFilterWhere(db: Database.Database, filter: Record<string, unknown>): SQL {
  const conditions: SQL[] = [isNull(filesTable.deletedAt), isNull(filesTable.missingAt)];
  const query = String(filter.query ?? "").trim();
  if (query) {
    conditions.push(like(filesTable.name, `%${query}%`));
  }

  if (typeof filter.folder_id === "number") {
    conditions.push(eq(filesTable.folderId, filter.folder_id));
  }

  const smartView = String(filter.smart_view ?? "").trim();
  if (smartView === "unclassified") {
    conditions.push(isNull(filesTable.folderId));
  } else if (smartView === "untagged") {
    conditions.push(
      notExists(
        getDrizzleDb(db)
          .select({ one: sql`1` })
          .from(fileTags)
          .where(eq(fileTags.fileId, filesTable.id)),
      ),
    );
  } else if (smartView === "recent") {
    conditions.push(isNotNull(filesTable.lastAccessedAt));
  }

  const fileTypes = Array.isArray(filter.file_types) ? filter.file_types.map(String) : [];
  const extGroups = fileTypes.flatMap((type) => FILE_TYPE_EXTENSIONS[type] ?? []);
  if (extGroups.length) {
    conditions.push(inArray(sql`LOWER(${filesTable.ext})`, extGroups));
  }

  const dateStart = String(filter.date_start ?? "").trim();
  if (dateStart) {
    conditions.push(gte(filesTable.importedAt, dateStart));
  }
  const dateEnd = String(filter.date_end ?? "").trim();
  if (dateEnd) {
    conditions.push(lte(filesTable.importedAt, dateEnd));
  }

  if (typeof filter.size_min === "number") {
    conditions.push(gte(filesTable.size, filter.size_min));
  }
  if (typeof filter.size_max === "number") {
    conditions.push(lte(filesTable.size, filter.size_max));
  }
  if (typeof filter.min_rating === "number" && filter.min_rating > 0) {
    conditions.push(gte(filesTable.rating, filter.min_rating));
  }

  const tagIds = Array.isArray(filter.tag_ids)
    ? filter.tag_ids.filter((value) => typeof value === "number")
    : [];
  if (tagIds.length) {
    conditions.push(
      exists(
        getDrizzleDb(db)
          .select({ one: sql`1` })
          .from(fileTags)
          .where(and(eq(fileTags.fileId, filesTable.id), inArray(fileTags.tagId, tagIds))),
      ),
    );
  }

  const targetColor = String(filter.dominant_color ?? "").trim();
  if (targetColor) {
    const parsed = parseHexColor(targetColor);
    if (parsed) {
      const [r, g, b] = parsed;
      conditions.push(
        and(
          isNotNull(filesTable.dominantR),
          isNotNull(filesTable.dominantG),
          isNotNull(filesTable.dominantB),
          sql`(((${filesTable.dominantR} - ${r}) * (${filesTable.dominantR} - ${r})) + ((${filesTable.dominantG} - ${g}) * (${filesTable.dominantG} - ${g})) + ((${filesTable.dominantB} - ${b}) * (${filesTable.dominantB} - ${b}))) <= ${85 * 85}`,
        )!,
      );
    } else {
      conditions.push(sql`1 = 0`);
    }
  }

  return and(...conditions)!;
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

  const scopedFilter = { ...filter, smart_view: null };
  const where = and(buildFilterWhere(db, scopedFilter), inArray(filesTable.id, orderedIds));
  const orderSql = `CASE f.id ${orderedIds
    .map((id, index) => `WHEN ${id} THEN ${index}`)
    .join(" ")} ELSE ${orderedIds.length} END`;

  const rows = getDrizzleDb(db)
    .select()
    .from(filesTable)
    .where(where)
    .orderBy(sql.raw(orderSql.replace(/f\./g, "")))
    .limit(pageSize)
    .offset(offset)
    .all()
    .map(toFileRow);
  const total =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(where)
      .get()?.count ?? 0;

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
  const where = buildFilterWhere(db, filter);
  const smartView = String(filter.smart_view ?? "").trim();
  let orderByExpression = sql.raw(
    buildOrderSql(
      filter.sort_by as string | undefined,
      filter.sort_direction as string | undefined,
    ),
  );

  if (smartView === "recent") {
    orderByExpression = sql`${filesTable.lastAccessedAt} DESC, ${filesTable.importedAt} DESC, ${filesTable.id} ASC`;
  } else if (smartView === "random") {
    const rawSeed = Number(filter.smart_seed);
    const seed = Number.isInteger(rawSeed) ? Math.abs(rawSeed) + 1 : 1;
    orderByExpression = sql`ABS(((${filesTable.id} * ${seed}) + ${seed * 97 + 13}) % 2147483647) ASC, ${filesTable.id} ASC`;
  }

  const rows = getDrizzleDb(db)
    .select()
    .from(filesTable)
    .where(where)
    .orderBy(orderByExpression)
    .limit(pageSize)
    .offset(offset)
    .all()
    .map(toFileRow);
  const total =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(where)
      .get()?.count ?? 0;
  return { rows, total, page, pageSize };
}

function getFilesByOrderedIds(db: Database.Database, fileIds: number[]): FileRow[] {
  if (fileIds.length === 0) {
    return [];
  }

  const order = new Map(fileIds.map((id, index) => [id, index]));
  const rows: FileRow[] = [];
  const chunkSize = 500;

  for (let index = 0; index < fileIds.length; index += chunkSize) {
    const chunk = fileIds.slice(index, index + chunkSize);
    rows.push(
      ...getDrizzleDb(db)
        .select()
        .from(filesTable)
        .where(inArray(filesTable.id, chunk))
        .all()
        .map(toFileRow),
    );
  }

  rows.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  return rows;
}

function queryFuzzyFilteredRows(
  db: Database.Database,
  filter: Record<string, unknown>,
  args: { page?: number; pageSize?: number },
): { rows: FileRow[]; total: number; page: number; pageSize: number } {
  const query = String(filter.query ?? "").trim();
  const scopedFilter: Record<string, unknown> = { ...filter, query: null };
  const { page, pageSize, offset } = pageArgs(args.page, args.pageSize);
  const smartView = String(scopedFilter.smart_view ?? "").trim();

  const rowsForMatchedCandidates = (matchedCandidates: FuzzyFileCandidate[]) => {
    const pageIds = matchedCandidates.slice(offset, offset + pageSize).map((file) => file.id);
    return getFilesByOrderedIds(db, pageIds);
  };

  if (smartView === "similar") {
    const candidates = queryDuplicateOrSimilarRows(db, scopedFilter, {
      page: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
    }).rows.map((file) => ({ id: file.id, name: file.name }));
    const matchedRows = fuzzySearchItems(candidates, query, {
      keys: FUZZY_FILE_KEYS,
    });
    return {
      rows: rowsForMatchedCandidates(matchedRows),
      total: matchedRows.length,
      page,
      pageSize,
    };
  }

  const where = buildFilterWhere(db, scopedFilter);
  let orderByExpression = sql.raw(
    buildOrderSql(
      scopedFilter.sort_by as string | undefined,
      scopedFilter.sort_direction as string | undefined,
    ),
  );

  if (smartView === "recent") {
    orderByExpression = sql`${filesTable.lastAccessedAt} DESC, ${filesTable.importedAt} DESC, ${filesTable.id} ASC`;
  } else if (smartView === "random") {
    const rawSeed = Number(scopedFilter.smart_seed);
    const seed = Number.isInteger(rawSeed) ? Math.abs(rawSeed) + 1 : 1;
    orderByExpression = sql`ABS(((${filesTable.id} * ${seed}) + ${seed * 97 + 13}) % 2147483647) ASC, ${filesTable.id} ASC`;
  }

  const candidates = getDrizzleDb(db)
    .select({ id: filesTable.id, name: filesTable.name })
    .from(filesTable)
    .where(where)
    .orderBy(orderByExpression)
    .all() as FuzzyFileCandidate[];
  const matchedRows = fuzzySearchItems(candidates, query, {
    keys: FUZZY_FILE_KEYS,
  });

  return { rows: rowsForMatchedCandidates(matchedRows), total: matchedRows.length, page, pageSize };
}

export function filterFiles(db: Database.Database, args: Record<string, unknown>): PaginatedFiles {
  const filter = (args.filter ?? {}) as Record<string, unknown>;
  const query = String(filter.query ?? "").trim();
  const { rows, total, page, pageSize } = query
    ? queryFuzzyFilteredRows(db, filter, {
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      })
    : queryFilteredRows(db, filter, {
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
  return paginated(db, rows, total, page, pageSize);
}

export function getSmartCollectionStats(db: Database.Database): SmartCollectionStats {
  const activeWhere = and(isNull(filesTable.deletedAt), isNull(filesTable.missingAt));
  const allCount =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(activeWhere)
      .get()?.count ?? 0;
  const unclassifiedCount =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(and(activeWhere, isNull(filesTable.folderId)))
      .get()?.count ?? 0;
  const untaggedCount =
    getDrizzleDb(db)
      .select({ count: countDistinct(filesTable.id) })
      .from(filesTable)
      .where(
        and(
          activeWhere,
          notExists(
            getDrizzleDb(db)
              .select({ one: sql`1` })
              .from(fileTags)
              .where(eq(fileTags.fileId, filesTable.id)),
          ),
        ),
      )
      .get()?.count ?? 0;

  return {
    allCount,
    unclassifiedCount,
    untaggedCount,
  };
}

export function touchFileLastAccessed(
  db: Database.Database,
  fileId: number,
  timestamp = currentTimestamp(),
): void {
  getDrizzleDb(db)
    .update(filesTable)
    .set({ lastAccessedAt: timestamp, updatedAt: timestamp })
    .where(eq(filesTable.id, fileId))
    .run();
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
    ? getDrizzleDb(db)
        .select({ syncId: filesTable.syncId })
        .from(filesTable)
        .where(eq(filesTable.id, existing.id))
        .get()?.syncId
    : generateSyncId("file");
  const existingContentHash = existing
    ? (getDrizzleDb(db)
        .select({ contentHash: filesTable.contentHash })
        .from(filesTable)
        .where(eq(filesTable.id, existing.id))
        .get()?.contentHash ?? null)
    : null;

  getDrizzleDb(db)
    .insert(filesTable)
    .values({
      path: input.path,
      normalizedPath: normalizeStoredPath(input.path),
      name: input.name,
      ext: input.ext.toLowerCase(),
      size: input.size,
      width: input.width,
      height: input.height,
      folderId: input.folderId,
      createdAt: input.createdAt,
      modifiedAt: input.modifiedAt,
      importedAt,
      rating,
      description,
      sourceUrl,
      dominantColor,
      dominantR: rgb?.[0] ?? null,
      dominantG: rgb?.[1] ?? null,
      dominantB: rgb?.[2] ?? null,
      colorDistribution,
      thumbHash,
      syncId: syncId ?? generateSyncId("file"),
      contentHash: input.contentHash ?? existingContentHash,
      fsModifiedAt: input.modifiedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: filesTable.normalizedPath,
      set: {
        path: sql`excluded.path`,
        normalizedPath: sql`excluded.normalized_path`,
        name: sql`excluded.name`,
        ext: sql`excluded.ext`,
        size: sql`excluded.size`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        folderId: sql`excluded.folder_id`,
        createdAt: sql`excluded.created_at`,
        modifiedAt: sql`excluded.modified_at`,
        importedAt: sql`excluded.imported_at`,
        rating: sql`excluded.rating`,
        description: sql`excluded.description`,
        sourceUrl: sql`excluded.source_url`,
        dominantColor: sql`excluded.dominant_color`,
        dominantR: sql`excluded.dominant_r`,
        dominantG: sql`excluded.dominant_g`,
        dominantB: sql`excluded.dominant_b`,
        colorDistribution: sql`excluded.color_distribution`,
        thumbHash: sql`excluded.thumb_hash`,
        contentHash: sql`excluded.content_hash`,
        fsModifiedAt: sql`excluded.fs_modified_at`,
        deletedAt: null,
        missingAt: null,
      },
    })
    .run();
  const inserted = getDrizzleDb(db)
    .select({ id: filesTable.id })
    .from(filesTable)
    .where(eq(filesTable.normalizedPath, normalizeStoredPath(input.path)))
    .get();
  if (!inserted) {
    throw new Error("Failed to read upserted file");
  }
  return inserted.id;
}

export function updateFileColorData(
  db: Database.Database,
  fileId: number,
  dominantColor: string,
  colorDistribution: string,
): void {
  const rgb = parseHexColor(dominantColor);
  getDrizzleDb(db)
    .update(filesTable)
    .set({
      dominantColor,
      dominantR: rgb?.[0] ?? null,
      dominantG: rgb?.[1] ?? null,
      dominantB: rgb?.[2] ?? null,
      colorDistribution,
    })
    .where(eq(filesTable.id, fileId))
    .run();
}

export function updateFileThumbHash(
  db: Database.Database,
  fileId: number,
  thumbHash: string,
): void {
  getDrizzleDb(db).update(filesTable).set({ thumbHash }).where(eq(filesTable.id, fileId)).run();
}

export function updateFileMetadata(
  db: Database.Database,
  fileId: number,
  rating: number,
  description: string,
  sourceUrl: string,
): void {
  getDrizzleDb(db)
    .update(filesTable)
    .set({ rating, description, sourceUrl })
    .where(eq(filesTable.id, fileId))
    .run();
}

export function updateFileDimensions(
  db: Database.Database,
  fileId: number,
  width: number,
  height: number,
): void {
  getDrizzleDb(db).update(filesTable).set({ width, height }).where(eq(filesTable.id, fileId)).run();
}

export function updateFileNameRecord(
  db: Database.Database,
  fileId: number,
  name: string,
  filePath: string,
): void {
  getDrizzleDb(db)
    .update(filesTable)
    .set({ name, path: filePath, normalizedPath: normalizeStoredPath(filePath) })
    .where(eq(filesTable.id, fileId))
    .run();
}

export function updateFilePathAndFolder(
  db: Database.Database,
  fileId: number,
  filePath: string,
  folderId: number | null,
): void {
  const timestamp = currentTimestamp();
  getDrizzleDb(db)
    .update(filesTable)
    .set({
      path: filePath,
      normalizedPath: normalizeStoredPath(filePath),
      name: path.basename(filePath),
      folderId,
      modifiedAt: timestamp,
      fsModifiedAt: timestamp,
    })
    .where(eq(filesTable.id, fileId))
    .run();
}

export function updateFileContentHash(
  db: Database.Database,
  fileId: number,
  contentHash: string | null,
): void {
  getDrizzleDb(db).update(filesTable).set({ contentHash }).where(eq(filesTable.id, fileId)).run();
}

export function deleteFileByPath(db: Database.Database, filePath: string): void {
  getDrizzleDb(db)
    .delete(filesTable)
    .where(eq(filesTable.normalizedPath, normalizeStoredPath(filePath)))
    .run();
}

export function markFileMissingByPath(db: Database.Database, filePath: string): boolean {
  const result = getDrizzleDb(db)
    .update(filesTable)
    .set({ missingAt: currentTimestamp() })
    .where(
      and(
        eq(filesTable.normalizedPath, normalizeStoredPath(filePath)),
        isNull(filesTable.deletedAt),
        isNull(filesTable.missingAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function markFileMissing(db: Database.Database, fileId: number, missingAt: string): void {
  getDrizzleDb(db).update(filesTable).set({ missingAt }).where(eq(filesTable.id, fileId)).run();
}

export function markFilePresent(db: Database.Database, fileId: number): void {
  getDrizzleDb(db)
    .update(filesTable)
    .set({ deletedAt: null, missingAt: null })
    .where(eq(filesTable.id, fileId))
    .run();
}

export function softDeleteFile(db: Database.Database, fileId: number): void {
  getDrizzleDb(db)
    .update(filesTable)
    .set({ deletedAt: currentTimestamp(), missingAt: null })
    .where(eq(filesTable.id, fileId))
    .run();
}

export function restoreFileRecord(db: Database.Database, fileId: number): void {
  markFilePresent(db, fileId);
}

export function permanentDeleteFileRecord(db: Database.Database, fileId: number): void {
  getDrizzleDb(db).delete(filesTable).where(eq(filesTable.id, fileId)).run();
}

export function filePathsInDir(db: Database.Database, dirPath: string): Set<string> {
  const dirPathKey = normalizeStoredPath(dirPath);
  const rows = getDrizzleDb(db)
    .select({ path: filesTable.path })
    .from(filesTable)
    .where(
      or(
        eq(filesTable.normalizedPath, dirPathKey),
        like(filesTable.normalizedPath, `${dirPathKey}/%`),
      ),
    )
    .all();
  return new Set(rows.filter((row) => pathHasPrefix(row.path, dirPath)).map((row) => row.path));
}

export function isFileUnchanged(
  db: Database.Database,
  filePath: string,
  ext: string,
  size: number,
  modifiedAt: string,
): boolean {
  const row = getDrizzleDb(db)
    .select({ ext: filesTable.ext, size: filesTable.size, fsModifiedAt: filesTable.fsModifiedAt })
    .from(filesTable)
    .where(eq(filesTable.normalizedPath, normalizeStoredPath(filePath)))
    .get();
  return Boolean(
    row &&
    row.ext.toLowerCase() === ext.toLowerCase() &&
    row.size === size &&
    row.fsModifiedAt === modifiedAt,
  );
}

export function updateFileBasicInfo(db: Database.Database, input: UpsertFileInput): void {
  getDrizzleDb(db)
    .update(filesTable)
    .set({
      name: input.name,
      ext: input.ext,
      size: input.size,
      width: input.width,
      height: input.height,
      folderId: input.folderId,
      createdAt: input.createdAt,
      modifiedAt: input.modifiedAt,
      fsModifiedAt: input.modifiedAt,
      thumbHash: input.thumbHash ?? "",
      contentHash: input.contentHash ?? null,
      deletedAt: null,
      missingAt: null,
    })
    .where(eq(filesTable.normalizedPath, normalizeStoredPath(input.path)))
    .run();
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
