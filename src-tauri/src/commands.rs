use crate::db::{FileWithTags, Tag, FileRecord, Folder};
use crate::indexer;
use crate::AppState;
use tauri::State;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use chrono::{DateTime, Local};
use image::GenericImageView;
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
pub fn create_folder(state: State<AppState>, name: String, parent_id: Option<i64>) -> Result<Folder, String> {
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
    let id = db.create_folder(&full_path, &name, parent_id).map_err(|e| e.to_string())?;

    Ok(Folder {
        id,
        path: full_path,
        name,
        parent_id,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
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
        let id = db.create_folder(&folder_path, default_folder_name, None)
            .map_err(|e| e.to_string())?;

        Ok(Folder {
            id,
            path: folder_path,
            name: default_folder_name.to_string(),
            parent_id: None,
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        })
    } else {
        Err("No index path configured".to_string())
    }
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_folder(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: i64, name: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_folder(id, &name).map_err(|e| e.to_string())
}
