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
    pub region_slug: String,
    pub name: String,
    pub status: String,
    pub tile_count: Option<u32>,
    pub size_bytes: Option<u64>,
    pub expires_at: String,
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
