use super::*;
use crate::ml::model_manager::{
    find_recommended_visual_model_path as find_recommended_visual_model_path_impl,
    load_auto_analyze_on_import, load_visual_search_config, resolve_model_paths,
    validate_visual_model_path as validate_visual_model_path_impl, VisualModelValidationResult,
};
use crate::openai::{
    load_ai_config, request_image_metadata, test_metadata_endpoint, AiEndpointConfig,
};
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{imageops::FilterType, ColorType, GenericImageView, ImageFormat, ImageReader};
use serde::Serialize;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

const MAX_AI_TAGS: usize = 5;
const MAX_AI_DESCRIPTION_CHARS: usize = 200;

#[derive(Debug, Serialize)]
pub struct VisualIndexRebuildResult {
    pub total: usize,
    pub indexed: usize,
    pub failed: usize,
    pub skipped: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VisualIndexProgressPayload {
    pub processed: usize,
    pub total: usize,
    pub indexed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub current_file_id: i64,
    pub current_file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualIndexRetryCandidatePayload {
    pub file_id: i64,
    pub path: String,
    pub ext: String,
    pub last_error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualIndexStatus {
    pub model_valid: bool,
    pub message: String,
    pub model_id: Option<String>,
    pub version: Option<String>,
    pub indexed_count: i64,
    pub failed_count: i64,
    pub pending_count: i64,
    pub outdated_count: i64,
    pub total_image_count: i64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiEndpointTarget {
    Metadata,
}

fn is_backend_decodable_image(file: &FileWithTags) -> bool {
    matches!(
        file.ext.to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "ico"
    )
}

fn is_supported_image_for_ai(file: &FileWithTags, has_image_data_url: bool) -> bool {
    if has_image_data_url {
        matches!(
            file.ext.to_ascii_lowercase().as_str(),
            "jpg"
                | "jpeg"
                | "png"
                | "webp"
                | "bmp"
                | "gif"
                | "tif"
                | "tiff"
                | "ico"
                | "avif"
                | "heic"
                | "heif"
        )
    } else {
        is_backend_decodable_image(file)
    }
}

fn load_image_from_bytes(
    bytes: &[u8],
    detected_format: Option<ImageFormat>,
) -> Result<image::DynamicImage, String> {
    let header = bytes
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");

    let decode_with_reader = || -> Result<image::DynamicImage, String> {
        let reader = ImageReader::new(BufReader::new(std::io::Cursor::new(bytes)))
            .with_guessed_format()
            .map_err(|e| format!("无法识别图片格式: {}", e))?;
        reader
            .decode()
            .map_err(|e| format!("reader decode failed: {}", e))
    };

    decode_with_reader().or_else(|reader_error| {
        image::load_from_memory(bytes).map_err(|memory_error| match detected_format {
            Some(format) => format!(
                "无法读取图片: 内容格式={format:?}，文件头={header}，reader={reader_error}，memory={memory_error}"
            ),
            None => format!(
                "无法识别图片格式，文件可能已损坏或并非图片。文件头={header}，reader={reader_error}，memory={memory_error}"
            ),
        })
    })
}

fn prepare_image_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("无法读取图片文件: {}", e))?;
    let detected_format = image::guess_format(&bytes).ok();
    let image = load_image_from_bytes(&bytes, detected_format)?;
    let (width, height) = image.dimensions();
    let resized = if width.max(height) > 1280 {
        image.resize(1280, 1280, FilterType::Lanczos3)
    } else {
        image
    };
    let rgb = resized.to_rgb8();
    let (resized_width, resized_height) = rgb.dimensions();

    let mut encoded = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut encoded, 85);
    encoder
        .encode(&rgb, resized_width, resized_height, ColorType::Rgb8.into())
        .map_err(|e| format!("无法编码图片: {}", e))?;

    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(encoded)
    ))
}

fn trim_to_char_limit(input: &str, max_chars: usize) -> String {
    input.chars().take(max_chars).collect::<String>()
}

fn normalize_tag_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn sanitize_tag_list(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for tag in tags {
        let trimmed = trim_to_char_limit(tag.trim(), 24);
        if trimmed.is_empty() {
            continue;
        }
        let key = normalize_tag_name(&trimmed);
        if seen.insert(key) {
            result.push(trimmed);
        }
        if result.len() >= MAX_AI_TAGS {
            break;
        }
    }

    result
}

fn sanitize_filename_stem(raw: &str, fallback: &str) -> String {
    let without_ext = Path::new(raw)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(raw);

    let sanitized = without_ext
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>();

    let collapsed = sanitized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['.', ' '])
        .to_string();

    let limited = trim_to_char_limit(&collapsed, 80);
    if limited.is_empty() {
        fallback.to_string()
    } else {
        limited
    }
}

fn resolve_available_rename_path(
    db: &Database,
    file_id: i64,
    old_path: &Path,
    desired_stem: &str,
) -> Result<(String, PathBuf), String> {
    let parent = old_path
        .parent()
        .ok_or_else(|| "无效的文件路径".to_string())?;
    let ext = old_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    let build_name = |stem: &str, attempt: Option<usize>| {
        let name_stem = match attempt {
            Some(index) => format!("{stem}-{index}"),
            None => stem.to_string(),
        };
        if ext.is_empty() {
            name_stem
        } else {
            format!("{name_stem}.{ext}")
        }
    };

    let has_db_conflict = |path: &Path| -> Result<bool, String> {
        let Some(path_str) = path.to_str() else {
            return Ok(true);
        };
        let existing = db.get_file_by_path(path_str).map_err(|e| e.to_string())?;
        Ok(existing.map(|file| file.id != file_id).unwrap_or(false))
    };

    for attempt in std::iter::once(None).chain((2..1000).map(Some)) {
        let candidate_name = build_name(desired_stem, attempt);
        let candidate_path = parent.join(&candidate_name);

        if candidate_path == old_path {
            return Ok((candidate_name, candidate_path));
        }

        if !candidate_path.exists() && !has_db_conflict(&candidate_path)? {
            return Ok((candidate_name, candidate_path));
        }
    }

    Err("无法为 AI 生成的名称找到可用文件名".to_string())
}

fn move_file_with_fallback(from: &Path, to: &Path) -> Result<(), String> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            fs::copy(from, to).map_err(|copy_error| {
                format!(
                    "重命名失败，复制兜底也失败: {} / {}",
                    rename_error, copy_error
                )
            })?;
            fs::remove_file(from)
                .map_err(|remove_error| format!("复制完成但删除旧文件失败: {}", remove_error))
        }
    }
}

fn pick_color_for_tag(name: &str) -> &'static str {
    const NEW_TAG_COLORS: [&str; 8] = [
        "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
    ];

    let hash = name
        .bytes()
        .fold(0usize, |acc, value| acc.wrapping_add(value as usize));
    NEW_TAG_COLORS[hash % NEW_TAG_COLORS.len()]
}

pub(crate) fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * std::mem::size_of::<f32>());
    for value in embedding {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let trimmed = data_url.trim();
    let Some(payload) = trimmed.strip_prefix("data:") else {
        return Err("图片数据必须是 data URL".to_string());
    };

    let Some((metadata, encoded)) = payload.split_once(',') else {
        return Err("图片 data URL 格式无效".to_string());
    };
    if !metadata.contains(";base64") {
        return Err("当前仅支持 base64 编码的图片 data URL".to_string());
    }

    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("无法解析图片 data URL: {}", e))
}

pub(crate) async fn analyze_file_metadata_impl(
    state: &AppState,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<FileWithTags, String> {
    let (config, file, existing_tags) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_ai_config(&db)?;
        let file = db
            .get_file_by_id(file_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "文件不存在".to_string())?;
        let existing_tags = db.get_all_tags().map_err(|e| e.to_string())?;
        (config, file, existing_tags)
    };

    let has_image_data_url = image_data_url
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if !is_supported_image_for_ai(&file, has_image_data_url) {
        return Err("当前仅支持对图片文件执行 AI 分析".to_string());
    }

    let old_path = PathBuf::from(&file.path);
    if !old_path.exists() {
        return Err("文件不存在，无法执行 AI 分析".to_string());
    }

    let image_data_url = match image_data_url {
        Some(value) if !value.trim().is_empty() => value,
        _ => prepare_image_data_url(&old_path)?,
    };
    let mut suggestion =
        request_image_metadata(&config, &file, &existing_tags, &image_data_url).await?;
    suggestion.filename = sanitize_filename_stem(
        &suggestion.filename,
        Path::new(&file.name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("untitled"),
    );
    suggestion.tags = sanitize_tag_list(std::mem::take(&mut suggestion.tags));
    suggestion.description =
        trim_to_char_limit(suggestion.description.trim(), MAX_AI_DESCRIPTION_CHARS);

    let current_stem = old_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled");
    let desired_stem = sanitize_filename_stem(&suggestion.filename, current_stem);

    let db = state.db.lock().map_err(|e| e.to_string())?;

    let (new_name, new_path) =
        resolve_available_rename_path(&db, file_id, &old_path, &desired_stem)?;
    if new_path != old_path {
        move_file_with_fallback(&old_path, &new_path)?;
        let new_path_string = new_path.to_string_lossy().to_string();
        db.update_file_name(file_id, &new_name, &new_path_string)
            .map_err(|e| e.to_string())?;
    }

    db.update_file_metadata(
        file_id,
        file.rating,
        &suggestion.description,
        &file.source_url,
    )
    .map_err(|e| e.to_string())?;

    let normalized_existing = existing_tags
        .iter()
        .map(|tag| (normalize_tag_name(&tag.name), tag))
        .collect::<std::collections::HashMap<_, _>>();

    for tag_name in &suggestion.tags {
        let normalized = normalize_tag_name(tag_name);
        let tag_id = if let Some(existing_tag) = normalized_existing.get(&normalized) {
            existing_tag.id
        } else {
            db.create_tag(tag_name, pick_color_for_tag(tag_name), None)
                .map_err(|e| e.to_string())?
        };
        db.add_tag_to_file(file_id, tag_id)
            .map_err(|e| e.to_string())?;
    }

    db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "更新后无法读取文件".to_string())
}

fn reindex_visual_candidate(
    state: &AppState,
    resolved_model: &crate::ml::model_manager::ResolvedModelPaths,
    candidate: &crate::db::VisualIndexCandidate,
    image_data_url: Option<&str>,
) -> Result<(), String> {
    let embedding = {
        let mut runtime = state
            .visual_model_runtime
            .lock()
            .map_err(|e| e.to_string())?;
        let model = runtime.get_or_load(resolved_model)?;
        if let Some(image_data_url) = image_data_url {
            let image_bytes = decode_image_data_url(image_data_url)?;
            model.encode_image_bytes(&image_bytes)?
        } else {
            model.encode_image_path(Path::new(&candidate.file.path))?
        }
    };

    let embedding_blob = embedding_to_blob(&embedding);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.upsert_file_visual_embedding(
        candidate.file.id,
        &resolved_model.manifest.model_id,
        embedding.len(),
        &embedding_blob,
        candidate.source_size,
        &candidate.source_modified_at,
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn reindex_file_visual_embedding_impl(
    state: &AppState,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<(), String> {
    let (resolved_model, candidate) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_visual_search_config(&db)?;
        let resolved_model = resolve_model_paths(&config.model_path)?;
        let candidate = db
            .get_visual_index_candidate(file_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "当前文件不是可建立视觉索引的图片，或文件不存在".to_string())?;
        (resolved_model, candidate)
    };

    match reindex_visual_candidate(
        state,
        &resolved_model,
        &candidate,
        image_data_url.as_deref(),
    ) {
        Ok(()) => Ok(()),
        Err(error) => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            db.mark_file_visual_embedding_error(
                candidate.file.id,
                &resolved_model.manifest.model_id,
                candidate.source_size,
                &candidate.source_modified_at,
                &error,
            )
            .map_err(|e| e.to_string())?;
            Err(error)
        }
    }
}

async fn analyze_file_metadata_with_app_handle(
    app_handle: tauri::AppHandle,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<FileWithTags, String> {
    let state = app_handle.state::<AppState>();
    analyze_file_metadata_impl(&state, file_id, image_data_url).await
}

fn reindex_file_visual_embedding_with_app_handle(
    app_handle: tauri::AppHandle,
    file_id: i64,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    reindex_file_visual_embedding_impl(&state, file_id, None)
}

pub(crate) fn run_post_import_pipeline(app_handle: tauri::AppHandle, file_id: i64) {
    tauri::async_runtime::spawn(async move {
        let (is_image, auto_analyze, auto_vectorize) = {
            let state = app_handle.state::<AppState>();
            let db = match state.db.lock() {
                Ok(db) => db,
                Err(error) => {
                    log::warn!("Failed to lock db for post import pipeline: {}", error);
                    return;
                }
            };

            let file = match db.get_file_by_id(file_id) {
                Ok(Some(file)) => file,
                Ok(None) => return,
                Err(error) => {
                    log::warn!("Failed to load imported file {}: {}", file_id, error);
                    return;
                }
            };
            let visual_search_config = load_visual_search_config(&db).unwrap_or_default();
            let auto_analyze = load_auto_analyze_on_import(&db).unwrap_or(false);

            (
                is_backend_decodable_image(&file),
                auto_analyze,
                visual_search_config.enabled && visual_search_config.auto_vectorize_on_import,
            )
        };

        if !is_image {
            return;
        }

        if auto_analyze {
            match analyze_file_metadata_with_app_handle(app_handle.clone(), file_id, None).await {
                Ok(updated_file) => {
                    let _ = app_handle.emit(
                        "file-updated",
                        serde_json::json!({ "fileId": updated_file.id }),
                    );
                }
                Err(error) => {
                    log::warn!(
                        "Auto analyze on import failed for file {}: {}",
                        file_id,
                        error
                    );
                }
            }
        }

        if auto_vectorize {
            if let Err(error) =
                reindex_file_visual_embedding_with_app_handle(app_handle.clone(), file_id)
            {
                log::warn!(
                    "Auto vectorize on import failed for file {}: {}",
                    file_id,
                    error
                );
            }
        }
    });
}

#[tauri::command]
pub fn validate_visual_model_path(
    model_path: String,
) -> Result<VisualModelValidationResult, String> {
    Ok(validate_visual_model_path_impl(&model_path))
}

#[tauri::command]
pub fn get_recommended_visual_model_path() -> Result<Option<String>, String> {
    Ok(find_recommended_visual_model_path_impl())
}

#[tauri::command]
pub fn get_visual_index_status(state: State<'_, AppState>) -> Result<VisualIndexStatus, String> {
    let (config, validation) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_visual_search_config(&db)?;
        let validation = validate_visual_model_path_impl(&config.model_path);
        (config, validation)
    };

    if !validation.valid {
        return Ok(VisualIndexStatus {
            model_valid: false,
            message: validation.message,
            model_id: None,
            version: None,
            indexed_count: 0,
            failed_count: 0,
            pending_count: 0,
            outdated_count: 0,
            total_image_count: 0,
        });
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_model = resolve_model_paths(&config.model_path)?;
    let counts = db
        .get_visual_index_counts(&resolved_model.manifest.model_id)
        .map_err(|e| e.to_string())?;

    Ok(VisualIndexStatus {
        model_valid: true,
        message: "视觉索引可用".to_string(),
        model_id: Some(resolved_model.manifest.model_id.clone()),
        version: Some(resolved_model.manifest.version.clone()),
        indexed_count: counts.ready,
        failed_count: counts.error,
        pending_count: counts.pending,
        outdated_count: counts.outdated,
        total_image_count: counts.total_images,
    })
}

#[tauri::command]
pub fn get_visual_index_retry_candidates(
    state: State<'_, AppState>,
) -> Result<Vec<VisualIndexRetryCandidatePayload>, String> {
    let (config, validation) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_visual_search_config(&db)?;
        let validation = validate_visual_model_path_impl(&config.model_path);
        (config, validation)
    };

    if !validation.valid {
        return Ok(Vec::new());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_model = resolve_model_paths(&config.model_path)?;
    let candidates = db
        .get_visual_index_retry_candidates(&resolved_model.manifest.model_id)
        .map_err(|e| e.to_string())?;

    Ok(candidates
        .into_iter()
        .map(|candidate| VisualIndexRetryCandidatePayload {
            file_id: candidate.file_id,
            path: candidate.path,
            ext: candidate.ext,
            last_error: candidate.last_error,
        })
        .collect())
}

fn rebuild_visual_index_impl(
    state: &AppState,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<VisualIndexRebuildResult, String> {
    let (resolved_model, candidates) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_visual_search_config(&db)?;
        let resolved_model = resolve_model_paths(&config.model_path)?;
        let candidates = db
            .get_visual_index_candidates()
            .map_err(|e| e.to_string())?;
        (resolved_model, candidates)
    };

    let mut result = VisualIndexRebuildResult {
        total: candidates.len(),
        indexed: 0,
        failed: 0,
        skipped: 0,
    };

    for (index, candidate) in candidates.into_iter().enumerate() {
        if let Some(app_handle) = app_handle {
            let _ = app_handle.emit(
                "visual-index-progress",
                VisualIndexProgressPayload {
                    processed: index + 1,
                    total: result.total,
                    indexed: result.indexed,
                    failed: result.failed,
                    skipped: result.skipped,
                    current_file_id: candidate.file.id,
                    current_file_name: candidate.file.name.clone(),
                },
            );
        }

        match reindex_visual_candidate(&state, &resolved_model, &candidate, None) {
            Ok(()) => {
                result.indexed += 1;
            }
            Err(error) => {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                db.mark_file_visual_embedding_error(
                    candidate.file.id,
                    &resolved_model.manifest.model_id,
                    candidate.source_size,
                    &candidate.source_modified_at,
                    &error,
                )
                .map_err(|e| e.to_string())?;
                result.failed += 1;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn rebuild_visual_index(
    app_handle: tauri::AppHandle,
) -> Result<VisualIndexRebuildResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        rebuild_visual_index_impl(&state, Some(&app_handle))
    })
    .await
    .map_err(|e| format!("视觉索引后台任务失败: {}", e))?
}

#[tauri::command]
pub fn reindex_file_visual_embedding(
    state: State<'_, AppState>,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<(), String> {
    reindex_file_visual_embedding_impl(&state, file_id, image_data_url)
}

#[tauri::command]
pub async fn test_ai_endpoint(
    state: State<'_, AppState>,
    target: AiEndpointTarget,
) -> Result<String, String> {
    let endpoint_config: AiEndpointConfig = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        match target {
            AiEndpointTarget::Metadata => load_ai_config(&db)?,
        }
    };

    match target {
        AiEndpointTarget::Metadata => test_metadata_endpoint(&endpoint_config).await,
    }
}

#[tauri::command]
pub async fn analyze_file_metadata(
    state: State<'_, AppState>,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<FileWithTags, String> {
    analyze_file_metadata_impl(&state, file_id, image_data_url).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb};

    #[test]
    fn prepare_image_data_url_reads_mismatched_extension_from_content() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-ai-test-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([12, 34, 56])));
        image.save_with_format(&path, ImageFormat::Jpeg).unwrap();

        let result = prepare_image_data_url(&path);
        let _ = fs::remove_file(&path);

        assert!(result.is_ok());
        assert!(result.unwrap().starts_with("data:image/jpeg;base64,"));
    }
}
