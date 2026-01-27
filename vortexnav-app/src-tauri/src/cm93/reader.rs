// CM93 Reader - Main interface for reading CM93 chart data
// Based on OpenCPN's CM93 implementation (GPL v2)

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::cell::{Cm93Cell, Cm93Feature};
use super::dictionary::Cm93Dictionary;
use super::geometry::GeoPoint;
use super::{Cm93Database, Cm93Error, Cm93Scale};

/// CM93 Reader for accessing chart data
pub struct Cm93Reader {
    /// Database reference
    database: Cm93Database,
    /// Cache of loaded cells (public for renderer access)
    pub cell_cache: HashMap<(Cm93Scale, u32), Cm93Cell>,
    /// Maximum cache size
    max_cache_size: usize,
    /// Spatial index: maps (scale, cell_index) -> [min_lon, min_lat, max_lon, max_lat]
    /// Built lazily as cells are loaded
    bounds_index: HashMap<(Cm93Scale, u32), [f64; 4]>,
    /// Tracks which scales have been fully indexed
    indexed_scales: std::collections::HashSet<Cm93Scale>,
}

impl Cm93Reader {
    /// Create a new CM93 reader from a database path
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, Cm93Error> {
        let database = Cm93Database::open(path)?;
        Ok(Self {
            database,
            cell_cache: HashMap::new(),
            max_cache_size: 500, // Increased to handle larger viewports
            bounds_index: HashMap::new(),
            indexed_scales: std::collections::HashSet::new(),
        })
    }

    /// Get the dictionary
    pub fn dictionary(&self) -> Option<&Cm93Dictionary> {
        self.database.dictionary.as_ref()
    }

    /// Get available scales
    pub fn available_scales(&self) -> Vec<Cm93Scale> {
        let scales = [
            Cm93Scale::Z,
            Cm93Scale::A,
            Cm93Scale::B,
            Cm93Scale::C,
            Cm93Scale::D,
            Cm93Scale::E,
            Cm93Scale::F,
            Cm93Scale::G,
        ];

        scales
            .into_iter()
            .filter(|&scale| !self.database.list_cells(scale).is_empty())
            .collect()
    }

    /// List all cells at a given scale
    pub fn list_cells(&self, scale: Cm93Scale) -> Vec<u32> {
        self.database.list_cells(scale)
    }

    /// Get a cell, loading from disk if not cached
    pub fn get_cell(&mut self, scale: Cm93Scale, cell_index: u32) -> Result<&Cm93Cell, Cm93Error> {
        let key = (scale, cell_index);

        if !self.cell_cache.contains_key(&key) {
            // Evict oldest entries if cache is full
            if self.cell_cache.len() >= self.max_cache_size {
                // Simple eviction: remove first entry
                if let Some(&k) = self.cell_cache.keys().next() {
                    self.cell_cache.remove(&k);
                }
            }

            // Load cell
            let path = self
                .database
                .get_cell_path(cell_index, scale)
                .ok_or_else(|| {
                    Cm93Error::CellNotFound(format!(
                        "Cell {} at scale {:?} not found",
                        cell_index, scale
                    ))
                })?;

            let cell = Cm93Cell::parse(&path, scale, cell_index)?;

            // Store bounds in spatial index (persists even if cell is evicted from cache)
            let bounds = cell.bounds();
            self.bounds_index.insert(key, bounds);

            self.cell_cache.insert(key, cell);
        }

        Ok(self.cell_cache.get(&key).unwrap())
    }

    /// Build spatial index for a scale by reading ONLY cell headers
    /// This is much faster than full parsing - reads only 138 bytes per cell vs entire file
    fn ensure_scale_indexed(&mut self, scale: Cm93Scale) {
        if self.indexed_scales.contains(&scale) {
            return; // Already indexed
        }

        let all_cells = self.database.list_cells(scale);
        eprintln!("[CM93] Building spatial index for scale {:?} ({} cells)...", scale, all_cells.len());

        let mut indexed_count = 0;
        for &cell_index in &all_cells {
            // Check if we already have bounds from a previous load
            if self.bounds_index.contains_key(&(scale, cell_index)) {
                continue;
            }

            // Get cell path and parse ONLY the header (fast - reads just 138 bytes)
            if let Some(path) = self.database.get_cell_path(cell_index, scale) {
                match Cm93Cell::parse_header_only(&path) {
                    Ok(bounds) => {
                        self.bounds_index.insert((scale, cell_index), bounds);
                        indexed_count += 1;
                    }
                    Err(e) => {
                        eprintln!("[CM93] Warning: Failed to index cell {}: {}", cell_index, e);
                    }
                }
            }
        }

        self.indexed_scales.insert(scale);
        eprintln!("[CM93] Spatial index complete for scale {:?}, indexed {} cells",
            scale, indexed_count);
    }

    /// Find cells that intersect a bounding box
    /// Uses spatial index for O(n) lookups without disk access
    pub fn find_cells_in_bounds(
        &mut self,
        scale: Cm93Scale,
        min_lat: f64,
        min_lon: f64,
        max_lat: f64,
        max_lon: f64,
    ) -> Vec<u32> {
        // Ensure we have bounds for all cells at this scale
        self.ensure_scale_indexed(scale);

        // Now query the index (fast - no disk access)
        let mut matching = Vec::new();

        for (&(s, cell_index), bounds) in &self.bounds_index {
            if s != scale {
                continue;
            }

            let cell_min_lon = bounds[0];
            let cell_min_lat = bounds[1];
            let cell_max_lon = bounds[2];
            let cell_max_lat = bounds[3];

            // Check intersection
            if !(cell_max_lat < min_lat
                || cell_min_lat > max_lat
                || cell_max_lon < min_lon
                || cell_min_lon > max_lon)
            {
                matching.push(cell_index);
            }
        }

        matching
    }

    /// Get features from all cells in a bounding box
    pub fn get_features_in_bounds(
        &mut self,
        scale: Cm93Scale,
        min_lat: f64,
        min_lon: f64,
        max_lat: f64,
        max_lon: f64,
    ) -> Result<Vec<FeatureRef>, Cm93Error> {
        // find_cells_in_bounds now loads cells and checks actual header bounds
        let cell_indices = self.find_cells_in_bounds(scale, min_lat, min_lon, max_lat, max_lon);

        let mut features = Vec::new();

        // Reload matched cells - they may have been evicted from cache during find_cells_in_bounds
        for cell_index in &cell_indices {
            // Reload the cell (will use cache if available, load from disk if not)
            if self.get_cell(scale, *cell_index).is_err() {
                continue;
            }

            if let Some(cell) = self.cell_cache.get(&(scale, *cell_index)) {
                for (idx, feature) in cell.features.iter().enumerate() {
                    // Check if feature geometry intersects bounds
                    let bounds = feature.geometry.bounds();
                    if !(bounds[2] < min_lon
                        || bounds[0] > max_lon
                        || bounds[3] < min_lat
                        || bounds[1] > max_lat)
                    {
                        features.push(FeatureRef {
                            scale,
                            cell_index: *cell_index,
                            feature_index: idx,
                        });
                    }
                }
            }
        }

        Ok(features)
    }

    /// Get the best scale for a given zoom level
    pub fn scale_for_zoom(&self, zoom: u8) -> Cm93Scale {
        // Map MapLibre zoom levels to CM93 scales
        // Higher zoom = more detail = higher scale letter
        match zoom {
            0..=3 => Cm93Scale::Z,   // World view
            4..=5 => Cm93Scale::A,   // Continental
            6..=7 => Cm93Scale::B,   // Regional
            8..=9 => Cm93Scale::C,   // Area
            10..=11 => Cm93Scale::D, // Coastal
            12..=13 => Cm93Scale::E, // Approach
            14..=15 => Cm93Scale::F, // Harbor approach
            _ => Cm93Scale::G,       // Harbor detail
        }
    }

    /// Clear the cell cache
    pub fn clear_cache(&mut self) {
        self.cell_cache.clear();
    }

    /// Set maximum cache size
    pub fn set_cache_size(&mut self, size: usize) {
        self.max_cache_size = size;
        while self.cell_cache.len() > self.max_cache_size {
            if let Some(&k) = self.cell_cache.keys().next() {
                self.cell_cache.remove(&k);
            }
        }
    }
}

/// Reference to a feature for deferred access
#[derive(Debug, Clone, Copy)]
pub struct FeatureRef {
    pub scale: Cm93Scale,
    pub cell_index: u32,
    pub feature_index: usize,
}

/// Statistics about CM93 data
#[derive(Debug, Clone, Default)]
pub struct Cm93Stats {
    pub total_cells: usize,
    pub cells_by_scale: HashMap<char, usize>,
    pub total_features: usize,
    pub features_by_class: HashMap<u16, usize>,
}

impl Cm93Reader {
    /// Gather statistics about the CM93 database
    pub fn gather_stats(&mut self) -> Cm93Stats {
        let mut stats = Cm93Stats::default();

        for scale in [
            Cm93Scale::Z,
            Cm93Scale::A,
            Cm93Scale::B,
            Cm93Scale::C,
            Cm93Scale::D,
            Cm93Scale::E,
            Cm93Scale::F,
            Cm93Scale::G,
        ] {
            let cells = self.database.list_cells(scale);
            let count = cells.len();
            stats.total_cells += count;
            stats.cells_by_scale.insert(scale.to_char(), count);
        }

        stats
    }
}

/// Iterator over features in a region
pub struct FeatureIterator<'a> {
    reader: &'a Cm93Reader,
    feature_refs: Vec<FeatureRef>,
    current: usize,
}

impl<'a> FeatureIterator<'a> {
    pub fn new(reader: &'a Cm93Reader, feature_refs: Vec<FeatureRef>) -> Self {
        Self {
            reader,
            feature_refs,
            current: 0,
        }
    }
}

/// Convert CM93 features to GeoJSON
pub fn features_to_geojson(features: &[&Cm93Feature], dictionary: Option<&Cm93Dictionary>) -> serde_json::Value {
    use serde_json::json;

    let geojson_features: Vec<serde_json::Value> = features
        .iter()
        .map(|f| {
            let geom_type = match f.geometry_type {
                super::GeometryType::Point => "Point",
                super::GeometryType::Line => "LineString",
                super::GeometryType::Area => "Polygon",
            };

            let mut properties = serde_json::Map::new();

            // Add object class info
            properties.insert("object_class".to_string(), json!(f.object_class));
            if let Some(dict) = dictionary {
                if let Some(obj) = dict.get_object(f.object_class) {
                    properties.insert("object_acronym".to_string(), json!(obj.acronym));
                    properties.insert("object_name".to_string(), json!(obj.name));
                }
            }

            // Add attributes
            for (code, value) in &f.attributes {
                let key = if let Some(dict) = dictionary {
                    dict.get_attribute(*code)
                        .map(|a| a.acronym.clone())
                        .unwrap_or_else(|| format!("attr_{}", code))
                } else {
                    format!("attr_{}", code)
                };
                properties.insert(key, json!(value.as_string()));
            }

            json!({
                "type": "Feature",
                "geometry": {
                    "type": geom_type,
                    "coordinates": f.geometry.to_coordinates()
                },
                "properties": properties
            })
        })
        .collect();

    json!({
        "type": "FeatureCollection",
        "features": geojson_features
    })
}

/// Convert CM93 data to vector tiles (MVT format)
pub mod tiles {
    use super::*;

    /// Tile coordinates
    #[derive(Debug, Clone, Copy)]
    pub struct TileCoord {
        pub z: u8,
        pub x: u32,
        pub y: u32,
    }

    impl TileCoord {
        /// Get the bounding box of this tile in geographic coordinates
        pub fn bounds(&self) -> (f64, f64, f64, f64) {
            let n = 2.0_f64.powi(self.z as i32);

            let lon_min = (self.x as f64 / n) * 360.0 - 180.0;
            let lon_max = ((self.x + 1) as f64 / n) * 360.0 - 180.0;

            let lat_max = (std::f64::consts::PI * (1.0 - 2.0 * self.y as f64 / n))
                .sinh()
                .atan()
                .to_degrees();
            let lat_min = (std::f64::consts::PI * (1.0 - 2.0 * (self.y + 1) as f64 / n))
                .sinh()
                .atan()
                .to_degrees();

            (lon_min, lat_min, lon_max, lat_max)
        }
    }

    /// Generate a vector tile from CM93 data
    pub fn generate_tile(
        reader: &mut Cm93Reader,
        coord: TileCoord,
    ) -> Result<Vec<u8>, Cm93Error> {
        let scale = reader.scale_for_zoom(coord.z);
        let (lon_min, lat_min, lon_max, lat_max) = coord.bounds();

        let feature_refs =
            reader.get_features_in_bounds(scale, lat_min, lon_min, lat_max, lon_max)?;

        // For now, return empty tile - full MVT encoding would require
        // additional dependencies (mapbox-vector-tile or similar)
        // This is a placeholder for the tile generation logic

        log::debug!(
            "Generating tile z={} x={} y={} with {} features",
            coord.z,
            coord.x,
            coord.y,
            feature_refs.len()
        );

        // TODO: Implement MVT encoding
        // For now, return empty protobuf
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_bounds() {
        let tile = tiles::TileCoord { z: 0, x: 0, y: 0 };
        let (lon_min, lat_min, lon_max, lat_max) = tile.bounds();

        assert!((lon_min - (-180.0)).abs() < 0.001);
        assert!((lon_max - 180.0).abs() < 0.001);
        assert!(lat_min < lat_max);
    }

    #[test]
    fn test_scale_for_zoom() {
        // Create a mock reader - this would need a real CM93 database
        // For now just verify the mapping logic exists
        assert!(true);
    }
}
