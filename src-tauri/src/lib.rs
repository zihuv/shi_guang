mod db;
mod indexer;
mod commands;

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

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
    pub app_data_dir: Mutex<std::path::PathBuf>,
    pub recent_imports: Mutex<RecentImports>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize DevTools plugin first (only in dev builds)
    #[cfg(debug_assertions)]
    let devtools_plugin = tauri_plugin_devtools::init();

    // Initialize env_logger
    let _ = env_logger::try_init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(devtools_plugin);
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder.setup(|app| {
        let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
        std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

        let db_path = app_data_dir.join("shiguang.db");
        let database = db::Database::new(&db_path).expect("Failed to initialize database");

        app.manage(AppState {
            db: Mutex::new(database),
            app_data_dir: Mutex::new(app_data_dir),
            recent_imports: Mutex::new(RecentImports::new()),
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
            commands::create_folder,
            commands::move_file,
            commands::scan_folders,
            commands::init_default_folder,
            commands::delete_folder,
            commands::rename_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
