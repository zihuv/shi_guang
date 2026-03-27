use crate::db::{Database, FileWithTags, Folder, Tag};
use crate::indexer;
use crate::path_utils::{join_path, normalize_path, path_has_prefix};
use crate::storage;
use crate::AppState;
use base64::Engine;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderTreeNode {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub children: Vec<FolderTreeNode>,
    #[serde(rename = "fileCount")]
    pub file_count: i32,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BatchImportItem {
    FilePath { path: String },
    Base64Image {
        #[serde(rename = "base64Data")]
        base64_data: String,
        ext: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportTaskItemResult {
    pub index: usize,
    pub status: String,
    pub source: String,
    pub error: Option<String>,
    pub file: Option<FileWithTags>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportTaskSnapshot {
    pub id: String,
    pub status: String,
    pub total: usize,
    pub processed: usize,
    #[serde(rename = "successCount")]
    pub success_count: usize,
    #[serde(rename = "failureCount")]
    pub failure_count: usize,
    pub results: Vec<ImportTaskItemResult>,
}

fn get_import_dir() -> Result<std::path::PathBuf, String> {
    // Try to get user's Pictures directory
    let pictures_dir =
        dirs::picture_dir().ok_or_else(|| "Could not find Pictures directory".to_string())?;

    let import_dir = pictures_dir.join("shiguang");

    // Create shiguang directory if it doesn't exist
    if !import_dir.exists() {
        fs::create_dir_all(&import_dir).map_err(|e| e.to_string())?;
    }

    Ok(import_dir)
}

/// 获取导入目标目录：如果指定了 folder_id，使用该文件夹路径；否则使用默认导入目录
fn get_target_dir(db: &Database, folder_id: Option<i64>) -> Result<std::path::PathBuf, String> {
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

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    Ok(target_dir)
}

/// 生成简单的 UUID 字符串
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{:x}{:x}", duration.as_secs(), duration.subsec_nanos())
}

fn import_file_with_database(
    db: &Database,
    source_path: &str,
    folder_id: Option<i64>,
) -> Result<FileWithTags, String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    let target_dir = get_target_dir(db, folder_id)?;
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let new_name = format!("{}_{}.{}", timestamp, uuid_simple(), ext);
    let dest_path = target_dir.join(&new_name);

    let image_data = fs::read(source).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
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

    let file_record = crate::db::save_and_import_image(
        &image_data,
        &dest_path,
        folder_id,
        created_at,
        modified_at,
    )?;

    db.insert_file(&file_record).map_err(|e| e.to_string())?;

    db.get_file_by_path(&dest_path.to_string_lossy())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to retrieve imported file".to_string())
}

fn import_base64_with_database(
    db: &Database,
    base64_data: &str,
    ext: &str,
    folder_id: Option<i64>,
) -> Result<FileWithTags, String> {
    let target_dir = get_target_dir(db, folder_id)?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let final_ext = if ext.is_empty() {
        "png".to_string()
    } else {
        ext.to_string()
    };
    let new_name = format!("paste_{}_{}.{}", timestamp, uuid_simple(), final_ext);
    let dest_path = target_dir.join(&new_name);

    let engine = base64::engine::general_purpose::STANDARD;
    let image_data = engine.decode(base64_data).map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let file_record =
        crate::db::save_and_import_image(&image_data, &dest_path, folder_id, now.clone(), now)?;

    db.insert_file(&file_record).map_err(|e| e.to_string())?;

    db.get_file_by_path(&dest_path.to_string_lossy())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to retrieve imported file".to_string())
}

fn import_batch_item(
    db: &Database,
    item: &BatchImportItem,
    folder_id: Option<i64>,
) -> Result<FileWithTags, String> {
    match item {
        BatchImportItem::FilePath { path } => import_file_with_database(db, path, folder_id),
        BatchImportItem::Base64Image { base64_data, ext } => {
            import_base64_with_database(db, base64_data, ext, folder_id)
        }
    }
}

fn batch_item_source(item: &BatchImportItem) -> String {
    match item {
        BatchImportItem::FilePath { path } => path.clone(),
        BatchImportItem::Base64Image { ext, .. } => format!("clipboard.{}", ext),
    }
}

fn resolve_target_folder_path(db: &Database, target_folder_id: Option<i64>) -> Result<String, String> {
    if let Some(folder_id) = target_folder_id {
        let folders = db.get_all_folders().map_err(|e| e.to_string())?;
        let folder = folders
            .iter()
            .find(|f| f.id == folder_id)
            .ok_or_else(|| "Target folder not found".to_string())?;
        Ok(folder.path.clone())
    } else {
        let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
        Ok(index_paths.first().cloned().unwrap_or_default())
    }
}

fn resolve_available_target_path(
    db: &Database,
    source_path: &Path,
    target_folder_path: &str,
    current_file_id: Option<i64>,
    conflict_suffix: &str,
) -> Result<std::path::PathBuf, String> {
    let file_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file path".to_string())?;
    let desired_path = std::path::PathBuf::from(join_path(target_folder_path, file_name));

    let has_db_conflict = |path: &Path| -> Result<bool, String> {
        let Some(path_str) = path.to_str() else {
            return Ok(true);
        };
        let existing = db.get_file_by_path(path_str).map_err(|e| e.to_string())?;
        Ok(existing
            .map(|file| current_file_id.map(|id| file.id != id).unwrap_or(true))
            .unwrap_or(false))
    };

    if source_path == desired_path {
        return Ok(desired_path);
    }

    if !desired_path.exists() && !has_db_conflict(&desired_path)? {
        return Ok(desired_path);
    }

    let stem = source_path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    for _ in 0..16 {
        let unique_name = if ext.is_empty() {
            format!("{}_{}_{}", stem, conflict_suffix, uuid_simple())
        } else {
            format!("{}_{}_{}.{}", stem, conflict_suffix, uuid_simple(), ext)
        };
        let candidate = std::path::PathBuf::from(join_path(target_folder_path, &unique_name));
        if !candidate.exists() && !has_db_conflict(&candidate)? {
            return Ok(candidate);
        }
    }

    Err("Failed to resolve available target path".to_string())
}

fn move_single_file(db: &Database, file_id: i64, target_folder_id: Option<i64>) -> Result<(), String> {
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;
    let target_path = resolve_target_folder_path(db, target_folder_id)?;
    let old_path = Path::new(&file.path);
    let new_path_obj =
        resolve_available_target_path(db, old_path, &target_path, Some(file_id), "moved")?;
    let new_path = new_path_obj.to_string_lossy().to_string();
    log::info!(
        "move_single_file file_id={} from='{}' target_folder_id={:?} to='{}'",
        file_id,
        file.path,
        target_folder_id,
        new_path
    );

    if old_path != new_path_obj && old_path.exists() {
        fs::rename(old_path, &new_path_obj).map_err(|e| e.to_string())?;
    }

    let modified_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    db.update_file_path_and_folder(file_id, &new_path, target_folder_id, &modified_at)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn copy_single_file(db: &Database, file_id: i64, target_folder_id: Option<i64>) -> Result<(), String> {
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;
    let target_path = resolve_target_folder_path(db, target_folder_id)?;
    let source_path = Path::new(&file.path);
    let new_path_obj = resolve_available_target_path(db, source_path, &target_path, None, "copy")?;
    let new_path = new_path_obj.to_string_lossy().to_string();

    if source_path.exists() && source_path != new_path_obj {
        fs::copy(source_path, &new_path_obj).map_err(|e| e.to_string())?;
    }

    let metadata = fs::metadata(source_path).map_err(|e| e.to_string())?;
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

    let image_data = fs::read(source_path).map_err(|e| e.to_string())?;
    let file_record = crate::db::save_and_import_image(
        &image_data,
        &new_path_obj,
        target_folder_id,
        created_at,
        modified_at,
    )?;
    db.insert_file(&file_record).map_err(|e| e.to_string())?;

    let imported_file = db
        .get_file_by_path(&new_path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to retrieve copied file".to_string())?;

    db.update_file_metadata(
        imported_file.id,
        file.rating,
        &file.description,
        &file.source_url,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn import_file(
    state: State<AppState>,
    source_path: String,
    folder_id: Option<i64>,
) -> Result<FileWithTags, String> {
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
    import_file_with_database(&db, &source_path, folder_id)
}

#[tauri::command]
pub fn import_image_from_base64(
    state: State<AppState>,
    base64_data: String,
    ext: String,
    folder_id: Option<i64>,
) -> Result<FileWithTags, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    import_base64_with_database(&db, &base64_data, &ext, folder_id)
}

fn spawn_import_task(
    state: &AppState,
    items: Vec<BatchImportItem>,
    folder_id: Option<i64>,
) -> Result<ImportTaskSnapshot, String> {
    let task_id = format!("import-{}", uuid_simple());
    let snapshot = ImportTaskSnapshot {
        id: task_id.clone(),
        status: "queued".to_string(),
        total: items.len(),
        processed: 0,
        success_count: 0,
        failure_count: 0,
        results: Vec::new(),
    };
    let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    {
        let mut tasks = state.import_tasks.lock().map_err(|e| e.to_string())?;
        tasks.insert(
            task_id.clone(),
            crate::ImportTaskEntry {
                snapshot: snapshot.clone(),
                items: items.clone(),
                cancel_flag: cancel_flag.clone(),
                folder_id,
            },
        );
    }

    let tasks = state.import_tasks.clone();
    let db_path = state.db_path.clone();
    let app_handle = state.app_handle.clone();
    let write_lock = state.import_write_lock.clone();

    std::thread::spawn(move || {
        {
            if let Ok(mut task_map) = tasks.lock() {
                if let Some(task) = task_map.get_mut(&task_id) {
                    task.snapshot.status = "running".to_string();
                }
            }
        }
        let _ = app_handle.emit("import-task-updated", &task_id);

        let _write_guard = match write_lock.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        let db = match Database::new(&db_path) {
            Ok(db) => db,
            Err(err) => {
                if let Ok(mut task_map) = tasks.lock() {
                    if let Some(task) = task_map.get_mut(&task_id) {
                        task.snapshot.status = "failed".to_string();
                        task.snapshot.failure_count = task.snapshot.total;
                        task.snapshot.processed = task.snapshot.total;
                        task.snapshot.results.push(ImportTaskItemResult {
                            index: 0,
                            status: "failed".to_string(),
                            source: "task".to_string(),
                            error: Some(err.to_string()),
                            file: None,
                        });
                    }
                }
                let _ = app_handle.emit("import-task-updated", &task_id);
                return;
            }
        };

        for (index, item) in items.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                if let Ok(mut task_map) = tasks.lock() {
                    if let Some(task) = task_map.get_mut(&task_id) {
                        task.snapshot.status = "cancelled".to_string();
                    }
                }
                let _ = app_handle.emit("import-task-updated", &task_id);
                return;
            }

            let source = batch_item_source(item);
            let result = import_batch_item(&db, item, folder_id);
            if let Ok(mut task_map) = tasks.lock() {
                if let Some(task) = task_map.get_mut(&task_id) {
                    task.snapshot.processed += 1;
                    match result {
                        Ok(file) => {
                            task.snapshot.success_count += 1;
                            task.snapshot.results.push(ImportTaskItemResult {
                                index,
                                status: "completed".to_string(),
                                source,
                                error: None,
                                file: Some(file),
                            });
                        }
                        Err(error) => {
                            task.snapshot.failure_count += 1;
                            task.snapshot.results.push(ImportTaskItemResult {
                                index,
                                status: "failed".to_string(),
                                source,
                                error: Some(error),
                                file: None,
                            });
                        }
                    }

                    if task.snapshot.processed == task.snapshot.total {
                        task.snapshot.status = if task.snapshot.failure_count > 0 {
                            "completed_with_errors".to_string()
                        } else {
                            "completed".to_string()
                        };
                    }
                }
            }
            let _ = app_handle.emit("import-task-updated", &task_id);
        }
    });

    Ok(snapshot)
}

#[tauri::command]
pub fn start_import_task(
    state: State<AppState>,
    items: Vec<BatchImportItem>,
    folder_id: Option<i64>,
) -> Result<ImportTaskSnapshot, String> {
    spawn_import_task(&state, items, folder_id)
}

#[tauri::command]
pub fn get_import_task(state: State<AppState>, task_id: String) -> Result<ImportTaskSnapshot, String> {
    let tasks = state.import_tasks.lock().map_err(|e| e.to_string())?;
    tasks
        .get(&task_id)
        .map(|task| task.snapshot.clone())
        .ok_or_else(|| "Import task not found".to_string())
}

#[tauri::command]
pub fn cancel_import_task(state: State<AppState>, task_id: String) -> Result<(), String> {
    let tasks = state.import_tasks.lock().map_err(|e| e.to_string())?;
    let task = tasks
        .get(&task_id)
        .ok_or_else(|| "Import task not found".to_string())?;
    task.cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn retry_import_task(
    state: State<AppState>,
    task_id: String,
) -> Result<ImportTaskSnapshot, String> {
    let (retry_items, folder_id) = {
        let tasks = state.import_tasks.lock().map_err(|e| e.to_string())?;
        let task = tasks
            .get(&task_id)
            .ok_or_else(|| "Import task not found".to_string())?;
        (
            task.snapshot
                .results
                .iter()
                .filter(|result| result.status == "failed")
                .filter_map(|result| task.items.get(result.index).cloned())
                .collect::<Vec<_>>(),
            task.folder_id,
        )
    };

    if retry_items.is_empty() {
        return Err("No failed import items to retry".to_string());
    }

    spawn_import_task(&state, retry_items, folder_id)
}

#[derive(Debug, Serialize)]
pub struct PaginatedFiles {
    pub files: Vec<FileWithTags>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

#[tauri::command]
pub fn get_all_files(
    state: State<AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .get_all_files(Some(page_size), Some(offset))
        .map_err(|e| e.to_string())?;
    let total = db.get_files_count().map_err(|e| e.to_string())?;
    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedFiles {
        files,
        total,
        page,
        page_size: page_size as u32,
        total_pages,
    })
}

#[tauri::command]
pub fn search_files(
    state: State<AppState>,
    query: String,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .search_files(&query, Some(page_size), Some(offset))
        .map_err(|e| e.to_string())?;
    let total = db.search_files_count(&query).map_err(|e| e.to_string())?;
    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedFiles {
        files,
        total,
        page,
        page_size: page_size as u32,
        total_pages,
    })
}

#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tag(
    state: State<AppState>,
    name: String,
    color: String,
    parent_id: Option<i64>,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_tag(&name, &color, parent_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tag(
    state: State<AppState>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
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
    db.add_tag_to_file(file_id, tag_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag_from_file(
    state: State<AppState>,
    file_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_tag_from_file(file_id, tag_id)
        .map_err(|e| e.to_string())
}

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

fn remove_thumbnail_for_path(db: &Database, file_path: &str) -> Result<(), String> {
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
    storage::remove_thumbnail_for_file(&index_paths, Path::new(file_path))
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
pub fn get_files_in_folder(
    state: State<AppState>,
    folder_id: Option<i64>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .get_files_in_folder(folder_id, Some(page_size), Some(offset))
        .map_err(|e| e.to_string())?;
    let total = db
        .get_files_in_folder_count(folder_id)
        .map_err(|e| e.to_string())?;
    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedFiles {
        files,
        total,
        page,
        page_size: page_size as u32,
        total_pages,
    })
}

#[tauri::command]
pub fn get_file(state: State<AppState>, file_id: i64) -> Result<FileWithTags, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())
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
pub fn init_default_folder(state: State<AppState>) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Check if there are any folders
    let folders = db.get_all_folders().map_err(|e| e.to_string())?;

    if !folders.is_empty() {
        // Return the first root folder (parent_id = NULL)
        if let Some(root_folder) = folders.iter().find(|f| f.parent_id.is_none()) {
            return Ok(root_folder.clone());
        }
        // Fallback: return the first folder
        return Ok(folders[0].clone());
    }

    // No folders exist, create a default one
    let paths = db.get_index_paths().map_err(|e| e.to_string())?;

    if let Some(index_path) = paths.first() {
        let default_folder_name = "默认文件夹";
        let folder_path = join_path(index_path, default_folder_name);

        // Create directory in file system
        let path = Path::new(&folder_path);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }

        // Create folder in database
        let id = db
            .create_folder(&folder_path, default_folder_name, None, false)
            .map_err(|e| e.to_string())?;

        Ok(Folder {
            id,
            path: folder_path,
            name: default_folder_name.to_string(),
            parent_id: None,
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            is_system: false,
            sort_order: 0,
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

    // Get folder path
    let folder = db.get_folder_by_id(id).map_err(|e| e.to_string())?;
    if let Some(folder) = folder {
        let folder_path = folder.path.clone();

        // Get all files
        let files = db.get_all_files(None, None).map_err(|e| e.to_string())?;

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
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    let path = Path::new(&file.path);

    // Extract color using the indexer function
    let color = indexer::extract_dominant_color(path)?;

    // Update the file with the extracted color
    db.update_file_dominant_color(file_id, &color)
        .map_err(|e| e.to_string())?;

    Ok(color)
}

#[tauri::command]
pub fn export_file(state: State<AppState>, file_id: i64) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Get export directory (user's Documents/shiguang_exports)
    let docs_dir =
        dirs::document_dir().ok_or_else(|| "Could not find Documents directory".to_string())?;
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
    let json_filename = format!(
        "{}_metadata.json",
        file.name.split('.').next().unwrap_or(&file.name)
    );
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
pub fn update_file_name(
    state: State<AppState>,
    file_id: i64,
    new_name: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Get directory path
    let old_path = Path::new(&file.path);
    let parent = old_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;

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
    if let Some(folder) = db
        .get_browser_collection_folder()
        .map_err(|e| e.to_string())?
    {
        return Ok(folder);
    }

    // Get index paths to determine where to create the folder
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;

    if let Some(index_path) = index_paths.first() {
        let folder_name = "浏览器采集";
        let folder_path = join_path(index_path, folder_name);

        // Create directory in file system
        let path = Path::new(&folder_path);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }

        // Create folder in database as system folder
        let id = db
            .create_folder(&folder_path, folder_name, None, true)
            .map_err(|e| e.to_string())?;

        Ok(Folder {
            id,
            path: folder_path,
            name: folder_name.to_string(),
            parent_id: None,
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            is_system: true,
            sort_order: 0,
        })
    } else {
        Err("No index path configured".to_string())
    }
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
pub fn reorder_tags(
    state: State<AppState>,
    tag_ids: Vec<i64>,
    parent_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.reorder_tags(&tag_ids, parent_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_tag(
    state: State<AppState>,
    tag_id: i64,
    new_parent_id: Option<i64>,
    sort_order: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.move_tag(tag_id, new_parent_id, sort_order)
        .map_err(|e| e.to_string())
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

#[tauri::command]
pub fn copy_file(
    state: State<AppState>,
    file_id: i64,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    copy_single_file(&db, file_id, target_folder_id)
}

#[tauri::command]
pub fn copy_files(
    state: State<AppState>,
    file_ids: Vec<i64>,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    for file_id in file_ids {
        copy_single_file(&db, file_id, target_folder_id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_file(state: State<AppState>, file_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Open file with default application
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file.path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file.path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file.path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn show_in_explorer(state: State<AppState>, file_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get file info
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;

    // Get parent directory
    let path = Path::new(&file.path);
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;

    // Open in file explorer
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn show_folder_in_explorer(state: State<AppState>, folder_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get folder info
    let folder = db
        .get_folder_by_id(folder_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Folder not found".to_string())?;

    // Open folder in file explorer
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder.path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // Use /select to open explorer with the folder selected
        // Convert path separators to Windows format
        let path = normalize_path(&folder.path);
        std::process::Command::new("explorer")
            .arg(&format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder.path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Trash-related commands

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

#[derive(Debug, Deserialize, Clone)]
pub struct FileFilter {
    pub query: Option<String>,
    pub folder_id: Option<i64>,
    pub file_types: Option<Vec<String>>,
    pub date_start: Option<String>,
    pub date_end: Option<String>,
    pub size_min: Option<i64>,
    pub size_max: Option<i64>,
    pub tag_ids: Option<Vec<i64>>,
    pub min_rating: Option<i32>,
    pub favorites_only: Option<bool>,
    pub dominant_color: Option<String>,
}

#[tauri::command]
pub fn filter_files(
    state: State<AppState>,
    filter: FileFilter,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .filter_files(filter.clone(), Some(page_size), Some(offset))
        .map_err(|e| e.to_string())?;
    let total = db.filter_files_count(&filter).map_err(|e| e.to_string())?;
    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedFiles {
        files,
        total,
        page,
        page_size: page_size as u32,
        total_pages,
    })
}
