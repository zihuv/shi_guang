use crate::db::{FileWithTags, Tag, FileRecord};
use crate::indexer;
use crate::AppState;
use tauri::State;
use std::fs;
use std::path::Path;
use chrono::{DateTime, Local};
use image::GenericImageView;
use base64::Engine;

fn get_import_dir() -> Result<std::path::PathBuf, String> {
    // Try to get user's Pictures directory
    let pictures_dir = dirs::picture_dir()
        .ok_or_else(|| "Could not find Pictures directory".to_string())?;

    let import_dir = pictures_dir.join("shiguang");

    // Create shiguang directory if it doesn't exist
    if !import_dir.exists() {
        fs::create_dir_all(&import_dir).map_err(|e| e.to_string())?;
    }

    Ok(import_dir)
}

#[tauri::command]
pub fn import_file(state: State<AppState>, source_path: String) -> Result<FileWithTags, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    // Get user's Pictures/shiguang directory for storing imported files
    let import_dir = get_import_dir()?;

    // Generate unique filename
    let ext = source.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let new_name = format!("{}_{}.{}", timestamp, uuid_simple(), ext);
    let dest_path = import_dir.join(&new_name);

    // Copy file to imports directory
    fs::copy(source, &dest_path).map_err(|e| e.to_string())?;

    // Get file metadata
    let metadata = fs::metadata(&dest_path).map_err(|e| e.to_string())?;
    let (width, height) = get_image_dimensions(&dest_path).unwrap_or((0, 0));

    let created_at = metadata.created()
        .ok()
        .map(|t| {
            let dt: DateTime<Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    let modified_at = metadata.modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    let file_record = FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: new_name.clone(),
        ext: ext.clone(),
        size: metadata.len() as i64,
        width: width as i32,
        height: height as i32,
        created_at,
        modified_at,
    };

    db.insert_file(&file_record).map_err(|e| e.to_string())?;

    // Return the newly imported file
    db.get_file_by_path(&dest_path.to_string_lossy())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to retrieve imported file".to_string())
}

#[tauri::command]
pub fn import_image_from_base64(state: State<AppState>, base64_data: String, ext: String) -> Result<FileWithTags, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get user's Pictures/shiguang directory for storing imported files
    let import_dir = get_import_dir()?;

    // Generate unique filename
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let final_ext = if ext.is_empty() { "png".to_string() } else { ext };
    let new_name = format!("paste_{}.{}", timestamp, final_ext);
    let dest_path = import_dir.join(&new_name);

    // Decode base64 and save file
    let engine = base64::engine::general_purpose::STANDARD;
    let image_data = engine.decode(&base64_data).map_err(|e| e.to_string())?;
    fs::write(&dest_path, &image_data).map_err(|e| e.to_string())?;

    // Get file metadata
    let metadata = fs::metadata(&dest_path).map_err(|e| e.to_string())?;
    let (width, height) = get_image_dimensions(&dest_path).unwrap_or((0, 0));

    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let file_record = FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: new_name.clone(),
        ext: final_ext,
        size: metadata.len() as i64,
        width: width as i32,
        height: height as i32,
        created_at: now.clone(),
        modified_at: now,
    };

    db.insert_file(&file_record).map_err(|e| e.to_string())?;

    // Return the newly imported file
    db.get_file_by_path(&dest_path.to_string_lossy())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to retrieve imported file".to_string())
}

fn get_image_dimensions(path: &std::path::Path) -> Result<(u32, u32), String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("svg") {
        return Ok((0, 0));
    }

    match image::open(path) {
        Ok(img) => Ok(img.dimensions()),
        Err(_) => Ok((0, 0)),
    }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{:x}{:x}", duration.as_secs(), duration.subsec_nanos())
}

#[tauri::command]
pub fn get_all_files(state: State<AppState>) -> Result<Vec<FileWithTags>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_files().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_files(state: State<AppState>, query: String) -> Result<Vec<FileWithTags>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_files(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tag(state: State<AppState>, name: String, color: String) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_tag(&name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tag(state: State<AppState>, id: i64, name: String, color: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_tag(id, &name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_tag(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag_to_file(state: State<AppState>, file_id: i64, tag_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_tag_to_file(file_id, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag_from_file(state: State<AppState>, file_id: i64, tag_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_tag_from_file(file_id, tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(state: State<AppState>, file_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file path first
    let files = db.get_all_files().map_err(|e| e.to_string())?;
    let file = files.iter().find(|f| f.id == file_id);

    if let Some(file) = file {
        // Delete from database
        db.delete_file(&file.path).map_err(|e| e.to_string())?;

        // Optionally delete the actual file
        let path = std::path::Path::new(&file.path);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_setting(&key)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Setting not found".to_string())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_index_paths(state: State<AppState>) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_index_paths().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_index_path(state: State<AppState>, path: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_index_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_index_path(state: State<AppState>, path: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_index_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reindex_all(state: State<AppState>) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let paths = db.get_index_paths().map_err(|e| e.to_string())?;

    let mut total_count = 0;
    for path in paths {
        match indexer::scan_directory(&db, &path) {
            Ok(count) => {
                log::info!("Indexed {} files from {}", count, path);
                total_count += count;
            }
            Err(e) => {
                log::error!("Failed to scan directory {}: {}", path, e);
            }
        }
    }

    Ok(total_count)
}
