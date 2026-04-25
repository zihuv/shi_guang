import Database from "better-sqlite3";

const SIMILAR_IMAGE_THRESHOLD = 0.94;

type ExactDuplicateGroup = {
  ids: number[];
  latestImportedAt: string;
};

type VisualEmbeddingCandidate = {
  id: number;
  importedAt: string;
  modelId: string;
  dimensions: number;
  embedding: Float32Array;
};

type SimilarImageGroup = {
  ids: number[];
  score: number;
  latestImportedAt: string;
};

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

class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index];
    if (parent === index) {
      return index;
    }
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent[rightRoot] = leftRoot;
    }
  }
}

function getExactDuplicateGroups(db: Database.Database): ExactDuplicateGroup[] {
  const rows = db
    .prepare(
      `SELECT id, content_hash, imported_at
       FROM files
       WHERE deleted_at IS NULL
         AND missing_at IS NULL
         AND NULLIF(content_hash, '') IS NOT NULL
         AND content_hash IN (
           SELECT content_hash
           FROM files
           WHERE deleted_at IS NULL
             AND missing_at IS NULL
             AND NULLIF(content_hash, '') IS NOT NULL
           GROUP BY content_hash
           HAVING COUNT(*) > 1
         )
       ORDER BY content_hash ASC, imported_at DESC, id ASC`,
    )
    .all() as Array<{ id: number; content_hash: string; imported_at: string }>;

  const groups = new Map<string, ExactDuplicateGroup>();
  for (const row of rows) {
    const group = groups.get(row.content_hash) ?? {
      ids: [],
      latestImportedAt: row.imported_at,
    };
    group.ids.push(row.id);
    if (row.imported_at > group.latestImportedAt) {
      group.latestImportedAt = row.imported_at;
    }
    groups.set(row.content_hash, group);
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (right.latestImportedAt !== left.latestImportedAt) {
      return right.latestImportedAt.localeCompare(left.latestImportedAt);
    }
    return left.ids[0] - right.ids[0];
  });
}

function getVisualEmbeddingCandidates(db: Database.Database): VisualEmbeddingCandidate[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.imported_at, fve.model_id, fve.dimensions, fve.embedding
       FROM file_visual_embeddings fve
       JOIN files f ON f.id = fve.file_id
       WHERE f.deleted_at IS NULL
         AND f.missing_at IS NULL
         AND fve.status = 'ready'
         AND fve.embedding IS NOT NULL
         AND ${currentVisualSourceMatchSql()}
       ORDER BY fve.model_id ASC, fve.dimensions ASC, f.imported_at DESC, f.id ASC`,
    )
    .all() as Array<{
    id: number;
    imported_at: string;
    model_id: string;
    dimensions: number;
    embedding: Buffer;
  }>;

  return rows
    .map((row) => {
      const embedding = decodeEmbeddingBlob(row.embedding, row.dimensions);
      if (!embedding) {
        return null;
      }
      return {
        id: row.id,
        importedAt: row.imported_at,
        modelId: row.model_id,
        dimensions: row.dimensions,
        embedding,
      };
    })
    .filter((candidate): candidate is VisualEmbeddingCandidate => Boolean(candidate));
}

function sortFileIdsByImportedAt(
  fileIds: Iterable<number>,
  importedAtByFileId: Map<number, string>,
): number[] {
  return Array.from(fileIds).sort((left, right) => {
    const rightImportedAt = importedAtByFileId.get(right) ?? "";
    const leftImportedAt = importedAtByFileId.get(left) ?? "";
    if (rightImportedAt !== leftImportedAt) {
      return rightImportedAt.localeCompare(leftImportedAt);
    }
    return left - right;
  });
}

function getSimilarImageGroups(candidates: VisualEmbeddingCandidate[]): SimilarImageGroup[] {
  const buckets = new Map<string, VisualEmbeddingCandidate[]>();
  for (const candidate of candidates) {
    const bucketKey = `${candidate.modelId}:${candidate.dimensions}`;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(candidate);
    buckets.set(bucketKey, bucket);
  }

  const groups: SimilarImageGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue;
    }

    const disjointSet = new DisjointSet(bucket.length);
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const score = dotProduct(bucket[left].embedding, bucket[right].embedding);
        if (score >= SIMILAR_IMAGE_THRESHOLD) {
          disjointSet.union(left, right);
        }
      }
    }

    const groupedIndexes = new Map<number, number[]>();
    for (let index = 0; index < bucket.length; index += 1) {
      const root = disjointSet.find(index);
      const indexes = groupedIndexes.get(root) ?? [];
      indexes.push(index);
      groupedIndexes.set(root, indexes);
    }

    for (const indexes of groupedIndexes.values()) {
      if (indexes.length < 2) {
        continue;
      }

      let score = 0;
      for (let left = 0; left < indexes.length; left += 1) {
        for (let right = left + 1; right < indexes.length; right += 1) {
          score = Math.max(
            score,
            dotProduct(bucket[indexes[left]].embedding, bucket[indexes[right]].embedding),
          );
        }
      }

      const files = indexes
        .map((index) => bucket[index])
        .sort((left, right) => {
          if (right.importedAt !== left.importedAt) {
            return right.importedAt.localeCompare(left.importedAt);
          }
          return left.id - right.id;
        });

      groups.push({
        ids: files.map((file) => file.id),
        score,
        latestImportedAt: files[0].importedAt,
      });
    }
  }

  return groups.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.latestImportedAt !== left.latestImportedAt) {
      return right.latestImportedAt.localeCompare(left.latestImportedAt);
    }
    return left.ids[0] - right.ids[0];
  });
}

export function getDuplicateOrSimilarFileIds(db: Database.Database): number[] {
  const exactGroups = getExactDuplicateGroups(db);
  const candidates = getVisualEmbeddingCandidates(db);
  const importedAtByFileId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.importedAt]),
  );
  const similarGroups = getSimilarImageGroups(candidates);
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  const consumedSimilarGroups = new Set<SimilarImageGroup>();

  for (const exactGroup of exactGroups) {
    const expandedIds = new Set(exactGroup.ids);
    for (const group of similarGroups) {
      if (group.ids.some((id) => expandedIds.has(id))) {
        consumedSimilarGroups.add(group);
        for (const id of group.ids) {
          expandedIds.add(id);
        }
      }
    }

    const exactIds = exactGroup.ids.filter((id) => !seen.has(id));
    const similarIds = sortFileIdsByImportedAt(expandedIds, importedAtByFileId).filter(
      (id) => !seen.has(id) && !exactGroup.ids.includes(id),
    );

    for (const id of [...exactIds, ...similarIds]) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  for (const group of similarGroups) {
    if (consumedSimilarGroups.has(group)) {
      continue;
    }
    for (const id of group.ids) {
      if (!seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }
  }

  return orderedIds;
}
