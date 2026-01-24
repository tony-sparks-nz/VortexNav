// VortexNav - Marine Navigation Application
// Tauri 2.0 Backend

mod commands;
mod database;
mod nmea;

use commands::AppState;
use database::ConfigDatabase;
use nmea::GpsState;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Get app data directory for database storage
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");

            // Charts directory for MBTiles files
            let charts_dir = app_data_dir.join("charts");
            std::fs::create_dir_all(&charts_dir).ok();

            // Initialize configuration database
            let config_db = ConfigDatabase::new(&app_data_dir)
                .expect("Failed to initialize configuration database");

            // Initialize GPS state
            let gps = GpsState::new();

            // Create app state
            let state = AppState {
                config_db,
                gps,
                mbtiles_readers: Mutex::new(HashMap::new()),
                charts_dir,
            };

            // Manage state in Tauri
            app.manage(state);

            log::info!("VortexNav initialized. Data directory: {:?}", app_data_dir);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            commands::get_settings,
            commands::save_settings,
            // GPS
            commands::get_gps_data,
            commands::update_gps_data,
            // Waypoints
            commands::get_waypoints,
            commands::create_waypoint,
            commands::delete_waypoint,
            // Charts/MBTiles
            commands::list_charts,
            commands::get_tile,
            commands::get_charts_directory,
            // Serial ports
            commands::list_serial_ports,
            // Utilities
            commands::get_app_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
