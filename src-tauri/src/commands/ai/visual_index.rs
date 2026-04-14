use super::{
    shared, VisualIndexRebuildResult, VisualIndexRetryCandidatePayload, VisualIndexStatus,
};
use crate::commands::VisualIndexTaskSnapshot;
use crate::db::VisualIndexCandidate;
use crate::ml::model_manager::{
    load_visual_search_config, resolve_model_paths,
    validate_visual_model_path as validate_visual_model_path_impl, ResolvedModelPaths,
    VisualSearchConfig,
};
use crate::{AppState, VisualIndexTaskEntry};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

fn reindex_visual_candidate(
    state: &AppState,
    visual_search_config: &VisualSearchConfig,
    resolved_model: &ResolvedModelPaths,
    candidate: &VisualIndexCandidate,
    image_data_url: Option<&str>,
    source_content_hash: &str,
) -> Result<(), String> {
    let embedding = {
        let mut runtime = state
            .visual_model_runtime
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(image_data_url) = image_data_url {
            let image_bytes = shared::decode_image_data_url(image_data_url)?;
            runtime.encode_image_bytes(resolved_model, visual_search_config, &image_bytes)?
        } else {
            runtime.encode_image_path(
                resolved_model,
                visual_search_config,
                std::path::Path::new(&candidate.file.path),
            )?
        }
    };

    let embedding_blob = shared::embedding_to_blob(&embedding);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.upsert_file_visual_embedding(
        candidate.file.id,
        &resolved_model.manifest.model_id,
        embedding.len(),
        &embedding_blob,
        candidate.source_size,
        &candidate.source_modified_at,
        source_content_hash,
    )
    .map_err(|e| e.to_string())
}

fn mark_visual_index_error(
    state: &AppState,
    resolved_model: &ResolvedModelPaths,
    candidate: &VisualIndexCandidate,
    source_content_hash: Option<&str>,
    error: &str,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.mark_file_visual_embedding_error(
        candidate.file.id,
        &resolved_model.manifest.model_id,
        candidate.source_size,
        &candidate.source_modified_at,
        source_content_hash,
        error,
    )
    .map_err(|e| e.to_string())
}

fn process_visual_index_candidate(
    state: &AppState,
    visual_search_config: &VisualSearchConfig,
    resolved_model: &ResolvedModelPaths,
    candidate: &VisualIndexCandidate,
    image_data_url: Option<String>,
) -> Result<(), String> {
    let image_data_url =
        shared::resolve_visual_index_image_data_url(state, candidate, image_data_url).or_else(
            |error| {
                mark_visual_index_error(state, resolved_model, candidate, None, &error)?;
                Err(error)
            },
        )?;

    let source_content_hash =
        shared::sync_visual_content_hash(state, candidate, image_data_url.as_deref()).or_else(
            |error| {
                shared::clear_visual_content_hash(state, candidate)?;
                mark_visual_index_error(state, resolved_model, candidate, None, &error)?;
                Err(error)
            },
        )?;

    reindex_visual_candidate(
        state,
        visual_search_config,
        resolved_model,
        candidate,
        image_data_url.as_deref(),
        &source_content_hash,
    )
    .or_else(|error| {
        mark_visual_index_error(
            state,
            resolved_model,
            candidate,
            Some(&source_content_hash),
            &error,
        )?;
        Err(error)
    })
}

fn load_visual_index_candidates(
    state: &AppState,
    process_unindexed_only: bool,
) -> Result<
    (
        VisualSearchConfig,
        ResolvedModelPaths,
        Vec<VisualIndexCandidate>,
    ),
    String,
> {
    let (visual_search_config, resolved_model, candidates) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let visual_search_config = load_visual_search_config(&db)?;
        let resolved_model = resolve_model_paths(&visual_search_config.model_path)?;
        let candidates = if process_unindexed_only {
            db.get_unindexed_visual_index_candidates(&resolved_model.manifest.model_id)
                .map_err(|e| e.to_string())?
        } else {
            db.get_visual_index_candidates()
                .map_err(|e| e.to_string())?
        };
        (visual_search_config, resolved_model, candidates)
    };

    Ok((visual_search_config, resolved_model, candidates))
}

pub(super) fn get_visual_index_status_impl(state: &AppState) -> Result<VisualIndexStatus, String> {
    let (config, validation) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_visual_search_config(&db)?;
        let validation = validate_visual_model_path_impl(&config.model_path);
        (config, validation)
    };

    if !validation.valid {
        return Ok(VisualIndexStatus {
            model_valid: false,
            message: validation.message,
            model_id: None,
            version: None,
            indexed_count: 0,
            failed_count: 0,
            pending_count: 0,
            outdated_count: 0,
            total_image_count: 0,
        });
    }
    if let Err(error) = config.runtime.resolve_runtime_config() {
        return Ok(VisualIndexStatus {
            model_valid: false,
            message: format!("视觉搜索运行时配置无效: {error}"),
            model_id: None,
            version: None,
            indexed_count: 0,
            failed_count: 0,
            pending_count: 0,
            outdated_count: 0,
            total_image_count: 0,
        });
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_model = resolve_model_paths(&config.model_path)?;
    let counts = db
        .get_visual_index_counts(&resolved_model.manifest.model_id)
        .map_err(|e| e.to_string())?;

    Ok(VisualIndexStatus {
        model_valid: true,
        message: "视觉索引可用".to_string(),
        model_id: Some(resolved_model.manifest.model_id.clone()),
        version: Some(resolved_model.manifest.version.clone()),
        indexed_count: counts.ready,
        failed_count: counts.error,
        pending_count: counts.pending,
        outdated_count: counts.outdated,
        total_image_count: counts.total_images,
    })
}

pub(super) fn get_visual_index_retry_candidates_impl(
    state: &AppState,
) -> Result<Vec<VisualIndexRetryCandidatePayload>, String> {
    let (config, validation) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_visual_search_config(&db)?;
        let validation = validate_visual_model_path_impl(&config.model_path);
        (config, validation)
    };

    if !validation.valid {
        return Ok(Vec::new());
    }
    if config.runtime.resolve_runtime_config().is_err() {
        return Ok(Vec::new());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_model = resolve_model_paths(&config.model_path)?;
    let candidates = db
        .get_visual_index_retry_candidates(&resolved_model.manifest.model_id)
        .map_err(|e| e.to_string())?;

    Ok(candidates
        .into_iter()
        .map(|candidate| VisualIndexRetryCandidatePayload {
            file_id: candidate.file_id,
            path: candidate.path,
            ext: candidate.ext,
            last_error: candidate.last_error,
        })
        .collect())
}

pub(super) fn complete_visual_index_browser_decode_request_impl(
    state: &AppState,
    request_id: String,
    image_data_url: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    let Some(response_tx) = ({
        let mut requests = state
            .visual_index_browser_decode_requests
            .lock()
            .map_err(|e| e.to_string())?;
        requests.remove(&request_id)
    }) else {
        log::debug!(
            "Ignore stale visual index browser decode response: {}",
            request_id
        );
        return Ok(());
    };

    let response = match image_data_url {
        Some(image_data_url) if !image_data_url.trim().is_empty() => Ok(image_data_url),
        _ => Err(error
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "前端未返回可用图片数据".to_string())),
    };

    if response_tx.send(response).is_err() {
        log::debug!(
            "Dropped visual index browser decode response because receiver is gone: {}",
            request_id
        );
    }

    Ok(())
}

pub(super) fn rebuild_visual_index_impl(
    state: &AppState,
    app_handle: Option<&tauri::AppHandle>,
    process_unindexed_only: bool,
) -> Result<VisualIndexRebuildResult, String> {
    let _visual_model_task = crate::ml::VisualModelTaskGuard::start(&state.visual_model_runtime)?;
    let (visual_search_config, resolved_model, candidates) =
        load_visual_index_candidates(state, process_unindexed_only)?;

    let mut result = VisualIndexRebuildResult {
        total: candidates.len(),
        indexed: 0,
        failed: 0,
        skipped: 0,
    };

    for (index, candidate) in candidates.into_iter().enumerate() {
        if let Some(app_handle) = app_handle {
            shared::emit_visual_index_progress(
                app_handle,
                index,
                result.total,
                result.indexed,
                result.failed,
                result.skipped,
                &candidate,
            );
        }

        if process_visual_index_candidate(
            state,
            &visual_search_config,
            &resolved_model,
            &candidate,
            None,
        )
        .is_ok()
        {
            result.indexed += 1;
        } else {
            result.failed += 1;
        }

        if let Some(app_handle) = app_handle {
            shared::emit_visual_index_progress(
                app_handle,
                result.indexed + result.failed + result.skipped,
                result.total,
                result.indexed,
                result.failed,
                result.skipped,
                &candidate,
            );
        }
    }

    Ok(result)
}

pub(super) fn spawn_visual_index_task(
    state: &AppState,
    process_unindexed_only: bool,
) -> Result<VisualIndexTaskSnapshot, String> {
    {
        let tasks = state.visual_index_tasks.lock().map_err(|e| e.to_string())?;
        if tasks
            .values()
            .any(|task| !shared::is_visual_index_task_terminal(&task.snapshot.status))
        {
            return Err("已有视觉索引任务正在进行".to_string());
        }
    }

    let (visual_search_config, resolved_model, candidates) =
        load_visual_index_candidates(state, process_unindexed_only)?;
    if candidates.is_empty() {
        return Err(if process_unindexed_only {
            "当前没有未索引图片需要处理".to_string()
        } else {
            "当前没有可建立视觉索引的图片".to_string()
        });
    }

    let task_id = format!(
        "visual-index-{}",
        crate::commands::imports::uuid_simple_shared()
    );
    let snapshot = VisualIndexTaskSnapshot {
        id: task_id.clone(),
        status: "queued".to_string(),
        total: candidates.len(),
        processed: 0,
        indexed_count: 0,
        failure_count: 0,
        skipped_count: 0,
        current_file_id: None,
        current_file_name: None,
        process_unindexed_only,
    };
    let cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let mut tasks = state.visual_index_tasks.lock().map_err(|e| e.to_string())?;
        tasks.insert(
            task_id.clone(),
            VisualIndexTaskEntry {
                snapshot: snapshot.clone(),
                cancel_flag: cancel_flag.clone(),
            },
        );
    }

    let tasks = state.visual_index_tasks.clone();
    let app_handle = state.app_handle.clone();
    let task_id_for_worker = task_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        shared::update_visual_index_task_snapshot(&tasks, &task_id_for_worker, |snapshot| {
            snapshot.status = "running".to_string();
        });
        shared::emit_visual_index_task_update(&app_handle, &task_id_for_worker);
        let state = app_handle.state::<AppState>();
        let visual_model_task = crate::ml::VisualModelTaskGuard::start(&state.visual_model_runtime);

        let run_result: Result<(), String> = (|| {
            let _visual_model_task = visual_model_task?;
            for candidate in candidates {
                if cancel_flag.load(Ordering::Relaxed) {
                    break;
                }

                shared::update_visual_index_task_snapshot(
                    &tasks,
                    &task_id_for_worker,
                    |snapshot| {
                        snapshot.current_file_id = Some(candidate.file.id);
                        snapshot.current_file_name = Some(candidate.file.name.clone());
                    },
                );
                shared::emit_visual_index_task_update(&app_handle, &task_id_for_worker);

                let result = process_visual_index_candidate(
                    &state,
                    &visual_search_config,
                    &resolved_model,
                    &candidate,
                    None,
                );

                shared::update_visual_index_task_snapshot(
                    &tasks,
                    &task_id_for_worker,
                    |snapshot| {
                        snapshot.processed += 1;
                        if result.is_ok() {
                            snapshot.indexed_count += 1;
                        } else {
                            snapshot.failure_count += 1;
                        }
                    },
                );
                shared::emit_visual_index_task_update(&app_handle, &task_id_for_worker);
            }

            Ok(())
        })();

        let run_error = run_result.err();
        if let Some(error) = run_error.as_ref() {
            log::error!("视觉索引任务失败: {}", error);
        }

        shared::update_visual_index_task_snapshot(&tasks, &task_id_for_worker, |snapshot| {
            snapshot.current_file_id = None;
            snapshot.current_file_name = None;
            snapshot.status = if run_error.is_some() {
                if snapshot.failure_count == 0 {
                    snapshot.failure_count += 1;
                }
                "failed".to_string()
            } else if cancel_flag.load(Ordering::Relaxed) {
                "cancelled".to_string()
            } else if snapshot.failure_count > 0 {
                "completed_with_errors".to_string()
            } else {
                "completed".to_string()
            };
        });
        shared::emit_visual_index_task_update(&app_handle, &task_id_for_worker);
    });

    Ok(snapshot)
}

pub(super) fn get_visual_index_task_impl(
    state: &AppState,
    task_id: &str,
) -> Result<VisualIndexTaskSnapshot, String> {
    let tasks = state.visual_index_tasks.lock().map_err(|e| e.to_string())?;
    tasks
        .get(task_id)
        .map(|task| task.snapshot.clone())
        .ok_or_else(|| "视觉索引任务不存在".to_string())
}

pub(super) fn cancel_visual_index_task_impl(state: &AppState, task_id: &str) -> Result<(), String> {
    let tasks = state.visual_index_tasks.lock().map_err(|e| e.to_string())?;
    let task = tasks
        .get(task_id)
        .ok_or_else(|| "视觉索引任务不存在".to_string())?;
    task.cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

pub(crate) fn reindex_file_visual_embedding_impl(
    state: &AppState,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<(), String> {
    let _visual_model_task = crate::ml::VisualModelTaskGuard::start(&state.visual_model_runtime)?;
    let (visual_search_config, resolved_model, candidate) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let visual_search_config = load_visual_search_config(&db)?;
        let resolved_model = resolve_model_paths(&visual_search_config.model_path)?;
        let candidate = db
            .get_visual_index_candidate(file_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "当前文件不是可建立视觉索引的图片，或文件不存在".to_string())?;
        (visual_search_config, resolved_model, candidate)
    };

    process_visual_index_candidate(
        state,
        &visual_search_config,
        &resolved_model,
        &candidate,
        image_data_url,
    )
}
