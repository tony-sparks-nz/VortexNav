// Database module for SQLite configuration and MBTiles tile serving

use rusqlite::{Connection, Result as SqliteResult, params, OptionalExtension};
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
    pub show_label: bool,
    pub hidden: bool,
    pub created_at: Option<String>,
}

// Route definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,           // Route line color (hex)
    pub is_active: bool,                 // Currently navigating this route
    pub hidden: bool,                    // Route visibility (hidden/visible)
    pub total_distance_nm: Option<f64>,  // Cached total distance
    pub estimated_speed_kn: f64,         // For ETA calculations
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl Default for Route {
    fn default() -> Self {
        Self {
            id: None,
            name: String::new(),
            description: None,
            color: Some("#c026d3".to_string()), // Magenta - standard course line
            is_active: false,
            hidden: false,
            total_distance_nm: None,
            estimated_speed_kn: 5.0,
            created_at: None,
            updated_at: None,
        }
    }
}

// Route tag for categorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteTag {
    pub id: Option<i64>,
    pub name: String,
    pub color: Option<String>,
    pub created_at: Option<String>,
}

// Route with full data loaded (waypoints and tags)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteWithWaypoints {
    pub route: Route,
    pub waypoints: Vec<Waypoint>,
    pub tags: Vec<RouteTag>,
}

// Track definition (recorded vessel trail)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub is_recording: bool,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub total_distance_nm: Option<f64>,
    pub point_count: i64,
    pub hidden: bool,
    pub created_at: Option<String>,
}

impl Default for Track {
    fn default() -> Self {
        Self {
            id: None,
            name: String::new(),
            description: None,
            color: Some("#06b6d4".to_string()), // Cyan - distinct from magenta routes
            is_recording: false,
            started_at: None,
            ended_at: None,
            total_distance_nm: None,
            point_count: 0,
            hidden: false,
            created_at: None,
        }
    }
}

// Track point (position in a recorded track)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackPoint {
    pub id: Option<i64>,
    pub track_id: i64,
    pub lat: f64,
    pub lon: f64,
    pub timestamp: String,
    pub sequence: i64,
    pub heading: Option<f64>,
    pub cog: Option<f64>,
    pub sog: Option<f64>,
}

// Track with all its points loaded
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackWithPoints {
    pub track: Track,
    pub points: Vec<TrackPoint>,
}

// Route statistics for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteStatistics {
    pub total_distance_nm: f64,
    pub waypoint_count: usize,
    pub estimated_time_hours: f64,
    pub leg_distances: Vec<f64>,
    pub leg_bearings: Vec<f64>,
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

// Chart custom metadata - user-editable overrides
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartCustomMetadata {
    pub chart_id: String,
    pub custom_name: Option<String>,
    pub custom_description: Option<String>,
    pub custom_min_zoom: Option<i32>,
    pub custom_max_zoom: Option<i32>,
}

// GEBCO bathymetry settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GebcoSettings {
    pub show_hillshade: bool,
    pub show_color: bool,
    pub show_contours: bool,
    pub hillshade_opacity: f64,
    pub color_opacity: f64,
    pub contour_interval: u32,  // meters: 10, 50, 100, 500, 1000
}

impl Default for GebcoSettings {
    fn default() -> Self {
        Self {
            show_hillshade: true,
            show_color: true,
            show_contours: false,
            hillshade_opacity: 0.3,
            color_opacity: 0.5,
            contour_interval: 100,
        }
    }
}

// Base nautical chart settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseNauticalSettings {
    pub enabled: bool,
    pub opacity: f64,
}

impl Default for BaseNauticalSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            opacity: 0.8,
        }
    }
}

// CM93 vector chart visualization settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cm93Settings {
    pub enabled: bool,
    pub opacity: f64,
    pub show_soundings: bool,
    pub show_depth_contours: bool,
    pub show_lights: bool,
    pub show_buoys: bool,
    pub show_land: bool,
    pub show_obstructions: bool,
    pub cm93_path: Option<String>,
}

impl Default for Cm93Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            opacity: 1.0,
            show_soundings: true,
            show_depth_contours: true,
            show_lights: true,
            show_buoys: true,
            show_land: true,
            show_obstructions: true,
            cm93_path: None,
        }
    }
}

// Chart catalog (imported from XML)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartCatalog {
    pub id: Option<i64>,
    pub name: String,
    pub catalog_type: String,  // "RNC" or "ENC"
    pub source_type: String,   // "file" or "url"
    pub source_path: String,   // Local file path or remote URL
    pub imported_at: Option<String>,
    pub last_refreshed: Option<String>,
    pub chart_count: Option<i64>,
}

// Chart available in a catalog
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogChart {
    pub id: Option<i64>,
    pub catalog_id: i64,
    pub chart_id: String,      // number (RNC) or name (ENC)
    pub title: String,
    pub chart_type: String,    // "RNC", "ENC"
    pub format: Option<String>, // "BSB", "S57", "MBTiles"
    pub scale: Option<i64>,
    pub status: Option<String>, // "Active", "Cancelled", etc.
    pub download_url: String,
    pub file_size: Option<i64>,
    pub last_updated: Option<String>,
    pub bounds: Option<String>, // JSON coverage polygon
    pub download_status: String, // "available", "downloading", "downloaded", "converting", "ready", "failed"
    pub download_progress: i64,
    pub download_path: Option<String>,
    pub mbtiles_path: Option<String>,
    pub error_message: Option<String>,
}

// Download progress info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub chart_id: String,
    pub bytes_downloaded: i64,
    pub total_bytes: i64,
    pub status: String,
    pub error: Option<String>,
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
                show_label INTEGER NOT NULL DEFAULT 1,
                hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Migration: add show_label column if it doesn't exist (for existing databases)
        let _ = conn.execute(
            "ALTER TABLE waypoints ADD COLUMN show_label INTEGER NOT NULL DEFAULT 1",
            [],
        );

        // Migration: add hidden column if it doesn't exist (for existing databases)
        let _ = conn.execute(
            "ALTER TABLE waypoints ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
            [],
        );

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

        // Route tags table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS route_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Route-tag junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS route_tag_assignments (
                route_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (route_id, tag_id),
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES route_tags(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Migrations: Add new columns to routes table (for existing databases)
        let _ = conn.execute("ALTER TABLE routes ADD COLUMN color TEXT DEFAULT '#c026d3'", []);
        let _ = conn.execute("ALTER TABLE routes ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE routes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE routes ADD COLUMN total_distance_nm REAL", []);
        let _ = conn.execute("ALTER TABLE routes ADD COLUMN estimated_speed_kn REAL DEFAULT 5.0", []);
        let _ = conn.execute("ALTER TABLE routes ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP", []);

        // Insert default route tags
        let default_tags = [
            ("Favorites", "#f59e0b"),
            ("Coastal", "#3b82f6"),
            ("Ocean Crossing", "#8b5cf6"),
            ("Harbor Entry", "#22c55e"),
            ("Anchorage Approach", "#06b6d4"),
            ("Emergency", "#ef4444"),
            ("Historic", "#a855f7"),
        ];
        for (name, color) in default_tags {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO route_tags (name, color) VALUES (?, ?)",
                params![name, color],
            );
        }

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

        // Migrations: Add custom metadata columns to chart_layers (for existing databases)
        let _ = conn.execute("ALTER TABLE chart_layers ADD COLUMN custom_name TEXT", []);
        let _ = conn.execute("ALTER TABLE chart_layers ADD COLUMN custom_description TEXT", []);
        let _ = conn.execute("ALTER TABLE chart_layers ADD COLUMN custom_min_zoom INTEGER", []);
        let _ = conn.execute("ALTER TABLE chart_layers ADD COLUMN custom_max_zoom INTEGER", []);

        // Chart catalogs - imported from XML files or URLs
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chart_catalogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                catalog_type TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_path TEXT NOT NULL,
                imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_refreshed TEXT
            )",
            [],
        )?;

        // Catalog charts - charts available in imported catalogs
        conn.execute(
            "CREATE TABLE IF NOT EXISTS catalog_charts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                catalog_id INTEGER NOT NULL,
                chart_id TEXT NOT NULL,
                title TEXT NOT NULL,
                chart_type TEXT NOT NULL,
                format TEXT,
                scale INTEGER,
                status TEXT,
                download_url TEXT NOT NULL,
                file_size INTEGER,
                last_updated TEXT,
                bounds TEXT,
                download_status TEXT DEFAULT 'available',
                download_progress INTEGER DEFAULT 0,
                download_path TEXT,
                mbtiles_path TEXT,
                error_message TEXT,
                FOREIGN KEY (catalog_id) REFERENCES chart_catalogs(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Tracks table - recorded vessel trails
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                color TEXT DEFAULT '#06b6d4',
                is_recording INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                ended_at TEXT,
                total_distance_nm REAL,
                point_count INTEGER DEFAULT 0,
                hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Track points table - individual positions in a track
        conn.execute(
            "CREATE TABLE IF NOT EXISTS track_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id INTEGER NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                timestamp TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                heading REAL,
                cog REAL,
                sog REAL,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Index for faster track point lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_track_points_track_id ON track_points(track_id)",
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

    // GEBCO bathymetry settings methods
    pub fn get_gebco_settings(&self) -> SqliteResult<GebcoSettings> {
        let mut settings = GebcoSettings::default();

        if let Some(v) = self.get_setting("gebco_show_hillshade")? {
            settings.show_hillshade = v == "true";
        }
        if let Some(v) = self.get_setting("gebco_show_color")? {
            settings.show_color = v == "true";
        }
        if let Some(v) = self.get_setting("gebco_show_contours")? {
            settings.show_contours = v == "true";
        }
        if let Some(v) = self.get_setting("gebco_hillshade_opacity")? {
            if let Ok(opacity) = v.parse() {
                settings.hillshade_opacity = opacity;
            }
        }
        if let Some(v) = self.get_setting("gebco_color_opacity")? {
            if let Ok(opacity) = v.parse() {
                settings.color_opacity = opacity;
            }
        }
        if let Some(v) = self.get_setting("gebco_contour_interval")? {
            if let Ok(interval) = v.parse() {
                settings.contour_interval = interval;
            }
        }

        Ok(settings)
    }

    pub fn save_gebco_settings(&self, settings: &GebcoSettings) -> SqliteResult<()> {
        self.set_setting("gebco_show_hillshade", if settings.show_hillshade { "true" } else { "false" })?;
        self.set_setting("gebco_show_color", if settings.show_color { "true" } else { "false" })?;
        self.set_setting("gebco_show_contours", if settings.show_contours { "true" } else { "false" })?;
        self.set_setting("gebco_hillshade_opacity", &settings.hillshade_opacity.to_string())?;
        self.set_setting("gebco_color_opacity", &settings.color_opacity.to_string())?;
        self.set_setting("gebco_contour_interval", &settings.contour_interval.to_string())?;
        Ok(())
    }

    // Base nautical chart settings methods
    pub fn get_base_nautical_settings(&self) -> SqliteResult<BaseNauticalSettings> {
        let mut settings = BaseNauticalSettings::default();

        if let Some(v) = self.get_setting("base_nautical_enabled")? {
            settings.enabled = v == "true";
        }
        if let Some(v) = self.get_setting("base_nautical_opacity")? {
            if let Ok(opacity) = v.parse() {
                settings.opacity = opacity;
            }
        }

        Ok(settings)
    }

    pub fn save_base_nautical_settings(&self, settings: &BaseNauticalSettings) -> SqliteResult<()> {
        self.set_setting("base_nautical_enabled", if settings.enabled { "true" } else { "false" })?;
        self.set_setting("base_nautical_opacity", &settings.opacity.to_string())?;
        Ok(())
    }

    // CM93 vector chart settings methods
    pub fn get_cm93_settings(&self) -> SqliteResult<Cm93Settings> {
        let mut settings = Cm93Settings::default();

        if let Some(v) = self.get_setting("cm93_enabled")? {
            settings.enabled = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_opacity")? {
            if let Ok(opacity) = v.parse() {
                settings.opacity = opacity;
            }
        }
        if let Some(v) = self.get_setting("cm93_show_soundings")? {
            settings.show_soundings = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_show_depth_contours")? {
            settings.show_depth_contours = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_show_lights")? {
            settings.show_lights = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_show_buoys")? {
            settings.show_buoys = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_show_land")? {
            settings.show_land = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_show_obstructions")? {
            settings.show_obstructions = v == "true";
        }
        if let Some(v) = self.get_setting("cm93_path")? {
            settings.cm93_path = Some(v);
        }

        Ok(settings)
    }

    pub fn save_cm93_settings(&self, settings: &Cm93Settings) -> SqliteResult<()> {
        self.set_setting("cm93_enabled", if settings.enabled { "true" } else { "false" })?;
        self.set_setting("cm93_opacity", &settings.opacity.to_string())?;
        self.set_setting("cm93_show_soundings", if settings.show_soundings { "true" } else { "false" })?;
        self.set_setting("cm93_show_depth_contours", if settings.show_depth_contours { "true" } else { "false" })?;
        self.set_setting("cm93_show_lights", if settings.show_lights { "true" } else { "false" })?;
        self.set_setting("cm93_show_buoys", if settings.show_buoys { "true" } else { "false" })?;
        self.set_setting("cm93_show_land", if settings.show_land { "true" } else { "false" })?;
        self.set_setting("cm93_show_obstructions", if settings.show_obstructions { "true" } else { "false" })?;
        if let Some(ref path) = settings.cm93_path {
            self.set_setting("cm93_path", path)?;
        }
        Ok(())
    }

    // Waypoint methods
    pub fn create_waypoint(&self, waypoint: &Waypoint) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO waypoints (name, lat, lon, description, symbol, show_label, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![waypoint.name, waypoint.lat, waypoint.lon, waypoint.description, waypoint.symbol, if waypoint.show_label { 1 } else { 0 }, if waypoint.hidden { 1 } else { 0 }],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_waypoints(&self) -> SqliteResult<Vec<Waypoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, lat, lon, description, symbol, show_label, hidden, created_at FROM waypoints ORDER BY name"
        )?;
        let waypoints = stmt.query_map([], |row| {
            Ok(Waypoint {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                lat: row.get(2)?,
                lon: row.get(3)?,
                description: row.get(4)?,
                symbol: row.get(5)?,
                show_label: row.get::<_, i32>(6)? == 1,
                hidden: row.get::<_, i32>(7)? == 1,
                created_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(waypoints)
    }

    pub fn update_waypoint(&self, waypoint: &Waypoint) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE waypoints SET name = ?, lat = ?, lon = ?, description = ?, symbol = ?, show_label = ?, hidden = ? WHERE id = ?",
            params![waypoint.name, waypoint.lat, waypoint.lon, waypoint.description, waypoint.symbol, if waypoint.show_label { 1 } else { 0 }, if waypoint.hidden { 1 } else { 0 }, waypoint.id],
        )?;
        Ok(())
    }

    /// Toggle the hidden state of a waypoint
    pub fn toggle_waypoint_hidden(&self, id: i64, hidden: bool) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE waypoints SET hidden = ? WHERE id = ?",
            params![if hidden { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    /// Update only the position (lat/lon) of a waypoint.
    /// This is a safe operation for drag-and-drop that won't overwrite other fields.
    pub fn update_waypoint_position(&self, id: i64, lat: f64, lon: f64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE waypoints SET lat = ?, lon = ? WHERE id = ?",
            params![lat, lon, id],
        )?;
        Ok(())
    }

    pub fn delete_waypoint(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM waypoints WHERE id = ?", params![id])?;
        Ok(())
    }

    // ============ Route Tag Methods ============

    pub fn create_route_tag(&self, tag: &RouteTag) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO route_tags (name, color) VALUES (?, ?)",
            params![tag.name, tag.color],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_route_tags(&self) -> SqliteResult<Vec<RouteTag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, color, created_at FROM route_tags ORDER BY name"
        )?;
        let tags = stmt.query_map([], |row| {
            Ok(RouteTag {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn update_route_tag(&self, tag: &RouteTag) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE route_tags SET name = ?, color = ? WHERE id = ?",
            params![tag.name, tag.color, tag.id],
        )?;
        Ok(())
    }

    pub fn delete_route_tag(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM route_tags WHERE id = ?", params![id])?;
        Ok(())
    }

    // ============ Route Methods ============

    pub fn create_route(&self, route: &Route, waypoint_ids: &[i64], tag_ids: &[i64]) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();

        // Insert the route
        conn.execute(
            "INSERT INTO routes (name, description, color, is_active, hidden, total_distance_nm, estimated_speed_kn)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                route.name,
                route.description,
                route.color,
                if route.is_active { 1 } else { 0 },
                if route.hidden { 1 } else { 0 },
                route.total_distance_nm,
                route.estimated_speed_kn
            ],
        )?;
        let route_id = conn.last_insert_rowid();

        // Insert waypoint associations with sequence
        for (seq, wp_id) in waypoint_ids.iter().enumerate() {
            conn.execute(
                "INSERT INTO route_waypoints (route_id, waypoint_id, sequence) VALUES (?, ?, ?)",
                params![route_id, wp_id, seq as i32],
            )?;
        }

        // Insert tag associations
        for tag_id in tag_ids {
            conn.execute(
                "INSERT INTO route_tag_assignments (route_id, tag_id) VALUES (?, ?)",
                params![route_id, tag_id],
            )?;
        }

        Ok(route_id)
    }

    pub fn get_routes(&self) -> SqliteResult<Vec<RouteWithWaypoints>> {
        let conn = self.conn.lock().unwrap();

        // Get all routes
        let mut routes_stmt = conn.prepare(
            "SELECT id, name, description, color, is_active, hidden, total_distance_nm, estimated_speed_kn, created_at, updated_at
             FROM routes ORDER BY name"
        )?;

        let routes: Vec<Route> = routes_stmt.query_map([], |row| {
            Ok(Route {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                is_active: row.get::<_, i32>(4)? == 1,
                hidden: row.get::<_, i32>(5).unwrap_or(0) == 1,
                total_distance_nm: row.get(6)?,
                estimated_speed_kn: row.get::<_, f64>(7).unwrap_or(5.0),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        // For each route, get waypoints and tags
        let mut result = Vec::with_capacity(routes.len());

        for route in routes {
            let route_id = route.id.unwrap();

            // Get waypoints for this route (ordered by sequence)
            let mut wp_stmt = conn.prepare(
                "SELECT w.id, w.name, w.lat, w.lon, w.description, w.symbol, w.show_label, w.hidden, w.created_at
                 FROM waypoints w
                 JOIN route_waypoints rw ON w.id = rw.waypoint_id
                 WHERE rw.route_id = ?
                 ORDER BY rw.sequence"
            )?;

            let waypoints: Vec<Waypoint> = wp_stmt.query_map(params![route_id], |row| {
                Ok(Waypoint {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    lat: row.get(2)?,
                    lon: row.get(3)?,
                    description: row.get(4)?,
                    symbol: row.get(5)?,
                    show_label: row.get::<_, i32>(6)? == 1,
                    hidden: row.get::<_, i32>(7)? == 1,
                    created_at: row.get(8)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;

            // Get tags for this route
            let mut tag_stmt = conn.prepare(
                "SELECT t.id, t.name, t.color, t.created_at
                 FROM route_tags t
                 JOIN route_tag_assignments rta ON t.id = rta.tag_id
                 WHERE rta.route_id = ?"
            )?;

            let tags: Vec<RouteTag> = tag_stmt.query_map(params![route_id], |row| {
                Ok(RouteTag {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;

            result.push(RouteWithWaypoints { route, waypoints, tags });
        }

        Ok(result)
    }

    pub fn get_route(&self, id: i64) -> SqliteResult<Option<RouteWithWaypoints>> {
        let conn = self.conn.lock().unwrap();

        // Get the route
        let mut route_stmt = conn.prepare(
            "SELECT id, name, description, color, is_active, hidden, total_distance_nm, estimated_speed_kn, created_at, updated_at
             FROM routes WHERE id = ?"
        )?;

        let route: Option<Route> = route_stmt.query_row(params![id], |row| {
            Ok(Route {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                is_active: row.get::<_, i32>(4)? == 1,
                hidden: row.get::<_, i32>(5).unwrap_or(0) == 1,
                total_distance_nm: row.get(6)?,
                estimated_speed_kn: row.get::<_, f64>(7).unwrap_or(5.0),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        }).optional()?;

        match route {
            Some(route) => {
                // Get waypoints
                let mut wp_stmt = conn.prepare(
                    "SELECT w.id, w.name, w.lat, w.lon, w.description, w.symbol, w.show_label, w.hidden, w.created_at
                     FROM waypoints w
                     JOIN route_waypoints rw ON w.id = rw.waypoint_id
                     WHERE rw.route_id = ?
                     ORDER BY rw.sequence"
                )?;

                let waypoints: Vec<Waypoint> = wp_stmt.query_map(params![id], |row| {
                    Ok(Waypoint {
                        id: Some(row.get(0)?),
                        name: row.get(1)?,
                        lat: row.get(2)?,
                        lon: row.get(3)?,
                        description: row.get(4)?,
                        symbol: row.get(5)?,
                        show_label: row.get::<_, i32>(6)? == 1,
                        hidden: row.get::<_, i32>(7)? == 1,
                        created_at: row.get(8)?,
                    })
                })?.collect::<Result<Vec<_>, _>>()?;

                // Get tags
                let mut tag_stmt = conn.prepare(
                    "SELECT t.id, t.name, t.color, t.created_at
                     FROM route_tags t
                     JOIN route_tag_assignments rta ON t.id = rta.tag_id
                     WHERE rta.route_id = ?"
                )?;

                let tags: Vec<RouteTag> = tag_stmt.query_map(params![id], |row| {
                    Ok(RouteTag {
                        id: Some(row.get(0)?),
                        name: row.get(1)?,
                        color: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                })?.collect::<Result<Vec<_>, _>>()?;

                Ok(Some(RouteWithWaypoints { route, waypoints, tags }))
            }
            None => Ok(None),
        }
    }

    pub fn update_route(&self, route: &Route, waypoint_ids: &[i64], tag_ids: &[i64]) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let route_id = route.id.ok_or(rusqlite::Error::InvalidParameterName("Route must have an id".to_string()))?;

        // Update route metadata
        conn.execute(
            "UPDATE routes SET name = ?, description = ?, color = ?, is_active = ?, hidden = ?,
             total_distance_nm = ?, estimated_speed_kn = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
            params![
                route.name,
                route.description,
                route.color,
                if route.is_active { 1 } else { 0 },
                if route.hidden { 1 } else { 0 },
                route.total_distance_nm,
                route.estimated_speed_kn,
                route_id
            ],
        )?;

        // Replace waypoint associations
        conn.execute("DELETE FROM route_waypoints WHERE route_id = ?", params![route_id])?;
        for (seq, wp_id) in waypoint_ids.iter().enumerate() {
            conn.execute(
                "INSERT INTO route_waypoints (route_id, waypoint_id, sequence) VALUES (?, ?, ?)",
                params![route_id, wp_id, seq as i32],
            )?;
        }

        // Replace tag associations
        conn.execute("DELETE FROM route_tag_assignments WHERE route_id = ?", params![route_id])?;
        for tag_id in tag_ids {
            conn.execute(
                "INSERT INTO route_tag_assignments (route_id, tag_id) VALUES (?, ?)",
                params![route_id, tag_id],
            )?;
        }

        Ok(())
    }

    pub fn delete_route(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // CASCADE will delete route_waypoints and route_tag_assignments
        conn.execute("DELETE FROM routes WHERE id = ?", params![id])?;
        Ok(())
    }

    /// Get waypoints that belong to a route and are not used by any other route
    pub fn get_exclusive_route_waypoints(&self, route_id: i64) -> SqliteResult<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        // Find waypoints that are:
        // 1. Part of this route
        // 2. Not used by any other route
        let mut stmt = conn.prepare(
            "SELECT rw.waypoint_id
             FROM route_waypoints rw
             WHERE rw.route_id = ?
             AND NOT EXISTS (
                 SELECT 1 FROM route_waypoints other
                 WHERE other.waypoint_id = rw.waypoint_id
                 AND other.route_id != ?
             )"
        )?;
        let ids = stmt.query_map(params![route_id, route_id], |row| row.get(0))?
            .collect::<Result<Vec<i64>, _>>()?;
        Ok(ids)
    }

    /// Delete a route and optionally its exclusive waypoints (waypoints not used by other routes)
    pub fn delete_route_with_waypoints(&self, id: i64, delete_waypoints: bool) -> SqliteResult<Vec<i64>> {
        // First get the exclusive waypoints before deleting the route
        let waypoints_to_delete = if delete_waypoints {
            self.get_exclusive_route_waypoints(id)?
        } else {
            vec![]
        };

        let conn = self.conn.lock().unwrap();

        // Delete the route (CASCADE will delete route_waypoints and route_tag_assignments)
        conn.execute("DELETE FROM routes WHERE id = ?", params![id])?;

        // Delete the exclusive waypoints if requested
        if delete_waypoints {
            for wp_id in &waypoints_to_delete {
                conn.execute("DELETE FROM waypoints WHERE id = ?", params![wp_id])?;
            }
        }

        Ok(waypoints_to_delete)
    }

    pub fn duplicate_route(&self, id: i64, new_name: &str) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();

        // Get the original route
        let mut stmt = conn.prepare(
            "SELECT description, color, total_distance_nm, estimated_speed_kn FROM routes WHERE id = ?"
        )?;
        let (description, color, distance, speed): (Option<String>, Option<String>, Option<f64>, f64) =
            stmt.query_row(params![id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, f64>(3).unwrap_or(5.0)))
            })?;

        // Create the new route (duplicates start visible and not active)
        conn.execute(
            "INSERT INTO routes (name, description, color, is_active, hidden, total_distance_nm, estimated_speed_kn)
             VALUES (?, ?, ?, 0, 0, ?, ?)",
            params![new_name, description, color, distance, speed],
        )?;
        let new_id = conn.last_insert_rowid();

        // Copy waypoint associations
        conn.execute(
            "INSERT INTO route_waypoints (route_id, waypoint_id, sequence)
             SELECT ?, waypoint_id, sequence FROM route_waypoints WHERE route_id = ?",
            params![new_id, id],
        )?;

        // Copy tag associations
        conn.execute(
            "INSERT INTO route_tag_assignments (route_id, tag_id)
             SELECT ?, tag_id FROM route_tag_assignments WHERE route_id = ?",
            params![new_id, id],
        )?;

        Ok(new_id)
    }

    pub fn reverse_route(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Get current waypoint count
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM route_waypoints WHERE route_id = ?",
            params![id],
            |row| row.get(0),
        )?;

        // Reverse the sequence numbers
        conn.execute(
            "UPDATE route_waypoints SET sequence = ? - sequence - 1 WHERE route_id = ?",
            params![count, id],
        )?;

        // Update the route's updated_at timestamp
        conn.execute(
            "UPDATE routes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params![id],
        )?;

        Ok(())
    }

    pub fn set_active_route(&self, id: Option<i64>) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Clear all active routes first
        conn.execute("UPDATE routes SET is_active = 0", [])?;

        // Set the new active route if provided
        if let Some(route_id) = id {
            conn.execute(
                "UPDATE routes SET is_active = 1 WHERE id = ?",
                params![route_id],
            )?;
        }

        Ok(())
    }

    /// Toggle the hidden state of a route
    pub fn toggle_route_hidden(&self, id: i64, hidden: bool) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE routes SET hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params![if hidden { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn get_route_waypoint_ids(&self, route_id: i64) -> SqliteResult<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT waypoint_id FROM route_waypoints WHERE route_id = ? ORDER BY sequence"
        )?;
        let ids = stmt.query_map(params![route_id], |row| row.get(0))?
            .collect::<Result<Vec<i64>, _>>()?;
        Ok(ids)
    }

    pub fn get_waypoint(&self, id: i64) -> SqliteResult<Option<Waypoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, lat, lon, description, symbol, show_label, hidden, created_at
             FROM waypoints WHERE id = ?"
        )?;
        let waypoint = stmt.query_row(params![id], |row| {
            Ok(Waypoint {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                lat: row.get(2)?,
                lon: row.get(3)?,
                description: row.get(4)?,
                symbol: row.get(5)?,
                show_label: row.get::<_, i32>(6)? == 1,
                hidden: row.get::<_, i32>(7)? == 1,
                created_at: row.get(8)?,
            })
        }).optional()?;
        Ok(waypoint)
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

    /// Save custom metadata for a chart layer
    pub fn save_chart_custom_metadata(&self, metadata: &ChartCustomMetadata) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // First ensure the row exists (create with defaults if not)
        conn.execute(
            "INSERT OR IGNORE INTO chart_layers (chart_id, enabled, opacity, z_order)
             VALUES (?, 1, 1.0, 0)",
            params![metadata.chart_id],
        )?;
        // Then update the custom fields
        conn.execute(
            "UPDATE chart_layers SET custom_name = ?, custom_description = ?, custom_min_zoom = ?, custom_max_zoom = ?
             WHERE chart_id = ?",
            params![
                metadata.custom_name,
                metadata.custom_description,
                metadata.custom_min_zoom,
                metadata.custom_max_zoom,
                metadata.chart_id,
            ],
        )?;
        Ok(())
    }

    /// Get custom metadata for a chart
    pub fn get_chart_custom_metadata(&self, chart_id: &str) -> SqliteResult<Option<ChartCustomMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT chart_id, custom_name, custom_description, custom_min_zoom, custom_max_zoom
             FROM chart_layers WHERE chart_id = ?"
        )?;
        let result = stmt.query_row([chart_id], |row| {
            Ok(ChartCustomMetadata {
                chart_id: row.get(0)?,
                custom_name: row.get(1)?,
                custom_description: row.get(2)?,
                custom_min_zoom: row.get(3)?,
                custom_max_zoom: row.get(4)?,
            })
        });
        match result {
            Ok(meta) => Ok(Some(meta)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Get all custom metadata for charts
    pub fn get_all_chart_custom_metadata(&self) -> SqliteResult<Vec<ChartCustomMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT chart_id, custom_name, custom_description, custom_min_zoom, custom_max_zoom
             FROM chart_layers
             WHERE custom_name IS NOT NULL OR custom_description IS NOT NULL
                OR custom_min_zoom IS NOT NULL OR custom_max_zoom IS NOT NULL"
        )?;
        let metadata = stmt.query_map([], |row| {
            Ok(ChartCustomMetadata {
                chart_id: row.get(0)?,
                custom_name: row.get(1)?,
                custom_description: row.get(2)?,
                custom_min_zoom: row.get(3)?,
                custom_max_zoom: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(metadata)
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

    // Chart catalog methods
    pub fn create_catalog(&self, catalog: &ChartCatalog) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chart_catalogs (name, catalog_type, source_type, source_path)
             VALUES (?, ?, ?, ?)",
            params![catalog.name, catalog.catalog_type, catalog.source_type, catalog.source_path],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_catalogs(&self) -> SqliteResult<Vec<ChartCatalog>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.catalog_type, c.source_type, c.source_path,
                    c.imported_at, c.last_refreshed,
                    (SELECT COUNT(*) FROM catalog_charts WHERE catalog_id = c.id) as chart_count
             FROM chart_catalogs c ORDER BY c.name"
        )?;
        let catalogs = stmt.query_map([], |row| {
            Ok(ChartCatalog {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                catalog_type: row.get(2)?,
                source_type: row.get(3)?,
                source_path: row.get(4)?,
                imported_at: row.get(5)?,
                last_refreshed: row.get(6)?,
                chart_count: row.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(catalogs)
    }

    pub fn get_catalog(&self, id: i64) -> SqliteResult<Option<ChartCatalog>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.catalog_type, c.source_type, c.source_path,
                    c.imported_at, c.last_refreshed,
                    (SELECT COUNT(*) FROM catalog_charts WHERE catalog_id = c.id) as chart_count
             FROM chart_catalogs c WHERE c.id = ?"
        )?;
        let result = stmt.query_row([id], |row| {
            Ok(ChartCatalog {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                catalog_type: row.get(2)?,
                source_type: row.get(3)?,
                source_path: row.get(4)?,
                imported_at: row.get(5)?,
                last_refreshed: row.get(6)?,
                chart_count: row.get(7)?,
            })
        });
        match result {
            Ok(catalog) => Ok(Some(catalog)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn update_catalog_refreshed(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE chart_catalogs SET last_refreshed = CURRENT_TIMESTAMP WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    pub fn delete_catalog(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // Charts are deleted via CASCADE
        conn.execute("DELETE FROM chart_catalogs WHERE id = ?", params![id])?;
        Ok(())
    }

    // Catalog chart methods
    pub fn create_catalog_chart(&self, chart: &CatalogChart) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO catalog_charts (catalog_id, chart_id, title, chart_type, format, scale,
                                         status, download_url, file_size, last_updated, bounds)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                chart.catalog_id,
                chart.chart_id,
                chart.title,
                chart.chart_type,
                chart.format,
                chart.scale,
                chart.status,
                chart.download_url,
                chart.file_size,
                chart.last_updated,
                chart.bounds
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_catalog_charts(&self, catalog_id: i64) -> SqliteResult<Vec<CatalogChart>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, catalog_id, chart_id, title, chart_type, format, scale, status,
                    download_url, file_size, last_updated, bounds, download_status,
                    download_progress, download_path, mbtiles_path, error_message
             FROM catalog_charts WHERE catalog_id = ? ORDER BY title"
        )?;
        let charts = stmt.query_map([catalog_id], |row| {
            Ok(CatalogChart {
                id: Some(row.get(0)?),
                catalog_id: row.get(1)?,
                chart_id: row.get(2)?,
                title: row.get(3)?,
                chart_type: row.get(4)?,
                format: row.get(5)?,
                scale: row.get(6)?,
                status: row.get(7)?,
                download_url: row.get(8)?,
                file_size: row.get(9)?,
                last_updated: row.get(10)?,
                bounds: row.get(11)?,
                download_status: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "available".to_string()),
                download_progress: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
                download_path: row.get(14)?,
                mbtiles_path: row.get(15)?,
                error_message: row.get(16)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(charts)
    }

    pub fn get_catalog_chart(&self, id: i64) -> SqliteResult<Option<CatalogChart>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, catalog_id, chart_id, title, chart_type, format, scale, status,
                    download_url, file_size, last_updated, bounds, download_status,
                    download_progress, download_path, mbtiles_path, error_message
             FROM catalog_charts WHERE id = ?"
        )?;
        let result = stmt.query_row([id], |row| {
            Ok(CatalogChart {
                id: Some(row.get(0)?),
                catalog_id: row.get(1)?,
                chart_id: row.get(2)?,
                title: row.get(3)?,
                chart_type: row.get(4)?,
                format: row.get(5)?,
                scale: row.get(6)?,
                status: row.get(7)?,
                download_url: row.get(8)?,
                file_size: row.get(9)?,
                last_updated: row.get(10)?,
                bounds: row.get(11)?,
                download_status: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "available".to_string()),
                download_progress: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
                download_path: row.get(14)?,
                mbtiles_path: row.get(15)?,
                error_message: row.get(16)?,
            })
        });
        match result {
            Ok(chart) => Ok(Some(chart)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn update_chart_download_status(
        &self,
        id: i64,
        status: &str,
        progress: i64,
        download_path: Option<&str>,
        mbtiles_path: Option<&str>,
        error: Option<&str>,
    ) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE catalog_charts SET download_status = ?, download_progress = ?,
             download_path = ?, mbtiles_path = ?, error_message = ? WHERE id = ?",
            params![status, progress, download_path, mbtiles_path, error, id],
        )?;
        Ok(())
    }

    pub fn get_charts_by_status(&self, status: &str) -> SqliteResult<Vec<CatalogChart>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, catalog_id, chart_id, title, chart_type, format, scale, status,
                    download_url, file_size, last_updated, bounds, download_status,
                    download_progress, download_path, mbtiles_path, error_message
             FROM catalog_charts WHERE download_status = ? ORDER BY title"
        )?;
        let charts = stmt.query_map([status], |row| {
            Ok(CatalogChart {
                id: Some(row.get(0)?),
                catalog_id: row.get(1)?,
                chart_id: row.get(2)?,
                title: row.get(3)?,
                chart_type: row.get(4)?,
                format: row.get(5)?,
                scale: row.get(6)?,
                status: row.get(7)?,
                download_url: row.get(8)?,
                file_size: row.get(9)?,
                last_updated: row.get(10)?,
                bounds: row.get(11)?,
                download_status: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "available".to_string()),
                download_progress: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
                download_path: row.get(14)?,
                mbtiles_path: row.get(15)?,
                error_message: row.get(16)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(charts)
    }

    pub fn clear_catalog_charts(&self, catalog_id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM catalog_charts WHERE catalog_id = ?", params![catalog_id])?;
        Ok(())
    }

    // ============ Track Methods ============

    /// Start recording a new track
    pub fn start_track_recording(&self, name: &str) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO tracks (name, is_recording, started_at, point_count) VALUES (?, 1, ?, 0)",
            params![name, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Stop recording a track
    pub fn stop_track_recording(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE tracks SET is_recording = 0, ended_at = ? WHERE id = ?",
            params![now, id],
        )?;
        Ok(())
    }

    /// Get the currently recording track (if any)
    pub fn get_recording_track(&self) -> SqliteResult<Option<Track>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, is_recording, started_at, ended_at,
                    total_distance_nm, point_count, hidden, created_at
             FROM tracks WHERE is_recording = 1 LIMIT 1"
        )?;
        let result = stmt.query_row([], |row| {
            Ok(Track {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                is_recording: row.get::<_, i32>(4)? == 1,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                total_distance_nm: row.get(7)?,
                point_count: row.get::<_, i64>(8).unwrap_or(0),
                hidden: row.get::<_, i32>(9).unwrap_or(0) == 1,
                created_at: row.get(10)?,
            })
        });
        match result {
            Ok(track) => Ok(Some(track)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Add a point to a recording track
    pub fn add_track_point(
        &self,
        track_id: i64,
        lat: f64,
        lon: f64,
        heading: Option<f64>,
        cog: Option<f64>,
        sog: Option<f64>,
    ) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // Get current sequence number
        let sequence: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM track_points WHERE track_id = ?",
            params![track_id],
            |row| row.get(0),
        )?;

        // Insert new point
        conn.execute(
            "INSERT INTO track_points (track_id, lat, lon, timestamp, sequence, heading, cog, sog)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![track_id, lat, lon, now, sequence, heading, cog, sog],
        )?;
        let point_id = conn.last_insert_rowid();

        // Update point count and recalculate distance
        self.update_track_stats_internal(&conn, track_id)?;

        Ok(point_id)
    }

    /// Internal method to update track statistics
    fn update_track_stats_internal(&self, conn: &Connection, track_id: i64) -> SqliteResult<()> {
        // Get all points for distance calculation
        let mut stmt = conn.prepare(
            "SELECT lat, lon FROM track_points WHERE track_id = ? ORDER BY sequence"
        )?;
        let points: Vec<(f64, f64)> = stmt.query_map(params![track_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.collect::<Result<Vec<_>, _>>()?;

        let point_count = points.len() as i64;

        // Calculate total distance
        let mut total_distance = 0.0;
        for i in 1..points.len() {
            let (lat1, lon1) = points[i - 1];
            let (lat2, lon2) = points[i];
            total_distance += haversine_distance_nm(lat1, lon1, lat2, lon2);
        }

        conn.execute(
            "UPDATE tracks SET point_count = ?, total_distance_nm = ? WHERE id = ?",
            params![point_count, total_distance, track_id],
        )?;

        Ok(())
    }

    /// Get all tracks
    pub fn get_tracks(&self) -> SqliteResult<Vec<Track>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, is_recording, started_at, ended_at,
                    total_distance_nm, point_count, hidden, created_at
             FROM tracks ORDER BY created_at DESC"
        )?;
        let tracks = stmt.query_map([], |row| {
            Ok(Track {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                is_recording: row.get::<_, i32>(4)? == 1,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                total_distance_nm: row.get(7)?,
                point_count: row.get::<_, i64>(8).unwrap_or(0),
                hidden: row.get::<_, i32>(9).unwrap_or(0) == 1,
                created_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(tracks)
    }

    /// Get a track by ID
    pub fn get_track(&self, id: i64) -> SqliteResult<Option<Track>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, is_recording, started_at, ended_at,
                    total_distance_nm, point_count, hidden, created_at
             FROM tracks WHERE id = ?"
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(Track {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                is_recording: row.get::<_, i32>(4)? == 1,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                total_distance_nm: row.get(7)?,
                point_count: row.get::<_, i64>(8).unwrap_or(0),
                hidden: row.get::<_, i32>(9).unwrap_or(0) == 1,
                created_at: row.get(10)?,
            })
        });
        match result {
            Ok(track) => Ok(Some(track)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Get a track with all its points
    pub fn get_track_with_points(&self, id: i64) -> SqliteResult<Option<TrackWithPoints>> {
        let track = match self.get_track(id)? {
            Some(t) => t,
            None => return Ok(None),
        };

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, track_id, lat, lon, timestamp, sequence, heading, cog, sog
             FROM track_points WHERE track_id = ? ORDER BY sequence"
        )?;
        let points: Vec<TrackPoint> = stmt.query_map(params![id], |row| {
            Ok(TrackPoint {
                id: Some(row.get(0)?),
                track_id: row.get(1)?,
                lat: row.get(2)?,
                lon: row.get(3)?,
                timestamp: row.get(4)?,
                sequence: row.get(5)?,
                heading: row.get(6)?,
                cog: row.get(7)?,
                sog: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(Some(TrackWithPoints { track, points }))
    }

    /// Get all tracks with their points
    pub fn get_tracks_with_points(&self) -> SqliteResult<Vec<TrackWithPoints>> {
        let tracks = self.get_tracks()?;
        let conn = self.conn.lock().unwrap();

        let mut result = Vec::with_capacity(tracks.len());
        for track in tracks {
            let track_id = track.id.unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, track_id, lat, lon, timestamp, sequence, heading, cog, sog
                 FROM track_points WHERE track_id = ? ORDER BY sequence"
            )?;
            let points: Vec<TrackPoint> = stmt.query_map(params![track_id], |row| {
                Ok(TrackPoint {
                    id: Some(row.get(0)?),
                    track_id: row.get(1)?,
                    lat: row.get(2)?,
                    lon: row.get(3)?,
                    timestamp: row.get(4)?,
                    sequence: row.get(5)?,
                    heading: row.get(6)?,
                    cog: row.get(7)?,
                    sog: row.get(8)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;

            result.push(TrackWithPoints { track, points });
        }

        Ok(result)
    }

    /// Update track metadata
    pub fn update_track(&self, track: &Track) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET name = ?, description = ?, color = ?, hidden = ? WHERE id = ?",
            params![track.name, track.description, track.color, if track.hidden { 1 } else { 0 }, track.id],
        )?;
        Ok(())
    }

    /// Toggle track visibility
    pub fn toggle_track_hidden(&self, id: i64, hidden: bool) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET hidden = ? WHERE id = ?",
            params![if hidden { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    /// Delete a track and all its points
    pub fn delete_track(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // CASCADE will delete track_points
        conn.execute("DELETE FROM tracks WHERE id = ?", params![id])?;
        Ok(())
    }

    /// Get track points for a track
    pub fn get_track_points(&self, track_id: i64) -> SqliteResult<Vec<TrackPoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, track_id, lat, lon, timestamp, sequence, heading, cog, sog
             FROM track_points WHERE track_id = ? ORDER BY sequence"
        )?;
        let points = stmt.query_map(params![track_id], |row| {
            Ok(TrackPoint {
                id: Some(row.get(0)?),
                track_id: row.get(1)?,
                lat: row.get(2)?,
                lon: row.get(3)?,
                timestamp: row.get(4)?,
                sequence: row.get(5)?,
                heading: row.get(6)?,
                cog: row.get(7)?,
                sog: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(points)
    }
}

/// Calculate haversine distance between two points in nautical miles
fn haversine_distance_nm(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 3440.065; // Earth radius in nautical miles

    let lat1_rad = lat1.to_radians();
    let lat2_rad = lat2.to_radians();
    let delta_lat = (lat2 - lat1).to_radians();
    let delta_lon = (lon2 - lon1).to_radians();

    let a = (delta_lat / 2.0).sin().powi(2)
        + lat1_rad.cos() * lat2_rad.cos() * (delta_lon / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().asin();

    r * c
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

        // If minzoom/maxzoom are not in metadata, try to detect from tiles table
        if metadata.minzoom.is_none() || metadata.maxzoom.is_none() {
            match self.detect_zoom_range() {
                Ok((detected_min, detected_max)) => {
                    println!("MBTiles: Detected zoom range from tiles table: {}-{}", detected_min, detected_max);
                    if metadata.minzoom.is_none() {
                        metadata.minzoom = Some(detected_min);
                    }
                    if metadata.maxzoom.is_none() {
                        metadata.maxzoom = Some(detected_max);
                    }
                }
                Err(e) => {
                    println!("MBTiles: Failed to detect zoom range: {:?}", e);
                }
            }
        }

        println!("MBTiles metadata: name={:?}, minzoom={:?}, maxzoom={:?}, bounds={:?}",
            metadata.name, metadata.minzoom, metadata.maxzoom, metadata.bounds);

        Ok(metadata)
    }

    /// Detect actual zoom range from tiles table
    /// This is useful when MBTiles metadata doesn't include minzoom/maxzoom
    fn detect_zoom_range(&self) -> Result<(i32, i32), DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles WHERE zoom_level IS NOT NULL"
        )?;

        let result: Result<(Option<i32>, Option<i32>), _> = stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        });

        match result {
            Ok((Some(min), Some(max))) => Ok((min, max)),
            Ok(_) => Err(DatabaseError::MBTilesNotFound("No tiles found in database".to_string())),
            Err(e) => Err(DatabaseError::Sqlite(e)),
        }
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
            show_label: true,
            hidden: false,
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
