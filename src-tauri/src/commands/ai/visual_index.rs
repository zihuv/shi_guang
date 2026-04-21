use super::{shared, VisualIndexRebuildResult, VisualIndexStatus};
use crate::commands::VisualIndexTaskSnapshot;
use crate::db::VisualIndexCandidate;
use crate::ml::model_manager::{
    load_visual_search_config, resolve_model_paths,
    validate_visual_model_path as validate_visual_model_path_impl, ResolvedModelPaths,
    VisualSearchConfig, VisualSearchThreadConfig,
};
use crate::{AppState, VisualIndexTaskEntry};
use omni_search::ExecutionProviderKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

const MAX_BACKGROUND_VISUAL_INDEX_INTRA_THREADS: usize = 2;
const DIRECTML_VISUAL_RUNTIME_RECYCLE_INTERVAL: usize = 24;

fn reindex_visual_candidate(
    state: &AppState,
    visual_search_config: &VisualSearchConfig,
    resolved_model: &ResolvedModelPaths,
    candidate: &VisualIndexCandidate,
    image_bytes: Option<&[u8]>,
    source_content_hash: &str,
) -> Result<(), String> {
    let embedding = {
        let mut runtime = state
            .visual_model_runtime
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(image_bytes) = image_bytes {
            runtime.encode_image_bytes(resolved_model, visual_search_config, image_bytes)?
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
) -> Result<(), String> {
    let browser_decoded_image_data_url =
        shared::resolve_visual_index_browser_decoded_image_data_url(state, candidate).or_else(
            |error| {
                mark_visual_index_error(state, resolved_model, candidate, None, &error)?;
                Err(error)
            },
        )?;

    let source_content_hash = shared::sync_visual_content_hash(
        state,
        candidate,
        browser_decoded_image_data_url.as_deref(),
    )
    .or_else(|error| {
        shared::clear_visual_content_hash(state, candidate)?;
        mark_visual_index_error(state, resolved_model, candidate, None, &error)?;
        Err(error)
    })?;

    let prepared_image_bytes = if let Some(image_data_url) = browser_decoded_image_data_url.as_deref()
    {
        Some(shared::decode_image_data_url(image_data_url).or_else(|error| {
            mark_visual_index_error(
                state,
                resolved_model,
                candidate,
                Some(&source_content_hash),
                &error,
            )?;
            Err(error)
        })?)
    } else {
        shared::resolve_visual_index_backend_prepared_image_bytes(candidate).or_else(|error| {
            mark_visual_index_error(
                state,
                resolved_model,
                candidate,
                Some(&source_content_hash),
                &error,
            )?;
            Err(error)
        })?
    };

    reindex_visual_candidate(
        state,
        visual_search_config,
        resolved_model,
        candidate,
        prepared_image_bytes.as_deref(),
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

fn visual_index_task_total(
    state: &AppState,
    process_unindexed_only: bool,
) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let visual_search_config = load_visual_search_config(&db)?;
    let resolved_model = resolve_model_paths(&visual_search_config.model_path)?;
    let counts = db
        .get_visual_index_counts(&resolved_model.manifest.model_id)
        .map_err(|e| e.to_string())?;

    Ok(if process_unindexed_only {
        (counts.pending + counts.error + counts.outdated).max(0) as usize
    } else {
        counts.total_images.max(0) as usize
    })
}

fn default_background_visual_index_intra_threads_for_parallelism(parallelism: usize) -> usize {
    parallelism
        .saturating_sub(1)
        .clamp(1, MAX_BACKGROUND_VISUAL_INDEX_INTRA_THREADS)
}

fn default_background_visual_index_intra_threads() -> usize {
    let detected = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(MAX_BACKGROUND_VISUAL_INDEX_INTRA_THREADS);
    default_background_visual_index_intra_threads_for_parallelism(detected)
}

fn apply_background_visual_index_runtime_defaults(
    visual_search_config: &VisualSearchConfig,
    intra_threads: usize,
) -> VisualSearchConfig {
    let mut effective = visual_search_config.clone();
    if !matches!(
        effective.runtime.intra_threads,
        Some(VisualSearchThreadConfig::Fixed(_))
    ) {
        effective.runtime.intra_threads = Some(VisualSearchThreadConfig::Fixed(intra_threads));
    }
    effective
}

fn effective_visual_index_config(visual_search_config: &VisualSearchConfig) -> VisualSearchConfig {
    apply_background_visual_index_runtime_defaults(
        visual_search_config,
        default_background_visual_index_intra_threads(),
    )
}

fn should_recycle_visual_runtime_after_candidate(
    processed_count: usize,
    effective_provider: Option<ExecutionProviderKind>,
) -> bool {
    processed_count > 0
        && processed_count % DIRECTML_VISUAL_RUNTIME_RECYCLE_INTERVAL == 0
        && matches!(effective_provider, Some(ExecutionProviderKind::DirectMl))
}

fn maybe_recycle_visual_runtime_after_candidate(
    state: &AppState,
    resolved_model: &ResolvedModelPaths,
    visual_search_config: &VisualSearchConfig,
    processed_count: usize,
) -> Result<(), String> {
    let mut runtime = state
        .visual_model_runtime
        .lock()
        .map_err(|e| e.to_string())?;
    let effective_provider = runtime
        .runtime_snapshot_if_loaded(resolved_model, visual_search_config)?
        .and_then(|snapshot| snapshot.image_session.effective_provider);

    if !should_recycle_visual_runtime_after_candidate(processed_count, effective_provider) {
        return Ok(());
    }

    runtime.clear();
    log::info!(
        "Recycled visual model runtime after {} images to avoid long-lived DirectML session stalls",
        processed_count
    );
    Ok(())
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
            requested_device: None,
            provider_policy: None,
            runtime_loaded: false,
            runtime_mode: None,
            effective_provider: None,
            runtime_reason: None,
            indexed_count: 0,
            failed_count: 0,
            pending_count: 0,
            outdated_count: 0,
            total_image_count: 0,
        });
    }
    let runtime_config = match config.runtime.resolve_runtime_config() {
        Ok(runtime_config) => runtime_config,
        Err(error) => {
            return Ok(VisualIndexStatus {
                model_valid: false,
                message: format!("视觉搜索运行时配置无效: {error}"),
                model_id: None,
                version: None,
                requested_device: None,
                provider_policy: None,
                runtime_loaded: false,
                runtime_mode: None,
                effective_provider: None,
                runtime_reason: None,
                indexed_count: 0,
                failed_count: 0,
                pending_count: 0,
                outdated_count: 0,
                total_image_count: 0,
            });
        }
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_model = resolve_model_paths(&config.model_path)?;
    let counts = db
        .get_visual_index_counts(&resolved_model.manifest.model_id)
        .map_err(|e| e.to_string())?;
    drop(db);

    let runtime_snapshot = {
        let runtime = state
            .visual_model_runtime
            .lock()
            .map_err(|e| e.to_string())?;
        runtime.runtime_snapshot_if_loaded(&resolved_model, &effective_visual_index_config(&config))?
    };

    let (runtime_loaded, runtime_mode, effective_provider, runtime_reason) =
        if let Some(snapshot) = runtime_snapshot {
            (
                true,
                Some(snapshot.summary.mode),
                snapshot.summary.effective_provider,
                snapshot.summary.reason,
            )
        } else {
            (false, None, None, None)
        };

    let message = if effective_provider.is_some() {
        "视觉索引可用，运行时已初始化".to_string()
    } else if runtime_loaded {
        if let Some(reason) = runtime_reason.as_deref() {
            format!("视觉索引可用，当前运行时状态待确认：{reason}")
        } else {
            "视觉索引可用，当前运行时状态待确认".to_string()
        }
    } else {
        "视觉索引可用，运行时将在首次编码时初始化".to_string()
    };

    Ok(VisualIndexStatus {
        model_valid: true,
        message,
        model_id: Some(resolved_model.manifest.model_id.clone()),
        version: Some(resolved_model.manifest.version.clone()),
        requested_device: Some(runtime_config.device),
        provider_policy: Some(runtime_config.provider_policy),
        runtime_loaded,
        runtime_mode,
        effective_provider,
        runtime_reason,
        indexed_count: counts.ready,
        failed_count: counts.error,
        pending_count: counts.pending,
        outdated_count: counts.outdated,
        total_image_count: counts.total_images,
    })
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
    let effective_visual_search_config = effective_visual_index_config(&visual_search_config);

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
            &effective_visual_search_config,
            &resolved_model,
            &candidate,
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

    let total = visual_index_task_total(state, process_unindexed_only)?;
    if total == 0 {
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
        total,
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
        let state = app_handle.state::<AppState>();
        let run_result: Result<(), String> = (|| {
            let _visual_model_task =
                crate::ml::VisualModelTaskGuard::start(&state.visual_model_runtime)?;
            let (visual_search_config, resolved_model, candidates) =
                load_visual_index_candidates(&state, process_unindexed_only)?;
            let effective_visual_search_config =
                effective_visual_index_config(&visual_search_config);

            shared::update_visual_index_task_snapshot(&tasks, &task_id_for_worker, |snapshot| {
                snapshot.total = candidates.len();
                snapshot.status = "running".to_string();
            });
            shared::emit_visual_index_task_update(&app_handle, &task_id_for_worker);

            let mut processed_count = 0usize;
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
                    &effective_visual_search_config,
                    &resolved_model,
                    &candidate,
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

                processed_count += 1;
                if let Err(error) = maybe_recycle_visual_runtime_after_candidate(
                    &state,
                    &resolved_model,
                    &effective_visual_search_config,
                    processed_count,
                ) {
                    log::warn!(
                        "Failed to recycle visual model runtime after {} images: {}",
                        processed_count,
                        error
                    );
                }
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
    let effective_visual_search_config = effective_visual_index_config(&visual_search_config);

    process_visual_index_candidate(
        state,
        &effective_visual_search_config,
        &resolved_model,
        &candidate,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ml::model_manager::{
        VisualSearchProviderPolicy, VisualSearchRuntimeConfig, VisualSearchRuntimeDevice,
    };
    use omni_search::ExecutionProviderKind;

    fn make_visual_search_config(
        intra_threads: Option<VisualSearchThreadConfig>,
    ) -> VisualSearchConfig {
        VisualSearchConfig {
            enabled: true,
            model_path: "D:\\models\\fgclip2".to_string(),
            auto_vectorize_on_import: false,
            process_unindexed_only: false,
            runtime: VisualSearchRuntimeConfig {
                device: VisualSearchRuntimeDevice::Auto,
                provider_policy: VisualSearchProviderPolicy::Interactive,
                intra_threads,
                fgclip_max_patches: None,
            },
        }
    }

    #[test]
    fn background_visual_index_threads_leave_one_core_for_ui() {
        assert_eq!(
            default_background_visual_index_intra_threads_for_parallelism(1),
            1
        );
        assert_eq!(
            default_background_visual_index_intra_threads_for_parallelism(2),
            1
        );
        assert_eq!(
            default_background_visual_index_intra_threads_for_parallelism(8),
            2
        );
    }

    #[test]
    fn background_visual_index_threads_respect_explicit_override() {
        let config = apply_background_visual_index_runtime_defaults(
            &make_visual_search_config(Some(VisualSearchThreadConfig::Fixed(6))),
            2,
        );

        assert_eq!(
            config.runtime.intra_threads,
            Some(VisualSearchThreadConfig::Fixed(6))
        );
    }

    #[test]
    fn background_visual_index_preserves_explicit_device_override() {
        let mut config = make_visual_search_config(None);
        config.runtime.device = VisualSearchRuntimeDevice::Gpu;

        let effective = apply_background_visual_index_runtime_defaults(&config, 2);

        assert_eq!(effective.runtime.device, VisualSearchRuntimeDevice::Gpu);
    }

    #[test]
    fn background_visual_index_keeps_auto_device_by_default() {
        let config = apply_background_visual_index_runtime_defaults(&make_visual_search_config(None), 2);

        assert_eq!(config.runtime.device, VisualSearchRuntimeDevice::Auto);
    }

    #[test]
    fn background_visual_index_threads_cap_auto_mode() {
        let config = apply_background_visual_index_runtime_defaults(
            &make_visual_search_config(Some(VisualSearchThreadConfig::Preset(
                crate::ml::model_manager::VisualSearchThreadPreset::Auto,
            ))),
            2,
        );

        assert_eq!(
            config.runtime.intra_threads,
            Some(VisualSearchThreadConfig::Fixed(2))
        );
    }

    #[test]
    fn directml_runtime_recycle_only_triggers_on_interval_boundary() {
        assert!(!should_recycle_visual_runtime_after_candidate(
            23,
            Some(ExecutionProviderKind::DirectMl)
        ));
        assert!(should_recycle_visual_runtime_after_candidate(
            24,
            Some(ExecutionProviderKind::DirectMl)
        ));
        assert!(should_recycle_visual_runtime_after_candidate(
            48,
            Some(ExecutionProviderKind::DirectMl)
        ));
    }

    #[test]
    fn directml_runtime_recycle_skips_non_directml_providers() {
        assert!(!should_recycle_visual_runtime_after_candidate(
            24,
            Some(ExecutionProviderKind::Cpu)
        ));
        assert!(!should_recycle_visual_runtime_after_candidate(24, None));
    }
}
