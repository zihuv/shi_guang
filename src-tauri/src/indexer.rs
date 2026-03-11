use crate::db::{Database, FileRecord};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;
use image::GenericImageView;
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

        match process_file(file_path, &ext) {
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

fn process_file(path: &Path, ext: &str) -> Result<FileRecord, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let (width, height) = get_image_dimensions(path).unwrap_or((0, 0));

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
        created_at,
        modified_at,
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
