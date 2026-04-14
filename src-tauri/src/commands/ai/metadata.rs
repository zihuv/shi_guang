use super::{shared, AiEndpointTarget};
use crate::commands::{AiMetadataTaskItemResult, AiMetadataTaskSnapshot};
use crate::db::{Database, FileWithTags};
use crate::openai::{load_ai_config, request_image_metadata, test_metadata_endpoint};
use crate::{AiMetadataTaskEntry, AppState};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tokio::task::JoinSet;
use tokio::time::{sleep, Duration};

enum AiMetadataTaskItemOutcome {
    Completed { attempts: usize, file: FileWithTags },
    Failed { attempts: usize, error: String },
    Cancelled,
}

fn clamp_ai_metadata_task_concurrency(value: usize) -> usize {
    value.clamp(
        shared::AI_METADATA_TASK_MIN_CONCURRENCY,
        shared::AI_METADATA_TASK_MAX_CONCURRENCY,
    )
}

fn parse_ai_metadata_task_concurrency(value: Option<&str>) -> usize {
    value
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .map(clamp_ai_metadata_task_concurrency)
        .unwrap_or(shared::AI_METADATA_TASK_DEFAULT_CONCURRENCY)
}

fn load_ai_metadata_task_concurrency(db: &Database) -> Result<usize, String> {
    let raw_value = db
        .get_setting(shared::AI_BATCH_ANALYZE_CONCURRENCY_SETTING_KEY)
        .map_err(|e| e.to_string())?;

    Ok(parse_ai_metadata_task_concurrency(raw_value.as_deref()))
}

pub(crate) async fn analyze_file_metadata_impl(
    state: &AppState,
    file_id: i64,
    image_data_url: Option<String>,
) -> Result<FileWithTags, String> {
    let (config, file, existing_tags) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let config = load_ai_config(&db)?;
        let file = db
            .get_file_by_id(file_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "文件不存在".to_string())?;
        let existing_tags = db.get_all_tags().map_err(|e| e.to_string())?;
        (config, file, existing_tags)
    };

    let has_image_data_url = image_data_url
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if !shared::is_supported_image_for_ai(&file, has_image_data_url) {
        return Err("当前仅支持对图片文件执行 AI 分析".to_string());
    }

    let old_path = PathBuf::from(&file.path);
    if !old_path.exists() {
        return Err("文件不存在，无法执行 AI 分析".to_string());
    }

    let image_data_url = match image_data_url {
        Some(value) if !value.trim().is_empty() => value,
        _ => shared::prepare_image_data_url(&old_path)?,
    };
    let mut suggestion =
        request_image_metadata(&config, &file, &existing_tags, &image_data_url).await?;
    suggestion.filename = shared::sanitize_filename_stem(
        &suggestion.filename,
        Path::new(&file.name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("untitled"),
    );
    suggestion.tags = shared::sanitize_tag_list(std::mem::take(&mut suggestion.tags));
    suggestion.description = shared::trim_to_char_limit(
        suggestion.description.trim(),
        shared::MAX_AI_DESCRIPTION_CHARS,
    );

    let current_stem = old_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled");
    let desired_stem = shared::sanitize_filename_stem(&suggestion.filename, current_stem);

    let db = state.db.lock().map_err(|e| e.to_string())?;

    let (new_name, new_path) =
        shared::resolve_available_rename_path(&db, file_id, &old_path, &desired_stem)?;
    if new_path != old_path {
        shared::move_file_with_fallback(&old_path, &new_path)?;
        let new_path_string = new_path.to_string_lossy().to_string();
        db.update_file_name(file_id, &new_name, &new_path_string)
            .map_err(|e| e.to_string())?;
    }

    db.update_file_metadata(
        file_id,
        file.rating,
        &suggestion.description,
        &file.source_url,
    )
    .map_err(|e| e.to_string())?;

    let normalized_existing = existing_tags
        .iter()
        .map(|tag| (shared::normalize_tag_name(&tag.name), tag))
        .collect::<HashMap<_, _>>();

    for tag_name in &suggestion.tags {
        let normalized = shared::normalize_tag_name(tag_name);
        let tag_id = if let Some(existing_tag) = normalized_existing.get(&normalized) {
            existing_tag.id
        } else {
            db.create_tag(tag_name, shared::pick_color_for_tag(tag_name), None)
                .map_err(|e| e.to_string())?
        };
        db.add_tag_to_file(file_id, tag_id)
            .map_err(|e| e.to_string())?;
    }

    db.get_file_by_id(file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "更新后无法读取文件".to_string())
}

async fn analyze_file_metadata_task_item(
    app_handle: &tauri::AppHandle,
    file_id: i64,
    cancel_flag: &Arc<AtomicBool>,
) -> AiMetadataTaskItemOutcome {
    let mut last_error = None;

    for attempt in 1..=shared::AI_METADATA_TASK_MAX_ATTEMPTS {
        if cancel_flag.load(Ordering::Relaxed) {
            return AiMetadataTaskItemOutcome::Cancelled;
        }

        let state = app_handle.state::<AppState>();
        match analyze_file_metadata_impl(&state, file_id, None).await {
            Ok(file) => {
                return AiMetadataTaskItemOutcome::Completed {
                    attempts: attempt,
                    file,
                };
            }
            Err(error) if attempt < shared::AI_METADATA_TASK_MAX_ATTEMPTS => {
                last_error = Some(error);
                sleep(Duration::from_millis(
                    shared::AI_METADATA_TASK_RETRY_DELAY_MS,
                ))
                .await;
            }
            Err(error) => {
                return AiMetadataTaskItemOutcome::Failed {
                    attempts: attempt,
                    error,
                };
            }
        }
    }

    AiMetadataTaskItemOutcome::Failed {
        attempts: shared::AI_METADATA_TASK_MAX_ATTEMPTS,
        error: last_error.unwrap_or_else(|| "AI 分析失败".to_string()),
    }
}

pub(super) fn spawn_ai_metadata_task(
    state: &AppState,
    file_ids: Vec<i64>,
) -> Result<AiMetadataTaskSnapshot, String> {
    let mut unique_file_ids = Vec::with_capacity(file_ids.len());
    let mut seen = HashSet::new();
    for file_id in file_ids {
        if seen.insert(file_id) {
            unique_file_ids.push(file_id);
        }
    }

    if unique_file_ids.is_empty() {
        return Err("No files selected".to_string());
    }

    let configured_concurrency = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        load_ai_metadata_task_concurrency(&db)?
    };

    let task_id = format!(
        "ai-metadata-{}",
        crate::commands::imports::uuid_simple_shared()
    );
    let snapshot = AiMetadataTaskSnapshot {
        id: task_id.clone(),
        status: "queued".to_string(),
        total: unique_file_ids.len(),
        processed: 0,
        success_count: 0,
        failure_count: 0,
        results: Vec::new(),
    };
    let cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let mut tasks = state.ai_metadata_tasks.lock().map_err(|e| e.to_string())?;
        tasks.insert(
            task_id.clone(),
            AiMetadataTaskEntry {
                snapshot: snapshot.clone(),
                cancel_flag: cancel_flag.clone(),
            },
        );
    }

    let tasks = state.ai_metadata_tasks.clone();
    let app_handle = state.app_handle.clone();

    tauri::async_runtime::spawn(async move {
        shared::update_ai_metadata_task_snapshot(&tasks, &task_id, |snapshot| {
            snapshot.status = "running".to_string();
        });
        shared::emit_ai_metadata_task_update(&app_handle, &task_id);

        let next_index = Arc::new(AtomicUsize::new(0));
        let worker_count = unique_file_ids.len().min(configured_concurrency);
        let mut workers = JoinSet::new();

        for _ in 0..worker_count {
            let task_id = task_id.clone();
            let tasks = tasks.clone();
            let app_handle = app_handle.clone();
            let cancel_flag = cancel_flag.clone();
            let next_index = next_index.clone();
            let file_ids = unique_file_ids.clone();

            workers.spawn(async move {
                loop {
                    if cancel_flag.load(Ordering::Relaxed) {
                        break;
                    }

                    let current_index = next_index.fetch_add(1, Ordering::Relaxed);
                    if current_index >= file_ids.len() {
                        break;
                    }

                    let file_id = file_ids[current_index];
                    let outcome =
                        analyze_file_metadata_task_item(&app_handle, file_id, &cancel_flag).await;

                    match outcome {
                        AiMetadataTaskItemOutcome::Completed { attempts, file } => {
                            shared::update_ai_metadata_task_snapshot(
                                &tasks,
                                &task_id,
                                |snapshot| {
                                    snapshot.processed += 1;
                                    snapshot.success_count += 1;
                                    snapshot.results.push(AiMetadataTaskItemResult {
                                        index: current_index,
                                        file_id,
                                        status: "completed".to_string(),
                                        attempts,
                                        error: None,
                                        file: Some(file),
                                    });
                                },
                            );
                            shared::emit_ai_metadata_task_update(&app_handle, &task_id);
                        }
                        AiMetadataTaskItemOutcome::Failed { attempts, error } => {
                            shared::update_ai_metadata_task_snapshot(
                                &tasks,
                                &task_id,
                                |snapshot| {
                                    snapshot.processed += 1;
                                    snapshot.failure_count += 1;
                                    snapshot.results.push(AiMetadataTaskItemResult {
                                        index: current_index,
                                        file_id,
                                        status: "failed".to_string(),
                                        attempts,
                                        error: Some(error),
                                        file: None,
                                    });
                                },
                            );
                            shared::emit_ai_metadata_task_update(&app_handle, &task_id);
                        }
                        AiMetadataTaskItemOutcome::Cancelled => break,
                    }
                }
            });
        }

        let mut worker_failure = None;
        while let Some(result) = workers.join_next().await {
            if let Err(error) = result {
                worker_failure = Some(error.to_string());
            }
        }

        shared::update_ai_metadata_task_snapshot(&tasks, &task_id, |snapshot| {
            snapshot.status = if let Some(error) = worker_failure {
                if !snapshot
                    .results
                    .iter()
                    .any(|result| result.status == "failed")
                {
                    snapshot.failure_count += 1;
                    snapshot.results.push(AiMetadataTaskItemResult {
                        index: snapshot.results.len(),
                        file_id: 0,
                        status: "failed".to_string(),
                        attempts: 0,
                        error: Some(format!("AI 批量任务异常: {}", error)),
                        file: None,
                    });
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
        shared::emit_ai_metadata_task_update(&app_handle, &task_id);
    });

    Ok(snapshot)
}

pub(super) fn get_ai_metadata_task_impl(
    state: &AppState,
    task_id: &str,
) -> Result<AiMetadataTaskSnapshot, String> {
    let tasks = state.ai_metadata_tasks.lock().map_err(|e| e.to_string())?;
    tasks
        .get(task_id)
        .map(|task| task.snapshot.clone())
        .ok_or_else(|| "AI metadata task not found".to_string())
}

pub(super) fn cancel_ai_metadata_task_impl(state: &AppState, task_id: &str) -> Result<(), String> {
    let tasks = state.ai_metadata_tasks.lock().map_err(|e| e.to_string())?;
    let task = tasks
        .get(task_id)
        .ok_or_else(|| "AI metadata task not found".to_string())?;
    task.cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

pub(super) async fn test_ai_endpoint_impl(
    state: &AppState,
    target: AiEndpointTarget,
) -> Result<String, String> {
    match target {
        AiEndpointTarget::Metadata => {
            let endpoint_config = {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                load_ai_config(&db)?
            };
            test_metadata_endpoint(&endpoint_config).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ai_metadata_task_concurrency_uses_default_for_invalid_values() {
        assert_eq!(
            parse_ai_metadata_task_concurrency(None),
            shared::AI_METADATA_TASK_DEFAULT_CONCURRENCY
        );
        assert_eq!(
            parse_ai_metadata_task_concurrency(Some("")),
            shared::AI_METADATA_TASK_DEFAULT_CONCURRENCY
        );
        assert_eq!(
            parse_ai_metadata_task_concurrency(Some("abc")),
            shared::AI_METADATA_TASK_DEFAULT_CONCURRENCY
        );
    }

    #[test]
    fn parse_ai_metadata_task_concurrency_clamps_to_supported_range() {
        assert_eq!(parse_ai_metadata_task_concurrency(Some("0")), 1);
        assert_eq!(parse_ai_metadata_task_concurrency(Some("3")), 3);
        assert_eq!(
            parse_ai_metadata_task_concurrency(Some("99")),
            shared::AI_METADATA_TASK_MAX_CONCURRENCY
        );
    }
}
