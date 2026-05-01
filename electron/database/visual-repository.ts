import Database from "better-sqlite3";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { FileRecord, PaginatedFiles } from "../types";
import { attachTags, currentTimestamp, pageArgs } from "./shared";
import { queryFilteredRows } from "./file-repository";
import { getDrizzleDb } from "./client";
import { fileVisualEmbeddings, files } from "./schema";
import { canVisualSearchImage } from "../../src/shared/file-formats";

export type VisualIndexCandidate = {
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

export type VisualIndexCounts = {
  totalImages: number;
  ready: number;
  error: number;
  pending: number;
  outdated: number;
};

export type FileVisualEmbeddingQuery = {
  fileId: number;
  fileName: string;
  modelId: string;
  embedding: Float32Array;
};

function isVisualSearchSupportedExtension(ext: string): boolean {
  return canVisualSearchImage(ext);
}

function currentVisualSourceMatchSql() {
  return sql`(
    (
      NULLIF(${fileVisualEmbeddings.sourceContentHash}, '') IS NOT NULL
      AND NULLIF(${files.contentHash}, '') IS NOT NULL
      AND ${fileVisualEmbeddings.sourceContentHash} = ${files.contentHash}
    )
    OR (
      (
        NULLIF(${fileVisualEmbeddings.sourceContentHash}, '') IS NULL
        OR NULLIF(${files.contentHash}, '') IS NULL
      )
      AND ${fileVisualEmbeddings.sourceSize} = ${files.size}
      AND ${fileVisualEmbeddings.sourceModifiedAt} = ${files.fsModifiedAt}
    )
  )`;
}

function outdatedVisualSourceMatchSql() {
  return sql`(
    (
      NULLIF(${fileVisualEmbeddings.sourceContentHash}, '') IS NOT NULL
      AND NULLIF(${files.contentHash}, '') IS NOT NULL
      AND ${fileVisualEmbeddings.sourceContentHash} != ${files.contentHash}
    )
    OR (
      (
        NULLIF(${fileVisualEmbeddings.sourceContentHash}, '') IS NULL
        OR NULLIF(${files.contentHash}, '') IS NULL
      )
      AND (
        ${fileVisualEmbeddings.sourceSize} != ${files.size}
        OR ${fileVisualEmbeddings.sourceModifiedAt} != ${files.fsModifiedAt}
      )
    )
  )`;
}

function toVisualIndexCandidate(row: {
  id: number;
  path: string;
  name: string;
  ext: string;
  size: number;
  fsModifiedAt: string;
  contentHash: string | null;
}): VisualIndexCandidate {
  return {
    file: {
      id: row.id,
      path: row.path,
      name: row.name,
      ext: row.ext,
    },
    sourceSize: row.size,
    sourceModifiedAt: row.fsModifiedAt,
    contentHash: row.contentHash ?? null,
  };
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
  const indexedAt = currentTimestamp();
  getDrizzleDb(db)
    .insert(fileVisualEmbeddings)
    .values({
      fileId: args.fileId,
      modelId: args.modelId,
      dimensions: args.dimensions,
      embedding: args.embedding,
      sourceSize: args.sourceSize,
      sourceModifiedAt: args.sourceModifiedAt,
      sourceContentHash: args.sourceContentHash,
      indexedAt,
      status: "ready",
      lastError: "",
    })
    .onConflictDoUpdate({
      target: fileVisualEmbeddings.fileId,
      set: {
        modelId: args.modelId,
        dimensions: args.dimensions,
        embedding: args.embedding,
        sourceSize: args.sourceSize,
        sourceModifiedAt: args.sourceModifiedAt,
        sourceContentHash: args.sourceContentHash,
        indexedAt,
        status: "ready",
        lastError: "",
      },
    })
    .run();
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
  const indexedAt = currentTimestamp();
  getDrizzleDb(db)
    .insert(fileVisualEmbeddings)
    .values({
      fileId: args.fileId,
      modelId: args.modelId,
      dimensions: 0,
      embedding: null,
      sourceSize: args.sourceSize,
      sourceModifiedAt: args.sourceModifiedAt,
      sourceContentHash: args.sourceContentHash,
      indexedAt,
      status: "error",
      lastError: args.error,
    })
    .onConflictDoUpdate({
      target: fileVisualEmbeddings.fileId,
      set: {
        modelId: args.modelId,
        dimensions: 0,
        embedding: null,
        sourceSize: args.sourceSize,
        sourceModifiedAt: args.sourceModifiedAt,
        sourceContentHash: args.sourceContentHash,
        indexedAt,
        status: "error",
        lastError: args.error,
      },
    })
    .run();
}

export function clearFileVisualEmbeddings(db: Database.Database): number {
  return getDrizzleDb(db).delete(fileVisualEmbeddings).run().changes;
}

export function getVisualIndexCandidate(
  db: Database.Database,
  fileId: number,
): VisualIndexCandidate | null {
  const row = getDrizzleDb(db)
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      ext: files.ext,
      size: files.size,
      fsModifiedAt: files.fsModifiedAt,
      contentHash: files.contentHash,
    })
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt), isNull(files.missingAt)))
    .get();
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
    sourceModifiedAt: row.fsModifiedAt,
    contentHash: row.contentHash ?? null,
  };
}

export function getVisualIndexCandidates(db: Database.Database): VisualIndexCandidate[] {
  const rows = getDrizzleDb(db)
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      ext: files.ext,
      size: files.size,
      fsModifiedAt: files.fsModifiedAt,
      contentHash: files.contentHash,
    })
    .from(files)
    .where(and(isNull(files.deletedAt), isNull(files.missingAt)))
    .orderBy(desc(files.importedAt), files.id)
    .all();
  return rows
    .filter((row) => isVisualSearchSupportedExtension(row.ext))
    .map(toVisualIndexCandidate);
}

export function getUnindexedVisualIndexCandidates(
  db: Database.Database,
  modelId: string,
): VisualIndexCandidate[] {
  const rows = getDrizzleDb(db)
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      ext: files.ext,
      size: files.size,
      fsModifiedAt: files.fsModifiedAt,
      contentHash: files.contentHash,
    })
    .from(files)
    .leftJoin(
      fileVisualEmbeddings,
      and(eq(fileVisualEmbeddings.fileId, files.id), eq(fileVisualEmbeddings.modelId, modelId)),
    )
    .where(
      and(
        isNull(files.deletedAt),
        isNull(files.missingAt),
        or(
          isNull(fileVisualEmbeddings.fileId),
          ne(fileVisualEmbeddings.status, "ready"),
          isNull(fileVisualEmbeddings.embedding),
          outdatedVisualSourceMatchSql(),
        ),
      ),
    )
    .orderBy(desc(files.importedAt), files.id)
    .all();
  return rows
    .filter((row) => isVisualSearchSupportedExtension(row.ext))
    .map(toVisualIndexCandidate);
}

export function getPendingVisualIndexCandidates(
  db: Database.Database,
  modelId: string,
): VisualIndexCandidate[] {
  const rows = getDrizzleDb(db)
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      ext: files.ext,
      size: files.size,
      fsModifiedAt: files.fsModifiedAt,
      contentHash: files.contentHash,
    })
    .from(files)
    .leftJoin(
      fileVisualEmbeddings,
      and(eq(fileVisualEmbeddings.fileId, files.id), eq(fileVisualEmbeddings.modelId, modelId)),
    )
    .where(
      and(
        isNull(files.deletedAt),
        isNull(files.missingAt),
        or(
          isNull(fileVisualEmbeddings.fileId),
          and(
            ne(fileVisualEmbeddings.status, "error"),
            or(ne(fileVisualEmbeddings.status, "ready"), isNull(fileVisualEmbeddings.embedding)),
          ),
          outdatedVisualSourceMatchSql(),
        ),
      ),
    )
    .orderBy(desc(files.importedAt), files.id)
    .all();
  return rows
    .filter((row) => isVisualSearchSupportedExtension(row.ext))
    .map(toVisualIndexCandidate);
}

export function isFileVisualEmbeddingReady(
  db: Database.Database,
  fileId: number,
  modelId: string,
): boolean {
  const row = getDrizzleDb(db)
    .select({ one: sql`1` })
    .from(fileVisualEmbeddings)
    .innerJoin(files, eq(files.id, fileVisualEmbeddings.fileId))
    .where(
      and(
        eq(files.id, fileId),
        isNull(files.deletedAt),
        isNull(files.missingAt),
        eq(fileVisualEmbeddings.modelId, modelId),
        eq(fileVisualEmbeddings.status, "ready"),
        isNotNull(fileVisualEmbeddings.embedding),
        currentVisualSourceMatchSql(),
      ),
    )
    .limit(1)
    .get();

  return Boolean(row);
}

export function getVisualIndexCounts(db: Database.Database, modelId: string): VisualIndexCounts {
  const rows = getDrizzleDb(db)
    .select({
      ext: files.ext,
      status: fileVisualEmbeddings.status,
      has_embedding: sql<number>`CASE WHEN ${fileVisualEmbeddings.embedding} IS NOT NULL THEN 1 ELSE 0 END`,
      is_current: sql<number>`CASE WHEN ${currentVisualSourceMatchSql()} THEN 1 ELSE 0 END`,
      is_outdated: sql<number>`CASE WHEN ${outdatedVisualSourceMatchSql()} THEN 1 ELSE 0 END`,
    })
    .from(files)
    .leftJoin(
      fileVisualEmbeddings,
      and(eq(fileVisualEmbeddings.fileId, files.id), eq(fileVisualEmbeddings.modelId, modelId)),
    )
    .where(and(isNull(files.deletedAt), isNull(files.missingAt)))
    .all();

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
  options: { excludeFileId?: number | null } = {},
): PaginatedFiles {
  const filter = {
    ...((args.filter ?? {}) as Record<string, unknown>),
    natural_language_query: null,
    image_query_file_id: null,
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

  const embeddingRows = getDrizzleDb(db)
    .select({
      file_id: fileVisualEmbeddings.fileId,
      dimensions: fileVisualEmbeddings.dimensions,
      embedding: fileVisualEmbeddings.embedding,
    })
    .from(fileVisualEmbeddings)
    .innerJoin(files, eq(files.id, fileVisualEmbeddings.fileId))
    .where(
      and(
        eq(fileVisualEmbeddings.modelId, modelId),
        eq(fileVisualEmbeddings.status, "ready"),
        isNotNull(fileVisualEmbeddings.embedding),
        isNull(files.deletedAt),
        isNull(files.missingAt),
        currentVisualSourceMatchSql(),
        inArray(
          fileVisualEmbeddings.fileId,
          candidateRows.map((row) => row.id),
        ),
      ),
    )
    .all();

  const embeddingMap = new Map<number, Float32Array>();
  for (const row of embeddingRows) {
    const embedding = row.embedding ? decodeEmbeddingBlob(row.embedding, row.dimensions) : null;
    if (embedding && embedding.length === queryEmbedding.length) {
      embeddingMap.set(row.file_id, embedding);
    }
  }

  const rankedRows = attachTags(db, candidateRows)
    .map((file) => {
      if (options.excludeFileId === file.id) {
        return null;
      }

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

export function getFileVisualEmbeddingQuery(
  db: Database.Database,
  fileId: number,
  modelId?: string,
): FileVisualEmbeddingQuery | null {
  const row = getDrizzleDb(db)
    .select({
      id: files.id,
      name: files.name,
      model_id: fileVisualEmbeddings.modelId,
      dimensions: fileVisualEmbeddings.dimensions,
      embedding: fileVisualEmbeddings.embedding,
    })
    .from(fileVisualEmbeddings)
    .innerJoin(files, eq(files.id, fileVisualEmbeddings.fileId))
    .where(
      and(
        eq(files.id, fileId),
        isNull(files.deletedAt),
        isNull(files.missingAt),
        eq(fileVisualEmbeddings.status, "ready"),
        isNotNull(fileVisualEmbeddings.embedding),
        modelId ? eq(fileVisualEmbeddings.modelId, modelId) : undefined,
        currentVisualSourceMatchSql(),
      ),
    )
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  const embedding = row.embedding ? decodeEmbeddingBlob(row.embedding, row.dimensions) : null;
  if (!embedding) {
    return null;
  }

  return {
    fileId: row.id,
    fileName: row.name,
    modelId: row.model_id,
    embedding,
  };
}
