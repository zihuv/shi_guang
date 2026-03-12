use crate::db::{Database, FileRecord};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;
use image::GenericImageView;
use image::Pixel;
use chrono::{DateTime, Local};

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "svg", "webp", "bmp",
    "ico", "tiff", "tif", "psd", "ai", "eps", "raw",
    "cr2", "nef", "arw", "dng", "heic", "heif",
];

pub fn scan_directory(db: &Database, dir_path: &str) -> Result<usize, String> {
    let mut count = 0;
    let path = Path::new(dir_path);

    if !path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path));
    }

    // Get index paths for folder creation
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let file_path = entry.path();

        if !file_path.is_file() {
            continue;
        }

        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        // Get or create folder for this file
        let folder_id = if let Some(parent) = file_path.parent() {
            let parent_path = parent.to_string_lossy().to_string();
            db.get_or_create_folder(&parent_path, &index_paths).map_err(|e| e.to_string())?
        } else {
            None
        };

        match process_file(file_path, &ext, folder_id) {
            Ok(file_record) => {
                if let Err(e) = db.insert_file(&file_record) {
                    log::warn!("Failed to insert file {}: {}", file_path.display(), e);
                } else {
                    count += 1;
                }
            }
            Err(e) => {
                log::warn!("Failed to process file {}: {}", file_path.display(), e);
            }
        }
    }

    Ok(count)
}

pub fn scan_folders(db: &Database, dir_path: &str) -> Result<usize, String> {
    let path = Path::new(dir_path);

    if !path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path));
    }

    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
    let mut count = 0;

    // Scan all directories under the path
    for entry in WalkDir::new(path)
        .follow_links(true)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let dir_path = entry.path();
        if dir_path.is_dir() {
            let dir_str = dir_path.to_string_lossy().to_string();
            if let Ok(Some(_)) = db.get_or_create_folder(&dir_str, &index_paths) {
                count += 1;
            }
        }
    }

    Ok(count)
}

fn process_file(path: &Path, ext: &str, folder_id: Option<i64>) -> Result<FileRecord, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let (width, height) = get_image_dimensions(path).unwrap_or((0, 0));

    // Extract dominant color
    let dominant_color = extract_dominant_color(path).unwrap_or_default();

    let created_at = metadata
        .created()
        .ok()
        .map(|t| {
            let dt: DateTime<Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    let modified_at = metadata
        .modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    Ok(FileRecord {
        id: 0,
        path: path.to_string_lossy().to_string(),
        name,
        ext: ext.to_string(),
        size: metadata.len() as i64,
        width: width as i32,
        height: height as i32,
        folder_id,
        created_at,
        modified_at,
        imported_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        rating: 0,
        description: String::new(),
        source_url: String::new(),
        dominant_color,
    })
}

fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    // For SVG files, we can't get dimensions from the image crate
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("svg") {
        return Ok((0, 0));
    }

    match image::open(path) {
        Ok(img) => Ok(img.dimensions()),
        Err(_) => Ok((0, 0)),
    }
}

fn extract_dominant_color(path: &Path) -> Result<String, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    // Skip non-image formats
    if ext.eq_ignore_ascii_case("svg") || ext.eq_ignore_ascii_case("psd")
        || ext.eq_ignore_ascii_case("ai") || ext.eq_ignore_ascii_case("eps")
        || ext.eq_ignore_ascii_case("raw") || ext.eq_ignore_ascii_case("cr2")
        || ext.eq_ignore_ascii_case("nef") || ext.eq_ignore_ascii_case("arw")
        || ext.eq_ignore_ascii_case("dng") || ext.eq_ignore_ascii_case("heic")
        || ext.eq_ignore_ascii_case("heif") {
        return Ok(String::new());
    }

    match image::open(path) {
        Ok(img) => {
            // Resize image to small size for faster processing
            let img = img.resize(50, 50, image::imageops::FilterType::Nearest);
            let pixels: Vec<_> = img.pixels().collect();

            // Simple average color calculation
            let mut r_sum: u64 = 0;
            let mut g_sum: u64 = 0;
            let mut b_sum: u64 = 0;
            let count = pixels.len() as u64;

            for pixel in pixels {
                let rgb = pixel.2.to_rgb();
                r_sum += rgb[0] as u64;
                g_sum += rgb[1] as u64;
                b_sum += rgb[2] as u64;
            }

            if count > 0 {
                let r = (r_sum / count) as u8;
                let g = (g_sum / count) as u8;
                let b = (b_sum / count) as u8;
                Ok(format!("#{:02X}{:02X}{:02X}", r, g, b))
            } else {
                Ok(String::new())
            }
        }
        Err(_) => Ok(String::new()),
    }
}
