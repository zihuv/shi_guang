mod db;
mod indexer;
mod commands;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub app_data_dir: Mutex<std::path::PathBuf>,
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

        let db_path = app_data_dir.join("shi_guang.db");
        let database = db::Database::new(&db_path).expect("Failed to initialize database");

        app.manage(AppState {
            db: Mutex::new(database),
            app_data_dir: Mutex::new(app_data_dir),
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
            commands::get_setting,
            commands::set_setting,
            commands::get_index_paths,
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
