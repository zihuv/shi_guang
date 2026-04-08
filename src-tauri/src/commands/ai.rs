use super::*;
use crate::openai::{load_ai_config, request_image_metadata};
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, GenericImageView, ImageFormat, ImageReader, imageops::FilterType};
use std::io::BufReader;
use std::path::{Path, PathBuf};

const MAX_AI_TAGS: usize = 5;
const MAX_AI_DESCRIPTION_CHARS: usize = 200;
const NEW_TAG_COLORS: [&str; 8] = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
];

fn is_supported_image(file: &FileWithTags) -> bool {
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
    )
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
        let reader = ImageReader::new(BufReader::new(std::io::Cursor::new(&bytes)))
            .with_guessed_format()
            .map_err(|e| format!("无法识别图片格式: {}", e))?;
        reader.decode().map_err(|e| format!("reader decode failed: {}", e))
    };

    decode_with_reader().or_else(|reader_error| {
        image::load_from_memory(&bytes).map_err(|memory_error| match detected_format {
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
    let ext = old_path.extension().and_then(|value| value.to_str()).unwrap_or("");

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
    let hash = name
        .bytes()
        .fold(0usize, |acc, value| acc.wrapping_add(value as usize));
    NEW_TAG_COLORS[hash % NEW_TAG_COLORS.len()]
}

async fn request_ai_metadata(
    config: &crate::openai::AiConfig,
    file: &FileWithTags,
    existing_tags: &[Tag],
    image_data_url: &str,
) -> Result<crate::openai::AiMetadataSuggestion, String> {
    let mut suggestion = request_image_metadata(config, file, existing_tags, image_data_url).await?;
    suggestion.filename = sanitize_filename_stem(
        &suggestion.filename,
        Path::new(&file.name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("untitled"),
    );
    suggestion.tags = sanitize_tag_list(std::mem::take(&mut suggestion.tags));
    suggestion.description = trim_to_char_limit(suggestion.description.trim(), MAX_AI_DESCRIPTION_CHARS);

    Ok(suggestion)
}

#[tauri::command]
pub async fn analyze_file_metadata(
    state: State<'_, AppState>,
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

    let _ = (&config.embedding_model, &config.reranker_model);

    if !is_supported_image(&file) {
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
    let suggestion = request_ai_metadata(&config, &file, &existing_tags, &image_data_url).await?;

    let current_stem = old_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled");
    let desired_stem = sanitize_filename_stem(&suggestion.filename, current_stem);

    let updated_file = {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        let (new_name, new_path) = resolve_available_rename_path(&db, file_id, &old_path, &desired_stem)?;
        if new_path != old_path {
            move_file_with_fallback(&old_path, &new_path)?;
            let new_path_string = new_path.to_string_lossy().to_string();
            db.update_file_name(file_id, &new_name, &new_path_string)
                .map_err(|e| e.to_string())?;
        }

        db.update_file_metadata(file_id, file.rating, &suggestion.description, &file.source_url)
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
            .ok_or_else(|| "更新后无法读取文件".to_string())?
    };

    Ok(updated_file)
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
