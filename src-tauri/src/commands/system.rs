use super::imports::uuid_simple_shared as uuid_simple;
use super::*;
use arboard::ImageData;
use std::borrow::Cow;
use std::path::PathBuf;

const EXTERNAL_DRAG_PREVIEW_ICON: &[u8] = include_bytes!("../../icons/32x32.png");

fn reveal_in_file_manager(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let target = normalize_path(target).replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let open_target = if target.is_dir() {
            target
        } else {
            target
                .parent()
                .ok_or_else(|| "Invalid target path".to_string())?
        };

        std::process::Command::new("xdg-open")
            .arg(open_target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn resolve_target_folder_path(
    db: &Database,
    target_folder_id: Option<i64>,
) -> Result<String, String> {
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

fn ensure_target_folder_exists(target_folder_path: &str) -> Result<(), String> {
    if target_folder_path.trim().is_empty() {
        return Err("Target folder path is empty".to_string());
    }

    fs::create_dir_all(target_folder_path).map_err(|e| {
        format!(
            "Failed to create target folder '{}': {}",
            target_folder_path, e
        )
    })
}

fn move_file_with_fallback(from: &Path, to: &Path) -> Result<(), String> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            fs::copy(from, to).map_err(|copy_err| {
                format!(
                    "Failed to move '{}' to '{}': {} / copy failed: {}",
                    from.display(),
                    to.display(),
                    rename_err,
                    copy_err
                )
            })?;
            fs::remove_file(from).map_err(|remove_err| {
                format!(
                    "Moved '{}' by copy but failed to remove original file: {}",
                    from.display(),
                    remove_err
                )
            })?;
            Ok(())
        }
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

fn move_single_file(
    db: &Database,
    file_id: i64,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;
    let target_path = resolve_target_folder_path(db, target_folder_id)?;
    ensure_target_folder_exists(&target_path)?;
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
        move_file_with_fallback(old_path, &new_path_obj)?;
    }

    let modified_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    db.update_file_path_and_folder(file_id, &new_path, target_folder_id, &modified_at)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn copy_single_file(
    db: &Database,
    file_id: i64,
    target_folder_id: Option<i64>,
) -> Result<i64, String> {
    let file = db
        .get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "File not found".to_string())?;
    let target_path = resolve_target_folder_path(db, target_folder_id)?;
    ensure_target_folder_exists(&target_path)?;
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

    Ok(imported_file.id)
}

fn remove_thumbnail_for_path(db: &Database, file_path: &str) -> Result<(), String> {
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;
    storage::remove_thumbnail_for_file(&index_paths, Path::new(file_path))
}

#[tauri::command]
pub fn copy_file(
    state: State<AppState>,
    file_id: i64,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let imported_file_id = copy_single_file(&db, file_id, target_folder_id)?;
    drop(db);

    super::ai::run_post_import_pipeline(state.app_handle.clone(), imported_file_id);
    Ok(())
}

#[tauri::command]
pub fn copy_files(
    state: State<AppState>,
    file_ids: Vec<i64>,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut imported_file_ids = Vec::new();
    for file_id in file_ids {
        imported_file_ids.push(copy_single_file(&db, file_id, target_folder_id)?);
    }
    drop(db);

    for imported_file_id in imported_file_ids {
        super::ai::run_post_import_pipeline(state.app_handle.clone(), imported_file_id);
    }

    Ok(())
}

#[tauri::command]
pub fn copy_files_to_clipboard(state: State<AppState>, file_ids: Vec<i64>) -> Result<(), String> {
    if file_ids.is_empty() {
        return Err("No files selected".to_string());
    }

    let file_paths = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        file_ids
            .into_iter()
            .map(|file_id| {
                db.get_file_by_id(file_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("File not found: {}", file_id))
                    .map(|file| PathBuf::from(file.path))
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    if file_paths.len() == 1 {
        if let Some(image) = load_clipboard_image_data(&file_paths[0]) {
            clipboard.set_image(image).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    clipboard
        .set()
        .file_list(&file_paths)
        .map_err(|e| e.to_string())
}

fn load_clipboard_image_data(path: &Path) -> Option<ImageData<'static>> {
    let decoded = image::open(path).ok()?;
    let rgba = decoded.into_rgba8();
    let (width, height) = rgba.dimensions();

    Some(ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(rgba.into_raw()),
    })
}

#[tauri::command]
pub fn start_drag_files(
    window: tauri::Window,
    state: State<AppState>,
    file_ids: Vec<i64>,
) -> Result<(), String> {
    if file_ids.is_empty() {
        return Err("No files selected".to_string());
    }

    let file_paths = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        file_ids
            .into_iter()
            .map(|file_id| {
                db.get_file_by_id(file_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("File not found: {}", file_id))
                    .map(|file| PathBuf::from(file.path))
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    let file_paths = file_paths
        .into_iter()
        .map(|path| {
            if !path.exists() {
                return Err(format!("File does not exist: {}", path.display()));
            }

            if path.is_absolute() {
                Ok(path)
            } else {
                fs::canonicalize(&path)
                    .map_err(|e| format!("Failed to resolve file path '{}': {}", path.display(), e))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let drag_window = window.clone();
        let drag_preview_icon = EXTERNAL_DRAG_PREVIEW_ICON.to_vec();

        window
            .run_on_main_thread(move || {
                if let Err(error) = drag::start_drag(
                    &drag_window,
                    drag::DragItem::Files(file_paths),
                    drag::Image::Raw(drag_preview_icon),
                    |_result, _cursor_position| {},
                    drag::Options::default(),
                ) {
                    eprintln!("Failed to start external file drag: {error}");
                }
            })
            .map_err(|e| e.to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = window;
        let _ = file_paths;
        Err("External file drag is not supported on this platform".to_string())
    }
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

    let path = Path::new(&file.path);
    reveal_in_file_manager(path)
}

#[tauri::command]
pub fn show_folder_in_explorer(state: State<AppState>, folder_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Get folder info
    let folder = db
        .get_folder_by_id(folder_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Folder not found".to_string())?;

    reveal_in_file_manager(Path::new(&folder.path))
}

pub(crate) fn move_single_file_shared(
    db: &Database,
    file_id: i64,
    target_folder_id: Option<i64>,
) -> Result<(), String> {
    move_single_file(db, file_id, target_folder_id)
}

pub(crate) fn remove_thumbnail_for_path_shared(
    db: &Database,
    file_path: &str,
) -> Result<(), String> {
    remove_thumbnail_for_path(db, file_path)
}
