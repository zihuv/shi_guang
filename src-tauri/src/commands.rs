use crate::db::{FileWithTags, Tag, FileRecord, Folder};
use crate::indexer;
use crate::AppState;
use tauri::State;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use chrono::{DateTime, Local};
use image::GenericImageView;
use image::Pixel;
use base64::Engine;
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderTreeNode {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub children: Vec<FolderTreeNode>,
    #[serde(rename = "fileCount")]
    pub file_count: i32,
}

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
pub fn import_file(state: State<AppState>, source_path: String, folder_id: Option<i64>) -> Result<FileWithTags, String> {
    // Check if this source file was recently imported (within 3 seconds)
    {
        let mut recent = state.recent_imports.lock().map_err(|e| e.to_string())?;
        if recent.is_recent(&source_path, std::time::Duration::from_secs(3)) {
            log::info!("Skipping duplicate import for: {}", source_path);
            return Err("Duplicate import skipped".to_string());
        }
        recent.add(source_path.clone());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;

    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    // Determine target directory: use folder path if folder_id is provided, otherwise use default import dir
    let target_dir = if let Some(fid) = folder_id {
        let folders = db.get_all_folders().map_err(|e| e.to_string())?;
        if let Some(folder) = folders.iter().find(|f| f.id == fid) {
            Path::new(&folder.path).to_path_buf()
        } else {
            get_import_dir()?
        }
    } else {
        get_import_dir()?
    };

    // Generate unique filename
    let ext = source.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let new_name = format!("{}_{}.{}", timestamp, uuid_simple(), ext);
    let dest_path = target_dir.join(&new_name);

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

    let imported_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let file_record = FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: new_name.clone(),
        ext: ext.clone(),
        size: metadata.len() as i64,
        width: width as i32,
        height: height as i32,
        folder_id,
        created_at,
        modified_at,
        imported_at,
        rating: 0,
        description: String::new(),
        source_url: String::new(),
        dominant_color: String::new(),
        color_distribution: String::from("[]"),
    };

    db.insert_file(&file_record).map_err(|e| e.to_string())?;

    // Return the newly imported file
    db.get_file_by_path(&dest_path.to_string_lossy())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to retrieve imported file".to_string())
}

#[tauri::command]
pub fn import_image_from_base64(state: State<AppState>, base64_data: String, ext: String, folder_id: Option<i64>) -> Result<FileWithTags, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Determine target directory: use folder path if folder_id is provided, otherwise use default import dir
    let target_dir = if let Some(fid) = folder_id {
        let folders = db.get_all_folders().map_err(|e| e.to_string())?;
        if let Some(folder) = folders.iter().find(|f| f.id == fid) {
            Path::new(&folder.path).to_path_buf()
        } else {
            get_import_dir()?
        }
    } else {
        get_import_dir()?
    };

    // Generate unique filename
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let final_ext = if ext.is_empty() { "png".to_string() } else { ext };
    let new_name = format!("paste_{}.{}", timestamp, final_ext);
    let dest_path = target_dir.join(&new_name);

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
        folder_id,
        created_at: now.clone(),
        modified_at: now.clone(),
        imported_at: now,
        rating: 0,
        description: String::new(),
        source_url: String::new(),
        dominant_color: String::new(),
        color_distribution: String::from("[]"),
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
pub fn delete_files(state: State<AppState>, file_ids: Vec<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get all files first
    let files = db.get_all_files().map_err(|e| e.to_string())?;

    for file_id in file_ids {
        if let Some(file) = files.iter().find(|f| f.id == file_id) {
            // Delete from database
            let _ = db.delete_file(&file.path);

            // Delete the actual file
            let path = std::path::Path::new(&file.path);
            if path.exists() {
                let _ = fs::remove_file(path);
            }
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
pub fn get_default_index_path() -> Result<String, String> {
    // Use Pictures/shiguang directory as default
    let pictures_dir = dirs::picture_dir()
        .ok_or_else(|| "Could not find Pictures directory".to_string())?;
    let shiguang_dir = pictures_dir.join("shiguang");
    // Create the directory if it doesn't exist
    if !shiguang_dir.exists() {
        fs::create_dir_all(&shiguang_dir).map_err(|e| e.to_string())?;
    }
    Ok(shiguang_dir.to_string_lossy().to_string())
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

fn build_folder_tree(folders: &[Folder], file_counts: &HashMap<i64, i32>) -> Vec<FolderTreeNode> {
    // Build a map of parent_id -> children
    let mut children_map: HashMap<Option<i64>, Vec<&Folder>> = HashMap::new();
    for folder in folders {
        children_map.entry(folder.parent_id).or_default().push(folder);
    }

    fn build_node(
        folder: &Folder,
        children_map: &HashMap<Option<i64>, Vec<&Folder>>,
        file_counts: &HashMap<i64, i32>,
    ) -> FolderTreeNode {
        let children: Vec<FolderTreeNode> = children_map
            .get(&Some(folder.id))
            .map(|children| {
                children
                    .iter()
                    .map(|c| build_node(c, children_map, file_counts))
                    .collect()
            })
            .unwrap_or_default();

        FolderTreeNode {
            id: folder.id,
            name: folder.name.clone(),
            path: folder.path.clone(),
            children,
            file_count: *file_counts.get(&folder.id).unwrap_or(&0),
        }
    }

    // Get root folders (those with parent_id = None)
    let empty_vec: Vec<&Folder> = vec![];
    let root_folders = children_map.get(&None).unwrap_or(&empty_vec);
    root_folders
        .iter()
        .map(|f| build_node(f, &children_map, file_counts))
        .collect()
}

#[tauri::command]
pub fn get_folder_tree(state: State<AppState>) -> Result<Vec<FolderTreeNode>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let folders = db.get_all_folders().map_err(|e| e.to_string())?;

    // Get file counts per folder
    let mut file_counts: HashMap<i64, i32> = HashMap::new();
    let files = db.get_all_files().map_err(|e| e.to_string())?;
    for file in files {
        if let Some(folder_id) = file.folder_id {
            *file_counts.entry(folder_id).or_insert(0) += 1;
        }
    }

    Ok(build_folder_tree(&folders, &file_counts))
}

#[tauri::command]
pub fn get_files_in_folder(state: State<AppState>, folder_id: Option<i64>) -> Result<Vec<FileWithTags>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_files_in_folder(folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, name: String, parent_id: Option<i64>, is_system: Option<bool>) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get index paths to determine where to create the folder
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;

    // Determine the parent path
    let parent_path = if let Some(pid) = parent_id {
        let folders = db.get_all_folders().map_err(|e| e.to_string())?;
        folders.iter().find(|f| f.id == pid).map(|f| f.path.clone())
    } else {
        // Use first index path as root
        index_paths.first().cloned()
    };

    let full_path = if let Some(parent) = parent_path {
        format!("{}/{}", parent, name)
    } else {
        return Err("No index path configured".to_string());
    };

    // Create directory in file system
    let path = Path::new(&full_path);
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }

    // Create folder in database
    let system = is_system.unwrap_or(false);
    let id = db.create_folder(&full_path, &name, parent_id, system).map_err(|e| e.to_string())?;

    Ok(Folder {
        id,
        path: full_path,
        name,
        parent_id,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        is_system: system,
    })
}

#[tauri::command]
pub fn move_file(state: State<AppState>, file_id: i64, target_folder_id: Option<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Get target folder path
    let target_path = if let Some(folder_id) = target_folder_id {
        let folders = db.get_all_folders().map_err(|e| e.to_string())?;
        let folder = folders.iter().find(|f| f.id == folder_id)
            .ok_or_else(|| "Target folder not found".to_string())?;
        folder.path.clone()
    } else {
        // Move to root (no folder)
        let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
        index_paths.first().cloned().unwrap_or_default()
    };

    // Get file name
    let file_name = Path::new(&file.path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file path".to_string())?;

    // Build new path
    let new_path = format!("{}/{}", target_path, file_name);

    // Move file in file system
    let old_path = Path::new(&file.path);
    let new_path_obj = Path::new(&new_path);

    if old_path != new_path_obj && old_path.exists() {
        fs::rename(old_path, new_path_obj).map_err(|e| e.to_string())?;
    }

    // Update database
    db.update_file_folder(file_id, target_folder_id).map_err(|e| e.to_string())?;

    // Also update the path in the database if file was moved
    if old_path != new_path_obj && old_path.exists() == false {
        // File was successfully moved, update path
        let updated_record = FileRecord {
            id: file_id,
            path: new_path,
            name: file.name,
            ext: file.ext,
            size: file.size,
            width: file.width,
            height: file.height,
            folder_id: target_folder_id,
            created_at: file.created_at,
            modified_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            imported_at: file.imported_at,
            rating: file.rating,
            description: file.description,
            source_url: file.source_url,
            dominant_color: file.dominant_color,
            color_distribution: file.color_distribution,
        };
        db.insert_file(&updated_record).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn scan_folders(state: State<AppState>) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let paths = db.get_index_paths().map_err(|e| e.to_string())?;

    let mut total_count = 0;
    for path in paths {
        match indexer::scan_folders(&db, &path) {
            Ok(count) => {
                log::info!("Scanned {} folders from {}", count, path);
                total_count += count;
            }
            Err(e) => {
                log::error!("Failed to scan folders {}: {}", path, e);
            }
        }
    }

    Ok(total_count)
}

#[tauri::command]
pub fn init_default_folder(state: State<AppState>) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check if there are any folders
    let folders = db.get_all_folders().map_err(|e| e.to_string())?;

    if !folders.is_empty() {
        // Return the first folder
        return Ok(folders[0].clone());
    }

    // No folders exist, create a default one
    let paths = db.get_index_paths().map_err(|e| e.to_string())?;

    if let Some(index_path) = paths.first() {
        let default_folder_name = "默认文件夹";
        let folder_path = format!("{}/{}", index_path, default_folder_name);

        // Create directory in file system
        let path = Path::new(&folder_path);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }

        // Create folder in database
        let id = db.create_folder(&folder_path, default_folder_name, None, false)
            .map_err(|e| e.to_string())?;

        Ok(Folder {
            id,
            path: folder_path,
            name: default_folder_name.to_string(),
            parent_id: None,
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            is_system: false,
        })
    } else {
        Err("No index path configured".to_string())
    }
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check if this is a system folder
    if db.is_folder_system(id).map_err(|e| e.to_string())? {
        return Err("Cannot delete system folder".to_string());
    }

    // First, delete all files in this folder (and subfolders)
    // Get folder path to find all matching files
    if let Some(folder) = db.get_folder_by_id(id).map_err(|e| e.to_string())? {
        let folder_path = folder.path.clone();

        // Get all files
        let files = db.get_all_files().map_err(|e| e.to_string())?;

        // Delete all files whose path starts with this folder's path
        for file in &files {
            if file.path.starts_with(&folder_path) {
                db.delete_file(&file.path).map_err(|e| e.to_string())?;
            }
        }

        // Also handle subfolder files - get all folders and delete files in subfolders
        let all_folders = db.get_all_folders().map_err(|e| e.to_string())?;
        for subfolder in &all_folders {
            if subfolder.path.starts_with(&folder_path) && subfolder.id != id {
                let subfolder_path = subfolder.path.clone();
                for file in &files {
                    if file.path.starts_with(&subfolder_path) {
                        let _ = db.delete_file(&file.path);
                    }
                }
            }
        }
    }

    // Then delete the folder itself
    db.delete_folder(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: i64, name: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_folder(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_file_metadata(
    state: State<AppState>,
    file_id: i64,
    rating: i32,
    description: String,
    source_url: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_file_metadata(file_id, rating, &description, &source_url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn extract_color(state: State<AppState>, file_id: i64) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    let path = Path::new(&file.path);

    // Extract color using the same logic as indexer
    let color = extract_dominant_color_from_file(path)?;

    // Update the file with the extracted color
    db.update_file_dominant_color(file_id, &color)
        .map_err(|e| e.to_string())?;

    Ok(color)
}

fn extract_dominant_color_from_file(path: &Path) -> Result<String, String> {
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

#[tauri::command]
pub fn export_file(state: State<AppState>, file_id: i64) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Get export directory (user's Documents/shiguang_exports)
    let docs_dir = dirs::document_dir()
        .ok_or_else(|| "Could not find Documents directory".to_string())?;
    let export_dir = docs_dir.join("shiguang_exports");

    // Create export directory if it doesn't exist
    if !export_dir.exists() {
        fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;
    }

    // Create metadata JSON
    let metadata = serde_json::json!({
        "id": file.id,
        "name": file.name,
        "path": file.path,
        "ext": file.ext,
        "size": file.size,
        "width": file.width,
        "height": file.height,
        "createdAt": file.created_at,
        "modifiedAt": file.modified_at,
        "importedAt": file.imported_at,
        "rating": file.rating,
        "description": file.description,
        "sourceUrl": file.source_url,
        "dominantColor": file.dominant_color,
        "tags": file.tags,
    });

    // Write metadata JSON file
    let json_filename = format!("{}_metadata.json", file.name.split('.').next().unwrap_or(&file.name));
    let json_path = export_dir.join(&json_filename);
    fs::write(&json_path, serde_json::to_string_pretty(&metadata).unwrap())
        .map_err(|e| e.to_string())?;

    // Copy original file
    let source_path = Path::new(&file.path);
    if source_path.exists() {
        let dest_path = export_dir.join(&file.name);
        fs::copy(source_path, &dest_path).map_err(|e| e.to_string())?;
    }

    Ok(export_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn update_file_name(state: State<AppState>, file_id: i64, new_name: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Get directory path
    let old_path = Path::new(&file.path);
    let parent = old_path.parent().ok_or_else(|| "Invalid file path".to_string())?;

    // Build new path
    let new_path = parent.join(&new_name).to_string_lossy().to_string();

    // Rename file in file system
    if old_path.exists() {
        fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    }

    // Update database
    db.update_file_name(file_id, &new_name, &new_path)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn init_browser_collection_folder(state: State<AppState>) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check if browser collection folder already exists
    if let Some(folder) = db.get_browser_collection_folder().map_err(|e| e.to_string())? {
        return Ok(folder);
    }

    // Get index paths to determine where to create the folder
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;

    if let Some(index_path) = index_paths.first() {
        let folder_name = "浏览器采集";
        let folder_path = format!("{}/{}", index_path, folder_name);

        // Create directory in file system
        let path = Path::new(&folder_path);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }

        // Create folder in database as system folder
        let id = db.create_folder(&folder_path, folder_name, None, true)
            .map_err(|e| e.to_string())?;

        Ok(Folder {
            id,
            path: folder_path,
            name: folder_name.to_string(),
            parent_id: None,
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            is_system: true,
        })
    } else {
        Err("No index path configured".to_string())
    }
}

#[tauri::command]
pub fn get_browser_collection_folder(state: State<AppState>) -> Result<Option<Folder>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_browser_collection_folder().map_err(|e| e.to_string())
}
