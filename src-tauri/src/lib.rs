mod db;
mod indexer;
mod commands;
mod http_server;

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use std::path::{Path, PathBuf};
use std::fs;
use rusqlite::Connection;

/// Get the default index path (Pictures/shiguang)
fn get_default_index_path() -> PathBuf {
    let pictures_dir = dirs::picture_dir().unwrap_or_else(|| PathBuf::from("."));
    pictures_dir.join("shiguang")
}

/// Get the .shiguang directory path for a given index path
fn get_shiguang_dir(index_path: &Path) -> PathBuf {
    index_path.join(".shiguang")
}

/// Get the database path for a given index path
fn get_db_path(index_path: &Path) -> PathBuf {
    get_shiguang_dir(index_path).join("shiguang.db")
}

/// Ensure the .shiguang directory exists
fn ensure_shiguang_dir(index_path: &Path) -> Result<(), String> {
    let shiguang_dir = get_shiguang_dir(index_path);
    if !shiguang_dir.exists() {
        fs::create_dir_all(&shiguang_dir).map_err(|e| format!("Failed to create .shiguang directory: {}", e))?;
    }
    Ok(())
}

/// Migrate database from old location to new location if needed
/// Returns the path to the database to use
fn migrate_or_get_db_path(app_data_dir: &Path) -> Result<PathBuf, String> {
    let old_db_path = app_data_dir.join("shiguang.db");

    // Get index path from old database, or use default
    let index_path = if old_db_path.exists() {
        // Try to read index_path from old database
        match Connection::open(&old_db_path) {
            Ok(conn) => {
                match conn.query_row("SELECT path FROM index_paths LIMIT 1", [], |row| row.get::<_, String>(0)) {
                    Ok(path) => PathBuf::from(path),
                    Err(_) => get_default_index_path(),
                }
            }
            Err(_) => get_default_index_path(),
        }
    } else {
        get_default_index_path()
    };

    // Ensure .shiguang directory exists
    ensure_shiguang_dir(&index_path)?;

    let new_db_path = get_db_path(&index_path);

    // If old database exists but new one doesn't, copy it
    if old_db_path.exists() && !new_db_path.exists() {
        log::info!("Migrating database from {:?} to {:?}", old_db_path, new_db_path);
        fs::copy(&old_db_path, &new_db_path)
            .map_err(|e| format!("Failed to copy old database: {}", e))?;
        log::info!("Database migration completed");
    }

    // If new database already exists (or was just migrated), use it
    // Otherwise create a new one at the new location
    if new_db_path.exists() || old_db_path.exists() {
        Ok(new_db_path)
    } else {
        Ok(new_db_path)
    }
}

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

fn init_browser_collection_folder_internal(db: &db::Database) -> Result<(), String> {
    // Check if browser collection folder already exists
    if db.get_browser_collection_folder().map_err(|e| e.to_string())?.is_some() {
        return Ok(());
    }

    // Get index paths
    let index_paths = db.get_index_paths().map_err(|e| e.to_string())?;

    if let Some(index_path) = index_paths.first() {
        let folder_name = "浏览器采集";
        let folder_path = format!("{}/{}", index_path, folder_name);

        // Create directory in file system
        let path = Path::new(&folder_path);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }

        // Create folder in database as system folder
        db.create_folder(&folder_path, folder_name, None, true)
            .map_err(|e| e.to_string())?;

        log::info!("Created browser collection folder: {}", folder_path);
        Ok(())
    } else {
        Err("No index path configured".to_string())
    }
}

// Track recent imports to prevent duplicate imports within a short time
pub struct RecentImports {
    entries: Vec<(String, Instant)>,
}

impl RecentImports {
    fn new() -> Self {
        RecentImports { entries: Vec::new() }
    }

    fn is_recent(&mut self, source_path: &str, max_age: Duration) -> bool {
        let now = Instant::now();
        // Clean old entries
        self.entries.retain(|(_, time)| now.duration_since(*time) < max_age);
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

    builder.setup(|app| {
        let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
        std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

        // Migrate database from old location to new location if needed
        let db_path = migrate_or_get_db_path(&app_data_dir)
            .expect("Failed to migrate or get database path");

        log::info!("Using database at: {:?}", db_path);

        let database = db::Database::new(&db_path).expect("Failed to initialize database");

        // Clean up dot-folders from database
        if let Err(e) = cleanup_dot_folders(&database) {
            log::warn!("Failed to cleanup dot-folders: {}", e);
        }

        // Initialize browser collection folder (system folder) first
        if let Err(e) = init_browser_collection_folder_internal(&database) {
            log::warn!("Failed to initialize browser collection folder: {}", e);
        }

        app.manage(AppState {
            db: Mutex::new(database),
            app_data_dir: app_data_dir.clone(),
            recent_imports: Mutex::new(RecentImports::new()),
            db_path: db_path.clone(),
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
            commands::get_all_files,
            commands::search_files,
            commands::get_all_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::add_tag_to_file,
            commands::remove_tag_from_file,
            commands::delete_file,
            commands::delete_files,
            commands::get_setting,
            commands::set_setting,
            commands::get_index_paths,
            commands::get_default_index_path,
            commands::add_index_path,
            commands::remove_index_path,
            commands::reindex_all,
            commands::import_file,
            commands::import_image_from_base64,
            commands::get_folder_tree,
            commands::get_files_in_folder,
            commands::get_file,
            commands::create_folder,
            commands::move_file,
            commands::scan_folders,
            commands::init_default_folder,
            commands::delete_folder,
            commands::rename_folder,
            commands::update_file_metadata,
            commands::extract_color,
            commands::export_file,
            commands::update_file_name,
            commands::init_browser_collection_folder,
            commands::get_browser_collection_folder,
            commands::reorder_folders,
            commands::reorder_tags,
            commands::move_folder,
            commands::copy_file,
            commands::open_file,
            commands::show_in_explorer,
            commands::show_folder_in_explorer,
            commands::get_trash_files,
            commands::restore_file,
            commands::restore_files,
            commands::permanent_delete_file,
            commands::permanent_delete_files,
            commands::empty_trash,
            commands::get_delete_mode,
            commands::set_delete_mode,
            commands::get_trash_count,
            commands::filter_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
