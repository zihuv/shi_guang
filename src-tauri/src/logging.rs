use chrono::Local;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::plugin::TauriPlugin;
use tauri::{App, AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const LOG_FILE_NAME: &str = "shiguang";
const LOG_RETENTION_DAYS: u64 = 7;
const LOG_RETENTION_CHECK_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_LOG_FILE_SIZE_BYTES: u128 = 5 * 1024 * 1024;

#[cfg(not(debug_assertions))]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    logger_builder().build()
}

#[cfg(debug_assertions)]
pub fn split<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<(TauriPlugin<R>, log::LevelFilter, Box<dyn log::Log>), tauri_plugin_log::Error> {
    logger_builder().split(app_handle)
}

fn logger_builder() -> tauri_plugin_log::Builder {
    let mut targets = vec![Target::new(TargetKind::Stdout)];

    if !cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        }));
    }

    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_LOG_FILE_SIZE_BYTES)
        .rotation_strategy(RotationStrategy::KeepAll)
        .format(|out, message, record| {
            out.finish(format_args!(
                "{} [{}] [{}] {}",
                Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                record.level(),
                record.target(),
                message
            ))
        })
}

pub fn cleanup_expired_logs<R: Runtime>(app: &App<R>) {
    cleanup_expired_logs_for_handle(&app.handle().clone());
}

pub fn start_retention_task<R: Runtime>(app: &App<R>) {
    if cfg!(debug_assertions) {
        return;
    }

    let app_handle = app.handle().clone();
    thread::spawn(move || loop {
        thread::sleep(LOG_RETENTION_CHECK_INTERVAL);
        cleanup_expired_logs_for_handle(&app_handle);
    });
}

fn cleanup_expired_logs_for_handle<R: Runtime>(app_handle: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }

    let Ok(log_dir) = app_handle.path().app_log_dir() else {
        log::warn!("Failed to resolve app log directory");
        return;
    };

    if !log_dir.exists() {
        return;
    }

    match remove_old_logs(
        &log_dir,
        Duration::from_secs(LOG_RETENTION_DAYS * 24 * 60 * 60),
    ) {
        Ok(removed) if removed > 0 => {
            log::info!(
                "Removed {} expired log files from {}",
                removed,
                log_dir.display()
            );
        }
        Ok(_) => {}
        Err(error) => {
            log::warn!(
                "Failed to cleanup expired log files in {}: {}",
                log_dir.display(),
                error
            );
        }
    }
}

fn remove_old_logs(log_dir: &Path, retention: Duration) -> Result<usize, String> {
    let now = SystemTime::now();
    let mut removed = 0;

    for entry in fs::read_dir(log_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !path.is_file() || !file_name.starts_with(LOG_FILE_NAME) || !file_name.ends_with(".log")
        {
            continue;
        }

        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let modified_at = metadata.modified().map_err(|error| error.to_string())?;
        let Ok(age) = now.duration_since(modified_at) else {
            continue;
        };

        if age <= retention {
            continue;
        }

        fs::remove_file(&path).map_err(|error| error.to_string())?;
        removed += 1;
    }

    Ok(removed)
}
