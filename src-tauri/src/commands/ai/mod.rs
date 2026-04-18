use super::*;
use crate::ml::model_manager::{
    find_recommended_visual_model_path as find_recommended_visual_model_path_impl,
    validate_visual_model_path as validate_visual_model_path_impl, VisualModelValidationResult,
};
use omni_search::{ExecutionProviderKind, ProviderPolicy, RuntimeDevice, RuntimeMode};
use serde::Serialize;
use tauri::{Manager, State};

mod metadata;
mod shared;
mod visual_index;

pub(crate) use metadata::analyze_file_metadata_impl;
pub(crate) use shared::is_backend_decodable_image;
pub(crate) use visual_index::reindex_file_visual_embedding_impl;

#[derive(Debug, Serialize)]
pub struct VisualIndexRebuildResult {
    pub total: usize,
    pub indexed: usize,
    pub failed: usize,
    pub skipped: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VisualIndexProgressPayload {
    pub processed: usize,
    pub total: usize,
    pub indexed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub current_file_id: i64,
    pub current_file_name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VisualIndexBrowserDecodeRequestPayload {
    pub request_id: String,
    pub file_id: i64,
    pub path: String,
    pub output_mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualIndexStatus {
    pub model_valid: bool,
    pub message: String,
    pub model_id: Option<String>,
    pub version: Option<String>,
    pub requested_device: Option<RuntimeDevice>,
    pub provider_policy: Option<ProviderPolicy>,
    pub runtime_loaded: bool,
    pub runtime_mode: Option<RuntimeMode>,
    pub effective_provider: Option<ExecutionProviderKind>,
    pub runtime_reason: Option<String>,
    pub indexed_count: i64,
    pub failed_count: i64,
    pub pending_count: i64,
    pub outdated_count: i64,
    pub total_image_count: i64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiEndpointTarget {
    Metadata,
}

#[tauri::command]
pub fn validate_visual_model_path(
    model_path: String,
) -> Result<VisualModelValidationResult, String> {
    Ok(validate_visual_model_path_impl(&model_path))
}

#[tauri::command]
pub fn get_recommended_visual_model_path() -> Result<Option<String>, String> {
    Ok(find_recommended_visual_model_path_impl())
}

#[tauri::command]
pub fn get_visual_index_status(state: State<'_, AppState>) -> Result<VisualIndexStatus, String> {
    visual_index::get_visual_index_status_impl(&state)
}

#[tauri::command]
pub fn complete_visual_index_browser_decode_request(
    state: State<'_, AppState>,
    request_id: String,
    image_data_url: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    visual_index::complete_visual_index_browser_decode_request_impl(
        &state,
        request_id,
        image_data_url,
        error,
    )
}

#[tauri::command]
pub async fn rebuild_visual_index(
    app_handle: tauri::AppHandle,
) -> Result<VisualIndexRebuildResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        visual_index::rebuild_visual_index_impl(&state, Some(&app_handle), false)
    })
    .await
    .map_err(|e| format!("视觉索引后台任务失败: {}", e))?
}

#[tauri::command]
pub fn start_visual_index_task(
    state: State<'_, AppState>,
    process_unindexed_only: bool,
) -> Result<VisualIndexTaskSnapshot, String> {
    visual_index::spawn_visual_index_task(&state, process_unindexed_only)
}

#[tauri::command]
pub fn get_visual_index_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<VisualIndexTaskSnapshot, String> {
    visual_index::get_visual_index_task_impl(&state, &task_id)
}

#[tauri::command]
pub fn cancel_visual_index_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    visual_index::cancel_visual_index_task_impl(&state, &task_id)
}

#[tauri::command]
pub async fn test_ai_endpoint(
    state: State<'_, AppState>,
    target: AiEndpointTarget,
) -> Result<String, String> {
    metadata::test_ai_endpoint_impl(&state, target).await
}

#[tauri::command]
pub fn start_ai_metadata_task(
    state: State<'_, AppState>,
    file_ids: Vec<i64>,
) -> Result<AiMetadataTaskSnapshot, String> {
    metadata::spawn_ai_metadata_task(&state, file_ids)
}

#[tauri::command]
pub fn get_ai_metadata_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<AiMetadataTaskSnapshot, String> {
    metadata::get_ai_metadata_task_impl(&state, &task_id)
}

#[tauri::command]
pub fn cancel_ai_metadata_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    metadata::cancel_ai_metadata_task_impl(&state, &task_id)
}

#[tauri::command]
pub async fn analyze_file_metadata(
    state: State<'_, AppState>,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<FileWithTags, String> {
    metadata::analyze_file_metadata_impl(&state, file_id, image_data_url).await
}
