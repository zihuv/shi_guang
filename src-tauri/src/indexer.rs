use crate::db::{Database, FileRecord};
use crate::media::MediaProbe;
use chrono::{DateTime, Local};
use image::GenericImageView;
use image::Pixel;
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorInfo {
    pub color: String,
    pub percentage: f64,
}

pub fn scan_directory(db: &Database, dir_path: &str) -> Result<usize, String> {
    let mut count = 0;
    let path = Path::new(dir_path);

    if !path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path));
    }

    // Get index paths for folder creation
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;

    // Get existing file paths in this directory for incremental scanning
    let existing_paths: HashSet<String> = db
        .get_file_paths_in_dir(dir_path)
        .map_err(|e| e.to_string())?;
    let mut processed_paths: HashSet<String> = HashSet::new();

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| !should_skip_entry(entry))
        .filter_map(|e| e.ok())
    {
        let file_path = entry.path();

        if !file_path.is_file() {
            continue;
        }

        if should_skip_path(file_path) {
            continue;
        }

        let probe = match crate::media::probe_media_path(file_path) {
            Ok(probe) if probe.is_scan_supported() => probe,
            Ok(_) => continue,
            Err(error) => {
                log::debug!("Failed to probe media {}: {}", file_path.display(), error);
                continue;
            }
        };

        let Some(detected_ext) = probe.detected_extension() else {
            continue;
        };

        let file_path_str = file_path.to_string_lossy().to_string();
        processed_paths.insert(file_path_str.clone());

        // Get or create folder for this file
        let folder_id = if let Some(parent) = file_path.parent() {
            let parent_path = parent.to_string_lossy().to_string();
            db.get_or_create_folder(&parent_path, &index_paths)
                .map_err(|e| e.to_string())?
        } else {
            None
        };

        // Check if file already exists and is unchanged (incremental scan)
        if existing_paths.contains(&file_path_str) {
            // File exists, check if it needs update
            match process_file(file_path, probe, folder_id) {
                Ok(file_record) => {
                    // Check if file is unchanged
                    if db
                        .is_file_unchanged(
                            &file_path_str,
                            detected_ext,
                            file_record.size,
                            &file_record.modified_at,
                        )
                        .unwrap_or(false)
                    {
                        // File is unchanged, skip processing
                        continue;
                    }
                    let visual_content_hash =
                        compute_visual_content_hash_for_scan(file_path, &file_record.ext);
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
                        visual_content_hash.as_deref(),
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
            match process_file(file_path, probe, folder_id) {
                Ok(file_record) => {
                    let visual_content_hash =
                        compute_visual_content_hash_for_scan(file_path, &file_record.ext);
                    match db.insert_file(&file_record) {
                        Ok(file_id) => {
                            if let Err(e) =
                                db.update_file_content_hash(file_id, visual_content_hash.as_deref())
                            {
                                log::warn!(
                                    "Failed to persist visual content hash for {}: {}",
                                    file_path.display(),
                                    e
                                );
                            }
                            count += 1;
                        }
                        Err(e) => {
                            log::warn!("Failed to insert file {}: {}", file_path.display(), e);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to process file {}: {}", file_path.display(), e);
                }
            }
        }
    }

    // Mark deleted files (files that existed but are no longer on disk)
    let deleted_paths: Vec<String> = existing_paths
        .difference(&processed_paths)
        .cloned()
        .collect();
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
        .filter_entry(|entry| !should_skip_entry(entry))
        .filter_map(|e| e.ok())
    {
        let dir_path = entry.path();
        if dir_path.is_dir() {
            if should_skip_path(dir_path) {
                continue;
            }
            let dir_str = dir_path.to_string_lossy().to_string();
            if let Ok(Some(_)) = db.get_or_create_folder(&dir_str, &index_paths) {
                count += 1;
            }
        }
    }

    Ok(count)
}

fn process_file(
    path: &Path,
    probe: MediaProbe,
    folder_id: Option<i64>,
) -> Result<FileRecord, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let ext = probe.detected_extension().unwrap_or("bin");

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
    let color_distribution_json =
        serde_json::to_string(&color_distribution).unwrap_or_else(|_| "[]".to_string());

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

fn compute_visual_content_hash_for_scan(path: &Path, ext: &str) -> Option<String> {
    if !crate::media::is_visual_search_supported_extension(ext) {
        return None;
    }

    crate::media::compute_visual_content_hash_from_path(path).ok()
}

fn should_skip_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }

    entry
        .file_name()
        .to_str()
        .map(crate::storage::is_hidden_name)
        .unwrap_or(false)
}

fn should_skip_path(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(crate::storage::is_hidden_name)
            .unwrap_or(false)
    })
}

fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let probe = crate::media::probe_media_path(path)?;
    if probe.is_svg() || !probe.is_backend_decodable_image() {
        return Ok((0, 0));
    }

    match crate::media::load_dynamic_image_from_path(path) {
        Ok(img) => Ok(img.dimensions()),
        Err(_) => Ok((0, 0)),
    }
}

pub fn extract_dominant_color(path: &Path) -> Result<String, String> {
    let probe = crate::media::probe_media_path(path)?;
    if !probe.can_extract_colors() {
        return Ok(String::new());
    }

    match crate::media::load_dynamic_image_from_path(path) {
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
    let probe = crate::media::probe_media_path(path)?;
    if !probe.can_extract_colors() {
        return Ok(Vec::new());
    }

    match crate::media::load_dynamic_image_from_path(path) {
        Ok(img) => Ok(extract_color_distribution_from_image(img)),
        Err(_) => Ok(Vec::new()),
    }
}

pub fn extract_color_distribution_from_bytes(bytes: &[u8]) -> Result<Vec<ColorInfo>, String> {
    let image = crate::media::load_dynamic_image_from_bytes(bytes)?;
    Ok(extract_color_distribution_from_image(image))
}

fn extract_color_distribution_from_image(img: image::DynamicImage) -> Vec<ColorInfo> {
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
        return Vec::new();
    }

    // Run K-means clustering
    let num_clusters = 7;
    let clusters = kmeans_clustering(&rgb_values, num_clusters, 20);

    // Calculate percentages
    let total = rgb_values.len() as f64;
    let mut color_infos: Vec<ColorInfo> = clusters
        .iter()
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
    merged.into_iter().take(7).collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use image::codecs::png::PngEncoder;
    use image::{ColorType, ImageBuffer, ImageEncoder, Rgb};

    #[test]
    fn extract_color_distribution_from_png_bytes_returns_primary_color() {
        let image = ImageBuffer::from_pixel(4, 4, Rgb([12, 34, 56]));
        let mut bytes = Vec::new();
        let encoder = PngEncoder::new(&mut bytes);

        encoder
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                ColorType::Rgb8.into(),
            )
            .unwrap();

        let colors = extract_color_distribution_from_bytes(&bytes).unwrap();

        assert_eq!(colors.len(), 1);
        assert_eq!(colors[0].color, "#0C2238");
        assert!((colors[0].percentage - 100.0).abs() < f64::EPSILON);
    }
}
