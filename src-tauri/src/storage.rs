use base64::Engine;
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ColorType, DynamicImage};
use rusqlite::Connection;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const DB_FILE_NAME: &str = "shiguang.db";
const CURRENT_INDEX_PATH_FILE_NAME: &str = "current-index-path.txt";
const THUMBNAIL_QUALITY: u8 = 82;
pub const THUMBNAIL_SIZE: u32 = 320;
pub const LIST_THUMBNAIL_SIZE: u32 = 160;
const MIN_THUMBNAIL_SIZE: u32 = 64;
const KNOWN_THUMBNAIL_SIZES: [u32; 2] = [THUMBNAIL_SIZE, LIST_THUMBNAIL_SIZE];

fn normalize_thumbnail_size(requested_size: Option<u32>) -> u32 {
    requested_size
        .unwrap_or(THUMBNAIL_SIZE)
        .clamp(MIN_THUMBNAIL_SIZE, THUMBNAIL_SIZE)
}

pub fn get_default_index_path() -> PathBuf {
    let pictures_dir = dirs::picture_dir().unwrap_or_else(|| PathBuf::from("."));
    pictures_dir.join("shiguang")
}

pub fn get_shiguang_dir(index_path: &Path) -> PathBuf {
    index_path.join(".shiguang")
}

pub fn get_db_dir(index_path: &Path) -> PathBuf {
    get_shiguang_dir(index_path).join("db")
}

pub fn get_thumbnail_dir(index_path: &Path) -> PathBuf {
    get_shiguang_dir(index_path).join("thumbnails")
}

pub fn get_db_path(index_path: &Path) -> PathBuf {
    get_db_dir(index_path).join(DB_FILE_NAME)
}

pub fn get_legacy_index_db_path(index_path: &Path) -> PathBuf {
    get_shiguang_dir(index_path).join(DB_FILE_NAME)
}

pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

fn get_legacy_app_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DB_FILE_NAME)
}

fn get_current_index_path_config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CURRENT_INDEX_PATH_FILE_NAME)
}

pub fn read_persisted_index_path(app_data_dir: &Path) -> Option<PathBuf> {
    let config_path = get_current_index_path_config_path(app_data_dir);
    let raw = fs::read_to_string(config_path).ok()?;
    let path = raw.trim();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

pub fn persist_index_path(app_data_dir: &Path, index_path: &Path) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| {
        format!(
            "Failed to create app data directory {:?}: {}",
            app_data_dir, e
        )
    })?;

    let config_path = get_current_index_path_config_path(app_data_dir);
    let normalized_path = crate::path_utils::normalize_path(index_path);
    fs::write(&config_path, normalized_path).map_err(|e| {
        format!(
            "Failed to write current index path {:?}: {}",
            config_path, e
        )
    })?;

    Ok(())
}

pub fn ensure_storage_dirs(index_path: &Path) -> Result<(), String> {
    let shiguang_dir = get_shiguang_dir(index_path);
    let db_dir = get_db_dir(index_path);
    let thumbnail_dir = get_thumbnail_dir(index_path);

    if !shiguang_dir.exists() {
        fs::create_dir_all(&shiguang_dir)
            .map_err(|e| format!("Failed to create .shiguang directory: {}", e))?;
    }

    if !db_dir.exists() {
        fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to create db directory: {}", e))?;
    }

    if !thumbnail_dir.exists() {
        fs::create_dir_all(&thumbnail_dir)
            .map_err(|e| format!("Failed to create thumbnails directory: {}", e))?;
    }

    Ok(())
}

pub fn find_matching_index_path<'a>(index_paths: &'a [String], file_path: &str) -> Option<&'a str> {
    let mut best_match: Option<&str> = None;

    for index_path in index_paths {
        if crate::path_utils::path_has_prefix(file_path, index_path) {
            match best_match {
                Some(current) if current.len() >= index_path.len() => {}
                _ => best_match = Some(index_path.as_str()),
            }
        }
    }

    best_match
}

fn hash_thumbnail_key(file_path: &Path, metadata: &fs::Metadata, thumbnail_size: u32) -> String {
    let mut hasher = DefaultHasher::new();
    file_path.to_string_lossy().hash(&mut hasher);
    thumbnail_size.hash(&mut hasher);
    metadata.len().hash(&mut hasher);

    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    modified.hash(&mut hasher);

    format!("{:016x}", hasher.finish())
}

pub fn get_thumbnail_output_path(
    index_path: &Path,
    file_path: &Path,
    thumbnail_size: u32,
) -> Result<PathBuf, String> {
    let metadata = fs::metadata(file_path).map_err(|e| e.to_string())?;
    let hash = hash_thumbnail_key(file_path, &metadata, thumbnail_size);
    let shard = &hash[0..2];
    let shard_dir = get_thumbnail_dir(index_path).join(shard);
    if !shard_dir.exists() {
        fs::create_dir_all(&shard_dir)
            .map_err(|e| format!("Failed to create thumbnail directory: {}", e))?;
    }
    Ok(shard_dir.join(format!("{}.jpg", hash)))
}

pub fn get_thumbnail_cache_path(
    index_paths: &[String],
    file_path: &Path,
    thumbnail_size: Option<u32>,
) -> Result<Option<PathBuf>, String> {
    let file_path_str = file_path.to_string_lossy().to_string();
    let Some(index_path) = find_matching_index_path(index_paths, &file_path_str) else {
        return Ok(None);
    };

    ensure_storage_dirs(Path::new(index_path))?;
    let normalized_thumbnail_size = normalize_thumbnail_size(thumbnail_size);
    Ok(Some(get_thumbnail_output_path(
        Path::new(index_path),
        file_path,
        normalized_thumbnail_size,
    )?))
}

fn flatten_on_white(image: DynamicImage) -> image::RgbImage {
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgb = image::RgbImage::new(width, height);

    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = pixel[3] as u16;
        let inv_alpha = 255u16.saturating_sub(alpha);
        let r = ((pixel[0] as u16 * alpha) + (255 * inv_alpha)) / 255;
        let g = ((pixel[1] as u16 * alpha) + (255 * inv_alpha)) / 255;
        let b = ((pixel[2] as u16 * alpha) + (255 * inv_alpha)) / 255;
        rgb.put_pixel(x, y, image::Rgb([r as u8, g as u8, b as u8]));
    }

    rgb
}

pub fn get_or_create_thumbnail(
    index_paths: &[String],
    file_path: &Path,
    thumbnail_size: Option<u32>,
) -> Result<Option<PathBuf>, String> {
    let normalized_thumbnail_size = normalize_thumbnail_size(thumbnail_size);
    let Some(output_path) =
        get_thumbnail_cache_path(index_paths, file_path, Some(normalized_thumbnail_size))?
    else {
        return Ok(None);
    };
    if output_path.exists() {
        return Ok(Some(output_path));
    }

    let image = match crate::media::load_dynamic_image_from_path(file_path) {
        Ok(img) => img,
        Err(_) => return Ok(None),
    };

    let thumbnail = image.resize(
        normalized_thumbnail_size,
        normalized_thumbnail_size,
        FilterType::Lanczos3,
    );
    let rgb = flatten_on_white(thumbnail);

    let file = fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create thumbnail file {:?}: {}", output_path, e))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, THUMBNAIL_QUALITY);
    encoder
        .encode(&rgb, rgb.width(), rgb.height(), ColorType::Rgb8.into())
        .map_err(|e| format!("Failed to encode thumbnail {:?}: {}", output_path, e))?;

    Ok(Some(output_path))
}

pub fn get_or_create_thumbnail_base64(
    index_paths: &[String],
    file_path: &Path,
    thumbnail_size: Option<u32>,
) -> Result<Option<String>, String> {
    let Some(output_path) = get_or_create_thumbnail(index_paths, file_path, thumbnail_size)? else {
        return Ok(None);
    };

    let bytes = fs::read(&output_path)
        .map_err(|e| format!("Failed to read thumbnail file {:?}: {}", output_path, e))?;

    Ok(Some(
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

pub fn remove_thumbnail_for_file(index_paths: &[String], file_path: &Path) -> Result<(), String> {
    if !file_path.exists() {
        return Ok(());
    }

    let file_path_str = file_path.to_string_lossy().to_string();
    let Some(index_path) = find_matching_index_path(index_paths, &file_path_str) else {
        return Ok(());
    };

    for thumbnail_size in KNOWN_THUMBNAIL_SIZES {
        let output_path =
            get_thumbnail_output_path(Path::new(index_path), file_path, thumbnail_size)?;
        if output_path.exists() {
            fs::remove_file(&output_path)
                .map_err(|e| format!("Failed to remove thumbnail {:?}: {}", output_path, e))?;
        }
    }

    Ok(())
}

fn read_index_path_from_db(db_path: &Path) -> Option<PathBuf> {
    if !db_path.exists() {
        return None;
    }

    let conn = Connection::open(db_path).ok()?;
    conn.query_row("SELECT path FROM index_paths LIMIT 1", [], |row| {
        row.get::<_, String>(0)
    })
    .ok()
    .map(PathBuf::from)
}

fn move_file_with_fallback(from: &Path, to: &Path) -> Result<(), String> {
    match fs::rename(from, to) {
        Ok(_) => Ok(()),
        Err(_) => {
            fs::copy(from, to)
                .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", from, to, e))?;
            fs::remove_file(from)
                .map_err(|e| format!("Failed to remove old file {:?}: {}", from, e))?;
            Ok(())
        }
    }
}

fn move_sqlite_bundle(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() || to.exists() {
        return Ok(());
    }

    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create database directory {:?}: {}", parent, e))?;
    }

    move_file_with_fallback(from, to)?;

    for suffix in [".wal", "-wal", ".shm", "-shm"] {
        let sidecar_from = PathBuf::from(format!("{}{}", from.to_string_lossy(), suffix));
        if sidecar_from.exists() {
            let sidecar_to = PathBuf::from(format!("{}{}", to.to_string_lossy(), suffix));
            move_file_with_fallback(&sidecar_from, &sidecar_to)?;
        }
    }

    Ok(())
}

pub fn migrate_or_get_db_path(app_data_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let legacy_app_db_path = get_legacy_app_db_path(app_data_dir);
    let persisted_index_path = read_persisted_index_path(app_data_dir);
    let legacy_index_path = read_index_path_from_db(&legacy_app_db_path);

    let index_path = persisted_index_path
        .clone()
        .or(legacy_index_path)
        .unwrap_or_else(get_default_index_path);

    ensure_storage_dirs(&index_path)?;
    persist_index_path(app_data_dir, &index_path)?;

    let new_db_path = get_db_path(&index_path);
    let legacy_index_db_path = get_legacy_index_db_path(&index_path);

    if legacy_index_db_path.exists() && !new_db_path.exists() {
        log::info!(
            "Migrating database from legacy index path {:?} to {:?}",
            legacy_index_db_path,
            new_db_path
        );
        move_sqlite_bundle(&legacy_index_db_path, &new_db_path)?;
    }

    if persisted_index_path.is_none() && legacy_app_db_path.exists() && !new_db_path.exists() {
        log::info!(
            "Migrating database from app data {:?} to {:?}",
            legacy_app_db_path,
            new_db_path
        );
        move_sqlite_bundle(&legacy_app_db_path, &new_db_path)?;
    }

    Ok((new_db_path, index_path))
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_storage_dirs, get_or_create_thumbnail, get_or_create_thumbnail_base64,
        get_thumbnail_cache_path, LIST_THUMBNAIL_SIZE, THUMBNAIL_SIZE,
    };
    use image::{GenericImageView, Rgb, RgbImage};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir() -> PathBuf {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("shiguang-thumbnail-test-{unique_suffix}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn thumbnail_base64_reads_generated_thumbnail() {
        let index_path = create_temp_dir();
        ensure_storage_dirs(&index_path).unwrap();

        let source_path = index_path.join("sample.png");
        let image = RgbImage::from_pixel(24, 24, Rgb([12, 34, 56]));
        image.save(&source_path).unwrap();

        let index_paths = vec![index_path.to_string_lossy().to_string()];
        let thumbnail_base64 =
            get_or_create_thumbnail_base64(&index_paths, &source_path, None).unwrap();
        assert!(thumbnail_base64.is_some());
        assert!(!thumbnail_base64.unwrap().is_empty());

        let thumbnail_path = get_thumbnail_cache_path(&index_paths, &source_path, None).unwrap();
        assert!(thumbnail_path.is_some());
        assert!(thumbnail_path.unwrap().exists());

        fs::remove_dir_all(index_path).unwrap();
    }

    #[test]
    fn thumbnail_generation_respects_requested_size() {
        let index_path = create_temp_dir();
        ensure_storage_dirs(&index_path).unwrap();

        let source_path = index_path.join("wide.png");
        let image = RgbImage::from_pixel(800, 400, Rgb([120, 45, 200]));
        image.save(&source_path).unwrap();

        let index_paths = vec![index_path.to_string_lossy().to_string()];
        let default_thumbnail = get_or_create_thumbnail(&index_paths, &source_path, None)
            .unwrap()
            .unwrap();
        let list_thumbnail =
            get_or_create_thumbnail(&index_paths, &source_path, Some(LIST_THUMBNAIL_SIZE))
                .unwrap()
                .unwrap();

        assert_ne!(default_thumbnail, list_thumbnail);

        let default_dimensions = image::open(&default_thumbnail).unwrap().dimensions();
        let list_dimensions = image::open(&list_thumbnail).unwrap().dimensions();

        assert_eq!(default_dimensions.0, THUMBNAIL_SIZE);
        assert_eq!(list_dimensions.0, LIST_THUMBNAIL_SIZE);

        fs::remove_dir_all(index_path).unwrap();
    }
}
