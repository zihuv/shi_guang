use crate::path_utils::{join_path, normalize_path, path_has_prefix, replace_path_prefix};
use chrono::Local;
use image::GenericImageView;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static SYNC_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Parse a hex color string (#RRGGBB) to RGB components
fn parse_hex_color(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

pub fn current_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn generate_sync_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let counter = SYNC_ID_COUNTER.fetch_add(1, Ordering::Relaxed);

    format!(
        "{prefix}_{:x}{:08x}{:x}{:x}",
        duration.as_secs(),
        duration.subsec_nanos(),
        std::process::id(),
        counter
    )
}

/// Get image dimensions
pub fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("svg") {
        return Ok((0, 0));
    }

    match image::open(path) {
        Ok(img) => Ok(img.dimensions()),
        Err(_) => Ok((0, 0)),
    }
}

/// 统一的图片导入辅助函数
/// 处理文件保存、尺寸获取、色彩分布提取等公共逻辑
/// 注意：created_at 和 modified_at 由调用者提供
pub fn save_and_import_image(
    image_data: &[u8],
    dest_path: &Path,
    folder_id: Option<i64>,
    created_at: String,
    modified_at: String,
) -> Result<FileRecord, String> {
    use std::fs;

    // Save image file
    fs::write(dest_path, image_data).map_err(|e| e.to_string())?;

    // Get image dimensions
    let (width, height) = get_image_dimensions(dest_path).unwrap_or((0, 0));

    // Extract color distribution
    let color_distribution =
        super::indexer::extract_color_distribution(dest_path).unwrap_or_default();
    let color_distribution_json =
        serde_json::to_string(&color_distribution).unwrap_or_else(|_| "[]".to_string());
    let dominant_color = color_distribution
        .first()
        .map(|c| c.color.clone())
        .unwrap_or_default();

    // Get file metadata
    let metadata = fs::metadata(dest_path).map_err(|e| e.to_string())?;
    let now = current_timestamp();

    Ok(FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: dest_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string(),
        ext: dest_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_lowercase(),
        size: metadata.len() as i64,
        width: width as i32,
        height: height as i32,
        folder_id,
        created_at,
        modified_at,
        imported_at: now,
        rating: 0,
        description: String::new(),
        source_url: String::new(),
        dominant_color,
        color_distribution: color_distribution_json,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: String,
    #[serde(rename = "isSystem")]
    pub is_system: bool,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileRecord {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub width: i32,
    pub height: i32,
    pub folder_id: Option<i64>,
    pub created_at: String,
    pub modified_at: String,
    pub imported_at: String,
    pub rating: i32,
    pub description: String,
    pub source_url: String,
    pub dominant_color: String,
    pub color_distribution: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
    #[serde(rename = "parentId")]
    pub parent_id: Option<i64>,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileWithTags {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub width: i32,
    pub height: i32,
    #[serde(rename = "folderId")]
    pub folder_id: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: String,
    #[serde(rename = "importedAt")]
    pub imported_at: String,
    pub rating: i32,
    pub description: String,
    #[serde(rename = "sourceUrl")]
    pub source_url: String,
    #[serde(rename = "dominantColor")]
    pub dominant_color: String,
    #[serde(rename = "colorDistribution")]
    pub color_distribution: String,
    pub tags: Vec<Tag>,
    #[serde(rename = "deletedAt")]
    pub deleted_at: Option<String>,
}

pub struct Database {
    conn: Connection,
}

pub const BROWSER_COLLECTION_FOLDER_NAME: &str = "浏览器采集";
pub const BROWSER_COLLECTION_FOLDER_SORT_ORDER: i32 = -1;
const DB_SCHEMA_VERSION: i32 = 6;

mod files;
mod folders;
mod schema;
mod settings;
mod tags;
