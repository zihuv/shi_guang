use super::system::{
    move_single_file_shared as move_single_file,
    remove_thumbnail_for_path_shared as remove_thumbnail_for_path,
};
use super::*;

fn build_folder_tree(folders: &[Folder], file_counts: &HashMap<i64, i32>) -> Vec<FolderTreeNode> {
    // Build a map of parent_id -> children
    let mut children_map: HashMap<Option<i64>, Vec<&Folder>> = HashMap::new();
    for folder in folders {
        children_map
            .entry(folder.parent_id)
            .or_default()
            .push(folder);
    }

    fn build_node(
        folder: &Folder,
        children_map: &HashMap<Option<i64>, Vec<&Folder>>,
        file_counts: &HashMap<i64, i32>,
    ) -> FolderTreeNode {
        // Sort children by sort_order
        let mut children_vec: Vec<&Folder> = children_map
            .get(&Some(folder.id))
            .map(|c| c.clone())
            .unwrap_or_default();
        children_vec.sort_by_key(|f| f.sort_order);

        let children: Vec<FolderTreeNode> = children_vec
            .iter()
            .map(|c| build_node(c, children_map, file_counts))
            .collect();

        FolderTreeNode {
            id: folder.id,
            name: folder.name.clone(),
            path: folder.path.clone(),
            children,
            file_count: *file_counts.get(&folder.id).unwrap_or(&0),
            sort_order: folder.sort_order,
        }
    }

    // Get root folders (those with parent_id = None) and sort by sort_order
    let mut root_folders: Vec<&Folder> = children_map
        .get(&None)
        .map(|c| c.clone())
        .unwrap_or_default();
    root_folders.sort_by_key(|f| f.sort_order);
    root_folders
        .iter()
        .map(|f| build_node(f, &children_map, file_counts))
        .collect()
}

#[tauri::command]
pub fn get_folder_tree(state: State<AppState>) -> Result<Vec<FolderTreeNode>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let folders = db.get_all_folders().map_err(|e| e.to_string())?;

    // 使用高效的批量查询获取文件数量
    let file_counts = db.get_file_counts_by_folders().map_err(|e| e.to_string())?;

    Ok(build_folder_tree(&folders, &file_counts))
}

#[tauri::command]
pub fn create_folder(
    state: State<AppState>,
    name: String,
    parent_id: Option<i64>,
    is_system: Option<bool>,
) -> Result<Folder, String> {
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
        join_path(&parent, &name)
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
    let id = db
        .create_folder(&full_path, &name, parent_id, system)
        .map_err(|e| e.to_string())?;

    Ok(Folder {
        id,
        path: full_path,
        name,
        parent_id,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        is_system: system,
        sort_order: 0,
    })
}

#[tauri::command]
pub fn move_file(
    state: State<AppState>,
    file_id: i64,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    log::info!(
        "move_file command file_id={} target_folder_id={:?}",
        file_id,
        target_folder_id
    );
    move_single_file(&db, file_id, target_folder_id)
}

#[tauri::command]
pub fn move_files(
    state: State<AppState>,
    file_ids: Vec<i64>,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut deduped_file_ids = Vec::new();
    for file_id in file_ids {
        if !deduped_file_ids.contains(&file_id) {
            deduped_file_ids.push(file_id);
        }
    }
    log::info!(
        "move_files command file_ids={:?} target_folder_id={:?}",
        deduped_file_ids,
        target_folder_id
    );
    for file_id in deduped_file_ids {
        move_single_file(&db, file_id, target_folder_id)?;
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
pub fn init_default_folder(state: State<AppState>) -> Result<Option<Folder>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let folders = db.get_all_folders().map_err(|e| e.to_string())?;

    if let Some(root_folder) = folders
        .iter()
        .find(|f| f.parent_id.is_none() && !f.is_system)
    {
        return Ok(Some(root_folder.clone()));
    }

    if let Some(folder) = folders.iter().find(|f| !f.is_system) {
        return Ok(Some(folder.clone()));
    }

    Ok(None)
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check if this is a system folder
    if db.is_folder_system(id).map_err(|e| e.to_string())? {
        return Err("Cannot delete system folder".to_string());
    }

    // Get folder path
    let folder = db.get_folder_by_id(id).map_err(|e| e.to_string())?;
    if let Some(folder) = folder {
        let folder_path = folder.path.clone();

        // Get all files
        let files = db
            .get_all_files(None, None, None, None)
            .map_err(|e| e.to_string())?;

        // Get all folders (for finding subfolders)
        let all_folders = db.get_all_folders().map_err(|e| e.to_string())?;

        // Collect all subfolder IDs (folders whose path starts with this folder's path)
        let subfolder_ids: Vec<i64> = all_folders
            .iter()
            .filter(|f| path_has_prefix(&f.path, &folder_path) && f.id != id)
            .map(|f| f.id)
            .collect();

        // Step 1: First, set folder_id to NULL for all files in this folder and subfolders
        // This breaks the FK constraint before we delete the folders
        let all_folder_ids: Vec<i64> = std::iter::once(id)
            .chain(subfolder_ids.iter().copied())
            .collect();

        db.clear_files_folder_id(&all_folder_ids)
            .map_err(|e| e.to_string())?;

        // Step 2: Delete all files whose path starts with this folder's path
        for file in &files {
            if path_has_prefix(&file.path, &folder_path) {
                remove_thumbnail_for_path(&db, &file.path)?;
                db.delete_file(&file.path).map_err(|e| e.to_string())?;
            }
        }

        // Step 3: Delete the folder - SQLite FK CASCADE will automatically delete all subfolders
        db.delete_folder(id).map_err(|e| e.to_string())?;

        // Step 4: Delete the actual folder from filesystem
        let folder_path_obj = std::path::Path::new(&folder_path);
        if folder_path_obj.exists() {
            std::fs::remove_dir_all(folder_path_obj).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: i64, name: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_folder(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn init_browser_collection_folder(state: State<AppState>) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.ensure_browser_collection_folder()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_browser_collection_folder(state: State<AppState>) -> Result<Option<Folder>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_browser_collection_folder()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_folders(state: State<AppState>, folder_ids: Vec<i64>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.reorder_folders(&folder_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_folder(
    state: State<AppState>,
    folder_id: i64,
    new_parent_id: Option<i64>,
    sort_order: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.move_folder(folder_id, new_parent_id, sort_order)
        .map_err(|e| e.to_string())
}
