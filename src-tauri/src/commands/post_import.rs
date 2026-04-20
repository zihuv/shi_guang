use super::*;
use crate::ml::model_manager::{load_auto_analyze_on_import, load_visual_search_config};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ImportSuccessOptions {
    pub emit_file_imported_event: bool,
}

fn emit_file_updated(app_handle: &tauri::AppHandle, file_id: i64) {
    let _ = app_handle.emit("file-updated", serde_json::json!({ "fileId": file_id }));
}

fn generate_import_thumbnail_if_missing(
    index_paths: &[String],
    file: &FileWithTags,
) -> Result<bool, String> {
    let file_path = std::path::Path::new(&file.path);
    let probe = crate::media::probe_media_path(file_path)?;
    if !probe.is_backend_decodable_image() {
        return Ok(false);
    }

    let Some(thumbnail_path) =
        crate::storage::get_thumbnail_cache_path(index_paths, file_path, None)?
    else {
        return Ok(false);
    };

    if thumbnail_path.exists() {
        return Ok(false);
    }

    let source_dimensions = match (u32::try_from(file.width), u32::try_from(file.height)) {
        (Ok(width), Ok(height)) if width > 0 && height > 0 => Some((width, height)),
        _ => None,
    };

    match crate::storage::get_or_create_thumbnail(index_paths, file_path, None, source_dimensions)?
    {
        Some(_) => Ok(true),
        None => Ok(false),
    }
}

pub(crate) fn handle_import_success(
    app_handle: &tauri::AppHandle,
    imported_file: &FileWithTags,
    options: ImportSuccessOptions,
) {
    enqueue_post_import_tasks(app_handle.clone(), imported_file.id);

    if options.emit_file_imported_event {
        let _ = app_handle.emit(
            "file-imported",
            serde_json::json!({
                "file_id": imported_file.id,
                "path": imported_file.path.clone(),
            }),
        );
    }
}

pub(crate) fn enqueue_post_import_tasks(app_handle: tauri::AppHandle, file_id: i64) {
    tauri::async_runtime::spawn(async move {
        let (file, index_paths, auto_analyze, auto_vectorize) = {
            let state = app_handle.state::<AppState>();
            let db = match state.db.lock() {
                Ok(db) => db,
                Err(error) => {
                    log::warn!("Failed to lock db for post import pipeline: {}", error);
                    return;
                }
            };

            let file = match db.get_file_by_id(file_id) {
                Ok(Some(file)) => file,
                Ok(None) => return,
                Err(error) => {
                    log::warn!("Failed to load imported file {}: {}", file_id, error);
                    return;
                }
            };
            let index_paths = match db.get_index_paths() {
                Ok(paths) => paths,
                Err(error) => {
                    log::warn!(
                        "Failed to load index paths for post import pipeline {}: {}",
                        file_id,
                        error
                    );
                    return;
                }
            };
            let visual_search_config = load_visual_search_config(&db).unwrap_or_default();
            let auto_analyze = load_auto_analyze_on_import(&db).unwrap_or(false);

            (
                file.clone(),
                index_paths,
                auto_analyze,
                visual_search_config.enabled && visual_search_config.auto_vectorize_on_import,
            )
        };
        let media_probe = crate::media::probe_media_path(std::path::Path::new(&file.path)).ok();
        let can_generate_thumbnail = media_probe
            .map(|probe| probe.is_backend_decodable_image())
            .unwrap_or(false);
        let can_analyze_with_ai = media_probe
            .map(|probe| probe.is_ai_supported_image())
            .unwrap_or(false);
        let can_build_visual_index = media_probe
            .map(|probe| probe.is_visual_search_supported())
            .unwrap_or(false);
        let should_browser_decode_colors = media_probe
            .map(|probe| probe.requires_browser_decode_for_color_extraction())
            .unwrap_or(false);

        let mut should_emit_file_updated = false;
        let browser_decoded_color_data_url = if should_browser_decode_colors {
            let state = app_handle.state::<AppState>();
            match super::ai::request_browser_decoded_image_data_url_for_file(
                &state,
                &file,
                "image/png",
            ) {
                Ok(image_data_url) => Some(image_data_url),
                Err(error) => {
                    log::warn!(
                        "Failed to browser-decode image for import color extraction {}: {}",
                        file_id,
                        error
                    );
                    None
                }
            }
        } else {
            None
        };

        {
            let state = app_handle.state::<AppState>();
            match super::files::refresh_file_color_data_impl(
                &state,
                file_id,
                browser_decoded_color_data_url.as_deref(),
            ) {
                Ok(Some(_)) => {
                    should_emit_file_updated = true;
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!(
                        "Auto color extraction on import failed for file {}: {}",
                        file_id,
                        error
                    );
                }
            }
        }

        if can_generate_thumbnail {
            match generate_import_thumbnail_if_missing(&index_paths, &file) {
                Ok(true) => {
                    should_emit_file_updated = true;
                }
                Ok(false) => {}
                Err(error) => {
                    log::warn!(
                        "Auto thumbnail generation on import failed for file {}: {}",
                        file_id,
                        error
                    );
                }
            }
        }

        if auto_analyze && can_analyze_with_ai {
            let state = app_handle.state::<AppState>();
            match super::ai::analyze_file_metadata_impl(&state, file_id, None).await {
                Ok(_) => {
                    should_emit_file_updated = true;
                }
                Err(error) => {
                    log::warn!(
                        "Auto analyze on import failed for file {}: {}",
                        file_id,
                        error
                    );
                }
            }
        }

        if should_emit_file_updated {
            emit_file_updated(&app_handle, file_id);
        }

        if auto_vectorize && can_build_visual_index {
            let state = app_handle.state::<AppState>();
            if let Err(error) = super::ai::reindex_file_visual_embedding_impl(&state, file_id) {
                log::warn!(
                    "Auto vectorize on import failed for file {}: {}",
                    file_id,
                    error
                );
            }
        }
    });
}
