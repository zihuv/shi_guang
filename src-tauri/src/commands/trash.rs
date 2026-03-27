use super::system::remove_thumbnail_for_path_shared as remove_thumbnail_for_path;
use super::*;

#[tauri::command]
pub fn delete_file(state: State<AppState>, file_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check delete mode
    let use_trash = db.get_delete_mode().map_err(|e| e.to_string())?;

    if use_trash {
        // Soft delete - just set deleted_at timestamp
        db.soft_delete_file(file_id).map_err(|e| e.to_string())?;
    } else {
        // Permanent delete - get file info first
        let file = db.get_file_by_id(file_id).map_err(|e| e.to_string())?;
        if let Some(file) = file {
            remove_thumbnail_for_path(&db, &file.path)?;
            // Delete from database
            db.permanent_delete_file(file_id)
                .map_err(|e| e.to_string())?;
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
pub fn delete_files(state: State<AppState>, file_ids: Vec<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check delete mode
    let use_trash = db.get_delete_mode().map_err(|e| e.to_string())?;

    for file_id in file_ids {
        if use_trash {
            // Soft delete
            db.soft_delete_file(file_id).map_err(|e| e.to_string())?;
        } else {
            // Permanent delete
            let file = db.get_file_by_id(file_id).map_err(|e| e.to_string())?;
            if let Some(file) = file {
                remove_thumbnail_for_path(&db, &file.path)?;
                db.permanent_delete_file(file_id)
                    .map_err(|e| e.to_string())?;
                let path = std::path::Path::new(&file.path);
                if path.exists() {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_trash_files(state: State<AppState>) -> Result<Vec<FileWithTags>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_trash_files().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_file(state: State<AppState>, file_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info to check if original folder still exists
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Check if the file's folder still exists
    let folder_exists = if let Some(folder_id) = file.folder_id {
        db.get_folder_by_id(folder_id)
            .map_err(|e| e.to_string())?
            .is_some()
    } else {
        true // Files without folder (root level) are always restorable
    };

    if !folder_exists {
        // Original folder was deleted, restore to default index path
        // Get the first index path as fallback
        let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
        if let Some(index_path) = index_paths.first() {
            let old_path = std::path::Path::new(&file.path);
            if let Some(file_name) = old_path.file_name() {
                let new_path = join_path(index_path, file_name);
                let new_path_obj = std::path::Path::new(&new_path);

                // Move file if it exists
                if old_path.exists() && old_path != new_path_obj {
                    fs::rename(old_path, new_path_obj).map_err(|e| e.to_string())?;
                }

                // Update database with new path and clear folder_id
                let modified_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                db.update_file_path_and_folder(file_id, &new_path, None, &modified_at)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    // Clear deleted_at to restore
    db.restore_file(file_id).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn restore_files(state: State<AppState>, file_ids: Vec<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    for file_id in file_ids {
        // Get file info
        let file = db.get_file_by_id(file_id).map_err(|e| e.to_string())?;
        if let Some(file) = file {
            // Check if the file's folder still exists
            let folder_exists = if let Some(folder_id) = file.folder_id {
                db.get_folder_by_id(folder_id)
                    .map_err(|e| e.to_string())?
                    .is_some()
            } else {
                true
            };

            if !folder_exists {
                // Restore to default index path
                let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
                if let Some(index_path) = index_paths.first() {
                    let old_path = std::path::Path::new(&file.path);
                    if let Some(file_name) = old_path.file_name() {
                        let new_path = join_path(index_path, file_name);
                        let new_path_obj = std::path::Path::new(&new_path);

                        if old_path.exists() && old_path != new_path_obj {
                            let _ = fs::rename(old_path, new_path_obj);
                        }

                        let modified_at =
                            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                        db.update_file_path_and_folder(file_id, &new_path, None, &modified_at)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }

            db.restore_file(file_id).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn permanent_delete_file(state: State<AppState>, file_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info first
    let file = db.get_file_by_id(file_id).map_err(|e| e.to_string())?;

    if let Some(file) = file {
        remove_thumbnail_for_path(&db, &file.path)?;
        // Delete from database
        db.permanent_delete_file(file_id)
            .map_err(|e| e.to_string())?;

        // Delete the actual file
        let path = std::path::Path::new(&file.path);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn permanent_delete_files(state: State<AppState>, file_ids: Vec<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    for file_id in file_ids {
        let file = db.get_file_by_id(file_id).map_err(|e| e.to_string())?;
        if let Some(file) = file {
            remove_thumbnail_for_path(&db, &file.path)?;
            db.permanent_delete_file(file_id)
                .map_err(|e| e.to_string())?;
            let path = std::path::Path::new(&file.path);
            if path.exists() {
                let _ = fs::remove_file(path);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get all trash files first
    let trash_files = db.get_trash_files().map_err(|e| e.to_string())?;

    // Delete all trash files permanently
    for file in trash_files {
        remove_thumbnail_for_path(&db, &file.path)?;
        // Delete from database
        db.permanent_delete_file(file.id)
            .map_err(|e| e.to_string())?;

        // Delete the actual file
        let path = std::path::Path::new(&file.path);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_delete_mode(state: State<AppState>) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_delete_mode().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_delete_mode(state: State<AppState>, use_trash: bool) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_delete_mode(use_trash).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_trash_count(state: State<AppState>) -> Result<i32, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_trash_count().map_err(|e| e.to_string())
}
