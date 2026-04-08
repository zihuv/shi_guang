mod commands;
mod db;
mod http_server;
mod indexer;
mod openai;
mod path_utils;
mod storage;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

/// Clean up folders and files that start with '.' from the database
fn cleanup_dot_folders(db: &db::Database) -> Result<(), String> {
    // Get all folders and delete those starting with '.'
    let folders = db.get_all_folders().map_err(|e| e.to_string())?;
    for folder in folders {
        if folder.name.starts_with('.') {
            log::info!("Removing dot-folder from database: {}", folder.name);
            db.delete_folder(folder.id).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// Track recent imports to prevent duplicate imports within a short time
pub struct RecentImports {
    entries: Vec<(String, Instant)>,
}

impl RecentImports {
    fn new() -> Self {
        RecentImports {
            entries: Vec::new(),
        }
    }

    fn is_recent(&mut self, source_path: &str, max_age: Duration) -> bool {
        let now = Instant::now();
        // Clean old entries
        self.entries
            .retain(|(_, time)| now.duration_since(*time) < max_age);
        // Check if this path was recently imported
        self.entries.iter().any(|(path, _)| path == source_path)
    }

    fn add(&mut self, source_path: String) {
        self.entries.push((source_path, Instant::now()));
    }
}

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub app_data_dir: std::path::PathBuf,
    pub recent_imports: Mutex<RecentImports>,
    pub db_path: std::path::PathBuf, // Add db_path for HTTP server to create its own connection
    pub import_tasks: Arc<Mutex<HashMap<String, ImportTaskEntry>>>,
    pub import_write_lock: Arc<Mutex<()>>,
    pub app_handle: tauri::AppHandle,
}

pub struct ImportTaskEntry {
    pub snapshot: commands::ImportTaskSnapshot,
    pub items: Vec<commands::BatchImportItem>,
    pub cancel_flag: Arc<AtomicBool>,
    pub folder_id: Option<i64>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize DevTools plugin first (only in dev builds)
    #[cfg(debug_assertions)]
    let devtools_plugin = tauri_plugin_devtools::init();

    // Initialize env_logger
    let _ = env_logger::try_init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(debug_assertions)]
    let builder = builder
        .plugin(devtools_plugin)
        .plugin(tauri_plugin_mcp_bridge::init());

    builder
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

            // Migrate database from old location to new location if needed
            let (db_path, index_path) = storage::migrate_or_get_db_path(&app_data_dir)
                .expect("Failed to migrate or get database path");

            log::info!("Using database at: {:?}", db_path);

            let database = db::Database::new(&db_path).expect("Failed to initialize database");
            let current_index_path = index_path.to_string_lossy().to_string();
            let needs_index_path_sync = database
                .get_index_paths()
                .map(|paths| {
                    paths
                        .first()
                        .map(|path| path != &current_index_path)
                        .unwrap_or(true)
                })
                .unwrap_or(true);
            if needs_index_path_sync {
                database
                    .set_index_path(&current_index_path)
                    .expect("Failed to synchronize index path");
            }

            // Clean up dot-folders from database
            if let Err(e) = cleanup_dot_folders(&database) {
                log::warn!("Failed to cleanup dot-folders: {}", e);
            }

            app.manage(AppState {
                db: Mutex::new(database),
                app_data_dir: app_data_dir.clone(),
                recent_imports: Mutex::new(RecentImports::new()),
                db_path: db_path.clone(),
                import_tasks: Arc::new(Mutex::new(HashMap::new())),
                import_write_lock: Arc::new(Mutex::new(())),
                app_handle: app.handle().clone(),
            });

            // Start HTTP server in background
            let app_handle = app.handle().clone();
            let http_db_path = db_path.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(http_server::start_http_server(http_db_path, app_handle));
            });

            log::info!("Application started successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::analyze_file_metadata,
            commands::files::get_all_files,
            commands::files::search_files,
            commands::tags::get_all_tags,
            commands::tags::create_tag,
            commands::tags::update_tag,
            commands::tags::delete_tag,
            commands::tags::add_tag_to_file,
            commands::tags::remove_tag_from_file,
            commands::trash::delete_file,
            commands::trash::delete_files,
            commands::indexing::get_setting,
            commands::indexing::set_setting,
            commands::indexing::get_index_paths,
            commands::indexing::get_default_index_path,
            commands::indexing::add_index_path,
            commands::indexing::switch_index_path_and_restart,
            commands::indexing::get_thumbnail_path,
            commands::indexing::get_thumbnail_data_base64,
            commands::indexing::get_thumbnail_cache_path,
            commands::indexing::save_thumbnail_cache,
            commands::indexing::remove_index_path,
            commands::indexing::reindex_all,
            commands::imports::import_file,
            commands::imports::import_image_from_base64,
            commands::imports::start_import_task,
            commands::imports::get_import_task,
            commands::imports::cancel_import_task,
            commands::imports::retry_import_task,
            commands::indexing::sync_index_path,
            commands::folders::get_folder_tree,
            commands::files::get_files_in_folder,
            commands::files::get_file,
            commands::files::update_file_dimensions,
            commands::folders::create_folder,
            commands::folders::move_file,
            commands::folders::move_files,
            commands::folders::scan_folders,
            commands::folders::init_default_folder,
            commands::folders::delete_folder,
            commands::folders::rename_folder,
            commands::files::update_file_metadata,
            commands::files::extract_color,
            commands::files::export_file,
            commands::files::update_file_name,
            commands::folders::init_browser_collection_folder,
            commands::folders::get_browser_collection_folder,
            commands::folders::reorder_folders,
            commands::tags::reorder_tags,
            commands::tags::move_tag,
            commands::folders::move_folder,
            commands::system::copy_file,
            commands::system::copy_files,
            commands::system::copy_files_to_clipboard,
            commands::system::start_drag_files,
            commands::system::open_file,
            commands::system::show_in_explorer,
            commands::system::show_folder_in_explorer,
            commands::trash::get_trash_files,
            commands::trash::restore_file,
            commands::trash::restore_files,
            commands::trash::permanent_delete_file,
            commands::trash::permanent_delete_files,
            commands::trash::empty_trash,
            commands::trash::get_delete_mode,
            commands::trash::set_delete_mode,
            commands::trash::get_trash_count,
            commands::files::filter_files,
            commands::indexing::rebuild_library_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
