use super::*;
use rayon::prelude::*;
use rusqlite::{params, OptionalExtension};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;

const EMBEDDING_FETCH_CHUNK_SIZE: usize = 500;

#[derive(Debug, Clone)]
pub struct VisualIndexSourceFile {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
}

#[derive(Debug, Clone)]
pub struct VisualIndexCandidate {
    pub file: VisualIndexSourceFile,
    pub source_size: i64,
    pub source_modified_at: String,
}

#[derive(Debug, Clone)]
pub struct VisualIndexRetryCandidate {
    pub file_id: i64,
    pub path: String,
    pub ext: String,
    pub last_error: String,
}

#[derive(Debug, Clone, Copy)]
pub struct VisualIndexCounts {
    pub total_images: i64,
    pub ready: i64,
    pub error: i64,
    pub pending: i64,
    pub outdated: i64,
}

#[derive(Debug)]
pub struct VisualSearchResult {
    pub files: Vec<FileWithTags>,
    pub total: i64,
    pub debug_scores: Option<Vec<crate::commands::VisualSearchDebugScore>>,
}

#[derive(Debug)]
struct EmbeddingRecord {
    file_id: i64,
    dimensions: usize,
    embedding: Vec<u8>,
}

#[derive(Debug)]
struct RankedFile {
    score: f32,
    file: FileWithTags,
}

impl Database {
    pub fn upsert_file_visual_embedding(
        &self,
        file_id: i64,
        model_id: &str,
        dimensions: usize,
        embedding: &[u8],
        source_size: i64,
        source_modified_at: &str,
        source_content_hash: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO file_visual_embeddings (
                file_id, model_id, dimensions, embedding, source_size, source_modified_at, source_content_hash, indexed_at, status, last_error
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ''
            )
            ON CONFLICT(file_id) DO UPDATE SET
                model_id = excluded.model_id,
                dimensions = excluded.dimensions,
                embedding = excluded.embedding,
                source_size = excluded.source_size,
                source_modified_at = excluded.source_modified_at,
                source_content_hash = excluded.source_content_hash,
                indexed_at = excluded.indexed_at,
                status = 'ready',
                last_error = ''",
            params![
                file_id,
                model_id,
                dimensions as i64,
                embedding,
                source_size,
                source_modified_at,
                source_content_hash,
                current_timestamp(),
            ],
        )?;
        Ok(())
    }

    pub fn mark_file_visual_embedding_error(
        &self,
        file_id: i64,
        model_id: &str,
        source_size: i64,
        source_modified_at: &str,
        source_content_hash: Option<&str>,
        error: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO file_visual_embeddings (
                file_id, model_id, dimensions, embedding, source_size, source_modified_at, source_content_hash, indexed_at, status, last_error
            ) VALUES (
                ?1, ?2, 0, NULL, ?3, ?4, ?5, ?6, 'error', ?7
            )
            ON CONFLICT(file_id) DO UPDATE SET
                model_id = excluded.model_id,
                dimensions = 0,
                embedding = NULL,
                source_size = excluded.source_size,
                source_modified_at = excluded.source_modified_at,
                source_content_hash = excluded.source_content_hash,
                indexed_at = excluded.indexed_at,
                status = 'error',
                last_error = excluded.last_error",
            params![
                file_id,
                model_id,
                source_size,
                source_modified_at,
                source_content_hash,
                current_timestamp(),
                error,
            ],
        )?;
        Ok(())
    }

    pub fn get_visual_index_candidate(&self, file_id: i64) -> Result<Option<VisualIndexCandidate>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, path, name, ext, size, fs_modified_at
                 FROM files
                 WHERE id = ?1
                   AND deleted_at IS NULL",
                [file_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, path, name, ext, source_size, source_modified_at)) = row else {
            return Ok(None);
        };
        if !is_supported_visual_index_path(&path) {
            return Ok(None);
        }

        Ok(Some(VisualIndexCandidate {
            source_size,
            source_modified_at,
            file: VisualIndexSourceFile {
                id,
                path,
                name,
                ext,
            },
        }))
    }

    pub fn get_visual_index_candidates(&self) -> Result<Vec<VisualIndexCandidate>> {
        let sql = "SELECT id, path, name, ext, size, fs_modified_at
             FROM files
             WHERE deleted_at IS NULL
             ORDER BY imported_at DESC, id ASC";

        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(VisualIndexCandidate {
                    file: VisualIndexSourceFile {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        name: row.get(2)?,
                        ext: row.get(3)?,
                    },
                    source_size: row.get(4)?,
                    source_modified_at: row.get(5)?,
                })
            })?
            .flatten()
            .filter(|candidate| is_supported_visual_index_path(&candidate.file.path))
            .collect::<Vec<_>>();

        Ok(rows)
    }

    pub fn get_unindexed_visual_index_candidates(
        &self,
        model_id: &str,
    ) -> Result<Vec<VisualIndexCandidate>> {
        let sql = format!(
            "SELECT f.id, f.path, f.name, f.ext, f.size, f.fs_modified_at
             FROM files f
             LEFT JOIN file_visual_embeddings fve
               ON fve.file_id = f.id
              AND fve.model_id = ?1
              WHERE f.deleted_at IS NULL
                AND (
                    fve.file_id IS NULL
                    OR fve.status != 'ready'
                    OR fve.embedding IS NULL
                    OR {}
               )
             ORDER BY f.imported_at DESC, f.id ASC",
            outdated_visual_source_match_sql()
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map([model_id], |row| {
                Ok(VisualIndexCandidate {
                    file: VisualIndexSourceFile {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        name: row.get(2)?,
                        ext: row.get(3)?,
                    },
                    source_size: row.get(4)?,
                    source_modified_at: row.get(5)?,
                })
            })?
            .flatten()
            .filter(|candidate| is_supported_visual_index_path(&candidate.file.path))
            .collect::<Vec<_>>();

        Ok(rows)
    }

    pub fn get_visual_index_counts(&self, model_id: &str) -> Result<VisualIndexCounts> {
        let sql = format!(
            "SELECT
                f.path,
                fve.status,
                CASE WHEN fve.embedding IS NOT NULL THEN 1 ELSE 0 END,
                CASE WHEN {} THEN 1 ELSE 0 END,
                CASE WHEN {} THEN 1 ELSE 0 END
             FROM files f
             LEFT JOIN file_visual_embeddings fve
               ON fve.file_id = f.id
              AND fve.model_id = ?1
             WHERE f.deleted_at IS NULL",
            current_visual_source_match_sql(),
            outdated_visual_source_match_sql()
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([model_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(4)? != 0,
            ))
        })?;

        let mut total_images = 0i64;
        let mut ready = 0i64;
        let mut error = 0i64;
        let mut outdated = 0i64;

        for row in rows.flatten() {
            let (path, status, has_embedding, is_current, is_outdated) = row;
            if !is_supported_visual_index_path(&path) {
                continue;
            }
            total_images += 1;
            if is_outdated {
                outdated += 1;
                continue;
            }
            if is_current {
                match status.as_deref() {
                    Some("ready") if has_embedding => ready += 1,
                    Some("error") => error += 1,
                    _ => {}
                }
            }
        }

        let pending = (total_images - ready - error - outdated).max(0i64);

        Ok(VisualIndexCounts {
            total_images,
            ready,
            error,
            pending,
            outdated,
        })
    }

    pub fn get_visual_index_retry_candidates(
        &self,
        model_id: &str,
    ) -> Result<Vec<VisualIndexRetryCandidate>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT f.id, f.path, f.ext, fve.last_error
             FROM file_visual_embeddings fve
             JOIN files f ON f.id = fve.file_id
             WHERE fve.model_id = ?1
               AND fve.status = 'error'
               AND f.deleted_at IS NULL
                AND {}
               ORDER BY f.id ASC",
            current_visual_source_match_sql()
        ))?;

        let rows = stmt.query_map([model_id], |row| {
            Ok(VisualIndexRetryCandidate {
                file_id: row.get(0)?,
                path: row.get(1)?,
                ext: row.get(2)?,
                last_error: row.get(3)?,
            })
        })?;

        Ok(rows
            .flatten()
            .filter(|candidate| is_supported_visual_index_path(&candidate.path))
            .collect())
    }

    pub fn search_files_by_visual_embedding(
        &self,
        mut filter: crate::commands::FileFilter,
        model_id: &str,
        query_embedding: &[f32],
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<VisualSearchResult> {
        filter.natural_language_query = None;

        let candidates = self.filter_files(filter, None, None)?;
        if candidates.is_empty() {
            return Ok(VisualSearchResult {
                files: Vec::new(),
                total: 0,
                debug_scores: None,
            });
        }

        let candidate_ids = candidates.iter().map(|file| file.id).collect::<Vec<_>>();
        let embedding_map = self.get_visual_embeddings_for_files(&candidate_ids, model_id)?;

        let mut ranked = candidates
            .into_par_iter()
            .filter_map(|file| {
                let score = embedding_map.get(&file.id).and_then(|record| {
                    cosine_similarity_from_blob(
                        &record.embedding,
                        record.dimensions,
                        query_embedding,
                    )
                })?;

                Some(RankedFile { score, file })
            })
            .collect::<Vec<_>>();

        ranked.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.file.imported_at.cmp(&left.file.imported_at))
                .then_with(|| left.file.id.cmp(&right.file.id))
        });

        let total = ranked.len() as i64;
        let start = offset.unwrap_or(0).max(0) as usize;
        let end = if let Some(limit) = limit {
            start.saturating_add(limit.max(0) as usize)
        } else {
            ranked.len()
        };

        let page_items = ranked
            .into_iter()
            .skip(start)
            .take(end.saturating_sub(start))
            .collect::<Vec<_>>();

        #[cfg(debug_assertions)]
        let debug_scores = Some(
            page_items
                .iter()
                .map(|item| crate::commands::VisualSearchDebugScore {
                    file_id: item.file.id,
                    name: item.file.name.clone(),
                    score: item.score,
                })
                .collect(),
        );

        #[cfg(not(debug_assertions))]
        let debug_scores = None;

        let files = page_items.into_iter().map(|item| item.file).collect();

        Ok(VisualSearchResult {
            files,
            total,
            debug_scores,
        })
    }

    fn get_visual_embeddings_for_files(
        &self,
        file_ids: &[i64],
        model_id: &str,
    ) -> Result<HashMap<i64, EmbeddingRecord>> {
        if file_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut result = HashMap::new();

        for chunk in file_ids.chunks(EMBEDDING_FETCH_CHUNK_SIZE) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!(
                "SELECT fve.file_id, fve.dimensions, fve.embedding
                 FROM file_visual_embeddings fve
                 JOIN files f ON f.id = fve.file_id
                 WHERE fve.model_id = ?
                   AND fve.status = 'ready'
                   AND fve.embedding IS NOT NULL
                   AND f.deleted_at IS NULL
                   AND {}
                   AND fve.file_id IN ({placeholders})",
                current_visual_source_match_sql()
            );

            let mut stmt = self.conn.prepare(&sql)?;
            let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
                vec![Box::new(model_id.to_string())];
            for file_id in chunk {
                params_vec.push(Box::new(*file_id));
            }
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                params_vec.iter().map(|param| param.as_ref()).collect();

            let rows = stmt.query_map(params_refs.as_slice(), |row| {
                Ok(EmbeddingRecord {
                    file_id: row.get(0)?,
                    dimensions: row.get::<_, i64>(1)? as usize,
                    embedding: row.get(2)?,
                })
            })?;

            for row in rows.flatten() {
                result.insert(row.file_id, row);
            }
        }

        Ok(result)
    }
}

fn is_supported_visual_index_path(path: &str) -> bool {
    crate::media::probe_media_path(Path::new(path))
        .map(|probe| probe.is_visual_search_supported())
        .unwrap_or(false)
}

fn current_visual_source_match_sql() -> &'static str {
    "(
        (
            NULLIF(fve.source_content_hash, '') IS NOT NULL
            AND NULLIF(f.content_hash, '') IS NOT NULL
            AND fve.source_content_hash = f.content_hash
        )
        OR (
            (
                NULLIF(fve.source_content_hash, '') IS NULL
                OR NULLIF(f.content_hash, '') IS NULL
            )
            AND fve.source_size = f.size
            AND fve.source_modified_at = f.fs_modified_at
        )
    )"
}

fn outdated_visual_source_match_sql() -> &'static str {
    "(
        (
            NULLIF(fve.source_content_hash, '') IS NOT NULL
            AND NULLIF(f.content_hash, '') IS NOT NULL
            AND fve.source_content_hash != f.content_hash
        )
        OR (
            (
                NULLIF(fve.source_content_hash, '') IS NULL
                OR NULLIF(f.content_hash, '') IS NULL
            )
            AND (
                fve.source_size != f.size
                OR fve.source_modified_at != f.fs_modified_at
            )
        )
    )"
}

fn cosine_similarity_from_blob(
    blob: &[u8],
    dimensions: usize,
    query_embedding: &[f32],
) -> Option<f32> {
    if dimensions == 0 || dimensions != query_embedding.len() || blob.len() != dimensions * 4 {
        return None;
    }

    let mut score = 0.0f32;
    for (index, chunk) in blob.chunks_exact(4).enumerate() {
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        score += value * query_embedding[index];
    }

    Some(score)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::path::{Path, PathBuf};

    fn embedding_blob(values: &[f32]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(values.len() * std::mem::size_of::<f32>());
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    fn make_filter(query: &str) -> crate::commands::FileFilter {
        crate::commands::FileFilter {
            query: None,
            natural_language_query: Some(query.to_string()),
            folder_id: None,
            file_types: None,
            date_start: None,
            date_end: None,
            size_min: None,
            size_max: None,
            tag_ids: None,
            min_rating: None,
            favorites_only: None,
            dominant_color: None,
            sort_by: None,
            sort_direction: None,
        }
    }

    fn make_file_record(path: &str, name: &str) -> FileRecord {
        let now = current_timestamp();
        FileRecord {
            id: 0,
            path: path.to_string(),
            name: name.to_string(),
            ext: "png".to_string(),
            size: 1,
            width: 100,
            height: 100,
            folder_id: None,
            created_at: now.clone(),
            modified_at: now.clone(),
            imported_at: now,
            rating: 0,
            description: String::new(),
            source_url: String::new(),
            dominant_color: String::new(),
            color_distribution: "[]".to_string(),
        }
    }

    fn set_file_content_hash(db: &Database, file_id: i64, content_hash: &str) {
        db.update_file_content_hash(file_id, Some(content_hash))
            .unwrap();
    }

    fn create_temp_visual_file(file_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-search-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            file_name
        ));
        let image = ImageBuffer::from_pixel(2, 2, Rgb([12u8, 34u8, 56u8]));
        image.save(&path).unwrap();
        path
    }

    fn remove_temp_visual_files(paths: &[&Path]) {
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
    }

    #[test]
    fn visual_search_orders_by_similarity() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-search-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let red_id = db
            .insert_file(&make_file_record(
                "D:\\visual\\red-shoe.png",
                "red-shoe.png",
            ))
            .unwrap();
        let blue_id = db
            .insert_file(&make_file_record(
                "D:\\visual\\blue-ocean.png",
                "blue-ocean.png",
            ))
            .unwrap();

        let red_source_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [red_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        let blue_source_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [blue_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();

        db.upsert_file_visual_embedding(
            red_id,
            "fgclip2-test",
            2,
            &embedding_blob(&[1.0, 0.0]),
            1,
            &red_source_modified_at,
            "hash-red",
        )
        .unwrap();
        set_file_content_hash(&db, red_id, "hash-red");
        db.upsert_file_visual_embedding(
            blue_id,
            "fgclip2-test",
            2,
            &embedding_blob(&[0.0, 1.0]),
            1,
            &blue_source_modified_at,
            "hash-blue",
        )
        .unwrap();
        set_file_content_hash(&db, blue_id, "hash-blue");

        let result = db
            .search_files_by_visual_embedding(
                make_filter("红色鞋子"),
                "fgclip2-test",
                &[1.0, 0.0],
                Some(10),
                Some(0),
            )
            .unwrap();

        let _ = std::fs::remove_file(&path);

        assert_eq!(result.files.first().map(|file| file.id), Some(red_id));
        assert_eq!(result.files.get(1).map(|file| file.id), Some(blue_id));
        assert_eq!(result.total, 2);
    }

    #[test]
    fn visual_index_counts_treat_changed_source_as_outdated() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-counts-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let source_path = create_temp_visual_file("stale.png");
        let file_id = db
            .insert_file(&make_file_record(
                &source_path.to_string_lossy(),
                "stale.png",
            ))
            .unwrap();
        let source_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [file_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();

        db.upsert_file_visual_embedding(
            file_id,
            "fgclip2-test",
            2,
            &embedding_blob(&[1.0, 0.0]),
            1,
            &source_modified_at,
            "hash-v1",
        )
        .unwrap();
        set_file_content_hash(&db, file_id, "hash-v2");

        let counts = db.get_visual_index_counts("fgclip2-test").unwrap();
        let _ = std::fs::remove_file(&path);
        remove_temp_visual_files(&[source_path.as_path()]);

        assert_eq!(counts.total_images, 1);
        assert_eq!(counts.ready, 0);
        assert_eq!(counts.outdated, 1);
    }

    #[test]
    fn visual_index_counts_ignore_mtime_only_changes_when_hash_matches() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-counts-stable-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let source_path = create_temp_visual_file("same-content.png");
        let file_id = db
            .insert_file(&make_file_record(
                &source_path.to_string_lossy(),
                "same-content.png",
            ))
            .unwrap();
        let source_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [file_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();

        db.upsert_file_visual_embedding(
            file_id,
            "fgclip2-test",
            2,
            &embedding_blob(&[1.0, 0.0]),
            1,
            &source_modified_at,
            "hash-stable",
        )
        .unwrap();
        set_file_content_hash(&db, file_id, "hash-stable");
        db.conn
            .execute(
                "UPDATE files SET fs_modified_at = '2099-01-01 00:00:00' WHERE id = ?1",
                [file_id],
            )
            .unwrap();

        let counts = db.get_visual_index_counts("fgclip2-test").unwrap();
        let _ = std::fs::remove_file(&path);
        remove_temp_visual_files(&[source_path.as_path()]);

        assert_eq!(counts.total_images, 1);
        assert_eq!(counts.ready, 1);
        assert_eq!(counts.outdated, 0);
    }

    #[test]
    fn unindexed_visual_index_candidates_include_pending_error_outdated_and_other_models() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-pending-candidates-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let ready_path = create_temp_visual_file("ready.png");
        let error_path = create_temp_visual_file("error.png");
        let outdated_path = create_temp_visual_file("outdated.png");
        let pending_path = create_temp_visual_file("pending.png");
        let other_model_path = create_temp_visual_file("other-model.png");
        let ready_id = db
            .insert_file(&make_file_record(
                &ready_path.to_string_lossy(),
                "ready.png",
            ))
            .unwrap();
        let error_id = db
            .insert_file(&make_file_record(
                &error_path.to_string_lossy(),
                "error.png",
            ))
            .unwrap();
        let outdated_id = db
            .insert_file(&make_file_record(
                &outdated_path.to_string_lossy(),
                "outdated.png",
            ))
            .unwrap();
        let pending_id = db
            .insert_file(&make_file_record(
                &pending_path.to_string_lossy(),
                "pending.png",
            ))
            .unwrap();
        let other_model_id = db
            .insert_file(&make_file_record(
                &other_model_path.to_string_lossy(),
                "other-model.png",
            ))
            .unwrap();

        let ready_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [ready_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        let error_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [error_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        let outdated_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [outdated_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        let other_model_modified_at = db
            .conn
            .query_row(
                "SELECT fs_modified_at FROM files WHERE id = ?1",
                [other_model_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();

        db.upsert_file_visual_embedding(
            ready_id,
            "fgclip2-test",
            2,
            &embedding_blob(&[1.0, 0.0]),
            1,
            &ready_modified_at,
            "hash-ready",
        )
        .unwrap();
        set_file_content_hash(&db, ready_id, "hash-ready");

        db.mark_file_visual_embedding_error(
            error_id,
            "fgclip2-test",
            1,
            &error_modified_at,
            Some("hash-error"),
            "decode failed",
        )
        .unwrap();
        set_file_content_hash(&db, error_id, "hash-error");

        db.upsert_file_visual_embedding(
            outdated_id,
            "fgclip2-test",
            2,
            &embedding_blob(&[0.0, 1.0]),
            1,
            &outdated_modified_at,
            "hash-outdated-old",
        )
        .unwrap();
        set_file_content_hash(&db, outdated_id, "hash-outdated-new");

        db.upsert_file_visual_embedding(
            other_model_id,
            "another-model",
            2,
            &embedding_blob(&[0.5, 0.5]),
            1,
            &other_model_modified_at,
            "hash-other-model",
        )
        .unwrap();
        set_file_content_hash(&db, other_model_id, "hash-other-model");

        let candidates = db
            .get_unindexed_visual_index_candidates("fgclip2-test")
            .unwrap();
        let candidate_ids = candidates
            .into_iter()
            .map(|candidate| candidate.file.id)
            .collect::<Vec<_>>();

        let _ = std::fs::remove_file(&path);
        remove_temp_visual_files(&[
            ready_path.as_path(),
            error_path.as_path(),
            outdated_path.as_path(),
            pending_path.as_path(),
            other_model_path.as_path(),
        ]);

        assert!(!candidate_ids.contains(&ready_id));
        assert!(candidate_ids.contains(&error_id));
        assert!(candidate_ids.contains(&outdated_id));
        assert!(candidate_ids.contains(&pending_id));
        assert!(candidate_ids.contains(&other_model_id));
    }
}
