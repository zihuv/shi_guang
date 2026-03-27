use super::*;

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
