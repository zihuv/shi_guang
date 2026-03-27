use super::*;

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
    let index_path = storage::get_default_index_path();
    if !index_path.exists() {
        fs::create_dir_all(&index_path).map_err(|e| e.to_string())?;
    }
    storage::ensure_storage_dirs(&index_path)?;
    Ok(index_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn add_index_path(state: State<AppState>, path: String) -> Result<(), String> {
    let index_path = Path::new(&path);
    if !index_path.exists() {
        fs::create_dir_all(index_path).map_err(|e| e.to_string())?;
    }
    storage::ensure_storage_dirs(index_path)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_index_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_thumbnail_path(
    state: State<AppState>,
    file_path: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
    drop(db);

    let thumbnail = storage::get_or_create_thumbnail(&index_paths, Path::new(&file_path))?;
    Ok(thumbnail.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn get_thumbnail_cache_path(
    state: State<AppState>,
    file_path: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
    drop(db);

    let thumbnail = storage::get_thumbnail_cache_path(&index_paths, Path::new(&file_path))?;
    Ok(thumbnail.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn save_thumbnail_cache(
    state: State<AppState>,
    file_path: String,
    data_base64: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
    drop(db);

    let Some(thumbnail_path) =
        storage::get_thumbnail_cache_path(&index_paths, Path::new(&file_path))?
    else {
        return Ok(None);
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;

    fs::write(&thumbnail_path, bytes).map_err(|e| e.to_string())?;

    Ok(Some(thumbnail_path.to_string_lossy().to_string()))
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

#[tauri::command]
pub fn sync_index_path(state: State<AppState>, path: String) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let file_count = indexer::scan_directory(&db, &path)?;
    let _ = indexer::scan_folders(&db, &path);
    Ok(file_count)
}

#[tauri::command]
pub fn rebuild_library_index(state: State<AppState>) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let paths = db.get_index_paths().map_err(|e| e.to_string())?;
    let mut total_count = 0;
    for path in paths {
        total_count += indexer::scan_directory(&db, &path)?;
        let _ = indexer::scan_folders(&db, &path);
    }
    Ok(total_count)
}
