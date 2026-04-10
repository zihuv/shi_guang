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
        let (is_image, auto_analyze, auto_vectorize) = {
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
            let visual_search_config = load_visual_search_config(&db).unwrap_or_default();
            let auto_analyze = load_auto_analyze_on_import(&db).unwrap_or(false);

            (
                super::ai::is_backend_decodable_image(&file),
                auto_analyze,
                visual_search_config.enabled && visual_search_config.auto_vectorize_on_import,
            )
        };

        let mut should_emit_file_updated = false;

        {
            let state = app_handle.state::<AppState>();
            match super::files::refresh_file_color_data_impl(&state, file_id) {
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

        if is_image {
            if auto_analyze {
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

            if auto_vectorize {
                let state = app_handle.state::<AppState>();
                if let Err(error) =
                    super::ai::reindex_file_visual_embedding_impl(&state, file_id, None)
                {
                    log::warn!(
                        "Auto vectorize on import failed for file {}: {}",
                        file_id,
                        error
                    );
                }
            }
        } else if should_emit_file_updated {
            emit_file_updated(&app_handle, file_id);
        }
    });
}
