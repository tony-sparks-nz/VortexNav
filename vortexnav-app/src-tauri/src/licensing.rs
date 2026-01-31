// ==============================================
// Licensing Agent IPC Client
// ==============================================
//
// Handles communication with the Vortex Licensing Agent
// which manages device identity, entitlements, and offline packs.
//

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

/// LA connection address (Windows uses TCP, Unix would use socket)
#[cfg(windows)]
const LA_ADDRESS: &str = "127.0.0.1:47923";

#[cfg(unix)]
const LA_SOCKET_PATH: &str = "/var/run/vortex-la/la.sock";

/// Request ID counter
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// IPC Request to LA
#[derive(Debug, Serialize)]
struct LaRequest {
    id: String,
    method: String,
    params: serde_json::Value,
}

/// IPC Response from LA
#[derive(Debug, Deserialize)]
struct LaResponse {
    id: String,
    success: bool,
    data: Option<serde_json::Value>,
    error: Option<LaError>,
}

#[derive(Debug, Deserialize)]
struct LaError {
    code: String,
    message: String,
}

/// Licensing Agent client
pub struct LaClient {
    connection: Mutex<Option<TcpStream>>,
}

impl LaClient {
    pub fn new() -> Self {
        Self {
            connection: Mutex::new(None),
        }
    }

    /// Connect to the LA
    async fn connect(&self) -> Result<(), String> {
        let mut conn = self.connection.lock().await;

        if conn.is_some() {
            println!("[LA Client] Already connected");
            return Ok(());
        }

        println!("[LA Client] Attempting TCP connection to {}", LA_ADDRESS);

        #[cfg(windows)]
        {
            match TcpStream::connect(LA_ADDRESS).await {
                Ok(stream) => {
                    println!("[LA Client] TCP connection established");
                    *conn = Some(stream);
                    Ok(())
                }
                Err(e) => {
                    println!("[LA Client] TCP connection error: {}", e);
                    Err(format!("Failed to connect to LA: {}", e))
                }
            }
        }

        #[cfg(unix)]
        {
            use tokio::net::UnixStream;
            match UnixStream::connect(LA_SOCKET_PATH).await {
                Ok(_stream) => {
                    // For Unix, we'd need different handling
                    Err("Unix socket not fully implemented".to_string())
                }
                Err(e) => Err(format!("Failed to connect to LA: {}", e)),
            }
        }
    }

    /// Send a request to the LA
    async fn send_request(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        println!("[LA Client] send_request: method={}", method);

        // Ensure connected
        self.connect().await?;

        let request_id = REQUEST_ID.fetch_add(1, Ordering::SeqCst).to_string();

        let request = LaRequest {
            id: request_id.clone(),
            method: method.to_string(),
            params,
        };

        let request_json = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?
            + "\n";

        println!("[LA Client] Sending: {}", request_json.trim());

        let mut conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_mut()
            .ok_or_else(|| "Not connected to LA".to_string())?;

        // Send request
        if let Err(e) = conn.write_all(request_json.as_bytes()).await {
            println!("[LA Client] Write error: {}", e);
            // Clear the stale connection so we reconnect next time
            *conn_guard = None;
            return Err(format!("Failed to send request: {}", e));
        }

        // Flush to ensure data is sent
        if let Err(e) = conn.flush().await {
            println!("[LA Client] Flush error: {}", e);
            *conn_guard = None;
            return Err(format!("Failed to flush request: {}", e));
        }

        // Read response
        let mut reader = BufReader::new(conn);
        let mut response_line = String::new();
        if let Err(e) = reader.read_line(&mut response_line).await {
            println!("[LA Client] Read error: {}", e);
            // Clear the stale connection so we reconnect next time
            *conn_guard = None;
            return Err(format!("Failed to read response: {}", e));
        }

        println!("[LA Client] Received: {}", response_line.trim());

        let response: LaResponse = serde_json::from_str(&response_line)
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if response.id != request_id {
            return Err("Response ID mismatch".to_string());
        }

        if response.success {
            Ok(response.data.unwrap_or(serde_json::Value::Null))
        } else {
            let error_msg = response.error
                .map(|e| format!("{}: {}", e.code, e.message))
                .unwrap_or_else(|| "Unknown error".to_string());
            Err(error_msg)
        }
    }
}

// ==============================================
// Data Types
// ==============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatus {
    pub registered: bool,
    pub device_id: Option<String>,
    pub horizon_url: Option<String>,
    pub registered_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementCheck {
    pub allowed: bool,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entitlement {
    pub key: String,
    pub value: Option<serde_json::Value>,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackInfo {
    pub id: String,
    #[serde(default)]
    pub region_slug: Option<String>,  // Optional for custom packs
    pub name: String,
    pub status: String,
    pub tile_count: Option<u32>,
    pub size_bytes: Option<u64>,
    pub expires_at: String,
    pub downloaded_at: Option<String>,
    pub bounds: Option<PackBounds>,
    pub zoom_levels: Option<Vec<u8>>,
    pub provider: Option<String>,
    pub storage_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackCatalogRegion {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub bounds: PackBounds,
    pub available_zoom_levels: Vec<u8>,
    pub estimated_size_bytes: Option<u64>,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackBounds {
    pub min_lon: f64,
    pub min_lat: f64,
    pub max_lon: f64,
    pub max_lat: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileData {
    pub tile: String,  // base64 encoded
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationResult {
    pub success: bool,
    pub device_id: Option<String>,
}

// ==============================================
// Static Client Instance
// ==============================================

use std::sync::OnceLock;

static LA_CLIENT: OnceLock<LaClient> = OnceLock::new();

fn get_client() -> &'static LaClient {
    LA_CLIENT.get_or_init(|| LaClient::new())
}

// ==============================================
// Tauri Commands
// ==============================================

/// Check if LA is available
#[tauri::command]
pub async fn la_check_connection() -> Result<bool, String> {
    println!("[LA Client] Checking connection to {}", LA_ADDRESS);
    let client = get_client();
    match client.connect().await {
        Ok(_) => {
            println!("[LA Client] Connection successful");
            Ok(true)
        },
        Err(e) => {
            println!("[LA Client] Connection failed: {}", e);
            Ok(false)
        },
    }
}

/// Get device status
#[tauri::command]
pub async fn la_get_device_status() -> Result<DeviceStatus, String> {
    println!("[LA Client] Getting device status");
    let client = get_client();
    match client.send_request("device.status", serde_json::json!({})).await {
        Ok(response) => {
            println!("[LA Client] Device status response: {:?}", response);
            serde_json::from_value(response)
                .map_err(|e| format!("Failed to parse device status: {}", e))
        }
        Err(e) => {
            println!("[LA Client] Device status error: {}", e);
            Err(e)
        }
    }
}

/// Register device with code
#[tauri::command]
pub async fn la_register_device(code: String) -> Result<RegistrationResult, String> {
    let client = get_client();
    let response = client.send_request("device.register", serde_json::json!({ "code": code })).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse registration result: {}", e))
}

/// Result of device reset
#[derive(Debug, Serialize, Deserialize)]
pub struct ResetResult {
    pub success: bool,
    pub message: String,
}

/// Reset device identity to allow re-registration
#[tauri::command]
pub async fn la_reset_device() -> Result<ResetResult, String> {
    println!("[Tauri] la_reset_device called");
    let client = get_client();
    let response = client.send_request("device.reset", serde_json::json!({})).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse reset result: {}", e))
}

/// Force sync with Horizon
#[tauri::command]
pub async fn la_sync() -> Result<bool, String> {
    let client = get_client();
    let response = client.send_request("device.sync", serde_json::json!({})).await?;
    let queued = response.get("queued").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(queued)
}

/// Check a specific entitlement
#[tauri::command]
pub async fn la_check_entitlement(key: String) -> Result<EntitlementCheck, String> {
    let client = get_client();
    let response = client.send_request("entitlement.check", serde_json::json!({ "key": key })).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse entitlement check: {}", e))
}

/// List all entitlements
#[tauri::command]
pub async fn la_list_entitlements() -> Result<Vec<Entitlement>, String> {
    let client = get_client();
    let response = client.send_request("entitlement.list", serde_json::json!({})).await?;
    let entitlements = response.get("entitlements")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(entitlements)
        .map_err(|e| format!("Failed to parse entitlements: {}", e))
}

/// List downloaded packs
#[tauri::command]
pub async fn la_list_packs() -> Result<Vec<PackInfo>, String> {
    let client = get_client();
    let response = client.send_request("pack.list", serde_json::json!({})).await?;
    let packs = response.get("packs")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(packs)
        .map_err(|e| format!("Failed to parse packs: {}", e))
}

/// Get pack catalog from Horizon
#[tauri::command]
pub async fn la_get_pack_catalog() -> Result<Vec<PackCatalogRegion>, String> {
    let client = get_client();
    let response = client.send_request("pack.catalog", serde_json::json!({})).await?;
    let catalog = response.get("catalog")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(catalog)
        .map_err(|e| format!("Failed to parse catalog: {}", e))
}

/// Request pack download
#[tauri::command]
pub async fn la_request_pack(region_slug: String, zoom_levels: Option<Vec<u8>>) -> Result<serde_json::Value, String> {
    let client = get_client();
    let params = serde_json::json!({
        "region_slug": region_slug,
        "zoom_levels": zoom_levels,
    });
    client.send_request("pack.request", params).await
}

/// Get pack status
#[tauri::command]
pub async fn la_get_pack_status(pack_id: String) -> Result<PackInfo, String> {
    let client = get_client();
    let response = client.send_request("pack.status", serde_json::json!({ "pack_id": pack_id })).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse pack status: {}", e))
}

/// Delete a pack
#[tauri::command]
pub async fn la_delete_pack(pack_id: String) -> Result<bool, String> {
    let client = get_client();
    let response = client.send_request("pack.delete", serde_json::json!({ "pack_id": pack_id })).await?;
    let deleted = response.get("deleted").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(deleted)
}

/// Get a tile from LA (base64 encoded)
#[tauri::command]
pub async fn la_get_tile(z: u8, x: u32, y: u32, layer: Option<String>) -> Result<TileData, String> {
    let client = get_client();
    let params = serde_json::json!({
        "z": z,
        "x": x,
        "y": y,
        "layer": layer.unwrap_or_else(|| "default".to_string()),
    });
    let response = client.send_request("tile.get", params).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse tile data: {}", e))
}

// ==============================================
// Custom Pack (Download Area) Commands
// ==============================================

/// Custom pack request result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPackResult {
    pub pack_id: String,
    pub status: String,
    pub tile_count: u64,
}

/// Tile estimate result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileEstimateResult {
    pub tile_count: u64,
    pub estimated_size_bytes: u64,
}

/// Request a custom pack download for a user-defined area
#[tauri::command]
pub async fn la_request_custom_pack(
    bounds: PackBounds,
    zoom_levels: Vec<u8>,
    basemap_id: String,
    name: String,
) -> Result<CustomPackResult, String> {
    println!("[Tauri LA] la_request_custom_pack called");
    println!("[Tauri LA]   bounds: {:?}", bounds);
    println!("[Tauri LA]   zoom_levels: {:?}", zoom_levels);
    println!("[Tauri LA]   basemap_id: {}", basemap_id);
    println!("[Tauri LA]   name: {}", name);

    let client = get_client();
    let params = serde_json::json!({
        "bounds": {
            "min_lon": bounds.min_lon,
            "min_lat": bounds.min_lat,
            "max_lon": bounds.max_lon,
            "max_lat": bounds.max_lat,
        },
        "zoom_levels": zoom_levels,
        "basemap_id": basemap_id,
        "name": name,
    });

    println!("[Tauri LA] Sending IPC request: pack.custom_request");
    match client.send_request("pack.custom_request", params).await {
        Ok(response) => {
            println!("[Tauri LA] IPC response received: {:?}", response);
            match serde_json::from_value::<CustomPackResult>(response.clone()) {
                Ok(result) => {
                    println!("[Tauri LA] Parsed result: {:?}", result);
                    Ok(result)
                }
                Err(e) => {
                    println!("[Tauri LA] Failed to parse response: {}", e);
                    println!("[Tauri LA] Raw response was: {:?}", response);
                    Err(format!("Failed to parse custom pack result: {}", e))
                }
            }
        }
        Err(e) => {
            println!("[Tauri LA] IPC request FAILED: {}", e);
            Err(e)
        }
    }
}

/// Estimate tile count and size for a custom area
#[tauri::command]
pub async fn la_estimate_pack_tiles(
    bounds: PackBounds,
    zoom_levels: Vec<u8>,
) -> Result<TileEstimateResult, String> {
    let client = get_client();
    let params = serde_json::json!({
        "bounds": {
            "min_lon": bounds.min_lon,
            "min_lat": bounds.min_lat,
            "max_lon": bounds.max_lon,
            "max_lat": bounds.max_lat,
        },
        "zoom_levels": zoom_levels,
    });
    let response = client.send_request("pack.estimate_tiles", params).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse tile estimate: {}", e))
}

/// Download progress result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressResult {
    pub pack_id: String,
    pub total_tiles: u32,
    pub downloaded_tiles: u32,
    pub failed_tiles: u32,
    pub percent: f32,
    pub status: String,
    #[serde(default)]
    pub paused: bool,
    pub eta_seconds: Option<u32>,
    pub tiles_per_second: Option<f32>,
}

/// Get download progress for a pack
#[tauri::command]
pub async fn la_get_download_progress(pack_id: String) -> Result<DownloadProgressResult, String> {
    println!("[Tauri] la_get_download_progress called for pack: {}", pack_id);
    let client = get_client();
    let response = client.send_request("pack.download_progress", serde_json::json!({ "pack_id": pack_id })).await?;
    println!("[Tauri] la_get_download_progress response: {:?}", response);
    let result: DownloadProgressResult = serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse download progress: {}", e))?;
    println!("[Tauri] la_get_download_progress parsed: percent={}, status={}", result.percent, result.status);
    Ok(result)
}

/// Pause download result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PauseResumeResult {
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub resumed: bool,
}

/// Pause a download
#[tauri::command]
pub async fn la_pause_download(pack_id: String) -> Result<PauseResumeResult, String> {
    println!("[Tauri] la_pause_download called for pack: {}", pack_id);
    let client = get_client();
    let response = client.send_request("pack.pause", serde_json::json!({ "pack_id": pack_id })).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse pause result: {}", e))
}

/// Resume a paused download
#[tauri::command]
pub async fn la_resume_download(pack_id: String) -> Result<PauseResumeResult, String> {
    println!("[Tauri] la_resume_download called for pack: {}", pack_id);
    let client = get_client();
    let response = client.send_request("pack.resume", serde_json::json!({ "pack_id": pack_id })).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse resume result: {}", e))
}

/// Cancel download result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelResult {
    #[serde(default)]
    pub cancelled: bool,
}

/// Cancel a download
#[tauri::command]
pub async fn la_cancel_download(pack_id: String) -> Result<CancelResult, String> {
    println!("[Tauri] la_cancel_download called for pack: {}", pack_id);
    let client = get_client();
    let response = client.send_request("pack.cancel", serde_json::json!({ "pack_id": pack_id })).await?;
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse cancel result: {}", e))
}

/// Export pack result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPackResult {
    pub success: bool,
    pub destination_path: String,
    pub size_bytes: u64,
}

/// Minimal pack status for export (only fields we need)
#[derive(Debug, Clone, Deserialize)]
struct PackStatusForExport {
    pub id: String,
    pub storage_path: Option<String>,
}

/// Export a pack's MBTiles file to user-specified location
#[tauri::command]
pub async fn la_export_pack(pack_id: String, destination_path: String) -> Result<ExportPackResult, String> {
    println!("[Tauri] la_export_pack called: pack_id={}, dest={}", pack_id, destination_path);

    // First, get the pack info to find the storage path
    let client = get_client();
    let response = client.send_request("pack.status", serde_json::json!({ "pack_id": pack_id })).await?;
    println!("[Tauri] pack.status response: {:?}", response);

    let pack_status: PackStatusForExport = serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse pack status: {}", e))?;

    let source_path = pack_status.storage_path
        .ok_or_else(|| "Pack has no storage path - may not be downloaded yet".to_string())?;

    println!("[Tauri] Copying from {} to {}", source_path, destination_path);

    // Copy the file
    let metadata = tokio::fs::metadata(&source_path).await
        .map_err(|e| format!("Failed to read source file: {}", e))?;

    tokio::fs::copy(&source_path, &destination_path).await
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    println!("[Tauri] Export successful: {} bytes", metadata.len());

    Ok(ExportPackResult {
        success: true,
        destination_path,
        size_bytes: metadata.len(),
    })
}
