use super::*;

fn get_import_dir(db: &Database) -> Result<std::path::PathBuf, String> {
    let index_path = db
        .get_index_paths()
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::picture_dir().map(|pictures_dir| pictures_dir.join("shiguang")))
        .ok_or_else(|| "Could not resolve import directory".to_string())?;

    if !index_path.exists() {
        fs::create_dir_all(&index_path).map_err(|e| e.to_string())?;
    }

    Ok(index_path)
}

/// 获取导入目标目录：如果指定了 folder_id，使用该文件夹路径；否则使用默认导入目录
fn get_target_dir(db: &Database, folder_id: Option<i64>) -> Result<std::path::PathBuf, String> {
    let target_dir = if let Some(fid) = folder_id {
        let folders = db.get_all_folders().map_err(|e| e.to_string())?;
        if let Some(folder) = folders.iter().find(|f| f.id == fid) {
            let folder_path = Path::new(&folder.path);
            if folder_path.is_absolute() {
                folder_path.to_path_buf()
            } else {
                get_import_dir(db)?.join(folder_path)
            }
        } else {
            get_import_dir(db)?
        }
    } else {
        get_import_dir(db)?
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

fn resolve_import_extension(fallback_ext: Option<&str>, file_data: &[u8]) -> String {
    crate::media::detect_extension_from_content(None, file_data)
        .map(str::to_string)
        .or_else(|| {
            fallback_ext
                .map(|ext| ext.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|ext| !ext.is_empty())
        })
        .unwrap_or_else(|| "png".to_string())
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
    let source_ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.to_lowercase());
    let image_data = fs::read(source).map_err(|e| e.to_string())?;
    let ext = resolve_import_extension(source_ext.as_deref(), &image_data);
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let new_name = format!("{}_{}.{}", timestamp, uuid_simple(), ext);
    let dest_path = target_dir.join(&new_name);

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

    let engine = base64::engine::general_purpose::STANDARD;
    let image_data = engine.decode(base64_data).map_err(|e| e.to_string())?;
    let final_ext = resolve_import_extension(Some(ext), &image_data);
    let new_name = format!("paste_{}_{}.{}", timestamp, uuid_simple(), final_ext);
    let dest_path = target_dir.join(&new_name);
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
    let imported_file = import_file_with_database(&db, &source_path, folder_id)?;
    drop(db);

    super::ai::run_post_import_pipeline(state.app_handle.clone(), imported_file.id);
    Ok(imported_file)
}

#[tauri::command]
pub fn import_image_from_base64(
    state: State<AppState>,
    base64_data: String,
    ext: String,
    folder_id: Option<i64>,
) -> Result<FileWithTags, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let imported_file = import_base64_with_database(&db, &base64_data, &ext, folder_id)?;
    drop(db);

    super::ai::run_post_import_pipeline(state.app_handle.clone(), imported_file.id);
    Ok(imported_file)
}

#[cfg(test)]
mod tests {
    use super::resolve_import_extension;

    #[test]
    fn resolve_import_extension_prefers_detected_content() {
        let bytes = [
            0x00, 0x00, 0x00, 0x1C, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f', 0x00, 0x00,
            0x00, 0x00,
        ];

        assert_eq!(resolve_import_extension(Some("png"), &bytes), "avif");
    }

    #[test]
    fn resolve_import_extension_falls_back_to_source_ext() {
        let bytes = b"not-an-image";

        assert_eq!(resolve_import_extension(Some("pdf"), bytes), "pdf");
    }
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
                            super::ai::run_post_import_pipeline(app_handle.clone(), file.id);
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
pub fn get_import_task(
    state: State<AppState>,
    task_id: String,
) -> Result<ImportTaskSnapshot, String> {
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

pub(crate) fn uuid_simple_shared() -> String {
    uuid_simple()
}
