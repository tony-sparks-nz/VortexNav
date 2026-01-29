// VortexNav - Marine Navigation Application
// Tauri 2.0 Backend

mod catalog_parser;
mod chart_converter;
pub mod cm93;
mod commands;
mod database;
mod download_manager;
mod gps;
mod gpx;
mod licensing;
mod nmea;

use commands::AppState;
use database::ConfigDatabase;
use gps::GpsManager;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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

            // Initialize GPS manager
            let gps_manager = GpsManager::new();

            // Create app state
            let state = AppState {
                config_db,
                gps_manager,
                mbtiles_readers: Mutex::new(HashMap::new()),
                charts_dir,
                cm93_server: Mutex::new(None),
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
            // GEBCO Bathymetry
            commands::get_gebco_status,
            commands::get_gebco_settings,
            commands::save_gebco_settings,
            // Base Nautical Chart
            commands::get_base_nautical_status,
            commands::get_base_nautical_settings,
            commands::save_base_nautical_settings,
            commands::convert_cm93_to_base_nautical,
            // CM93 Vector Chart
            commands::init_cm93_server,
            commands::get_cm93_status,
            commands::get_cm93_tile,
            commands::get_cm93_features,
            commands::get_cm93_settings,
            commands::save_cm93_settings,
            // GPS
            commands::get_gps_data,
            commands::get_gps_status,
            commands::list_serial_ports,
            commands::test_gps_port,
            commands::get_gps_sources,
            commands::save_gps_source,
            commands::delete_gps_source,
            commands::update_gps_priorities,
            commands::start_gps,
            commands::stop_gps,
            commands::get_nmea_buffer,
            commands::clear_nmea_buffer,
            // Waypoints
            commands::get_waypoints,
            commands::create_waypoint,
            commands::update_waypoint,
            commands::update_waypoint_position,
            commands::delete_waypoint,
            commands::toggle_waypoint_hidden,
            // Routes
            commands::get_routes,
            commands::get_route,
            commands::create_route,
            commands::update_route,
            commands::delete_route,
            commands::duplicate_route,
            commands::reverse_route,
            commands::set_active_route,
            commands::toggle_route_hidden,
            commands::get_route_exclusive_waypoint_count,
            commands::delete_route_with_waypoints,
            // Route Tags
            commands::get_route_tags,
            commands::create_route_tag,
            commands::update_route_tag,
            commands::delete_route_tag,
            // Route Statistics
            commands::calculate_route_statistics,
            // Tracks
            commands::get_tracks,
            commands::get_track,
            commands::get_track_with_points,
            commands::get_tracks_with_points,
            commands::start_track_recording,
            commands::stop_track_recording,
            commands::get_recording_track,
            commands::add_track_point,
            commands::update_track,
            commands::toggle_track_hidden,
            commands::delete_track,
            commands::get_track_points,
            commands::get_track_gpx_string,
            commands::export_track_gpx,
            commands::convert_track_to_route,
            // GPX Import/Export
            commands::import_gpx,
            commands::export_route_gpx,
            commands::export_routes_gpx,
            commands::get_route_gpx_string,
            commands::get_route_summary_text,
            // Charts/MBTiles
            commands::list_charts,
            commands::get_tile,
            commands::get_charts_directory,
            commands::import_chart,
            commands::remove_chart,
            commands::save_chart_layer_state,
            commands::get_chart_layer_states,
            commands::save_chart_custom_metadata,
            commands::get_chart_custom_metadata,
            commands::get_all_chart_custom_metadata,
            // Catalogs
            commands::import_catalog_file,
            commands::import_catalog_url,
            commands::list_catalogs,
            commands::get_catalog,
            commands::delete_catalog,
            commands::list_catalog_charts,
            commands::get_catalog_chart,
            commands::download_catalog_chart,
            commands::refresh_catalog,
            commands::check_gdal,
            commands::import_charts_from_folder,
            commands::scan_folder_for_import,
            commands::import_selected_charts,
            commands::tag_charts_from_bsb,
            commands::fix_chart_bounds,
            commands::recalculate_chart_bounds_from_tiles,
            // Utilities
            commands::get_app_data_dir,
            // Licensing Agent
            licensing::la_check_connection,
            licensing::la_get_device_status,
            licensing::la_register_device,
            licensing::la_sync,
            licensing::la_check_entitlement,
            licensing::la_list_entitlements,
            licensing::la_list_packs,
            licensing::la_get_pack_catalog,
            licensing::la_request_pack,
            licensing::la_get_pack_status,
            licensing::la_delete_pack,
            licensing::la_get_tile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
