use super::*;
use crate::ml::model_manager::{load_visual_search_config, resolve_model_paths};

#[tauri::command]
pub fn get_all_files(
    state: State<AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
    sort_by: Option<String>,
    sort_direction: Option<String>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .get_all_files(
            Some(page_size),
            Some(offset),
            sort_by.as_deref(),
            sort_direction.as_deref(),
        )
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
    sort_by: Option<String>,
    sort_direction: Option<String>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .search_files(
            &query,
            Some(page_size),
            Some(offset),
            sort_by.as_deref(),
            sort_direction.as_deref(),
        )
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
pub fn get_files_in_folder(
    state: State<AppState>,
    folder_id: Option<i64>,
    page: Option<u32>,
    page_size: Option<u32>,
    sort_by: Option<String>,
    sort_direction: Option<String>,
) -> Result<PaginatedFiles, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let files = db
        .get_files_in_folder(
            folder_id,
            Some(page_size),
            Some(offset),
            sort_by.as_deref(),
            sort_direction.as_deref(),
        )
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
pub fn update_file_dimensions(
    state: State<AppState>,
    file_id: i64,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_file_dimensions(file_id, width, height)
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
pub async fn filter_files(
    state: State<'_, AppState>,
    filter: FileFilter,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedFiles, String> {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(100).max(1).min(500) as i64;
    let offset = (page - 1) as i64 * page_size;

    let natural_language_query = filter
        .natural_language_query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .map(str::to_string);

    let (files, total) = if let Some(natural_language_query) = natural_language_query {
        let resolved_model = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let config = load_visual_search_config(&db)?;
            if !config.enabled {
                return Err("请先在设置 > AI 中启用本地自然语言搜图".to_string());
            }

            let resolved_model = resolve_model_paths(&config.model_path)?;
            let ready_count = db
                .get_visual_index_counts(&resolved_model.manifest.model_id)
                .map_err(|e| e.to_string())?;
            if ready_count.ready == 0 {
                return Err(
                    "视觉索引为空或已过期，请先在设置 > AI 中配置模型并重建视觉索引".to_string(),
                );
            }

            resolved_model
        };

        let query_embedding = {
            let mut runtime = state
                .visual_model_runtime
                .lock()
                .map_err(|e| e.to_string())?;
            let model = runtime.get_or_load(&resolved_model)?;
            model.encode_text(&natural_language_query)?
        };

        let db = state.db.lock().map_err(|e| e.to_string())?;
        let result = db
            .search_files_by_visual_embedding(
                filter.clone(),
                &resolved_model.manifest.model_id,
                &query_embedding,
                Some(page_size),
                Some(offset),
            )
            .map_err(|e| e.to_string())?;
        (result.files, result.total)
    } else {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let files = db
            .filter_files(filter.clone(), Some(page_size), Some(offset))
            .map_err(|e| e.to_string())?;
        let total = db.filter_files_count(&filter).map_err(|e| e.to_string())?;
        (files, total)
    };

    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedFiles {
        files,
        total,
        page,
        page_size: page_size as u32,
        total_pages,
    })
}
