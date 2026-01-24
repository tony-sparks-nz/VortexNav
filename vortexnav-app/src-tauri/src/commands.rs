// Tauri commands for frontend communication

use crate::database::{AppSettings, ConfigDatabase, GpsSourceRecord, MBTilesMetadata, MBTilesReader, Waypoint};
use crate::gps::{DetectedPort, GpsManager, GpsSourceConfig, GpsSourceStatus, GpsSourceType};
use crate::nmea::GpsData;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

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
pub fn delete_waypoint(id: i64, state: State<AppState>) -> CommandResult<()> {
    match state.config_db.delete_waypoint(id) {
        Ok(_) => CommandResult::ok(()),
        Err(e) => CommandResult::err(&e.to_string()),
    }
}

// ============ MBTiles Commands ============

#[derive(Debug, Serialize, Deserialize)]
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

// ============ Utility Commands ============

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> CommandResult<String> {
    match app.path().app_data_dir() {
        Ok(path) => CommandResult::<String>::ok(path.to_string_lossy().to_string()),
        Err(e) => CommandResult::<String>::err(&e.to_string()),
    }
}
