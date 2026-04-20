use super::{VisualIndexBrowserDecodeRequestPayload, VisualIndexProgressPayload};
use crate::commands::{AiMetadataTaskSnapshot, VisualIndexTaskSnapshot};
use crate::db::{Database, FileWithTags, VisualIndexCandidate};
use crate::media;
use crate::{AiMetadataTaskEntry, AppState, VisualIndexTaskEntry};
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{imageops::FilterType, ColorType, GenericImageView};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub(super) const MAX_AI_TAGS: usize = 5;
pub(super) const MAX_AI_DESCRIPTION_CHARS: usize = 200;
pub(super) const AI_METADATA_TASK_EVENT: &str = "ai-metadata-task-updated";
pub(super) const VISUAL_INDEX_TASK_EVENT: &str = "visual-index-task-updated";
pub(super) const VISUAL_INDEX_BROWSER_DECODE_REQUEST_EVENT: &str =
    "visual-index-browser-decode-request";
pub(super) const VISUAL_INDEX_BROWSER_DECODE_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(1800);
pub(super) const AI_BATCH_ANALYZE_CONCURRENCY_SETTING_KEY: &str = "aiBatchAnalyzeConcurrency";
pub(super) const AI_METADATA_TASK_DEFAULT_CONCURRENCY: usize = 5;
pub(super) const AI_METADATA_TASK_MIN_CONCURRENCY: usize = 1;
pub(super) const AI_METADATA_TASK_MAX_CONCURRENCY: usize = 5;
pub(super) const AI_METADATA_TASK_MAX_ATTEMPTS: usize = 3;
pub(super) const AI_METADATA_TASK_RETRY_DELAY_MS: u64 = 400;

fn probe_file_media(file: &FileWithTags) -> Result<media::MediaProbe, String> {
    media::probe_media_path(Path::new(&file.path))
}

pub(super) fn requires_browser_decoded_visual_index(path: &Path) -> Result<bool, String> {
    Ok(media::probe_media_path(path)?.requires_browser_decode_for_visual_index())
}

pub(super) fn is_supported_image_for_ai(file: &FileWithTags, _has_image_data_url: bool) -> bool {
    let Ok(probe) = probe_file_media(file) else {
        return false;
    };

    probe.is_ai_supported_image()
}

pub(super) fn prepare_image_data_url(path: &Path) -> Result<String, String> {
    let image = media::load_dynamic_image_from_path(path)?;
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

pub(super) fn prepare_file_image_data_url(
    state: &AppState,
    file: &FileWithTags,
) -> Result<String, String> {
    let probe = probe_file_media(file)?;
    if probe.requires_browser_decode_for_ai() {
        return request_browser_decoded_image_data_url_for_file(state, file, "image/png");
    }
    if probe.is_backend_decodable_image() {
        return prepare_image_data_url(Path::new(&file.path));
    }
    Err("当前仅支持对图片文件执行 AI 分析".to_string())
}

pub(super) fn trim_to_char_limit(input: &str, max_chars: usize) -> String {
    input.chars().take(max_chars).collect::<String>()
}

pub(super) fn normalize_tag_name(value: &str) -> String {
    value.trim().to_lowercase()
}

pub(super) fn sanitize_tag_list(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
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

pub(super) fn sanitize_filename_stem(raw: &str, fallback: &str) -> String {
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

pub(super) fn resolve_available_rename_path(
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

pub(super) fn move_file_with_fallback(from: &Path, to: &Path) -> Result<(), String> {
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

pub(super) fn pick_color_for_tag(name: &str) -> &'static str {
    const NEW_TAG_COLORS: [&str; 8] = [
        "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
    ];

    let hash = name
        .bytes()
        .fold(0usize, |acc, value| acc.wrapping_add(value as usize));
    NEW_TAG_COLORS[hash % NEW_TAG_COLORS.len()]
}

pub(super) fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * std::mem::size_of::<f32>());
    for value in embedding {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub(crate) fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
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

fn request_browser_decoded_image_data_url_for_source(
    state: &AppState,
    file_id: i64,
    path: &str,
    output_mime_type: &str,
) -> Result<String, String> {
    let request_id = format!(
        "visual-index-browser-decode-{}",
        crate::commands::imports::uuid_simple_shared()
    );
    let (response_tx, response_rx) = std::sync::mpsc::channel::<Result<String, String>>();

    {
        let mut requests = state
            .visual_index_browser_decode_requests
            .lock()
            .map_err(|e| e.to_string())?;
        requests.insert(request_id.clone(), response_tx);
    }

    if let Err(error) = state.app_handle.emit(
        VISUAL_INDEX_BROWSER_DECODE_REQUEST_EVENT,
        VisualIndexBrowserDecodeRequestPayload {
            request_id: request_id.clone(),
            file_id,
            path: path.to_string(),
            output_mime_type: output_mime_type.to_string(),
        },
    ) {
        if let Ok(mut requests) = state.visual_index_browser_decode_requests.lock() {
            requests.remove(&request_id);
        }
        return Err(format!("无法请求前端解码图片: {}", error));
    }

    match response_rx.recv_timeout(VISUAL_INDEX_BROWSER_DECODE_TIMEOUT) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            if let Ok(mut requests) = state.visual_index_browser_decode_requests.lock() {
                requests.remove(&request_id);
            }
            Err(format!(
                "等待前端解码图片超时（>{} 秒）: {}",
                VISUAL_INDEX_BROWSER_DECODE_TIMEOUT.as_secs(),
                path
            ))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            if let Ok(mut requests) = state.visual_index_browser_decode_requests.lock() {
                requests.remove(&request_id);
            }
            Err(format!("前端解码图片通道已断开: {}", path))
        }
    }
}

pub(crate) fn request_browser_decoded_image_data_url_for_file(
    state: &AppState,
    file: &FileWithTags,
    output_mime_type: &str,
) -> Result<String, String> {
    request_browser_decoded_image_data_url_for_source(state, file.id, &file.path, output_mime_type)
}

pub(super) fn request_browser_decoded_image_data_url(
    state: &AppState,
    candidate: &VisualIndexCandidate,
    output_mime_type: &str,
) -> Result<String, String> {
    request_browser_decoded_image_data_url_for_source(
        state,
        candidate.file.id,
        &candidate.file.path,
        output_mime_type,
    )
}

pub(super) fn resolve_visual_index_image_data_url(
    state: &AppState,
    candidate: &VisualIndexCandidate,
) -> Result<Option<String>, String> {
    if requires_browser_decoded_visual_index(Path::new(&candidate.file.path))? {
        return request_browser_decoded_image_data_url(state, candidate, "image/png").map(Some);
    }

    Ok(None)
}

pub(super) fn sync_visual_content_hash(
    state: &AppState,
    candidate: &VisualIndexCandidate,
    image_data_url: Option<&str>,
) -> Result<String, String> {
    let content_hash_result = match image_data_url {
        Some(image_data_url) => {
            let image_bytes = decode_image_data_url(image_data_url)?;
            crate::media::compute_visual_content_hash_from_bytes(&image_bytes)?
        }
        None => {
            crate::media::compute_visual_content_hash_from_path(Path::new(&candidate.file.path))?
        }
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    match db.update_file_content_hash(candidate.file.id, Some(&content_hash_result)) {
        Ok(()) => Ok(content_hash_result),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn clear_visual_content_hash(
    state: &AppState,
    candidate: &VisualIndexCandidate,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_file_content_hash(candidate.file.id, None)
        .map_err(|e| e.to_string())
}

pub(super) fn update_ai_metadata_task_snapshot<F>(
    tasks: &Arc<Mutex<HashMap<String, AiMetadataTaskEntry>>>,
    task_id: &str,
    update: F,
) where
    F: FnOnce(&mut AiMetadataTaskSnapshot),
{
    if let Ok(mut task_map) = tasks.lock() {
        if let Some(task) = task_map.get_mut(task_id) {
            update(&mut task.snapshot);
        }
    }
}

pub(super) fn emit_ai_metadata_task_update(app_handle: &tauri::AppHandle, task_id: &str) {
    let _ = app_handle.emit(AI_METADATA_TASK_EVENT, task_id);
}

pub(super) fn is_visual_index_task_terminal(status: &str) -> bool {
    matches!(
        status,
        "completed" | "completed_with_errors" | "cancelled" | "failed"
    )
}

pub(super) fn update_visual_index_task_snapshot<F>(
    tasks: &Arc<Mutex<HashMap<String, VisualIndexTaskEntry>>>,
    task_id: &str,
    update: F,
) where
    F: FnOnce(&mut VisualIndexTaskSnapshot),
{
    if let Ok(mut task_map) = tasks.lock() {
        if let Some(task) = task_map.get_mut(task_id) {
            update(&mut task.snapshot);
        }
    }
}

pub(super) fn emit_visual_index_task_update(app_handle: &tauri::AppHandle, task_id: &str) {
    let _ = app_handle.emit(VISUAL_INDEX_TASK_EVENT, task_id);
}

pub(super) fn emit_visual_index_progress(
    app_handle: &tauri::AppHandle,
    processed: usize,
    total: usize,
    indexed: usize,
    failed: usize,
    skipped: usize,
    candidate: &VisualIndexCandidate,
) {
    let _ = app_handle.emit(
        "visual-index-progress",
        VisualIndexProgressPayload {
            processed,
            total,
            indexed,
            failed,
            skipped,
            current_file_id: candidate.file.id,
            current_file_name: candidate.file.name.clone(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb};

    #[test]
    fn visual_index_browser_decode_requirement_uses_content_probe() {
        let temp_dir = std::env::temp_dir();
        let avif_path = temp_dir.join("shiguang-visual-index-avif-probe.avif");
        let png_path = temp_dir.join("shiguang-visual-index-png-probe.png");
        std::fs::write(
            &avif_path,
            [
                0x00, 0x00, 0x00, 0x1C, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f',
            ],
        )
        .unwrap();
        std::fs::write(&png_path, [0x89, 0x50, 0x4E, 0x47]).unwrap();

        assert!(requires_browser_decoded_visual_index(&avif_path).unwrap());
        assert!(!requires_browser_decoded_visual_index(&png_path).unwrap());

        let _ = std::fs::remove_file(avif_path);
        let _ = std::fs::remove_file(png_path);
    }

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
