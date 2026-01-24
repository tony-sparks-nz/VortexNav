// Database module for SQLite configuration and MBTiles tile serving

use rusqlite::{Connection, Result as SqliteResult, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Tile not found: z={z}, x={x}, y={y}")]
    TileNotFound { z: u32, x: u32, y: u32 },
    #[error("MBTiles file not found: {0}")]
    MBTilesNotFound(String),
}

// Waypoint definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Waypoint {
    pub id: Option<i64>,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub description: Option<String>,
    pub symbol: Option<String>,
    pub created_at: Option<String>,
}

// Route definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub waypoint_ids: Vec<i64>,
    pub created_at: Option<String>,
}

// App settings stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub basemap: String,
    pub show_openseamap: bool,
    pub esri_api_key: Option<String>,
    pub last_lat: Option<f64>,
    pub last_lon: Option<f64>,
    pub last_zoom: Option<f64>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "day".to_string(),
            basemap: "osm".to_string(),
            show_openseamap: true,
            esri_api_key: None,
            last_lat: None,
            last_lon: None,
            last_zoom: Some(10.0),
        }
    }
}

// GPS source record for database storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpsSourceRecord {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub port_name: Option<String>,
    pub baud_rate: u32,
    pub enabled: bool,
    pub priority: i32,
}

// MBTiles metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MBTilesMetadata {
    pub name: Option<String>,
    pub format: Option<String>,
    pub bounds: Option<String>,
    pub center: Option<String>,
    pub minzoom: Option<i32>,
    pub maxzoom: Option<i32>,
    pub description: Option<String>,
}

// Chart layer state for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartLayerState {
    pub chart_id: String,
    pub enabled: bool,
    pub opacity: f64,
    pub z_order: i32,
}

// Configuration database manager
pub struct ConfigDatabase {
    conn: Mutex<Connection>,
}

impl ConfigDatabase {
    pub fn new(data_dir: &PathBuf) -> Result<Self, DatabaseError> {
        std::fs::create_dir_all(data_dir)?;
        let db_path = data_dir.join("vortexnav.db");
        let conn = Connection::open(db_path)?;

        let db = Self { conn: Mutex::new(conn) };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Settings table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Waypoints table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS waypoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                description TEXT,
                symbol TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Routes table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Route waypoints junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS route_waypoints (
                route_id INTEGER NOT NULL,
                waypoint_id INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                PRIMARY KEY (route_id, waypoint_id),
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
                FOREIGN KEY (waypoint_id) REFERENCES waypoints(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // MBTiles registry - tracks available offline chart files
        conn.execute(
            "CREATE TABLE IF NOT EXISTS mbtiles_registry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                minzoom INTEGER,
                maxzoom INTEGER,
                bounds TEXT,
                enabled INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // GPS sources configuration
        conn.execute(
            "CREATE TABLE IF NOT EXISTS gps_sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                port_name TEXT,
                baud_rate INTEGER NOT NULL DEFAULT 4800,
                enabled INTEGER NOT NULL DEFAULT 1,
                priority INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Chart layer state - stores user preferences for each chart layer
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chart_layers (
                chart_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                opacity REAL NOT NULL DEFAULT 1.0,
                z_order INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        Ok(())
    }

    // Settings methods
    pub fn get_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")?;
        let result = stmt.query_row([key], |row| row.get(0));
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> SqliteResult<AppSettings> {
        let mut settings = AppSettings::default();

        if let Some(v) = self.get_setting("theme")? { settings.theme = v; }
        if let Some(v) = self.get_setting("basemap")? { settings.basemap = v; }
        if let Some(v) = self.get_setting("show_openseamap")? {
            settings.show_openseamap = v == "true";
        }
        if let Some(v) = self.get_setting("esri_api_key")? {
            settings.esri_api_key = Some(v);
        }
        if let Some(v) = self.get_setting("last_lat")? {
            settings.last_lat = v.parse().ok();
        }
        if let Some(v) = self.get_setting("last_lon")? {
            settings.last_lon = v.parse().ok();
        }
        if let Some(v) = self.get_setting("last_zoom")? {
            settings.last_zoom = v.parse().ok();
        }

        Ok(settings)
    }

    pub fn save_all_settings(&self, settings: &AppSettings) -> SqliteResult<()> {
        self.set_setting("theme", &settings.theme)?;
        self.set_setting("basemap", &settings.basemap)?;
        self.set_setting("show_openseamap", if settings.show_openseamap { "true" } else { "false" })?;
        if let Some(ref key) = settings.esri_api_key {
            self.set_setting("esri_api_key", key)?;
        }
        if let Some(lat) = settings.last_lat {
            self.set_setting("last_lat", &lat.to_string())?;
        }
        if let Some(lon) = settings.last_lon {
            self.set_setting("last_lon", &lon.to_string())?;
        }
        if let Some(zoom) = settings.last_zoom {
            self.set_setting("last_zoom", &zoom.to_string())?;
        }
        Ok(())
    }

    // Waypoint methods
    pub fn create_waypoint(&self, waypoint: &Waypoint) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO waypoints (name, lat, lon, description, symbol) VALUES (?, ?, ?, ?, ?)",
            params![waypoint.name, waypoint.lat, waypoint.lon, waypoint.description, waypoint.symbol],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_waypoints(&self) -> SqliteResult<Vec<Waypoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, lat, lon, description, symbol, created_at FROM waypoints ORDER BY name"
        )?;
        let waypoints = stmt.query_map([], |row| {
            Ok(Waypoint {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                lat: row.get(2)?,
                lon: row.get(3)?,
                description: row.get(4)?,
                symbol: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(waypoints)
    }

    pub fn update_waypoint(&self, waypoint: &Waypoint) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE waypoints SET name = ?, lat = ?, lon = ?, description = ?, symbol = ? WHERE id = ?",
            params![waypoint.name, waypoint.lat, waypoint.lon, waypoint.description, waypoint.symbol, waypoint.id],
        )?;
        Ok(())
    }

    pub fn delete_waypoint(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM waypoints WHERE id = ?", params![id])?;
        Ok(())
    }

    // MBTiles registry methods
    pub fn register_mbtiles(&self, name: &str, file_path: &str, metadata: &MBTilesMetadata) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO mbtiles_registry (name, file_path, minzoom, maxzoom, bounds)
             VALUES (?, ?, ?, ?, ?)",
            params![name, file_path, metadata.minzoom, metadata.maxzoom, metadata.bounds],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_registered_mbtiles(&self) -> SqliteResult<Vec<(i64, String, String, bool)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, file_path, enabled FROM mbtiles_registry ORDER BY name"
        )?;
        let files = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, i32>(3)? == 1))
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(files)
    }

    // GPS source methods
    pub fn save_gps_source(&self, source: &GpsSourceRecord) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO gps_sources (id, name, source_type, port_name, baud_rate, enabled, priority)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                source.id,
                source.name,
                source.source_type,
                source.port_name,
                source.baud_rate,
                if source.enabled { 1 } else { 0 },
                source.priority
            ],
        )?;
        Ok(())
    }

    pub fn get_gps_sources(&self) -> SqliteResult<Vec<GpsSourceRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, source_type, port_name, baud_rate, enabled, priority
             FROM gps_sources ORDER BY priority ASC, name ASC"
        )?;
        let sources = stmt.query_map([], |row| {
            Ok(GpsSourceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                source_type: row.get(2)?,
                port_name: row.get(3)?,
                baud_rate: row.get(4)?,
                enabled: row.get::<_, i32>(5)? == 1,
                priority: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(sources)
    }

    pub fn delete_gps_source(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM gps_sources WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn update_gps_source_priority(&self, id: &str, priority: i32) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE gps_sources SET priority = ? WHERE id = ?",
            params![priority, id],
        )?;
        Ok(())
    }

    // Chart layer state methods
    pub fn save_chart_layer_state(&self, state: &ChartLayerState) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO chart_layers (chart_id, enabled, opacity, z_order)
             VALUES (?, ?, ?, ?)",
            params![
                state.chart_id,
                if state.enabled { 1 } else { 0 },
                state.opacity,
                state.z_order
            ],
        )?;
        Ok(())
    }

    pub fn get_chart_layer_states(&self) -> SqliteResult<Vec<ChartLayerState>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT chart_id, enabled, opacity, z_order FROM chart_layers ORDER BY z_order ASC"
        )?;
        let states = stmt.query_map([], |row| {
            Ok(ChartLayerState {
                chart_id: row.get(0)?,
                enabled: row.get::<_, i32>(1)? == 1,
                opacity: row.get(2)?,
                z_order: row.get(3)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(states)
    }

    pub fn get_chart_layer_state(&self, chart_id: &str) -> SqliteResult<Option<ChartLayerState>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT chart_id, enabled, opacity, z_order FROM chart_layers WHERE chart_id = ?"
        )?;
        let result = stmt.query_row([chart_id], |row| {
            Ok(ChartLayerState {
                chart_id: row.get(0)?,
                enabled: row.get::<_, i32>(1)? == 1,
                opacity: row.get(2)?,
                z_order: row.get(3)?,
            })
        });
        match result {
            Ok(state) => Ok(Some(state)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn delete_chart_layer_state(&self, chart_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chart_layers WHERE chart_id = ?", params![chart_id])?;
        Ok(())
    }

    pub fn delete_mbtiles_registry(&self, chart_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // Delete by file name (chart_id is the file stem)
        conn.execute(
            "DELETE FROM mbtiles_registry WHERE file_path LIKE ?",
            params![format!("%{}.mbtiles", chart_id)],
        )?;
        Ok(())
    }
}

// MBTiles file reader for serving offline tiles
pub struct MBTilesReader {
    conn: Connection,
}

impl MBTilesReader {
    pub fn open(path: &str) -> Result<Self, DatabaseError> {
        if !std::path::Path::new(path).exists() {
            return Err(DatabaseError::MBTilesNotFound(path.to_string()));
        }
        let conn = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        Ok(Self { conn })
    }

    pub fn get_metadata(&self) -> Result<MBTilesMetadata, DatabaseError> {
        let mut metadata = MBTilesMetadata {
            name: None,
            format: None,
            bounds: None,
            center: None,
            minzoom: None,
            maxzoom: None,
            description: None,
        };

        let mut stmt = self.conn.prepare("SELECT name, value FROM metadata")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        for row in rows {
            let (name, value) = row?;
            match name.as_str() {
                "name" => metadata.name = Some(value),
                "format" => metadata.format = Some(value),
                "bounds" => metadata.bounds = Some(value),
                "center" => metadata.center = Some(value),
                "minzoom" => metadata.minzoom = value.parse().ok(),
                "maxzoom" => metadata.maxzoom = value.parse().ok(),
                "description" => metadata.description = Some(value),
                _ => {}
            }
        }

        Ok(metadata)
    }

    pub fn get_tile(&self, z: u32, x: u32, y: u32) -> Result<Vec<u8>, DatabaseError> {
        // MBTiles uses TMS coordinate system (y is flipped)
        let tms_y = (1 << z) - 1 - y;

        let mut stmt = self.conn.prepare(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?"
        )?;

        let tile_data: Vec<u8> = stmt.query_row(params![z, x, tms_y], |row| row.get(0))
            .map_err(|_| DatabaseError::TileNotFound { z, x, y })?;

        Ok(tile_data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn test_config_database() {
        let temp = temp_dir().join("vortexnav_test");
        let db = ConfigDatabase::new(&temp).unwrap();

        // Test settings
        db.set_setting("theme", "night").unwrap();
        assert_eq!(db.get_setting("theme").unwrap(), Some("night".to_string()));

        // Test waypoint
        let wp = Waypoint {
            id: None,
            name: "Test".to_string(),
            lat: 37.8,
            lon: -122.4,
            description: None,
            symbol: None,
            created_at: None,
        };
        let id = db.create_waypoint(&wp).unwrap();
        let waypoints = db.get_waypoints().unwrap();
        assert_eq!(waypoints.len(), 1);
        assert_eq!(waypoints[0].id, Some(id));

        // Cleanup
        std::fs::remove_dir_all(temp).ok();
    }
}
