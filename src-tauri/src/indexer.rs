use crate::db::{Database, FileRecord};
use std::fs;
use std::path::Path;
use std::collections::HashSet;
use walkdir::WalkDir;
use image::GenericImageView;
use image::Pixel;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use serde_json;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorInfo {
    pub color: String,
    pub percentage: f64,
}

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

    // Get existing file paths in this directory for incremental scanning
    let existing_paths: HashSet<String> = db.get_file_paths_in_dir(dir_path).map_err(|e| e.to_string())?;
    let mut processed_paths: HashSet<String> = HashSet::new();

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

        let file_path_str = file_path.to_string_lossy().to_string();
        processed_paths.insert(file_path_str.clone());

        // Get or create folder for this file
        let folder_id = if let Some(parent) = file_path.parent() {
            let parent_path = parent.to_string_lossy().to_string();
            db.get_or_create_folder(&parent_path, &index_paths).map_err(|e| e.to_string())?
        } else {
            None
        };

        // Check if file already exists and is unchanged (incremental scan)
        if existing_paths.contains(&file_path_str) {
            // File exists, check if it needs update
            match process_file(file_path, &ext, folder_id) {
                Ok(file_record) => {
                    // Check if file is unchanged
                    if db.is_file_unchanged(&file_path_str, file_record.size, &file_record.modified_at).unwrap_or(false) {
                        // File is unchanged, skip processing
                        continue;
                    }
                    // File is modified, update basic info only
                    if let Err(e) = db.update_file_basic_info(
                        &file_path_str,
                        &file_record.name,
                        &file_record.ext,
                        file_record.size,
                        file_record.width,
                        file_record.height,
                        file_record.folder_id,
                        &file_record.created_at,
                        &file_record.modified_at,
                    ) {
                        log::warn!("Failed to update file {}: {}", file_path.display(), e);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to process file {}: {}", file_path.display(), e);
                }
            }
        } else {
            // New file, insert it
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
    }

    // Mark deleted files (files that existed but are no longer on disk)
    let deleted_paths: Vec<String> = existing_paths.difference(&processed_paths).cloned().collect();
    for deleted_path in &deleted_paths {
        if let Err(e) = db.delete_file(deleted_path) {
            log::warn!("Failed to delete file {}: {}", deleted_path, e);
        }
    }

    if !deleted_paths.is_empty() {
        log::info!("Marked {} deleted files", deleted_paths.len());
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

    // Extract color distribution
    let color_distribution = extract_color_distribution(path).unwrap_or_default();
    let color_distribution_json = serde_json::to_string(&color_distribution).unwrap_or_else(|_| "[]".to_string());

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
        color_distribution: color_distribution_json,
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

/// 检查是否为不支持颜色提取的图像格式
fn is_color_extraction_unsupported_format(ext: &str) -> bool {
    ext.eq_ignore_ascii_case("svg") || ext.eq_ignore_ascii_case("psd")
        || ext.eq_ignore_ascii_case("ai") || ext.eq_ignore_ascii_case("eps")
        || ext.eq_ignore_ascii_case("raw") || ext.eq_ignore_ascii_case("cr2")
        || ext.eq_ignore_ascii_case("nef") || ext.eq_ignore_ascii_case("arw")
        || ext.eq_ignore_ascii_case("dng") || ext.eq_ignore_ascii_case("heic")
        || ext.eq_ignore_ascii_case("heif")
}

pub fn extract_dominant_color(path: &Path) -> Result<String, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    // Skip non-image formats
    if is_color_extraction_unsupported_format(ext) {
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

/// Extract color distribution using K-means clustering
pub fn extract_color_distribution(path: &Path) -> Result<Vec<ColorInfo>, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    // Skip non-image formats
    if is_color_extraction_unsupported_format(ext) {
        return Ok(Vec::new());
    }

    match image::open(path) {
        Ok(img) => {
            // Resize image to small size for faster processing
            let img = img.resize(50, 50, image::imageops::FilterType::Nearest);
            let pixels: Vec<_> = img.pixels().collect();

            // Collect RGB values
            let mut rgb_values: Vec<[f64; 3]> = Vec::new();
            for pixel in &pixels {
                let rgb = pixel.2.to_rgb();
                rgb_values.push([rgb[0] as f64, rgb[1] as f64, rgb[2] as f64]);
            }

            if rgb_values.is_empty() {
                return Ok(Vec::new());
            }

            // Run K-means clustering
            let num_clusters = 7;
            let clusters = kmeans_clustering(&rgb_values, num_clusters, 20);

            // Calculate percentages
            let total = rgb_values.len() as f64;
            let mut color_infos: Vec<ColorInfo> = clusters.iter()
                .map(|c| {
                    let r = c[0] as u8;
                    let g = c[1] as u8;
                    let b = c[2] as u8;
                    let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);
                    ColorInfo {
                        color: hex,
                        percentage: (c[3] / total) * 100.0,
                    }
                })
                .collect();

            // Sort by percentage descending
            color_infos.sort_by(|a, b| b.percentage.partial_cmp(&a.percentage).unwrap());

            // Merge similar colors (distance threshold 30)
            let merged = merge_similar_colors(color_infos, 30.0);

            // Return top 7 colors
            Ok(merged.into_iter().take(7).collect())
        }
        Err(_) => Ok(Vec::new()),
    }
}

/// Simple K-means clustering implementation
fn kmeans_clustering(data: &[[f64; 3]], k: usize, max_iterations: usize) -> Vec<[f64; 4]> {
    if data.is_empty() || k == 0 {
        return Vec::new();
    }

    let k = k.min(data.len());

    // Initialize centroids by random sampling
    let mut centroids: Vec<[f64; 3]> = Vec::with_capacity(k);
    let mut used_indices = std::collections::HashSet::new();

    let mut rng_seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;

    for _ in 0..k {
        let idx = (rng_seed as usize) % data.len();
        if used_indices.insert(idx) {
            centroids.push(data[idx]);
        }
        rng_seed = rng_seed.wrapping_mul(1103515245).wrapping_add(12345);
    }

    // Run iterations
    for _ in 0..max_iterations {
        // Assign points to nearest centroid
        let mut clusters: Vec<Vec<[f64; 3]>> = vec![Vec::new(); k];

        for point in data {
            let mut min_dist = f64::MAX;
            let mut nearest = 0;

            for (i, centroid) in centroids.iter().enumerate() {
                let dist = color_distance(point, centroid);
                if dist < min_dist {
                    min_dist = dist;
                    nearest = i;
                }
            }

            clusters[nearest].push(*point);
        }

        // Update centroids
        let mut changed = false;
        for (i, cluster) in clusters.iter().enumerate() {
            if cluster.is_empty() {
                continue;
            }

            let mut new_centroid = [0.0; 3];
            for point in cluster {
                new_centroid[0] += point[0];
                new_centroid[1] += point[1];
                new_centroid[2] += point[2];
            }
            let len = cluster.len() as f64;
            new_centroid[0] /= len;
            new_centroid[1] /= len;
            new_centroid[2] /= len;

            if color_distance(&new_centroid, &centroids[i]) > 1.0 {
                changed = true;
            }
            centroids[i] = new_centroid;
        }

        if !changed {
            break;
        }
    }

    // Final assignment to get accurate counts
    let mut final_clusters: Vec<Vec<[f64; 3]>> = vec![Vec::new(); k];

    for point in data {
        let mut min_dist = f64::MAX;
        let mut nearest = 0;

        for (i, centroid) in centroids.iter().enumerate() {
            let dist = color_distance(point, centroid);
            if dist < min_dist {
                min_dist = dist;
                nearest = i;
            }
        }

        final_clusters[nearest].push(*point);
    }

    // Calculate cluster sizes and return
    let mut result: Vec<[f64; 4]> = Vec::with_capacity(k);

    for (i, centroid) in centroids.iter().enumerate() {
        let count = final_clusters[i].len() as f64;
        result.push([centroid[0], centroid[1], centroid[2], count]);
    }

    result
}

/// Calculate Euclidean distance between two colors
fn color_distance(c1: &[f64; 3], c2: &[f64; 3]) -> f64 {
    let dr = c1[0] - c2[0];
    let dg = c1[1] - c2[1];
    let db = c1[2] - c2[2];
    (dr * dr + dg * dg + db * db).sqrt()
}

/// Merge similar colors based on distance threshold
fn merge_similar_colors(colors: Vec<ColorInfo>, threshold: f64) -> Vec<ColorInfo> {
    if colors.is_empty() {
        return colors;
    }

    let mut merged: Vec<ColorInfo> = colors;

    loop {
        let mut i = 0;
        let mut found_similar = false;

        while i < merged.len() {
            let mut j = i + 1;
            while j < merged.len() {
                if color_distance_hex(&merged[i].color, &merged[j].color) < threshold {
                    // Merge j into i
                    merged[i].percentage += merged[j].percentage;
                    merged.remove(j);
                    found_similar = true;
                } else {
                    j += 1;
                }
            }
            i += 1;
        }

        if !found_similar {
            break;
        }
    }

    // Sort by percentage again
    merged.sort_by(|a, b| b.percentage.partial_cmp(&a.percentage).unwrap());
    merged
}

/// Calculate color distance between two hex colors
fn color_distance_hex(hex1: &str, hex2: &str) -> f64 {
    let parse_hex = |hex: &str| -> Option<[f64; 3]> {
        let hex = hex.trim_start_matches('#');
        if hex.len() >= 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f64;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f64;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f64;
            Some([r, g, b])
        } else {
            None
        }
    };

    match (parse_hex(hex1), parse_hex(hex2)) {
        (Some(c1), Some(c2)) => color_distance(&c1, &c2),
        _ => f64::MAX,
    }
}
