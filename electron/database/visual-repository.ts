import Database from "better-sqlite3";
import type { FileRecord, PaginatedFiles } from "../types";
import { attachTags, currentTimestamp, makePlaceholders, pageArgs } from "./shared";
import { queryFilteredRows } from "./file-repository";

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
): FileVisualEmbeddingQuery | null {
  const row = db
    .prepare(
      `SELECT f.id, f.name, fve.model_id, fve.dimensions, fve.embedding
       FROM file_visual_embeddings fve
       JOIN files f ON f.id = fve.file_id
       WHERE f.id = ?
         AND f.deleted_at IS NULL
         AND f.missing_at IS NULL
         AND fve.status = 'ready'
         AND fve.embedding IS NOT NULL
         AND ${currentVisualSourceMatchSql()}
       LIMIT 1`,
    )
    .get(fileId) as
    | {
        id: number;
        name: string;
        model_id: string;
        dimensions: number;
        embedding: Buffer;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const embedding = decodeEmbeddingBlob(row.embedding, row.dimensions);
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
