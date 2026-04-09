use super::*;
use rusqlite::params;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;

const EMBEDDING_FETCH_CHUNK_SIZE: usize = 500;
const MAX_FILENAME_BOOST: f32 = 0.65;

#[derive(Debug)]
pub struct SemanticSearchResult {
    pub files: Vec<FileWithTags>,
    pub total: i64,
}

#[derive(Debug)]
struct EmbeddingRecord {
    file_id: i64,
    dimensions: usize,
    embedding: Vec<u8>,
}

#[derive(Debug)]
struct HybridQueryFeatures {
    normalized: String,
    compact: String,
    token_set: HashSet<String>,
    char_set: HashSet<char>,
    gram_set: HashSet<String>,
}

#[derive(Debug)]
struct RankedFile {
    total_score: f32,
    semantic_score: Option<f32>,
    filename_boost: f32,
    file: FileWithTags,
}

impl Database {
    pub fn upsert_file_embedding(
        &self,
        file_id: i64,
        model: &str,
        dimensions: usize,
        embedding: &[u8],
        search_text: &str,
        source_updated_at: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO file_embeddings (
                file_id, model, dimensions, embedding, search_text, source_updated_at, indexed_at, status, last_error
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', ''
            )
            ON CONFLICT(file_id) DO UPDATE SET
                model = excluded.model,
                dimensions = excluded.dimensions,
                embedding = excluded.embedding,
                search_text = excluded.search_text,
                source_updated_at = excluded.source_updated_at,
                indexed_at = excluded.indexed_at,
                status = 'ready',
                last_error = ''",
            params![
                file_id,
                model,
                dimensions as i64,
                embedding,
                search_text,
                source_updated_at,
                current_timestamp(),
            ],
        )?;
        Ok(())
    }

    pub fn mark_file_embedding_error(
        &self,
        file_id: i64,
        model: &str,
        search_text: &str,
        source_updated_at: &str,
        error: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO file_embeddings (
                file_id, model, dimensions, embedding, search_text, source_updated_at, indexed_at, status, last_error
            ) VALUES (
                ?1, ?2, 0, NULL, ?3, ?4, ?5, 'error', ?6
            )
            ON CONFLICT(file_id) DO UPDATE SET
                model = excluded.model,
                dimensions = 0,
                embedding = NULL,
                search_text = excluded.search_text,
                source_updated_at = excluded.source_updated_at,
                indexed_at = excluded.indexed_at,
                status = 'error',
                last_error = excluded.last_error",
            params![
                file_id,
                model,
                search_text,
                source_updated_at,
                current_timestamp(),
                error,
            ],
        )?;
        Ok(())
    }

    pub fn get_ready_embedding_count(&self, model: &str) -> Result<i64> {
        self.conn.query_row(
            "SELECT COUNT(*)
             FROM file_embeddings fe
             JOIN files f ON f.id = fe.file_id
             WHERE fe.model = ?1
               AND fe.status = 'ready'
               AND fe.embedding IS NOT NULL
               AND f.deleted_at IS NULL",
            [model],
            |row| row.get(0),
        )
    }

    pub fn search_files_by_embedding(
        &self,
        mut filter: crate::commands::FileFilter,
        model: &str,
        query_text: &str,
        query_embedding: &[f32],
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<SemanticSearchResult> {
        filter.semantic_query = None;

        let candidates = self.filter_files(filter, None, None)?;
        if candidates.is_empty() {
            return Ok(SemanticSearchResult {
                files: Vec::new(),
                total: 0,
            });
        }

        let embedding_map = self.get_embeddings_for_files(
            &candidates.iter().map(|file| file.id).collect::<Vec<_>>(),
            model,
        )?;
        let lexical_query = build_hybrid_query_features(query_text);

        let mut ranked = candidates
            .into_iter()
            .filter_map(|file| {
                let filename_boost = lexical_query
                    .as_ref()
                    .map(|query| lexical_filename_boost(&file.name, query))
                    .unwrap_or(0.0);
                let semantic_score = embedding_map.get(&file.id).and_then(|record| {
                    cosine_similarity_from_blob(
                        &record.embedding,
                        record.dimensions,
                        query_embedding,
                    )
                });

                if semantic_score.is_none() && filename_boost <= 0.0 {
                    return None;
                }

                Some(RankedFile {
                    total_score: semantic_score.unwrap_or(0.0) + filename_boost,
                    semantic_score,
                    filename_boost,
                    file,
                })
            })
            .collect::<Vec<_>>();

        ranked.sort_by(|left, right| {
            right
                .total_score
                .partial_cmp(&left.total_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| {
                    right
                        .filename_boost
                        .partial_cmp(&left.filename_boost)
                        .unwrap_or(Ordering::Equal)
                })
                .then_with(|| {
                    right
                        .semantic_score
                        .unwrap_or(f32::NEG_INFINITY)
                        .partial_cmp(&left.semantic_score.unwrap_or(f32::NEG_INFINITY))
                        .unwrap_or(Ordering::Equal)
                })
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

        let files = ranked
            .into_iter()
            .skip(start)
            .take(end.saturating_sub(start))
            .map(|item| item.file)
            .collect();

        Ok(SemanticSearchResult { files, total })
    }

    fn get_embeddings_for_files(
        &self,
        file_ids: &[i64],
        model: &str,
    ) -> Result<HashMap<i64, EmbeddingRecord>> {
        let mut result = HashMap::new();

        for chunk in file_ids.chunks(EMBEDDING_FETCH_CHUNK_SIZE) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!(
                "SELECT file_id, dimensions, embedding
                 FROM file_embeddings
                 WHERE model = ?
                   AND status = 'ready'
                   AND embedding IS NOT NULL
                   AND file_id IN ({placeholders})"
            );

            let mut stmt = self.conn.prepare(&sql)?;
            let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(model.to_string())];
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

fn build_hybrid_query_features(query_text: &str) -> Option<HybridQueryFeatures> {
    let normalized = normalize_lexical_text(query_text);
    let compact = compact_lexical_text(query_text);

    if normalized.is_empty() && compact.is_empty() {
        return None;
    }

    Some(HybridQueryFeatures {
        token_set: collect_word_tokens(&normalized),
        char_set: collect_character_set(&compact),
        gram_set: collect_char_grams(&compact),
        normalized,
        compact,
    })
}

fn lexical_filename_boost(file_name: &str, query: &HybridQueryFeatures) -> f32 {
    let filename_stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let normalized_name = normalize_lexical_text(filename_stem);
    let compact_name = compact_lexical_text(filename_stem);

    if normalized_name.is_empty() && compact_name.is_empty() {
        return 0.0;
    }

    let mut boost = 0.0;

    if !query.compact.is_empty() && compact_name == query.compact {
        boost += 0.32;
    } else if !query.normalized.is_empty() && normalized_name == query.normalized {
        boost += 0.28;
    }

    if !query.compact.is_empty() && !compact_name.is_empty() {
        if compact_name.starts_with(&query.compact) {
            boost += 0.08;
        } else if compact_name.contains(&query.compact) {
            boost += 0.05;
        }
    }

    let char_similarity =
        dice_coefficient_chars(&collect_character_set(&compact_name), &query.char_set);
    let gram_similarity =
        dice_coefficient_strings(&collect_char_grams(&compact_name), &query.gram_set);
    let token_similarity =
        dice_coefficient_strings(&collect_word_tokens(&normalized_name), &query.token_set);

    boost += 0.12 * char_similarity;
    boost += 0.18 * gram_similarity;
    boost += 0.12 * token_similarity;

    // Treat near-reordered names as strong lexical evidence, especially for CJK filenames.
    if char_similarity >= 0.95 && gram_similarity >= 0.45 {
        boost += 0.12;
    }

    boost.min(MAX_FILENAME_BOOST)
}

fn normalize_lexical_text(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    let mut previous_is_space = true;

    for ch in text.chars() {
        let mut emitted = false;
        for lowered in ch.to_lowercase() {
            if is_lexical_char(lowered) {
                normalized.push(lowered);
                previous_is_space = false;
                emitted = true;
            }
        }

        if !emitted && !previous_is_space {
            normalized.push(' ');
            previous_is_space = true;
        }
    }

    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn compact_lexical_text(text: &str) -> String {
    let mut compact = String::with_capacity(text.len());

    for ch in text.chars() {
        for lowered in ch.to_lowercase() {
            if is_lexical_char(lowered) {
                compact.push(lowered);
            }
        }
    }

    compact
}

fn is_lexical_char(ch: char) -> bool {
    ch.is_alphanumeric()
        || matches!(
            ch,
            '\u{3400}'..='\u{4DBF}'
                | '\u{4E00}'..='\u{9FFF}'
                | '\u{3040}'..='\u{30FF}'
                | '\u{AC00}'..='\u{D7AF}'
        )
}

fn collect_word_tokens(text: &str) -> HashSet<String> {
    text.split_whitespace()
        .filter(|token| token.chars().count() >= 2)
        .map(str::to_string)
        .collect()
}

fn collect_character_set(text: &str) -> HashSet<char> {
    text.chars().collect()
}

fn collect_char_grams(text: &str) -> HashSet<String> {
    let chars = text.chars().collect::<Vec<_>>();

    match chars.len() {
        0 => HashSet::new(),
        1 => std::iter::once(chars[0].to_string()).collect(),
        _ => chars
            .windows(2)
            .map(|window| window.iter().collect::<String>())
            .collect(),
    }
}

fn dice_coefficient_strings(left: &HashSet<String>, right: &HashSet<String>) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }

    let overlap = left.intersection(right).count() as f32;
    (2.0 * overlap) / (left.len() + right.len()) as f32
}

fn dice_coefficient_chars(left: &HashSet<char>, right: &HashSet<char>) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }

    let overlap = left.intersection(right).count() as f32;
    (2.0 * overlap) / (left.len() + right.len()) as f32
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

    fn make_filter(query: &str) -> crate::commands::FileFilter {
        crate::commands::FileFilter {
            query: None,
            semantic_query: Some(query.to_string()),
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

    fn embedding_blob(values: &[f32]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(values.len() * std::mem::size_of::<f32>());
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
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

    #[test]
    fn semantic_search_orders_by_similarity() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-semantic-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let red_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\red-shoe.png",
                "red-shoe.png",
            ))
            .unwrap();
        let blue_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\blue-ocean.png",
                "blue-ocean.png",
            ))
            .unwrap();

        db.upsert_file_embedding(
            red_id,
            "test-embedding",
            2,
            &embedding_blob(&[1.0, 0.0]),
            "红色鞋子",
            &current_timestamp(),
        )
        .unwrap();
        db.upsert_file_embedding(
            blue_id,
            "test-embedding",
            2,
            &embedding_blob(&[0.0, 1.0]),
            "蓝色海洋",
            &current_timestamp(),
        )
        .unwrap();

        let result = db
            .search_files_by_embedding(
                make_filter("红色鞋子"),
                "test-embedding",
                "红色鞋子",
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
    fn hybrid_search_boosts_exact_filename_matches() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-hybrid-exact-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let exact_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\red-shoe.png",
                "red shoe.png",
            ))
            .unwrap();
        let semantic_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\fashion-note.png",
                "fashion note.png",
            ))
            .unwrap();

        db.upsert_file_embedding(
            exact_id,
            "test-embedding",
            2,
            &embedding_blob(&[0.45, 0.0]),
            "red shoe",
            &current_timestamp(),
        )
        .unwrap();
        db.upsert_file_embedding(
            semantic_id,
            "test-embedding",
            2,
            &embedding_blob(&[0.62, 0.0]),
            "fashion semantic",
            &current_timestamp(),
        )
        .unwrap();

        let result = db
            .search_files_by_embedding(
                make_filter("red shoe"),
                "test-embedding",
                "red shoe",
                &[1.0, 0.0],
                Some(10),
                Some(0),
            )
            .unwrap();

        let _ = std::fs::remove_file(&path);

        assert_eq!(result.files.first().map(|file| file.id), Some(exact_id));
        assert_eq!(result.files.get(1).map(|file| file.id), Some(semantic_id));
    }

    #[test]
    fn hybrid_search_boosts_fuzzy_filename_matches() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-hybrid-fuzzy-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let fuzzy_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\comic-portrait.png",
                "黑白漫画侧脸人物.png",
            ))
            .unwrap();
        let semantic_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\portrait.png",
                "人物速写.png",
            ))
            .unwrap();

        db.upsert_file_embedding(
            fuzzy_id,
            "test-embedding",
            2,
            &embedding_blob(&[0.30, 0.0]),
            "黑白漫画侧脸人物",
            &current_timestamp(),
        )
        .unwrap();
        db.upsert_file_embedding(
            semantic_id,
            "test-embedding",
            2,
            &embedding_blob(&[0.50, 0.0]),
            "人物速写",
            &current_timestamp(),
        )
        .unwrap();

        let result = db
            .search_files_by_embedding(
                make_filter("黑白侧脸漫画人物"),
                "test-embedding",
                "黑白侧脸漫画人物",
                &[1.0, 0.0],
                Some(10),
                Some(0),
            )
            .unwrap();

        let _ = std::fs::remove_file(&path);

        assert_eq!(result.files.first().map(|file| file.id), Some(fuzzy_id));
        assert_eq!(result.files.get(1).map(|file| file.id), Some(semantic_id));
    }

    #[test]
    fn hybrid_search_includes_lexical_matches_without_embedding() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-hybrid-lexical-only-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let db = Database::new(&path).unwrap();
        let lexical_only_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\invoice-2024.png",
                "invoice 2024.png",
            ))
            .unwrap();
        let semantic_id = db
            .insert_file(&make_file_record(
                "D:\\semantic\\travel-note.png",
                "travel note.png",
            ))
            .unwrap();

        db.upsert_file_embedding(
            semantic_id,
            "test-embedding",
            2,
            &embedding_blob(&[0.18, 0.0]),
            "travel note",
            &current_timestamp(),
        )
        .unwrap();

        let result = db
            .search_files_by_embedding(
                make_filter("invoice 2024"),
                "test-embedding",
                "invoice 2024",
                &[1.0, 0.0],
                Some(10),
                Some(0),
            )
            .unwrap();

        let _ = std::fs::remove_file(&path);

        assert_eq!(
            result.files.first().map(|file| file.id),
            Some(lexical_only_id)
        );
        assert_eq!(result.files.get(1).map(|file| file.id), Some(semantic_id));
    }
}
