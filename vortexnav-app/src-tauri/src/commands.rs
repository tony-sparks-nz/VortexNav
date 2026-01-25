// Tauri commands for frontend communication

use crate::catalog_parser::{parse_catalog_file, parse_catalog_xml};
use crate::chart_converter::{check_gdal_available, convert_to_mbtiles, get_mbtiles_output_path, write_mbtiles_metadata, GdalInfo};
use crate::database::{AppSettings, CatalogChart, ChartCatalog, ChartLayerState, ConfigDatabase, GpsSourceRecord, MBTilesMetadata, MBTilesReader, Waypoint};
use crate::download_manager::{download_file, extract_zip, categorize_extracted_files, fetch_catalog_url, filename_from_url, DownloadState};
use crate::gps::{DetectedPort, GpsManager, GpsSourceConfig, GpsSourceStatus, GpsSourceType};
use crate::nmea::GpsData;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

// App state managed by Tauri
pub struct AppState {
    pub config_db: ConfigDatabase,
    pub gps_manager: GpsManager,
    pub mbtiles_readers: Mutex<HashMap<String, MBTilesReader>>,
    pub charts_dir: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> CommandResult<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }

    pub fn err(msg: &str) -> Self {
        Self { success: false, data: None, error: Some(msg.to_string()) }
    }
}

// ============ Settings Commands ============

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CommandResult<AppSettings> {
    match state.config_db.get_all_settings() {
        Ok(settings) => CommandResult::ok(settings),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn save_settings(settings: AppSettings, state: State<AppState>) -> CommandResult<()> {
    match state.config_db.save_all_settings(&settings) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

// ============ GPS Commands ============

#[tauri::command]
pub fn get_gps_data(state: State<AppState>) -> CommandResult<GpsData> {
    CommandResult::ok(state.gps_manager.get_data())
}

#[tauri::command]
pub fn get_gps_status(state: State<AppState>) -> CommandResult<GpsSourceStatus> {
    CommandResult::ok(state.gps_manager.get_status())
}

#[tauri::command]
pub fn list_serial_ports() -> CommandResult<Vec<DetectedPort>> {
    match GpsManager::list_serial_ports() {
        Ok(ports) => CommandResult::ok(ports),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn test_gps_port(port_name: String, baud_rate: u32) -> CommandResult<bool> {
    match GpsManager::test_port(&port_name, baud_rate, 3000) {
        Ok(is_gps) => CommandResult::ok(is_gps),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn get_gps_sources(state: State<AppState>) -> CommandResult<Vec<GpsSourceConfig>> {
    // Load from database and convert to config
    match state.config_db.get_gps_sources() {
        Ok(records) => {
            let configs: Vec<GpsSourceConfig> = records
                .into_iter()
                .map(|r| GpsSourceConfig {
                    id: r.id,
                    name: r.name,
                    source_type: match r.source_type.as_str() {
                        "serial_port" => GpsSourceType::SerialPort,
                        "tcp_stream" => GpsSourceType::TcpStream,
                        "simulated" => GpsSourceType::Simulated,
                        _ => GpsSourceType::SerialPort,
                    },
                    port_name: r.port_name,
                    baud_rate: r.baud_rate,
                    enabled: r.enabled,
                    priority: r.priority,
                })
                .collect();
            CommandResult::ok(configs)
        }
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn save_gps_source(source: GpsSourceConfig, state: State<AppState>) -> CommandResult<()> {
    let record = GpsSourceRecord {
        id: source.id,
        name: source.name,
        source_type: match source.source_type {
            GpsSourceType::SerialPort => "serial_port".to_string(),
            GpsSourceType::TcpStream => "tcp_stream".to_string(),
            GpsSourceType::Simulated => "simulated".to_string(),
        },
        port_name: source.port_name,
        baud_rate: source.baud_rate,
        enabled: source.enabled,
        priority: source.priority,
    };

    match state.config_db.save_gps_source(&record) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn delete_gps_source(id: String, state: State<AppState>) -> CommandResult<()> {
    match state.config_db.delete_gps_source(&id) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn update_gps_priorities(priorities: Vec<(String, i32)>, state: State<AppState>) -> CommandResult<()> {
    for (id, priority) in priorities {
        if let Err(e) = state.config_db.update_gps_source_priority(&id, priority) {
            return CommandResult::err(&e.to_string());
        }
    }
    CommandResult::ok(())
}

#[tauri::command]
pub fn start_gps(state: State<AppState>) -> CommandResult<()> {
    // Load sources from database
    let sources = match state.config_db.get_gps_sources() {
        Ok(records) => records
            .into_iter()
            .map(|r| GpsSourceConfig {
                id: r.id,
                name: r.name,
                source_type: match r.source_type.as_str() {
                    "serial_port" => GpsSourceType::SerialPort,
                    "tcp_stream" => GpsSourceType::TcpStream,
                    "simulated" => GpsSourceType::Simulated,
                    _ => GpsSourceType::SerialPort,
                },
                port_name: r.port_name,
                baud_rate: r.baud_rate,
                enabled: r.enabled,
                priority: r.priority,
            })
            .collect(),
        Err(e) => return CommandResult::err(&e.to_string()),
    };

    // Set sources and start
    state.gps_manager.set_sources(sources);

    match state.gps_manager.start() {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn stop_gps(state: State<AppState>) -> CommandResult<()> {
    state.gps_manager.stop();
    CommandResult::ok(())
}

#[tauri::command]
pub fn get_nmea_buffer(state: State<AppState>) -> CommandResult<Vec<String>> {
    CommandResult::ok(state.gps_manager.get_nmea_buffer())
}

#[tauri::command]
pub fn clear_nmea_buffer(state: State<AppState>) -> CommandResult<()> {
    state.gps_manager.clear_nmea_buffer();
    CommandResult::ok(())
}

// ============ Waypoint Commands ============

#[tauri::command]
pub fn get_waypoints(state: State<AppState>) -> CommandResult<Vec<Waypoint>> {
    match state.config_db.get_waypoints() {
        Ok(waypoints) => CommandResult::ok(waypoints),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn create_waypoint(waypoint: Waypoint, state: State<AppState>) -> CommandResult<i64> {
    match state.config_db.create_waypoint(&waypoint) {
        Ok(id) => CommandResult::ok(id),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn update_waypoint(waypoint: Waypoint, state: State<AppState>) -> CommandResult<()> {
    match state.config_db.update_waypoint(&waypoint) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn delete_waypoint(id: i64, state: State<AppState>) -> CommandResult<()> {
    match state.config_db.delete_waypoint(id) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

// ============ MBTiles Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub metadata: MBTilesMetadata,
}

#[tauri::command]
pub fn list_charts(state: State<AppState>) -> CommandResult<Vec<ChartInfo>> {
    let charts_dir = &state.charts_dir;

    if !charts_dir.exists() {
        // Create charts directory if it doesn't exist
        if let Err(e) = std::fs::create_dir_all(charts_dir) {
            return CommandResult::err(&format!("Failed to create charts directory: {}", e));
        }
        return CommandResult::ok(vec![]);
    }

    let mut charts = Vec::new();

    if let Ok(entries) = std::fs::read_dir(charts_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "mbtiles") {
                let path_str = path.to_string_lossy().to_string();
                if let Ok(reader) = MBTilesReader::open(&path_str) {
                    if let Ok(metadata) = reader.get_metadata() {
                        let name = metadata.name.clone().unwrap_or_else(|| {
                            path.file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_else(|| "Unknown".to_string())
                        });

                        let id = path.file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                        charts.push(ChartInfo {
                            id,
                            name,
                            path: path_str,
                            metadata,
                        });
                    }
                }
            }
        }
    }

    CommandResult::ok(charts)
}

#[tauri::command]
pub fn get_tile(
    chart_id: String,
    z: u32,
    x: u32,
    y: u32,
    state: State<AppState>,
) -> Result<Vec<u8>, String> {
    let mut readers = state.mbtiles_readers.lock().unwrap();

    // Check if we have a cached reader
    if !readers.contains_key(&chart_id) {
        // Find the chart file
        let charts_dir = &state.charts_dir;
        let chart_path = charts_dir.join(format!("{}.mbtiles", chart_id));

        if !chart_path.exists() {
            return Err(format!("Chart not found: {}", chart_id));
        }

        let reader = MBTilesReader::open(&chart_path.to_string_lossy())
            .map_err(|e| e.to_string())?;

        readers.insert(chart_id.clone(), reader);
    }

    let reader = readers.get(&chart_id).unwrap();
    reader.get_tile(z, x, y).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_charts_directory(state: State<AppState>) -> CommandResult<String> {
    CommandResult::ok(state.charts_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_chart(source_path: String, state: State<AppState>) -> CommandResult<ChartInfo> {
    let source = std::path::Path::new(&source_path);

    // Validate source file exists
    if !source.exists() {
        return CommandResult::err(&format!("Source file not found: {}", source_path));
    }

    // Validate it's an mbtiles file
    if source.extension().map_or(true, |ext| ext != "mbtiles") {
        return CommandResult::err("File must have .mbtiles extension");
    }

    // Validate it's a valid MBTiles database
    let reader = match MBTilesReader::open(&source_path) {
        Ok(r) => r,
        Err(e) => return CommandResult::err(&format!("Invalid MBTiles file: {}", e)),
    };

    let metadata = match reader.get_metadata() {
        Ok(m) => m,
        Err(e) => return CommandResult::err(&format!("Failed to read MBTiles metadata: {}", e)),
    };

    // Get file name for destination
    let file_name = source.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.mbtiles", uuid::Uuid::new_v4()));

    let dest_path = state.charts_dir.join(&file_name);

    // Check if file already exists in charts directory
    if dest_path.exists() {
        // File already exists, just return its info
        let id = dest_path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let name = metadata.name.clone().unwrap_or_else(|| id.clone());

        return CommandResult::ok(ChartInfo {
            id,
            name,
            path: dest_path.to_string_lossy().to_string(),
            metadata,
        });
    }

    // Copy file to charts directory
    if let Err(e) = std::fs::copy(&source_path, &dest_path) {
        return CommandResult::err(&format!("Failed to copy chart file: {}", e));
    }

    let id = dest_path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let name = metadata.name.clone().unwrap_or_else(|| id.clone());

    // Create default layer state
    let layer_state = ChartLayerState {
        chart_id: id.clone(),
        enabled: true,
        opacity: 1.0,
        z_order: 0,
    };

    if let Err(e) = state.config_db.save_chart_layer_state(&layer_state) {
        log::warn!("Failed to save chart layer state: {}", e);
    }

    CommandResult::ok(ChartInfo {
        id,
        name,
        path: dest_path.to_string_lossy().to_string(),
        metadata,
    })
}

#[tauri::command]
pub fn remove_chart(chart_id: String, state: State<AppState>) -> CommandResult<()> {
    let chart_path = state.charts_dir.join(format!("{}.mbtiles", chart_id));

    // Remove from cache first
    {
        let mut readers = state.mbtiles_readers.lock().unwrap();
        readers.remove(&chart_id);
    }

    // Delete the file
    if chart_path.exists() {
        if let Err(e) = std::fs::remove_file(&chart_path) {
            return CommandResult::err(&format!("Failed to delete chart file: {}", e));
        }
    }

    // Delete layer state
    if let Err(e) = state.config_db.delete_chart_layer_state(&chart_id) {
        log::warn!("Failed to delete chart layer state: {}", e);
    }

    // Delete from registry
    if let Err(e) = state.config_db.delete_mbtiles_registry(&chart_id) {
        log::warn!("Failed to delete chart registry entry: {}", e);
    }

    CommandResult::ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChartLayerStateInput {
    pub chart_id: String,
    pub enabled: bool,
    pub opacity: f64,
    pub z_order: i32,
}

#[tauri::command]
pub fn save_chart_layer_state(layer_state: ChartLayerStateInput, state: State<AppState>) -> CommandResult<()> {
    let db_state = ChartLayerState {
        chart_id: layer_state.chart_id,
        enabled: layer_state.enabled,
        opacity: layer_state.opacity,
        z_order: layer_state.z_order,
    };

    match state.config_db.save_chart_layer_state(&db_state) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn get_chart_layer_states(state: State<AppState>) -> CommandResult<Vec<ChartLayerState>> {
    match state.config_db.get_chart_layer_states() {
        Ok(states) => CommandResult::ok(states),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

// ============ Utility Commands ============

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> CommandResult<String> {
    match app.path().app_data_dir() {
        Ok(path) => CommandResult::<String>::ok(path.to_string_lossy().to_string()),
        Err(e) => CommandResult::<String>::err(&e.to_string()),
    }
}

// ============ Catalog Commands ============

#[tauri::command]
pub fn import_catalog_file(file_path: String, state: State<AppState>) -> CommandResult<ChartCatalog> {
    // Parse the catalog file
    let parsed = match parse_catalog_file(&file_path) {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Failed to parse catalog: {}", e)),
    };

    // Create catalog record
    let catalog = ChartCatalog {
        id: None,
        name: parsed.name.clone(),
        catalog_type: parsed.catalog_type.clone(),
        source_type: "file".to_string(),
        source_path: file_path,
        imported_at: None,
        last_refreshed: None,
        chart_count: Some(parsed.charts.len() as i64),
    };

    // Save catalog to database
    let catalog_id = match state.config_db.create_catalog(&catalog) {
        Ok(id) => id,
        Err(e) => return CommandResult::err(&format!("Failed to save catalog: {}", e)),
    };

    // Save charts to database
    for chart in &parsed.charts {
        let catalog_chart = CatalogChart {
            id: None,
            catalog_id,
            chart_id: chart.chart_id.clone(),
            title: chart.title.clone(),
            chart_type: chart.chart_type.clone(),
            format: chart.format.clone(),
            scale: chart.scale,
            status: chart.status.clone(),
            download_url: chart.download_url.clone(),
            file_size: chart.file_size,
            last_updated: chart.last_updated.clone(),
            bounds: chart.bounds.clone(),
            download_status: "available".to_string(),
            download_progress: 0,
            download_path: None,
            mbtiles_path: None,
            error_message: None,
        };

        if let Err(e) = state.config_db.create_catalog_chart(&catalog_chart) {
            log::warn!("Failed to save chart {}: {}", chart.chart_id, e);
        }
    }

    // Return the created catalog with ID
    let mut result = catalog;
    result.id = Some(catalog_id);
    CommandResult::ok(result)
}

#[tauri::command]
pub async fn import_catalog_url(url: String, state: State<'_, AppState>) -> Result<CommandResult<ChartCatalog>, ()> {
    // Fetch the catalog XML
    let xml_content = match fetch_catalog_url(&url).await {
        Ok(content) => content,
        Err(e) => return Ok(CommandResult::err(&format!("Failed to fetch catalog: {}", e))),
    };

    // Parse the catalog
    let parsed = match parse_catalog_xml(&xml_content) {
        Ok(c) => c,
        Err(e) => return Ok(CommandResult::err(&format!("Failed to parse catalog: {}", e))),
    };

    // Create catalog record
    let catalog = ChartCatalog {
        id: None,
        name: parsed.name.clone(),
        catalog_type: parsed.catalog_type.clone(),
        source_type: "url".to_string(),
        source_path: url,
        imported_at: None,
        last_refreshed: None,
        chart_count: Some(parsed.charts.len() as i64),
    };

    // Save catalog to database
    let catalog_id = match state.config_db.create_catalog(&catalog) {
        Ok(id) => id,
        Err(e) => return Ok(CommandResult::err(&format!("Failed to save catalog: {}", e))),
    };

    // Save charts to database
    for chart in &parsed.charts {
        let catalog_chart = CatalogChart {
            id: None,
            catalog_id,
            chart_id: chart.chart_id.clone(),
            title: chart.title.clone(),
            chart_type: chart.chart_type.clone(),
            format: chart.format.clone(),
            scale: chart.scale,
            status: chart.status.clone(),
            download_url: chart.download_url.clone(),
            file_size: chart.file_size,
            last_updated: chart.last_updated.clone(),
            bounds: chart.bounds.clone(),
            download_status: "available".to_string(),
            download_progress: 0,
            download_path: None,
            mbtiles_path: None,
            error_message: None,
        };

        if let Err(e) = state.config_db.create_catalog_chart(&catalog_chart) {
            log::warn!("Failed to save chart {}: {}", chart.chart_id, e);
        }
    }

    // Return the created catalog with ID
    let mut result = catalog;
    result.id = Some(catalog_id);
    Ok(CommandResult::ok(result))
}

#[tauri::command]
pub fn list_catalogs(state: State<AppState>) -> CommandResult<Vec<ChartCatalog>> {
    match state.config_db.get_catalogs() {
        Ok(catalogs) => CommandResult::ok(catalogs),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn get_catalog(catalog_id: i64, state: State<AppState>) -> CommandResult<Option<ChartCatalog>> {
    match state.config_db.get_catalog(catalog_id) {
        Ok(catalog) => CommandResult::ok(catalog),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn delete_catalog(catalog_id: i64, state: State<AppState>) -> CommandResult<()> {
    match state.config_db.delete_catalog(catalog_id) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn list_catalog_charts(catalog_id: i64, state: State<AppState>) -> CommandResult<Vec<CatalogChart>> {
    match state.config_db.get_catalog_charts(catalog_id) {
        Ok(charts) => CommandResult::ok(charts),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub fn get_catalog_chart(chart_id: i64, state: State<AppState>) -> CommandResult<Option<CatalogChart>> {
    match state.config_db.get_catalog_chart(chart_id) {
        Ok(chart) => CommandResult::ok(chart),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

#[tauri::command]
pub async fn download_catalog_chart(
    chart_db_id: i64,
    state: State<'_, AppState>,
) -> Result<CommandResult<CatalogChart>, ()> {
    // Get the chart from database
    let chart = match state.config_db.get_catalog_chart(chart_db_id) {
        Ok(Some(c)) => c,
        Ok(None) => return Ok(CommandResult::err("Chart not found")),
        Err(e) => return Ok(CommandResult::err(&e.to_string())),
    };

    // Update status to downloading
    if let Err(e) = state.config_db.update_chart_download_status(
        chart_db_id, "downloading", 0, None, None, None
    ) {
        return Ok(CommandResult::err(&e.to_string()));
    }

    // Create downloads directory
    let downloads_dir = state.charts_dir.join("downloads");
    if let Err(e) = std::fs::create_dir_all(&downloads_dir) {
        return Ok(CommandResult::err(&format!("Failed to create downloads directory: {}", e)));
    }

    // Download the file
    let file_name = filename_from_url(&chart.download_url);
    let download_path = downloads_dir.join(&file_name);

    let progress = Arc::new(TokioMutex::new(DownloadState::default()));

    match download_file(&chart.download_url, &download_path, progress).await {
        Ok(_) => {
            // Update status to downloaded
            let _ = state.config_db.update_chart_download_status(
                chart_db_id,
                "downloaded",
                chart.file_size.unwrap_or(0),
                Some(download_path.to_string_lossy().as_ref()),
                None,
                None,
            );
        }
        Err(e) => {
            let _ = state.config_db.update_chart_download_status(
                chart_db_id, "failed", 0, None, None, Some(&e.to_string())
            );
            return Ok(CommandResult::err(&format!("Download failed: {}", e)));
        }
    }

    // Extract if it's a ZIP file
    if file_name.to_lowercase().ends_with(".zip") {
        let extract_dir = downloads_dir.join(&chart.chart_id);

        match extract_zip(&download_path, &extract_dir) {
            Ok(files) => {
                let categorized = categorize_extracted_files(&files);

                // Check if GDAL is available for conversion
                let gdal_info = check_gdal_available();

                // Process extracted files
                let mut mbtiles_path: Option<PathBuf> = None;

                // First check for MBTiles files (no conversion needed)
                if let Some(mbtiles_file) = categorized.mbtiles_files.first() {
                    let dest = get_mbtiles_output_path(&state.charts_dir, &chart.chart_id);
                    if let Err(e) = std::fs::copy(mbtiles_file, &dest) {
                        return Ok(CommandResult::err(&format!("Failed to copy MBTiles: {}", e)));
                    }
                    mbtiles_path = Some(dest);
                }
                // Convert BSB files if GDAL is available
                else if !categorized.bsb_files.is_empty() {
                    if gdal_info.available {
                        let _ = state.config_db.update_chart_download_status(
                            chart_db_id, "converting", 0, None, None, None
                        );

                        if let Some(bsb_file) = categorized.bsb_files.first() {
                            let dest = get_mbtiles_output_path(&state.charts_dir, &chart.chart_id);
                            match convert_to_mbtiles(bsb_file, &dest) {
                                Ok(path) => mbtiles_path = Some(path),
                                Err(e) => {
                                    let _ = state.config_db.update_chart_download_status(
                                        chart_db_id, "failed", 0, None, None, Some(&e.to_string())
                                    );
                                    return Ok(CommandResult::err(&format!("Conversion failed: {}", e)));
                                }
                            }
                        }
                    } else {
                        // Mark as needing conversion
                        let _ = state.config_db.update_chart_download_status(
                            chart_db_id, "needs_conversion", 0,
                            Some(extract_dir.to_string_lossy().as_ref()),
                            None,
                            Some("GDAL not installed - chart requires conversion")
                        );
                        // Return updated chart info
                        match state.config_db.get_catalog_chart(chart_db_id) {
                            Ok(Some(updated)) => return Ok(CommandResult::ok(updated)),
                            _ => return Ok(CommandResult::err("Failed to get updated chart")),
                        }
                    }
                }
                // Convert S57 files if GDAL is available
                else if !categorized.s57_files.is_empty() {
                    if gdal_info.available {
                        let _ = state.config_db.update_chart_download_status(
                            chart_db_id, "converting", 0, None, None, None
                        );

                        if let Some(s57_file) = categorized.s57_files.first() {
                            let dest = get_mbtiles_output_path(&state.charts_dir, &chart.chart_id);
                            match convert_to_mbtiles(s57_file, &dest) {
                                Ok(path) => mbtiles_path = Some(path),
                                Err(e) => {
                                    let _ = state.config_db.update_chart_download_status(
                                        chart_db_id, "failed", 0, None, None, Some(&e.to_string())
                                    );
                                    return Ok(CommandResult::err(&format!("Conversion failed: {}", e)));
                                }
                            }
                        }
                    } else {
                        // Mark as needing conversion
                        let _ = state.config_db.update_chart_download_status(
                            chart_db_id, "needs_conversion", 0,
                            Some(extract_dir.to_string_lossy().as_ref()),
                            None,
                            Some("GDAL not installed - chart requires conversion")
                        );
                        // Return updated chart info
                        match state.config_db.get_catalog_chart(chart_db_id) {
                            Ok(Some(updated)) => return Ok(CommandResult::ok(updated)),
                            _ => return Ok(CommandResult::err("Failed to get updated chart")),
                        }
                    }
                }

                // Update to ready if we have an MBTiles file
                if let Some(path) = mbtiles_path {
                    let _ = state.config_db.update_chart_download_status(
                        chart_db_id, "ready", chart.file_size.unwrap_or(0),
                        Some(extract_dir.to_string_lossy().as_ref()),
                        Some(path.to_string_lossy().as_ref()),
                        None
                    );

                    // Create chart layer state
                    let layer_state = ChartLayerState {
                        chart_id: chart.chart_id.clone(),
                        enabled: true,
                        opacity: 1.0,
                        z_order: 0,
                    };
                    let _ = state.config_db.save_chart_layer_state(&layer_state);
                }
            }
            Err(e) => {
                let _ = state.config_db.update_chart_download_status(
                    chart_db_id, "failed", 0, None, None, Some(&format!("Extraction failed: {}", e))
                );
                return Ok(CommandResult::err(&format!("Extraction failed: {}", e)));
            }
        }
    }

    // Return updated chart
    match state.config_db.get_catalog_chart(chart_db_id) {
        Ok(Some(updated)) => Ok(CommandResult::ok(updated)),
        Ok(None) => Ok(CommandResult::err("Chart not found after update")),
        Err(e) => Ok(CommandResult::err(&e.to_string())),
    }
}

#[tauri::command]
pub fn check_gdal() -> CommandResult<GdalInfo> {
    CommandResult::ok(check_gdal_available())
}

/// Result of importing charts from a folder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderImportResult {
    pub total_found: usize,
    pub converted: usize,
    pub failed: usize,
    pub skipped: usize,
    pub imported_charts: Vec<ChartInfo>,
    pub errors: Vec<String>,
}

/// Scan a folder recursively for chart files
fn scan_folder_for_charts(folder: &std::path::Path) -> Vec<PathBuf> {
    let mut chart_files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories
                chart_files.extend(scan_folder_for_charts(&path));
            } else if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                // Check for chart file extensions
                // Note: .bsb files are catalog/index files (text metadata), not chart images
                // Only .kap, .cap, and .000 contain raster/vector data GDAL can convert
                if matches!(ext_lower.as_str(), "kap" | "cap" | "000") {
                    chart_files.push(path);
                }
            }
        }
    }

    chart_files
}

/// Information about a scanned chart file (before import)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedChartFile {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub parent_folder: String,
    pub already_imported: bool,
}

/// Result of scanning a folder for chart files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFolderResult {
    pub files: Vec<ScannedChartFile>,
    pub total_count: usize,
    pub already_imported_count: usize,
}

/// Scan a folder for chart files and return info without importing
#[tauri::command]
pub async fn scan_folder_for_import(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<CommandResult<ScanFolderResult>, ()> {
    let folder = std::path::PathBuf::from(&folder_path);

    // Validate folder exists
    if !folder.exists() || !folder.is_dir() {
        return Ok(CommandResult::err(&format!("Folder not found: {}", folder_path)));
    }

    let charts_dir = state.charts_dir.clone();

    // Run scan in blocking task
    let result = tokio::task::spawn_blocking(move || {
        let chart_files = scan_folder_for_charts(&folder);
        let mut scanned_files = Vec::new();
        let mut already_imported_count = 0;

        for path in chart_files {
            let name = path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let extension = path.extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            let size_bytes = std::fs::metadata(&path)
                .map(|m| m.len())
                .unwrap_or(0);

            let parent_folder = path.parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            // Check if already imported (MBTiles file exists)
            let mbtiles_name = format!("{}.mbtiles", name);
            let mbtiles_path = charts_dir.join(&mbtiles_name);
            let already_imported = mbtiles_path.exists();

            if already_imported {
                already_imported_count += 1;
            }

            scanned_files.push(ScannedChartFile {
                path: path.to_string_lossy().to_string(),
                name,
                extension,
                size_bytes,
                parent_folder,
                already_imported,
            });
        }

        // Sort by name
        scanned_files.sort_by(|a, b| a.name.cmp(&b.name));

        ScanFolderResult {
            total_count: scanned_files.len(),
            already_imported_count,
            files: scanned_files,
        }
    }).await.unwrap();

    Ok(CommandResult::ok(result))
}

/// Result of a single chart conversion (for parallel processing)
struct ConversionResult {
    file_name: String,
    success: bool,
    chart_info: Option<ChartInfo>,
    error: Option<String>,
    skipped: bool,
}

/// Import specific chart files by path with parallel processing
#[tauri::command]
pub async fn import_selected_charts(
    file_paths: Vec<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandResult<FolderImportResult>, ()> {
    if file_paths.is_empty() {
        return Ok(CommandResult::err("No files selected for import"));
    }

    // Check if GDAL is available
    let gdal_info = check_gdal_available();
    if !gdal_info.available {
        return Ok(CommandResult::err("GDAL is required to convert chart files. Please install GDAL first."));
    }

    let charts_dir = state.charts_dir.clone();
    let app_handle_clone = app_handle.clone();

    // Emit scanning phase
    let _ = app_handle.emit("import-progress", ImportProgress {
        phase: "scanning".to_string(),
        current: 0,
        total: file_paths.len(),
        current_file: "Scanning for BSB metadata...".to_string(),
        converted: 0,
        skipped: 0,
        failed: 0,
    });

    // Run the heavy work in a blocking task
    let result = tokio::task::spawn_blocking(move || {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::thread;

        let mut result = FolderImportResult {
            total_found: file_paths.len(),
            converted: 0,
            failed: 0,
            skipped: 0,
            imported_charts: Vec::new(),
            errors: Vec::new(),
        };

        // Step 1: Collect unique parent directories to scan for BSB files
        // Scan up to 4 levels up to find BSB files in typical folder structures
        let mut parent_dirs: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
        for file_path_str in &file_paths {
            let file_path = PathBuf::from(file_path_str);
            let mut current = file_path.parent();
            for _ in 0..4 {
                if let Some(dir) = current {
                    parent_dirs.insert(dir.to_path_buf());
                    current = dir.parent();
                } else {
                    break;
                }
            }
        }

        // Step 2: Scan all parent directories for BSB files and build metadata mapping
        let mut metadata_map: HashMap<String, BsbChartMetadata> = HashMap::new();
        log::info!("Scanning {} directories for BSB metadata files", parent_dirs.len());

        let mut total_bsb_found = 0;
        for dir in &parent_dirs {
            let bsb_files = scan_folder_for_bsb_files(dir);
            total_bsb_found += bsb_files.len();
            for bsb_path in bsb_files {
                log::debug!("Parsing BSB file: {:?}", bsb_path);
                let metadata_list = parse_bsb_full(&bsb_path);
                log::debug!("  Found {} chart entries", metadata_list.len());
                for meta in metadata_list {
                    metadata_map.insert(meta.chart_id.clone(), meta);
                }
            }
        }

        log::info!("Found {} BSB files with {} chart metadata entries", total_bsb_found, metadata_map.len());

        // Step 3: Convert charts in parallel batches
        // Use 2-4 parallel conversions to balance CPU usage with I/O
        // Each GDAL process already uses multi-threading internally
        let num_threads = std::cmp::min(4, std::cmp::max(2, num_cpus::get() / 2));
        log::info!("Using {} parallel conversion threads", num_threads);

        // Shared counters for progress tracking
        let completed = Arc::new(AtomicUsize::new(0));
        let converted_count = Arc::new(AtomicUsize::new(0));
        let skipped_count = Arc::new(AtomicUsize::new(0));
        let failed_count = Arc::new(AtomicUsize::new(0));

        // Process in batches
        let metadata_map = Arc::new(metadata_map);
        let charts_dir = Arc::new(charts_dir);
        let total = file_paths.len();

        // Convert paths to work items
        let work_items: Vec<(usize, String)> = file_paths.into_iter().enumerate().collect();

        // Process in parallel using thread pool
        let results: Vec<ConversionResult> = work_items
            .chunks(num_threads)
            .flat_map(|batch| {
                let handles: Vec<_> = batch.iter().map(|(idx, file_path_str)| {
                    let file_path_str = file_path_str.clone();
                    let metadata_map = Arc::clone(&metadata_map);
                    let charts_dir = Arc::clone(&charts_dir);
                    let app_handle = app_handle_clone.clone();
                    let completed = Arc::clone(&completed);
                    let converted_count = Arc::clone(&converted_count);
                    let skipped_count = Arc::clone(&skipped_count);
                    let failed_count = Arc::clone(&failed_count);
                    let idx = *idx;

                    thread::spawn(move || {
                        let file_path = PathBuf::from(&file_path_str);
                        let file_name = file_path.file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| format!("chart_{}", idx));

                        // Emit progress
                        let current = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = app_handle.emit("import-progress", ImportProgress {
                            phase: "converting".to_string(),
                            current,
                            total,
                            current_file: file_name.clone(),
                            converted: converted_count.load(Ordering::SeqCst),
                            skipped: skipped_count.load(Ordering::SeqCst),
                            failed: failed_count.load(Ordering::SeqCst),
                        });

                        // Check if file exists
                        if !file_path.exists() {
                            failed_count.fetch_add(1, Ordering::SeqCst);
                            return ConversionResult {
                                file_name,
                                success: false,
                                chart_info: None,
                                error: Some(format!("File not found: {}", file_path_str)),
                                skipped: false,
                            };
                        }

                        // Check if already imported
                        let mbtiles_name = format!("{}.mbtiles", file_name);
                        let mbtiles_path = charts_dir.join(&mbtiles_name);

                        if mbtiles_path.exists() {
                            log::info!("Skipping {} - already imported", file_name);
                            skipped_count.fetch_add(1, Ordering::SeqCst);
                            return ConversionResult {
                                file_name,
                                success: true,
                                chart_info: None,
                                error: None,
                                skipped: true,
                            };
                        }

                        // Convert the chart
                        log::info!("Converting chart: {} -> {}", file_path.display(), mbtiles_path.display());

                        match convert_to_mbtiles(&file_path, &mbtiles_path) {
                            Ok(_) => {
                                converted_count.fetch_add(1, Ordering::SeqCst);

                                // Apply BSB metadata (chart title, description) if available
                                // Use uppercase for case-insensitive matching
                                let file_name_upper = file_name.to_uppercase();
                                if let Some(meta) = metadata_map.get(&file_name_upper) {
                                    // Build full title with chart type suffix for insets
                                    let full_title = if let Some(ref ty) = meta.chart_type {
                                        if ty.eq_ignore_ascii_case("Inset") {
                                            format!("{} (Inset)", meta.title)
                                        } else {
                                            meta.title.clone()
                                        }
                                    } else {
                                        meta.title.clone()
                                    };

                                    log::info!("Applying BSB metadata for {}: title='{}', edition={:?}",
                                              file_name, full_title, meta.edition_date);

                                    // Write title
                                    if let Err(e) = write_mbtiles_metadata(&mbtiles_path, "name", &full_title) {
                                        log::warn!("Failed to write chart title: {}", e);
                                    }

                                    // Write edition date as description if available
                                    if let Some(ref edition) = meta.edition_date {
                                        let desc = format!("Edition: {}", edition);
                                        if let Err(e) = write_mbtiles_metadata(&mbtiles_path, "description", &desc) {
                                            log::warn!("Failed to write chart description: {}", e);
                                        }
                                    }
                                } else {
                                    log::debug!("No BSB metadata found for {} (searched for {})", file_name, file_name_upper);
                                }

                                // Try to read metadata and create ChartInfo
                                let chart_info = MBTilesReader::open(mbtiles_path.to_str().unwrap_or_default())
                                    .ok()
                                    .and_then(|reader| reader.get_metadata().ok())
                                    .map(|metadata| ChartInfo {
                                        id: mbtiles_path.to_string_lossy().to_string(),
                                        name: metadata.name.clone().unwrap_or_else(|| file_name.clone()),
                                        path: mbtiles_path.to_string_lossy().to_string(),
                                        metadata,
                                    });

                                log::info!("Successfully imported: {}", file_name);

                                ConversionResult {
                                    file_name,
                                    success: true,
                                    chart_info,
                                    error: None,
                                    skipped: false,
                                }
                            }
                            Err(e) => {
                                failed_count.fetch_add(1, Ordering::SeqCst);
                                log::error!("Failed to convert {}: {:?}", file_name, e);
                                ConversionResult {
                                    file_name: file_name.clone(),
                                    success: false,
                                    chart_info: None,
                                    error: Some(format!("{}: {}", file_name, e)),
                                    skipped: false,
                                }
                            }
                        }
                    })
                }).collect();

                // Wait for all threads in this batch to complete
                handles.into_iter().map(|h| h.join().unwrap()).collect::<Vec<_>>()
            })
            .collect();

        // Collect results
        for conv_result in results {
            if conv_result.skipped {
                result.skipped += 1;
            } else if conv_result.success {
                result.converted += 1;
                if let Some(info) = conv_result.chart_info {
                    result.imported_charts.push(info);
                }
            } else {
                result.failed += 1;
                if let Some(err) = conv_result.error {
                    result.errors.push(err);
                }
            }
        }

        // Emit completion
        let _ = app_handle_clone.emit("import-progress", ImportProgress {
            phase: "complete".to_string(),
            current: total,
            total,
            current_file: "Import complete".to_string(),
            converted: result.converted,
            skipped: result.skipped,
            failed: result.failed,
        });

        result
    }).await.unwrap();

    Ok(CommandResult::ok(result))
}

/// Progress update for folder import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub phase: String,           // "scanning", "converting", "complete"
    pub current: usize,          // Current item number
    pub total: usize,            // Total items
    pub current_file: String,    // Name of current file being processed
    pub converted: usize,        // Successfully converted so far
    pub skipped: usize,          // Skipped so far
    pub failed: usize,           // Failed so far
}

#[tauri::command]
pub async fn import_charts_from_folder(
    folder_path: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandResult<FolderImportResult>, ()> {
    let folder = std::path::PathBuf::from(&folder_path);

    // Validate folder exists
    if !folder.exists() || !folder.is_dir() {
        return Ok(CommandResult::err(&format!("Folder not found: {}", folder_path)));
    }

    // Check if GDAL is available
    let gdal_info = check_gdal_available();
    if !gdal_info.available {
        return Ok(CommandResult::err("GDAL is required to convert chart files. Please install GDAL first."));
    }

    // Emit scanning phase
    let _ = app_handle.emit("import-progress", ImportProgress {
        phase: "scanning".to_string(),
        current: 0,
        total: 0,
        current_file: "Scanning for chart files...".to_string(),
        converted: 0,
        skipped: 0,
        failed: 0,
    });

    // Clone values needed for the blocking task
    let charts_dir = state.charts_dir.clone();
    let app_handle_clone = app_handle.clone();

    // Run the heavy work in a blocking task to avoid freezing the UI
    let result = tokio::task::spawn_blocking(move || {
        // Scan for chart files
        let chart_files = scan_folder_for_charts(&folder);

        let mut result = FolderImportResult {
            total_found: chart_files.len(),
            converted: 0,
            failed: 0,
            skipped: 0,
            imported_charts: Vec::new(),
            errors: Vec::new(),
        };

        if chart_files.is_empty() {
            let _ = app_handle_clone.emit("import-progress", ImportProgress {
                phase: "complete".to_string(),
                current: 0,
                total: 0,
                current_file: "No chart files found".to_string(),
                converted: 0,
                skipped: 0,
                failed: 0,
            });
            return result;
        }

        log::info!("Found {} chart files to import", chart_files.len());

        // Scan for BSB files and build metadata mapping
        let bsb_files = scan_folder_for_bsb_files(&folder);
        let mut metadata_map: HashMap<String, BsbChartMetadata> = HashMap::new();
        for bsb_path in &bsb_files {
            let metadata_list = parse_bsb_full(bsb_path);
            for meta in metadata_list {
                metadata_map.insert(meta.chart_id.clone(), meta);
            }
        }
        log::info!("Found {} chart metadata entries from {} BSB files", metadata_map.len(), bsb_files.len());

        // Emit found count
        let _ = app_handle_clone.emit("import-progress", ImportProgress {
            phase: "converting".to_string(),
            current: 0,
            total: chart_files.len(),
            current_file: format!("Found {} charts to process", chart_files.len()),
            converted: 0,
            skipped: 0,
            failed: 0,
        });

        // Process each chart file
        for (index, chart_path) in chart_files.iter().enumerate() {
            let file_stem = chart_path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("chart_{}", uuid::Uuid::new_v4()));

            // Emit progress before processing
            let _ = app_handle_clone.emit("import-progress", ImportProgress {
                phase: "converting".to_string(),
                current: index + 1,
                total: chart_files.len(),
                current_file: file_stem.clone(),
                converted: result.converted,
                skipped: result.skipped,
                failed: result.failed,
            });

            // Generate output path
            let output_path = get_mbtiles_output_path(&charts_dir, &file_stem);

            // Skip if already exists
            if output_path.exists() {
                log::info!("Skipping {} - already exists", file_stem);
                result.skipped += 1;
                continue;
            }

            log::info!("Converting: {} -> {}", chart_path.display(), output_path.display());

            // Convert the chart
            match convert_to_mbtiles(chart_path, &output_path) {
                Ok(_) => {
                    result.converted += 1;

                    // Apply BSB metadata (chart title, description) if available
                    // Use uppercase for case-insensitive matching
                    let file_stem_upper = file_stem.to_uppercase();
                    if let Some(meta) = metadata_map.get(&file_stem_upper) {
                        // Build full title with chart type suffix for insets
                        let full_title = if let Some(ref ty) = meta.chart_type {
                            if ty.eq_ignore_ascii_case("Inset") {
                                format!("{} (Inset)", meta.title)
                            } else {
                                meta.title.clone()
                            }
                        } else {
                            meta.title.clone()
                        };

                        log::info!("Applying BSB metadata for {}: title='{}', edition={:?}",
                                  file_stem, full_title, meta.edition_date);

                        // Write title
                        if let Err(e) = write_mbtiles_metadata(&output_path, "name", &full_title) {
                            log::warn!("Failed to write chart title: {}", e);
                        }

                        // Write edition date as description if available
                        if let Some(ref edition) = meta.edition_date {
                            let desc = format!("Edition: {}", edition);
                            if let Err(e) = write_mbtiles_metadata(&output_path, "description", &desc) {
                                log::warn!("Failed to write chart description: {}", e);
                            }
                        }
                    } else {
                        log::debug!("No BSB metadata found for {} (searched for {})", file_stem, file_stem_upper);
                    }

                    // Try to read metadata and create ChartInfo
                    if let Ok(reader) = MBTilesReader::open(output_path.to_str().unwrap_or_default()) {
                        if let Ok(metadata) = reader.get_metadata() {
                            result.imported_charts.push(ChartInfo {
                                id: output_path.to_string_lossy().to_string(),
                                name: metadata.name.clone().unwrap_or_else(|| file_stem.clone()),
                                path: output_path.to_string_lossy().to_string(),
                                metadata,
                            });
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}: {}", chart_path.display(), e);
                    log::error!("Failed to convert: {}", error_msg);
                    result.failed += 1;
                    result.errors.push(error_msg);
                }
            }
        }

        // Emit completion
        let _ = app_handle_clone.emit("import-progress", ImportProgress {
            phase: "complete".to_string(),
            current: chart_files.len(),
            total: chart_files.len(),
            current_file: "Import complete".to_string(),
            converted: result.converted,
            skipped: result.skipped,
            failed: result.failed,
        });

        log::info!(
            "Import complete: {} converted, {} failed, {} skipped",
            result.converted, result.failed, result.skipped
        );

        result
    }).await.unwrap_or_else(|e| {
        log::error!("Import task panicked: {:?}", e);
        FolderImportResult {
            total_found: 0,
            converted: 0,
            failed: 1,
            skipped: 0,
            imported_charts: Vec::new(),
            errors: vec![format!("Import task failed: {:?}", e)],
        }
    });

    Ok(CommandResult::ok(result))
}

#[tauri::command]
pub async fn refresh_catalog(
    catalog_id: i64,
    state: State<'_, AppState>,
) -> Result<CommandResult<ChartCatalog>, ()> {
    // Get the catalog
    let catalog = match state.config_db.get_catalog(catalog_id) {
        Ok(Some(c)) => c,
        Ok(None) => return Ok(CommandResult::err("Catalog not found")),
        Err(e) => return Ok(CommandResult::err(&e.to_string())),
    };

    // Only URL catalogs can be refreshed
    if catalog.source_type != "url" {
        return Ok(CommandResult::err("Only URL catalogs can be refreshed"));
    }

    // Fetch the catalog XML
    let xml_content = match fetch_catalog_url(&catalog.source_path).await {
        Ok(content) => content,
        Err(e) => return Ok(CommandResult::err(&format!("Failed to fetch catalog: {}", e))),
    };

    // Parse the catalog
    let parsed = match parse_catalog_xml(&xml_content) {
        Ok(c) => c,
        Err(e) => return Ok(CommandResult::err(&format!("Failed to parse catalog: {}", e))),
    };

    // Clear existing charts (keep downloaded ones)
    // For now, we'll just add new charts
    // TODO: Implement proper merge logic

    // Update last_refreshed
    if let Err(e) = state.config_db.update_catalog_refreshed(catalog_id) {
        return Ok(CommandResult::err(&e.to_string()));
    }

    // Return updated catalog
    match state.config_db.get_catalog(catalog_id) {
        Ok(Some(updated)) => Ok(CommandResult::ok(updated)),
        Ok(None) => Ok(CommandResult::err("Catalog not found after update")),
        Err(e) => Ok(CommandResult::err(&e.to_string())),
    }
}

// ============ BSB Metadata Tagging Commands ============

/// Scan a folder recursively for .bsb catalog files
fn scan_folder_for_bsb_files(folder: &std::path::Path) -> Vec<PathBuf> {
    let mut bsb_files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories
                bsb_files.extend(scan_folder_for_bsb_files(&path));
            } else if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if ext_lower == "bsb" {
                    bsb_files.push(path);
                }
            }
        }
    }

    bsb_files
}

/// Parse a BSB catalog file to extract KAP filename -> chart title mapping
///
/// BSB files contain lines like:
/// K01/NA=Manawatawhi/Three Kings Islands,NU=NZ411101,TY=Base,FN=NZ411101.KAP
/// K02/NA=North West Bay,NU=NZ411102,TY=Inset,FN=NZ411102.KAP
///
/// Returns a Vec of (kap_filename_without_ext, chart_title) pairs
fn parse_bsb_for_titles(bsb_path: &std::path::Path) -> Vec<(String, String)> {
    let mut results = Vec::new();

    // BSB files are often ISO-8859-1 (Latin-1) encoded, not UTF-8
    // Read as bytes and convert with lossy UTF-8 to handle any encoding
    let bytes = match std::fs::read(bsb_path) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Failed to read BSB file {:?}: {}", bsb_path, e);
            return results;
        }
    };
    let content = String::from_utf8_lossy(&bytes);

    // BSB files have multi-line entries where continuation lines start with whitespace.
    // First, join continuation lines with their preceding K0x/ line.
    let mut joined_lines: Vec<String> = Vec::new();
    for line in content.lines() {
        // Continuation lines start with whitespace (spaces or tabs)
        if line.starts_with(' ') || line.starts_with('\t') {
            // Append to previous line if we have one
            if let Some(last) = joined_lines.last_mut() {
                last.push(',');
                last.push_str(line.trim());
            }
        } else {
            // New entry
            joined_lines.push(line.to_string());
        }
    }

    // Now parse the joined lines
    for line in &joined_lines {
        let line = line.trim();

        // Match lines like "K01/NA=...,FN=..." or "K02/NA=...,FN=..."
        if line.starts_with('K') && line.len() > 3 {
            // Check if it's a Kxx/ pattern (K followed by digits and /)
            let prefix_end = line.find('/');
            if let Some(slash_pos) = prefix_end {
                let prefix = &line[0..slash_pos];
                if prefix.len() >= 2 && prefix.chars().skip(1).all(|c| c.is_ascii_digit()) {
                    let rest = &line[slash_pos + 1..];

                    // Extract NA= value (chart title), TY= (type), and FN= (filename)
                    let title = extract_field(rest, "NA=");
                    let chart_type = extract_field(rest, "TY="); // Base or Inset
                    let filename = extract_field(rest, "FN=");

                    if let (Some(title), Some(filename)) = (title, filename) {
                        // Remove .KAP extension from filename for matching
                        // Normalize to uppercase for case-insensitive matching
                        let chart_id = filename
                            .trim_end_matches(".KAP")
                            .trim_end_matches(".kap")
                            .to_uppercase();

                        // Append chart type to title if it's an Inset
                        let full_title = if let Some(ref ty) = chart_type {
                            if ty.eq_ignore_ascii_case("Inset") {
                                format!("{} (Inset)", title)
                            } else {
                                title.clone()
                            }
                        } else {
                            title.clone()
                        };

                        log::info!("BSB mapping: {} -> {} (type: {:?})", chart_id, full_title, chart_type);
                        results.push((chart_id, full_title));
                    }
                }
            }
        }
    }

    log::info!("Parsed {} title mappings from {:?}", results.len(), bsb_path);
    results
}

/// Extract a field value from a BSB line
/// e.g., extract_field("NA=Samoa Islands,NU=WS111,FN=WS11101.KAP", "NA=") -> Some("Samoa Islands")
fn extract_field(line: &str, field: &str) -> Option<String> {
    let start = line.find(field)?;
    let value_start = start + field.len();
    let rest = &line[value_start..];

    // Value ends at comma or end of string
    let end = rest.find(',').unwrap_or(rest.len());
    let value = rest[..end].trim().to_string();

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Full metadata extracted from a BSB file for a single chart
#[derive(Debug, Clone)]
pub struct BsbChartMetadata {
    pub chart_id: String,      // e.g., "NZ5301"
    pub title: String,         // e.g., "Bream Head to Slipper Island"
    pub chart_type: Option<String>,  // "Base" or "Inset"
    pub edition_date: Option<String>, // e.g., "2023-03-14" (from NTM/ND)
    pub source_edition: Option<String>, // e.g., "2017-05-01" (from CED/SE)
}

/// Parse BSB file and extract full metadata for all charts
fn parse_bsb_full(bsb_path: &std::path::Path) -> Vec<BsbChartMetadata> {
    let mut results = Vec::new();

    // BSB files are often ISO-8859-1 (Latin-1) encoded, not UTF-8
    // Read as bytes and convert with lossy UTF-8 to handle any encoding
    let bytes = match std::fs::read(bsb_path) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Failed to read BSB file {:?}: {}", bsb_path, e);
            return results;
        }
    };
    let content = String::from_utf8_lossy(&bytes);

    // Join continuation lines
    let mut joined_lines: Vec<String> = Vec::new();
    for line in content.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = joined_lines.last_mut() {
                last.push(',');
                last.push_str(line.trim());
            }
        } else {
            joined_lines.push(line.to_string());
        }
    }

    // Extract global metadata (applies to all charts in this BSB)
    let mut edition_date: Option<String> = None;
    let mut source_edition: Option<String> = None;

    for line in &joined_lines {
        let line = line.trim();

        // Parse NTM line for latest notice date: NTM/NE=2023030,ND=03/14/2023
        if line.starts_with("NTM/") {
            if let Some(nd) = extract_field(line, "ND=") {
                // Convert MM/DD/YYYY to YYYY-MM-DD
                let parts: Vec<&str> = nd.split('/').collect();
                if parts.len() == 3 {
                    edition_date = Some(format!("{}-{}-{}", parts[2], parts[0], parts[1]));
                }
            }
        }

        // Parse CED line for source edition: CED/SE=20170501,RE=1,ED=05/01/2017
        if line.starts_with("CED/") {
            if let Some(se) = extract_field(line, "SE=") {
                // Convert YYYYMMDD to YYYY-MM-DD
                if se.len() == 8 {
                    source_edition = Some(format!("{}-{}-{}", &se[0..4], &se[4..6], &se[6..8]));
                }
            }
        }

        // Parse K01/, K02/, etc. lines for individual chart metadata
        if line.starts_with('K') && line.len() > 3 {
            if let Some(slash_pos) = line.find('/') {
                let prefix = &line[0..slash_pos];
                if prefix.len() >= 2 && prefix.chars().skip(1).all(|c| c.is_ascii_digit()) {
                    let rest = &line[slash_pos + 1..];

                    let title = extract_field(rest, "NA=");
                    let chart_type = extract_field(rest, "TY=");
                    let filename = extract_field(rest, "FN=");

                    if let (Some(title), Some(filename)) = (title, filename) {
                        let chart_id = filename
                            .trim_end_matches(".KAP")
                            .trim_end_matches(".kap")
                            .to_uppercase();

                        results.push(BsbChartMetadata {
                            chart_id,
                            title,
                            chart_type,
                            edition_date: edition_date.clone(),
                            source_edition: source_edition.clone(),
                        });
                    }
                }
            }
        }
    }

    log::info!("Parsed {} chart metadata entries from {:?}", results.len(), bsb_path);
    results
}

/// Result of tagging charts with BSB metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagResult {
    pub total_bsb_files: usize,
    pub total_mappings: usize,
    pub charts_updated: usize,
    pub charts_not_found: usize,
    pub errors: Vec<String>,
}

/// Tag already-imported MBTiles charts with human-readable titles from BSB catalog files
#[tauri::command]
pub async fn tag_charts_from_bsb(
    bsb_folder: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandResult<TagResult>, ()> {
    let folder = std::path::PathBuf::from(&bsb_folder);

    // Validate folder exists
    if !folder.exists() || !folder.is_dir() {
        return Ok(CommandResult::err(&format!("Folder not found: {}", bsb_folder)));
    }

    let charts_dir = state.charts_dir.clone();

    // Run the work in a blocking task
    let result = tokio::task::spawn_blocking(move || {
        let mut result = TagResult {
            total_bsb_files: 0,
            total_mappings: 0,
            charts_updated: 0,
            charts_not_found: 0,
            errors: Vec::new(),
        };

        // Step 1: Scan for BSB files
        log::info!("Scanning for BSB files in {:?}", folder);
        let bsb_files = scan_folder_for_bsb_files(&folder);
        result.total_bsb_files = bsb_files.len();
        log::info!("Found {} BSB files", bsb_files.len());

        // Step 2: Parse all BSB files to build chart ID -> metadata mapping
        let mut metadata_map: HashMap<String, BsbChartMetadata> = HashMap::new();

        for bsb_path in &bsb_files {
            let metadata_list = parse_bsb_full(bsb_path);
            for meta in metadata_list {
                metadata_map.insert(meta.chart_id.clone(), meta);
            }
        }

        result.total_mappings = metadata_map.len();
        log::info!("Built {} chart ID -> metadata mappings", metadata_map.len());

        // Step 3: Scan charts directory for MBTiles files
        if !charts_dir.exists() {
            result.errors.push("Charts directory does not exist".to_string());
            return result;
        }

        let mbtiles_files: Vec<PathBuf> = std::fs::read_dir(&charts_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |ext| ext == "mbtiles"))
            .collect();

        log::info!("Found {} MBTiles files to tag", mbtiles_files.len());

        // Step 4: Update each MBTiles file's metadata with chart title and description
        for mbtiles_path in mbtiles_files {
            let chart_id = match mbtiles_path.file_stem() {
                Some(stem) => stem.to_string_lossy().to_string(),
                None => continue,
            };

            // Look up metadata in our mapping (case-insensitive)
            let chart_id_upper = chart_id.to_uppercase();
            if let Some(meta) = metadata_map.get(&chart_id_upper) {
                let path_str = mbtiles_path.to_string_lossy().to_string();

                // Build full title with chart type suffix for insets
                let full_title = if let Some(ref ty) = meta.chart_type {
                    if ty.eq_ignore_ascii_case("Inset") {
                        format!("{} (Inset)", meta.title)
                    } else {
                        meta.title.clone()
                    }
                } else {
                    meta.title.clone()
                };

                // Update the name metadata
                match update_mbtiles_name(&path_str, &full_title) {
                    Ok(_) => {
                        log::info!("Tagged {} as '{}'", chart_id, full_title);
                        result.charts_updated += 1;

                        // Also write edition date as description if available
                        if let Some(ref edition) = meta.edition_date {
                            let desc = format!("Edition: {}", edition);
                            if let Err(e) = write_mbtiles_metadata(
                                std::path::Path::new(&path_str), "description", &desc
                            ) {
                                log::warn!("Failed to write description for {}: {}", chart_id, e);
                            }
                        }
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to update {}: {}", chart_id, e);
                        log::error!("{}", error_msg);
                        result.errors.push(error_msg);
                    }
                }
            } else {
                log::debug!("No BSB mapping found for chart: {}", chart_id);
                result.charts_not_found += 1;
            }
        }

        log::info!(
            "Tagging complete: {} updated, {} not found in BSB files",
            result.charts_updated, result.charts_not_found
        );

        result
    }).await.unwrap_or_else(|e| {
        log::error!("Tagging task panicked: {:?}", e);
        TagResult {
            total_bsb_files: 0,
            total_mappings: 0,
            charts_updated: 0,
            charts_not_found: 0,
            errors: vec![format!("Tagging task failed: {:?}", e)],
        }
    });

    Ok(CommandResult::ok(result))
}

/// Update the 'name' field in an MBTiles file's metadata table
fn update_mbtiles_name(mbtiles_path: &str, name: &str) -> Result<(), String> {
    use rusqlite::Connection;

    // Open in read-write mode
    let conn = Connection::open(mbtiles_path)
        .map_err(|e| format!("Failed to open MBTiles: {}", e))?;

    // Check if 'name' row exists in metadata
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM metadata WHERE name = 'name'",
        [],
        |row| row.get(0)
    ).unwrap_or(false);

    if exists {
        // Update existing name
        conn.execute(
            "UPDATE metadata SET value = ?1 WHERE name = 'name'",
            [name]
        ).map_err(|e| format!("Failed to update name: {}", e))?;
    } else {
        // Insert new name
        conn.execute(
            "INSERT INTO metadata (name, value) VALUES ('name', ?1)",
            [name]
        ).map_err(|e| format!("Failed to insert name: {}", e))?;
    }

    Ok(())
}

/// Update the 'bounds' field in an MBTiles file's metadata table
fn update_mbtiles_bounds(mbtiles_path: &str, bounds: &str) -> Result<(), String> {
    use rusqlite::Connection;

    let conn = Connection::open(mbtiles_path)
        .map_err(|e| format!("Failed to open MBTiles: {}", e))?;

    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM metadata WHERE name = 'bounds'",
        [],
        |row| row.get(0)
    ).unwrap_or(false);

    if exists {
        conn.execute(
            "UPDATE metadata SET value = ?1 WHERE name = 'bounds'",
            [bounds]
        ).map_err(|e| format!("Failed to update bounds: {}", e))?;
    } else {
        conn.execute(
            "INSERT INTO metadata (name, value) VALUES ('bounds', ?1)",
            [bounds]
        ).map_err(|e| format!("Failed to insert bounds: {}", e))?;
    }

    Ok(())
}

/// Check if an MBTiles file has bounds metadata
fn mbtiles_has_bounds(mbtiles_path: &str) -> bool {
    use rusqlite::Connection;

    if let Ok(conn) = Connection::open(mbtiles_path) {
        let has_bounds: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM metadata WHERE name = 'bounds' AND value IS NOT NULL AND value != ''",
            [],
            |row| row.get(0)
        ).unwrap_or(false);
        return has_bounds;
    }
    false
}

/// Scan a folder recursively for KAP files and build chart ID -> path mapping
fn scan_folder_for_kap_files(folder: &std::path::Path) -> HashMap<String, PathBuf> {
    let mut kap_files = HashMap::new();

    fn scan_recursive(folder: &std::path::Path, kap_files: &mut HashMap<String, PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    scan_recursive(&path, kap_files);
                } else if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if ext_lower == "kap" || ext_lower == "cap" {
                        if let Some(stem) = path.file_stem() {
                            let chart_id = stem.to_string_lossy().to_string();
                            kap_files.insert(chart_id, path);
                        }
                    }
                }
            }
        }
    }

    scan_recursive(folder, &mut kap_files);
    kap_files
}

/// Result of fixing bounds for imported charts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixBoundsResult {
    pub charts_checked: usize,
    pub charts_already_had_bounds: usize,
    pub charts_updated: usize,
    pub charts_kap_not_found: usize,
    pub charts_bounds_failed: usize,
    pub errors: Vec<String>,
}

/// Fix bounds for already-imported MBTiles charts by reading from original KAP files
#[tauri::command]
pub async fn fix_chart_bounds(
    kap_folder: String,
    state: State<'_, AppState>,
) -> Result<CommandResult<FixBoundsResult>, ()> {
    use crate::chart_converter::check_gdal_available;

    let folder = std::path::PathBuf::from(&kap_folder);

    // Validate folder exists
    if !folder.exists() || !folder.is_dir() {
        return Ok(CommandResult::err(&format!("Folder not found: {}", kap_folder)));
    }

    // Check GDAL is available
    let gdal_info = check_gdal_available();
    if !gdal_info.available {
        return Ok(CommandResult::err("GDAL is required to extract bounds from KAP files"));
    }

    let charts_dir = state.charts_dir.clone();

    // Run the work in a blocking task
    let result = tokio::task::spawn_blocking(move || {
        let mut result = FixBoundsResult {
            charts_checked: 0,
            charts_already_had_bounds: 0,
            charts_updated: 0,
            charts_kap_not_found: 0,
            charts_bounds_failed: 0,
            errors: Vec::new(),
        };

        // Step 1: Scan for KAP files and build chart ID -> path mapping
        log::info!("Scanning for KAP files in {:?}", folder);
        let kap_files = scan_folder_for_kap_files(&folder);
        log::info!("Found {} KAP files", kap_files.len());

        // Step 2: Scan charts directory for MBTiles files
        if !charts_dir.exists() {
            result.errors.push("Charts directory does not exist".to_string());
            return result;
        }

        let mbtiles_files: Vec<PathBuf> = std::fs::read_dir(&charts_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |ext| ext == "mbtiles"))
            .collect();

        log::info!("Found {} MBTiles files to check", mbtiles_files.len());
        result.charts_checked = mbtiles_files.len();

        // Step 3: For each MBTiles without bounds, try to get bounds from KAP file
        for mbtiles_path in mbtiles_files {
            let chart_id = match mbtiles_path.file_stem() {
                Some(stem) => stem.to_string_lossy().to_string(),
                None => continue,
            };

            let path_str = mbtiles_path.to_string_lossy().to_string();

            // Check if already has bounds
            if mbtiles_has_bounds(&path_str) {
                log::debug!("Chart {} already has bounds", chart_id);
                result.charts_already_had_bounds += 1;
                continue;
            }

            // Look for matching KAP file
            if let Some(kap_path) = kap_files.get(&chart_id) {
                // Use gdalinfo to get bounds
                match get_chart_bounds_from_gdalinfo(kap_path) {
                    Some((min_lon, min_lat, max_lon, max_lat)) => {
                        let bounds_str = format!("{},{},{},{}", min_lon, min_lat, max_lon, max_lat);
                        match update_mbtiles_bounds(&path_str, &bounds_str) {
                            Ok(_) => {
                                log::info!("Fixed bounds for {}: {}", chart_id, bounds_str);
                                result.charts_updated += 1;
                            }
                            Err(e) => {
                                let error_msg = format!("Failed to update bounds for {}: {}", chart_id, e);
                                log::error!("{}", error_msg);
                                result.errors.push(error_msg);
                                result.charts_bounds_failed += 1;
                            }
                        }
                    }
                    None => {
                        log::warn!("Could not extract bounds from KAP file: {:?}", kap_path);
                        result.charts_bounds_failed += 1;
                    }
                }
            } else {
                log::debug!("No KAP file found for chart: {}", chart_id);
                result.charts_kap_not_found += 1;
            }
        }

        log::info!(
            "Fix bounds complete: {} checked, {} already had bounds, {} updated, {} KAP not found, {} failed",
            result.charts_checked, result.charts_already_had_bounds, result.charts_updated,
            result.charts_kap_not_found, result.charts_bounds_failed
        );

        result
    }).await.unwrap_or_else(|e| {
        log::error!("Fix bounds task panicked: {:?}", e);
        FixBoundsResult {
            charts_checked: 0,
            charts_already_had_bounds: 0,
            charts_updated: 0,
            charts_kap_not_found: 0,
            charts_bounds_failed: 0,
            errors: vec![format!("Task failed: {:?}", e)],
        }
    });

    Ok(CommandResult::ok(result))
}

/// Get chart bounds from gdalinfo (extracted to reuse in fix_chart_bounds)
fn get_chart_bounds_from_gdalinfo(kap_path: &std::path::Path) -> Option<(f64, f64, f64, f64)> {
    use std::process::Command;

    let input_str = kap_path.to_str()?;

    // Try bundled GDAL first on Windows
    #[cfg(target_os = "windows")]
    {
        let sdk_root = std::path::PathBuf::from(r"C:\Dev\VortexNav\gdal");
        let gdalinfo_exe = sdk_root.join("bin").join("gdal").join("apps").join("gdalinfo.exe");

        if gdalinfo_exe.exists() {
            let bin_path = sdk_root.join("bin");
            let apps_path = sdk_root.join("bin").join("gdal").join("apps");
            let current_path = std::env::var("PATH").unwrap_or_default();
            let new_path = format!("{};{};{}", bin_path.display(), apps_path.display(), current_path);

            if let Ok(output) = Command::new(&gdalinfo_exe)
                .args(&["-json", input_str])
                .env("PATH", new_path)
                .env("GDAL_DATA", sdk_root.join("bin").join("gdal-data"))
                .output()
            {
                if output.status.success() {
                    return parse_gdalinfo_bounds(&String::from_utf8_lossy(&output.stdout));
                }
            }
        }
    }

    // Fall back to PATH-based gdalinfo
    if let Ok(output) = Command::new("gdalinfo").args(&["-json", input_str]).output() {
        if output.status.success() {
            return parse_gdalinfo_bounds(&String::from_utf8_lossy(&output.stdout));
        }
    }

    None
}

/// Parse bounds from gdalinfo JSON output
fn parse_gdalinfo_bounds(info_str: &str) -> Option<(f64, f64, f64, f64)> {
    // Look for wgs84Extent in the JSON output
    if let Some(extent_start) = info_str.find("wgs84Extent") {
        if let Some(coords_start) = info_str[extent_start..].find("coordinates") {
            let coords_section = &info_str[extent_start + coords_start..];

            let mut lons: Vec<f64> = Vec::new();
            let mut lats: Vec<f64> = Vec::new();
            let mut in_bracket = 0;
            let mut current_num = String::new();
            let mut numbers: Vec<f64> = Vec::new();

            for ch in coords_section.chars().take(2000) {
                match ch {
                    '[' => in_bracket += 1,
                    ']' => {
                        if !current_num.is_empty() {
                            if let Ok(n) = current_num.parse::<f64>() {
                                numbers.push(n);
                            }
                            current_num.clear();
                        }
                        in_bracket -= 1;
                        if in_bracket <= 1 {
                            break;
                        }
                    }
                    ',' | ' ' => {
                        if !current_num.is_empty() {
                            if let Ok(n) = current_num.parse::<f64>() {
                                numbers.push(n);
                            }
                            current_num.clear();
                        }
                    }
                    c if c.is_numeric() || c == '.' || c == '-' => {
                        current_num.push(c);
                    }
                    _ => {}
                }
            }

            for chunk in numbers.chunks(2) {
                if chunk.len() == 2 {
                    let lon = chunk[0];
                    let lat = chunk[1];
                    if lon.abs() <= 180.0 && lat.abs() <= 90.0 {
                        lons.push(lon);
                        lats.push(lat);
                    }
                }
            }

            if !lons.is_empty() && !lats.is_empty() {
                let min_lon = lons.iter().cloned().fold(f64::INFINITY, f64::min);
                let max_lon = lons.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                let min_lat = lats.iter().cloned().fold(f64::INFINITY, f64::min);
                let max_lat = lats.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

                return Some((min_lon, min_lat, max_lon, max_lat));
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bsb_multiline() {
        // Simulate a BSB file with multi-line K01 entry
        let bsb_content = r#"!
CRR/NZMariner
CHT/NA=Bream Head to Slipper Island,NU=NZ53
CED/SE=20170501,RE=1,ED=05/01/2017
NTM/NE=2023030,ND=03/14/2023
K01/NA=Bream Head to Slipper Island including Hauraki Gulf
    NU=NZ5301,TY=Base,FN=NZ5301.KAP
K02/NA=Whangapoua Harbour continuation
    TY=Inset,FN=NZ531202.KAP
"#;
        // Write temp file
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("test_bsb.bsb");
        std::fs::write(&temp_file, bsb_content).unwrap();

        // Parse
        let results = parse_bsb_full(&temp_file);

        // Clean up
        let _ = std::fs::remove_file(&temp_file);

        // Verify
        assert_eq!(results.len(), 2, "Should parse 2 chart entries");

        // Check first entry (Base chart)
        let chart1 = results.iter().find(|m| m.chart_id == "NZ5301").expect("Should find NZ5301");
        assert_eq!(chart1.title, "Bream Head to Slipper Island including Hauraki Gulf");
        assert_eq!(chart1.chart_type.as_deref(), Some("Base"));
        assert_eq!(chart1.edition_date.as_deref(), Some("2023-03-14"));

        // Check second entry (Inset chart)
        let chart2 = results.iter().find(|m| m.chart_id == "NZ531202").expect("Should find NZ531202");
        assert_eq!(chart2.title, "Whangapoua Harbour continuation");
        assert_eq!(chart2.chart_type.as_deref(), Some("Inset"));
    }

    #[test]
    fn test_extract_field() {
        assert_eq!(extract_field("NA=Test Chart,NU=123", "NA="), Some("Test Chart".to_string()));
        assert_eq!(extract_field("NA=Test,FN=file.KAP", "FN="), Some("file.KAP".to_string()));
        assert_eq!(extract_field("NA=Test", "FN="), None);
        assert_eq!(extract_field("TY=Base,FN=test.kap", "TY="), Some("Base".to_string()));
    }
}
