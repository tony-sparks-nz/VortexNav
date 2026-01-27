// CM93 to MBTiles Renderer
// Renders CM93 chart features to raster tiles
// Based on S52 symbology standards

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

use rusqlite::{params, Connection};

use super::cell::{AttributeValue, Cm93Feature};
use super::dictionary::Cm93Dictionary;
use super::geometry::{Cm93Geometry, GeoPoint};
use super::reader::Cm93Reader;
use super::{Cm93Error, Cm93Scale, GeometryType};

/// MBTiles database for storing rendered tiles
pub struct MBTilesWriter {
    conn: Connection,
    name: String,
    bounds: [f64; 4], // [min_lon, min_lat, max_lon, max_lat]
    min_zoom: u8,
    max_zoom: u8,
}

impl MBTilesWriter {
    /// Create a new MBTiles database
    pub fn create(path: &Path, name: &str) -> Result<Self, Cm93Error> {
        let conn = Connection::open(path)
            .map_err(|e| Cm93Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

        // Create MBTiles schema
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
            CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
            CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row);
            ",
        )
        .map_err(|e| Cm93Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

        Ok(Self {
            conn,
            name: name.to_string(),
            bounds: [-180.0, -85.0, 180.0, 85.0],
            min_zoom: 0,
            max_zoom: 14,
        })
    }

    /// Set the bounds
    pub fn set_bounds(&mut self, bounds: [f64; 4]) {
        self.bounds = bounds;
    }

    /// Set zoom range
    pub fn set_zoom_range(&mut self, min_zoom: u8, max_zoom: u8) {
        self.min_zoom = min_zoom;
        self.max_zoom = max_zoom;
    }

    /// Insert a tile
    pub fn insert_tile(&self, z: u8, x: u32, y: u32, data: &[u8]) -> Result<(), Cm93Error> {
        // MBTiles uses TMS y-coordinate (flipped from XYZ)
        let tms_y = (1u32 << z) - 1 - y;

        self.conn
            .execute(
                "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?1, ?2, ?3, ?4)",
                params![z as i32, x as i32, tms_y as i32, data],
            )
            .map_err(|e| Cm93Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

        Ok(())
    }

    /// Finalize and write metadata
    pub fn finalize(&self) -> Result<(), Cm93Error> {
        let metadata = [
            ("name", self.name.as_str()),
            ("format", "png"),
            ("type", "overlay"),
            (
                "bounds",
                &format!(
                    "{},{},{},{}",
                    self.bounds[0], self.bounds[1], self.bounds[2], self.bounds[3]
                ),
            ),
            ("minzoom", &self.min_zoom.to_string()),
            ("maxzoom", &self.max_zoom.to_string()),
            ("description", "CM93 Base Nautical Chart"),
        ];

        for (name, value) in &metadata {
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO metadata (name, value) VALUES (?1, ?2)",
                    params![name, value],
                )
                .map_err(|e| {
                    Cm93Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
                })?;
        }

        // VACUUM for optimization
        self.conn.execute_batch("VACUUM").ok();

        Ok(())
    }
}

/// Configuration for CM93 rendering
#[derive(Debug, Clone)]
pub struct RenderConfig {
    /// Tile size in pixels
    pub tile_size: u32,
    /// Background color (RGBA)
    pub background: [u8; 4],
    /// Water color
    pub water_color: [u8; 4],
    /// Land color
    pub land_color: [u8; 4],
    /// Depth contour color
    pub depth_contour_color: [u8; 4],
    /// Coastline color
    pub coastline_color: [u8; 4],
    /// Sounding color
    pub sounding_color: [u8; 4],
    /// Line width for features
    pub line_width: f32,
    /// Font size for labels
    pub font_size: f32,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            tile_size: 256,
            background: [0, 0, 0, 0],     // Transparent
            water_color: [220, 235, 250, 255], // Light blue
            land_color: [225, 210, 175, 255],  // Tan
            depth_contour_color: [100, 140, 180, 255], // Blue-gray
            coastline_color: [80, 80, 80, 255], // Dark gray
            sounding_color: [0, 60, 120, 255],  // Dark blue
            line_width: 1.0,
            font_size: 10.0,
        }
    }
}

/// S52 color palette for nautical chart rendering
pub struct S52Colors;

impl S52Colors {
    /// Day mode colors
    pub fn day() -> HashMap<&'static str, [u8; 4]> {
        let mut colors = HashMap::new();
        colors.insert("NODTA", [163, 163, 163, 255]); // No data
        colors.insert("CURSR", [255, 0, 0, 255]);     // Cursor
        colors.insert("CHBLK", [0, 0, 0, 255]);       // Chart black
        colors.insert("CHGRD", [128, 128, 128, 255]); // Chart gray dark
        colors.insert("CHGRF", [200, 200, 200, 255]); // Chart gray light
        colors.insert("CHRED", [200, 0, 0, 255]);     // Chart red
        colors.insert("CHGRN", [0, 180, 0, 255]);     // Chart green
        colors.insert("CHYLW", [200, 200, 0, 255]);   // Chart yellow
        colors.insert("CHMGD", [120, 0, 120, 255]);   // Chart magenta dark
        colors.insert("CHMGF", [200, 0, 200, 255]);   // Chart magenta
        colors.insert("CHBRN", [100, 70, 40, 255]);   // Chart brown
        colors.insert("CHWHT", [255, 255, 255, 255]); // Chart white
        colors.insert("SNDG1", [50, 50, 50, 255]);    // Sounding value
        colors.insert("SNDG2", [0, 60, 100, 255]);    // Sounding deep
        colors.insert("DEPMS", [210, 235, 255, 255]); // Depth shallow
        colors.insert("DEPMW", [190, 220, 250, 255]); // Depth medium
        colors.insert("DEPDW", [170, 205, 245, 255]); // Depth deep
        colors.insert("LANDA", [225, 210, 175, 255]); // Land
        colors.insert("LANDF", [190, 175, 145, 255]); // Land fill
        colors.insert("CSTLN", [80, 80, 80, 255]);    // Coastline
        colors.insert("DEPSC", [100, 140, 180, 255]); // Depth contour
        colors
    }

    /// Night mode colors (red-tinted for night vision)
    pub fn night() -> HashMap<&'static str, [u8; 4]> {
        let mut colors = HashMap::new();
        colors.insert("NODTA", [80, 0, 0, 255]);
        colors.insert("CHBLK", [60, 0, 0, 255]);
        colors.insert("CHGRD", [80, 0, 0, 255]);
        colors.insert("DEPMS", [40, 0, 0, 255]);
        colors.insert("DEPMW", [30, 0, 0, 255]);
        colors.insert("DEPDW", [20, 0, 0, 255]);
        colors.insert("LANDA", [50, 20, 10, 255]);
        colors.insert("CSTLN", [100, 0, 0, 255]);
        colors.insert("DEPSC", [80, 20, 20, 255]);
        colors
    }
}

/// Simple tile rasterizer for CM93 features
pub struct TileRasterizer {
    config: RenderConfig,
    buffer: Vec<u8>,
}

impl TileRasterizer {
    pub fn new(config: RenderConfig) -> Self {
        let size = (config.tile_size * config.tile_size * 4) as usize;
        Self {
            buffer: vec![0u8; size],
            config,
        }
    }

    /// Clear buffer with background color
    pub fn clear(&mut self) {
        let bg = self.config.background;
        for pixel in self.buffer.chunks_mut(4) {
            pixel.copy_from_slice(&bg);
        }
    }

    /// Get the tile pixel buffer
    pub fn buffer(&self) -> &[u8] {
        &self.buffer
    }

    /// Get buffer dimensions
    pub fn dimensions(&self) -> (u32, u32) {
        (self.config.tile_size, self.config.tile_size)
    }

    /// Convert geographic coordinates to tile pixel coordinates
    fn geo_to_tile_pixel(
        &self,
        lon: f64,
        lat: f64,
        tile_bounds: (f64, f64, f64, f64),
    ) -> (i32, i32) {
        let (min_lon, min_lat, max_lon, max_lat) = tile_bounds;
        let tile_size = self.config.tile_size as f64;

        let x = ((lon - min_lon) / (max_lon - min_lon) * tile_size) as i32;
        let y = ((max_lat - lat) / (max_lat - min_lat) * tile_size) as i32;

        (x, y)
    }

    /// Set a pixel with bounds checking
    fn set_pixel(&mut self, x: i32, y: i32, color: [u8; 4]) {
        let size = self.config.tile_size as i32;
        if x >= 0 && x < size && y >= 0 && y < size {
            let idx = ((y as u32 * self.config.tile_size + x as u32) * 4) as usize;
            if idx + 3 < self.buffer.len() {
                // Alpha blending
                let alpha = color[3] as f32 / 255.0;
                let inv_alpha = 1.0 - alpha;

                self.buffer[idx] =
                    (color[0] as f32 * alpha + self.buffer[idx] as f32 * inv_alpha) as u8;
                self.buffer[idx + 1] =
                    (color[1] as f32 * alpha + self.buffer[idx + 1] as f32 * inv_alpha) as u8;
                self.buffer[idx + 2] =
                    (color[2] as f32 * alpha + self.buffer[idx + 2] as f32 * inv_alpha) as u8;
                self.buffer[idx + 3] = (color[3] as f32 + self.buffer[idx + 3] as f32 * inv_alpha)
                    .min(255.0) as u8;
            }
        }
    }

    /// Draw a line using Bresenham's algorithm
    fn draw_line(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, color: [u8; 4]) {
        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        let mut x = x0;
        let mut y = y0;

        loop {
            self.set_pixel(x, y, color);

            if x == x1 && y == y1 {
                break;
            }

            let e2 = 2 * err;
            if e2 >= dy {
                if x == x1 {
                    break;
                }
                err += dy;
                x += sx;
            }
            if e2 <= dx {
                if y == y1 {
                    break;
                }
                err += dx;
                y += sy;
            }
        }
    }

    /// Draw a point (small circle)
    fn draw_point(&mut self, x: i32, y: i32, color: [u8; 4], radius: i32) {
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx * dx + dy * dy <= radius * radius {
                    self.set_pixel(x + dx, y + dy, color);
                }
            }
        }
    }

    /// Draw a polygon (fill)
    fn draw_polygon(&mut self, points: &[(i32, i32)], color: [u8; 4]) {
        if points.len() < 3 {
            return;
        }

        // Simple scanline fill
        let min_y = points.iter().map(|p| p.1).min().unwrap_or(0);
        let max_y = points.iter().map(|p| p.1).max().unwrap_or(0);

        for y in min_y..=max_y {
            let mut intersections = Vec::new();

            for i in 0..points.len() {
                let j = (i + 1) % points.len();
                let (x0, y0) = points[i];
                let (x1, y1) = points[j];

                if (y0 <= y && y < y1) || (y1 <= y && y < y0) {
                    if y1 != y0 {
                        let x = x0 + (y - y0) * (x1 - x0) / (y1 - y0);
                        intersections.push(x);
                    }
                }
            }

            intersections.sort();

            for chunk in intersections.chunks(2) {
                if chunk.len() == 2 {
                    for x in chunk[0]..=chunk[1] {
                        self.set_pixel(x, y, color);
                    }
                }
            }
        }
    }

    /// Render a CM93 feature
    pub fn render_feature(
        &mut self,
        feature: &Cm93Feature,
        tile_bounds: (f64, f64, f64, f64),
        colors: &HashMap<&str, [u8; 4]>,
    ) {
        let geom = &feature.geometry;

        match feature.geometry_type {
            GeometryType::Point => {
                if let Some(point) = geom.points.first() {
                    let (px, py) = self.geo_to_tile_pixel(point.lon, point.lat, tile_bounds);
                    let color = self.get_feature_color(feature, colors);
                    self.draw_point(px, py, color, 3);
                }
            }
            GeometryType::Line => {
                let color = self.get_feature_color(feature, colors);
                for i in 0..geom.points.len().saturating_sub(1) {
                    let p0 = &geom.points[i];
                    let p1 = &geom.points[i + 1];
                    let (x0, y0) = self.geo_to_tile_pixel(p0.lon, p0.lat, tile_bounds);
                    let (x1, y1) = self.geo_to_tile_pixel(p1.lon, p1.lat, tile_bounds);
                    self.draw_line(x0, y0, x1, y1, color);
                }
            }
            GeometryType::Area => {
                let color = self.get_feature_color(feature, colors);
                let pixels: Vec<(i32, i32)> = geom
                    .points
                    .iter()
                    .map(|p| self.geo_to_tile_pixel(p.lon, p.lat, tile_bounds))
                    .collect();

                if !pixels.is_empty() {
                    self.draw_polygon(&pixels, color);

                    // Draw outline
                    let outline_color = [
                        (color[0] as i32 - 30).max(0) as u8,
                        (color[1] as i32 - 30).max(0) as u8,
                        (color[2] as i32 - 30).max(0) as u8,
                        color[3],
                    ];
                    for i in 0..pixels.len() {
                        let j = (i + 1) % pixels.len();
                        self.draw_line(pixels[i].0, pixels[i].1, pixels[j].0, pixels[j].1, outline_color);
                    }
                }
            }
        }
    }

    /// Get the appropriate color for a feature based on object class
    fn get_feature_color(&self, feature: &Cm93Feature, colors: &HashMap<&str, [u8; 4]>) -> [u8; 4] {
        use super::dictionary::object_codes::*;

        match feature.object_class {
            LNDARE => colors.get("LANDA").copied().unwrap_or(self.config.land_color),
            DEPARE => {
                // Depth area - color based on depth value
                if let Some(drval1) = feature.attributes.get(&87) {
                    // DRVAL1
                    if let Some(depth) = drval1.as_f64() {
                        if depth < 5.0 {
                            colors.get("DEPMS").copied().unwrap_or(self.config.water_color)
                        } else if depth < 20.0 {
                            colors.get("DEPMW").copied().unwrap_or(self.config.water_color)
                        } else {
                            colors.get("DEPDW").copied().unwrap_or(self.config.water_color)
                        }
                    } else {
                        colors.get("DEPMS").copied().unwrap_or(self.config.water_color)
                    }
                } else {
                    colors.get("DEPMS").copied().unwrap_or(self.config.water_color)
                }
            }
            DEPCNT => colors.get("DEPSC").copied().unwrap_or(self.config.depth_contour_color),
            COALNE => colors.get("CSTLN").copied().unwrap_or(self.config.coastline_color),
            SOUNDG => colors.get("SNDG1").copied().unwrap_or(self.config.sounding_color),
            _ => colors.get("CHGRD").copied().unwrap_or([128, 128, 128, 255]),
        }
    }

    /// Encode buffer as PNG
    pub fn to_png(&self) -> Result<Vec<u8>, Cm93Error> {
        let mut png_data = Vec::new();

        {
            let mut encoder = png::Encoder::new(&mut png_data, self.config.tile_size, self.config.tile_size);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::Fast);

            let mut writer = encoder
                .write_header()
                .map_err(|e| Cm93Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

            writer
                .write_image_data(&self.buffer)
                .map_err(|e| Cm93Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        }

        Ok(png_data)
    }
}

/// Get tile bounds in geographic coordinates
pub fn tile_bounds(z: u8, x: u32, y: u32) -> (f64, f64, f64, f64) {
    let n = 2.0_f64.powi(z as i32);

    let lon_min = (x as f64 / n) * 360.0 - 180.0;
    let lon_max = ((x + 1) as f64 / n) * 360.0 - 180.0;

    let lat_max = (std::f64::consts::PI * (1.0 - 2.0 * y as f64 / n))
        .sinh()
        .atan()
        .to_degrees();
    let lat_min = (std::f64::consts::PI * (1.0 - 2.0 * (y + 1) as f64 / n))
        .sinh()
        .atan()
        .to_degrees();

    (lon_min, lat_min, lon_max, lat_max)
}

/// Convert CM93 database to MBTiles
pub fn convert_cm93_to_mbtiles(
    cm93_path: &Path,
    output_path: &Path,
    min_zoom: u8,
    max_zoom: u8,
    progress_callback: Option<Box<dyn Fn(usize, usize) + Send>>,
) -> Result<(), Cm93Error> {
    log::info!("Converting CM93 database to MBTiles: {:?}", cm93_path);

    // Open CM93 database
    let mut reader = Cm93Reader::open(cm93_path)?;

    // Create output MBTiles
    let mut mbtiles = MBTilesWriter::create(output_path, "Base Nautical Chart")?;
    mbtiles.set_zoom_range(min_zoom, max_zoom);

    // Get overall bounds from available scales
    let mut overall_bounds: [f64; 4] = [180.0, 90.0, -180.0, -90.0];
    let available_scales = reader.available_scales();
    log::info!("Available scales: {:?}", available_scales);

    if available_scales.is_empty() {
        return Err(Cm93Error::InvalidDirectory(
            "No chart data found in CM93 database".to_string()
        ));
    }

    for scale in &available_scales {
        let cells = reader.list_cells(*scale);
        log::debug!("Scale {:?}: {} cells", scale, cells.len());
        for cell_index in cells {
            if let Ok(cell) = reader.get_cell(*scale, cell_index) {
                let bounds = cell.bounds();
                overall_bounds[0] = overall_bounds[0].min(bounds[0]);
                overall_bounds[1] = overall_bounds[1].min(bounds[1]);
                overall_bounds[2] = overall_bounds[2].max(bounds[2]);
                overall_bounds[3] = overall_bounds[3].max(bounds[3]);
            }
        }
    }

    // Check if we found any valid bounds
    if overall_bounds[0] >= overall_bounds[2] || overall_bounds[1] >= overall_bounds[3] {
        return Err(Cm93Error::InvalidDirectory(
            "No valid cell bounds found in CM93 database".to_string()
        ));
    }

    log::info!("Overall bounds: {:?}", overall_bounds);
    mbtiles.set_bounds(overall_bounds);

    // Calculate total tiles for progress
    let mut total_tiles = 0;
    for z in min_zoom..=max_zoom {
        let n = 1u32 << z;
        // Estimate tiles in bounds
        let x_min = ((overall_bounds[0] + 180.0) / 360.0 * n as f64) as u32;
        let x_max = ((overall_bounds[2] + 180.0) / 360.0 * n as f64) as u32;
        let y_min = ((1.0 - (overall_bounds[3].to_radians().tan() + 1.0 / overall_bounds[3].to_radians().cos()).ln() / std::f64::consts::PI) / 2.0 * n as f64) as u32;
        let y_max = ((1.0 - (overall_bounds[1].to_radians().tan() + 1.0 / overall_bounds[1].to_radians().cos()).ln() / std::f64::consts::PI) / 2.0 * n as f64) as u32;
        total_tiles += ((x_max - x_min + 1) * (y_max - y_min + 1)) as usize;
    }

    let config = RenderConfig::default();
    let mut rasterizer = TileRasterizer::new(config);
    let colors = S52Colors::day();

    let mut tiles_rendered = 0;

    // Render each zoom level
    for z in min_zoom..=max_zoom {
        let scale = reader.scale_for_zoom(z);
        let n = 1u32 << z;

        // Calculate tile range
        let x_min = ((overall_bounds[0] + 180.0) / 360.0 * n as f64).max(0.0) as u32;
        let x_max = ((overall_bounds[2] + 180.0) / 360.0 * n as f64).min((n - 1) as f64) as u32;

        let lat_to_y = |lat: f64| -> f64 {
            (1.0 - (lat.to_radians().tan() + 1.0 / lat.to_radians().cos()).ln() / std::f64::consts::PI) / 2.0 * n as f64
        };
        let y_min = lat_to_y(overall_bounds[3]).max(0.0) as u32;
        let y_max = lat_to_y(overall_bounds[1]).min((n - 1) as f64) as u32;

        log::debug!("Zoom {}: rendering tiles x={}..{}, y={}..{}", z, x_min, x_max, y_min, y_max);

        for x in x_min..=x_max {
            for y in y_min..=y_max {
                rasterizer.clear();

                let bounds = tile_bounds(z, x, y);

                // Get features in tile bounds
                if let Ok(feature_refs) = reader.get_features_in_bounds(
                    scale,
                    bounds.1, bounds.0, bounds.3, bounds.2,
                ) {
                    // Render features
                    for fref in &feature_refs {
                        if let Some(cell) = reader.cell_cache.get(&(fref.scale, fref.cell_index)) {
                            if let Some(feature) = cell.features.get(fref.feature_index) {
                                rasterizer.render_feature(feature, bounds, &colors);
                            }
                        }
                    }
                }

                // Only save non-empty tiles
                if rasterizer.buffer().iter().any(|&b| b != 0) {
                    if let Ok(png_data) = rasterizer.to_png() {
                        mbtiles.insert_tile(z, x, y, &png_data)?;
                    }
                }

                tiles_rendered += 1;
                if let Some(ref callback) = progress_callback {
                    callback(tiles_rendered, total_tiles);
                }
            }
        }
    }

    // Finalize
    mbtiles.finalize()?;

    log::info!("CM93 conversion complete. {} tiles rendered.", tiles_rendered);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_bounds() {
        let (lon_min, lat_min, lon_max, lat_max) = tile_bounds(0, 0, 0);
        assert!((lon_min - (-180.0)).abs() < 0.001);
        assert!((lon_max - 180.0).abs() < 0.001);
    }

    #[test]
    fn test_s52_colors() {
        let day_colors = S52Colors::day();
        assert!(day_colors.contains_key("LANDA"));
        assert!(day_colors.contains_key("CSTLN"));

        let night_colors = S52Colors::night();
        assert!(night_colors.contains_key("LANDA"));
    }
}
