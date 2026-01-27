// CM93 Vector Tile Server
// Serves CM93 chart data as GeoJSON for MapLibre GL rendering

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use super::cell::Cm93Feature;
use super::dictionary::{attr_codes, object_codes, Cm93Dictionary};
use super::geometry::GeoPoint;
use super::reader::Cm93Reader;
use super::{Cm93Error, Cm93Scale};

/// CM93 tile server for serving vector tiles
pub struct Cm93Server {
    reader: RwLock<Cm93Reader>,
}

impl Cm93Server {
    /// Create a new CM93 server from a database path
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Cm93Error> {
        let reader = Cm93Reader::open(path.as_ref())?;
        Ok(Self {
            reader: RwLock::new(reader),
        })
    }

    /// Get vector features for a tile as GeoJSON
    pub fn get_tile_geojson(&self, z: u8, x: u32, y: u32) -> Result<GeoJsonTile, Cm93Error> {
        let bounds = tile_bounds(z, x, y);
        let scale = scale_for_zoom(z);

        let mut reader = self.reader.write().map_err(|_| {
            Cm93Error::DecodeError("Failed to acquire reader lock".to_string())
        })?;

        // Get features in bounds
        let feature_refs = reader.get_features_in_bounds(
            scale,
            bounds.min_lat,
            bounds.min_lon,
            bounds.max_lat,
            bounds.max_lon,
        )?;

        // Convert to GeoJSON features
        let mut geojson_features = Vec::new();
        let dictionary = reader.dictionary();

        for fref in &feature_refs {
            if let Some(cell) = reader.cell_cache.get(&(fref.scale, fref.cell_index)) {
                if let Some(feature) = cell.features.get(fref.feature_index) {
                    if let Some(gj) = feature_to_geojson(feature, dictionary) {
                        geojson_features.push(gj);
                    }
                }
            }
        }

        Ok(GeoJsonTile {
            tile_type: "FeatureCollection".to_string(),
            features: geojson_features,
            tile_info: TileInfo { z, x, y, scale: scale.to_char() },
        })
    }

    /// Get features for a bounding box (for non-tiled queries)
    pub fn get_features_in_bounds(
        &self,
        min_lat: f64,
        min_lon: f64,
        max_lat: f64,
        max_lon: f64,
        zoom: u8,
    ) -> Result<GeoJsonTile, Cm93Error> {
        let scale = scale_for_zoom(zoom);
        eprintln!("[CM93 Server] scale={:?} for zoom={}", scale, zoom);

        let mut reader = self.reader.write().map_err(|_| {
            Cm93Error::DecodeError("Failed to acquire reader lock".to_string())
        })?;

        let feature_refs = reader.get_features_in_bounds(scale, min_lat, min_lon, max_lat, max_lon)?;
        eprintln!("[CM93 Server] Found {} feature refs from reader", feature_refs.len());

        let mut geojson_features = Vec::new();
        let dictionary = reader.dictionary();
        let mut skipped_conversion = 0;
        let mut skipped_invalid_geom = 0;
        let mut geom_type_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut layer_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        for fref in &feature_refs {
            if let Some(cell) = reader.cell_cache.get(&(fref.scale, fref.cell_index)) {
                if let Some(feature) = cell.features.get(fref.feature_index) {
                    // Count geometry types
                    let geom_type = match feature.geometry_type {
                        super::GeometryType::Point => "Point",
                        super::GeometryType::Line => "Line",
                        super::GeometryType::Area => "Area",
                    };
                    *geom_type_counts.entry(geom_type.to_string()).or_insert(0) += 1;

                    // Check if geometry is valid
                    if !feature.geometry.is_valid() {
                        skipped_invalid_geom += 1;
                        continue;
                    }

                    if let Some(gj) = feature_to_geojson(feature, dictionary) {
                        *layer_counts.entry(gj.properties.layer.clone()).or_insert(0) += 1;
                        geojson_features.push(gj);
                    } else {
                        skipped_conversion += 1;
                    }
                }
            }
        }

        // Log statistics
        eprintln!("[CM93 Server] Geometry types: {:?}", geom_type_counts);
        eprintln!("[CM93 Server] Layer distribution: {:?}", layer_counts);

        // Log object class distribution
        let mut obj_class_counts: std::collections::HashMap<u16, usize> = std::collections::HashMap::new();
        for fref in &feature_refs {
            if let Some(cell) = reader.cell_cache.get(&(fref.scale, fref.cell_index)) {
                if let Some(feature) = cell.features.get(fref.feature_index) {
                    *obj_class_counts.entry(feature.object_class).or_insert(0) += 1;
                }
            }
        }
        // Show top 10 object classes
        let mut obj_vec: Vec<_> = obj_class_counts.iter().collect();
        obj_vec.sort_by(|a, b| b.1.cmp(a.1));
        let top_classes: Vec<_> = obj_vec.iter().take(10).map(|(code, count)| {
            let name = dictionary.and_then(|d| d.get_object(**code)).map(|o| o.acronym.clone()).unwrap_or_else(|| format!("OBJ_{}", code));
            format!("{}({}): {}", name, code, count)
        }).collect();
        eprintln!("[CM93 Server] Top object classes: {}", top_classes.join(", "));

        if skipped_invalid_geom > 0 {
            eprintln!("[CM93 Server] Skipped {} features (invalid geometry)", skipped_invalid_geom);
        }
        if skipped_conversion > 0 {
            eprintln!("[CM93 Server] Skipped {} features (conversion failed)", skipped_conversion);
        }

        eprintln!("[CM93 Server] Returning {} GeoJSON features", geojson_features.len());

        Ok(GeoJsonTile {
            tile_type: "FeatureCollection".to_string(),
            features: geojson_features,
            tile_info: TileInfo { z: zoom, x: 0, y: 0, scale: scale.to_char() },
        })
    }

    /// Check if CM93 data is available
    pub fn is_available(&self) -> bool {
        if let Ok(reader) = self.reader.read() {
            !reader.available_scales().is_empty()
        } else {
            false
        }
    }

    /// Get available scale levels
    pub fn available_scales(&self) -> Vec<char> {
        if let Ok(reader) = self.reader.read() {
            reader.available_scales().iter().map(|s| s.to_char()).collect()
        } else {
            Vec::new()
        }
    }
}

/// GeoJSON tile response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonTile {
    #[serde(rename = "type")]
    pub tile_type: String,
    pub features: Vec<GeoJsonFeature>,
    #[serde(rename = "tileInfo")]
    pub tile_info: TileInfo,
}

/// Tile metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileInfo {
    pub z: u8,
    pub x: u32,
    pub y: u32,
    pub scale: char,
}

/// GeoJSON feature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonFeature {
    #[serde(rename = "type")]
    pub feature_type: String,
    pub geometry: GeoJsonGeometry,
    pub properties: GeoJsonProperties,
}

/// GeoJSON geometry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonGeometry {
    #[serde(rename = "type")]
    pub geom_type: String,
    pub coordinates: serde_json::Value,
}

/// Feature properties with S57/CM93 attributes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonProperties {
    /// S57 object class code
    #[serde(rename = "objClass")]
    pub obj_class: u16,
    /// S57 object class acronym (e.g., "SOUNDG", "LIGHTS")
    #[serde(rename = "objAcronym")]
    pub obj_acronym: String,
    /// Human-readable object name
    #[serde(rename = "objName")]
    pub obj_name: String,
    /// Geometry type for styling ("Point", "Line", "Polygon")
    #[serde(rename = "geomType")]
    pub geom_type: String,
    /// Layer for styling (e.g., "soundings", "depths", "lights", "buoys")
    pub layer: String,
    /// Depth value for soundings/contours (meters)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    /// Object name from chart (e.g., light name)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Color attribute
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Additional attributes as key-value pairs
    #[serde(flatten)]
    pub attributes: HashMap<String, serde_json::Value>,
}

/// Tile bounds in geographic coordinates
#[derive(Debug, Clone, Copy)]
pub struct TileBounds {
    pub min_lon: f64,
    pub min_lat: f64,
    pub max_lon: f64,
    pub max_lat: f64,
}

/// Calculate tile bounds from z/x/y
pub fn tile_bounds(z: u8, x: u32, y: u32) -> TileBounds {
    let n = 2.0_f64.powi(z as i32);

    let min_lon = (x as f64 / n) * 360.0 - 180.0;
    let max_lon = ((x + 1) as f64 / n) * 360.0 - 180.0;

    let max_lat = (std::f64::consts::PI * (1.0 - 2.0 * y as f64 / n))
        .sinh()
        .atan()
        .to_degrees();
    let min_lat = (std::f64::consts::PI * (1.0 - 2.0 * (y + 1) as f64 / n))
        .sinh()
        .atan()
        .to_degrees();

    TileBounds { min_lon, min_lat, max_lon, max_lat }
}

/// Map zoom level to CM93 scale
pub fn scale_for_zoom(zoom: u8) -> Cm93Scale {
    match zoom {
        0..=3 => Cm93Scale::Z,   // World view
        4..=5 => Cm93Scale::A,   // Continental
        6..=7 => Cm93Scale::B,   // Regional
        8..=9 => Cm93Scale::C,   // Area
        10..=11 => Cm93Scale::D, // Coastal
        12..=13 => Cm93Scale::E, // Approach
        14..=15 => Cm93Scale::F, // Harbor approach
        _ => Cm93Scale::G,       // Harbor detail (16+)
    }
}

/// Check if a line geometry is a cell boundary connector
/// Cell boundary connectors are straight vertical or horizontal lines
/// at cell edges that should not be rendered
fn is_cell_boundary_connector(points: &[GeoPoint]) -> bool {
    if points.len() < 2 {
        return false;
    }

    // Tolerance for coordinate comparison (accounts for floating point precision)
    const COORD_TOLERANCE: f64 = 1e-7;

    // Check if all points have the same longitude (vertical line)
    let first_lon = points[0].lon;
    let all_same_lon = points.iter().all(|p| (p.lon - first_lon).abs() < COORD_TOLERANCE);

    // Check if all points have the same latitude (horizontal line)
    let first_lat = points[0].lat;
    let all_same_lat = points.iter().all(|p| (p.lat - first_lat).abs() < COORD_TOLERANCE);

    // If it's a perfectly straight vertical or horizontal line with only 2 points,
    // it's very likely a cell boundary connector
    if points.len() == 2 && (all_same_lon || all_same_lat) {
        return true;
    }

    // For longer lines, only flag as boundary if ALL points are on the same line
    if all_same_lon {
        let lat_span = points.iter().map(|p| p.lat).fold(f64::NEG_INFINITY, f64::max)
            - points.iter().map(|p| p.lat).fold(f64::INFINITY, f64::min);
        // Short vertical line - likely cell boundary connector
        if lat_span < 0.1 {
            return true;
        }
    }

    if all_same_lat {
        let lon_span = points.iter().map(|p| p.lon).fold(f64::NEG_INFINITY, f64::max)
            - points.iter().map(|p| p.lon).fold(f64::INFINITY, f64::min);
        // Short horizontal line - likely cell boundary connector
        if lon_span < 0.1 {
            return true;
        }
    }

    false
}

/// Check if an object class is a metadata/internal feature that shouldn't be rendered
fn is_metadata_object(object_class: u16) -> bool {
    // CM93 metadata object codes are typically in the 200+ range
    // These include coverage (M_COVR), quality (M_QUAL), etc.
    // Filter them out as they're internal to the format
    object_class >= 200
}

/// Check if an area geometry is a degenerate sliver (likely a cell boundary artifact)
fn is_degenerate_area(points: &[GeoPoint]) -> bool {
    if points.len() < 3 {
        return true;
    }

    // Calculate bounding box
    let min_lon = points.iter().map(|p| p.lon).fold(f64::INFINITY, f64::min);
    let max_lon = points.iter().map(|p| p.lon).fold(f64::NEG_INFINITY, f64::max);
    let min_lat = points.iter().map(|p| p.lat).fold(f64::INFINITY, f64::min);
    let max_lat = points.iter().map(|p| p.lat).fold(f64::NEG_INFINITY, f64::max);

    let lon_span = max_lon - min_lon;
    let lat_span = max_lat - min_lat;

    // Check for extremely thin slivers (aspect ratio > 100:1 and very small)
    if lon_span > 0.0 && lat_span > 0.0 {
        let aspect_ratio = if lon_span > lat_span {
            lon_span / lat_span
        } else {
            lat_span / lon_span
        };

        // Very thin sliver AND small overall - likely cell boundary artifact
        if aspect_ratio > 50.0 && (lon_span < 0.01 || lat_span < 0.01) {
            return true;
        }
    }

    // Zero-area polygons
    if lon_span < 1e-8 || lat_span < 1e-8 {
        return true;
    }

    false
}

/// Convert CM93 feature to GeoJSON
fn feature_to_geojson(feature: &Cm93Feature, dictionary: Option<&Cm93Dictionary>) -> Option<GeoJsonFeature> {
    let geom = &feature.geometry;

    // Skip invalid geometries
    if !geom.is_valid() {
        return None;
    }

    // Skip metadata objects (coverage, quality records, etc.)
    if is_metadata_object(feature.object_class) {
        return None;
    }

    // Skip cell boundary connector lines
    if feature.geometry_type == super::GeometryType::Line {
        if is_cell_boundary_connector(&geom.points) {
            return None;
        }
    }

    // Skip degenerate area features (thin slivers at cell boundaries)
    if feature.geometry_type == super::GeometryType::Area {
        if is_degenerate_area(&geom.points) {
            return None;
        }
    }

    // Determine geometry type and coordinates
    let (geom_type, coordinates) = match feature.geometry_type {
        super::GeometryType::Point => {
            if let Some(p) = geom.points.first() {
                ("Point".to_string(), serde_json::json!([p.lon, p.lat]))
            } else {
                return None;
            }
        }
        super::GeometryType::Line => {
            let coords: Vec<[f64; 2]> = geom.points.iter()
                .map(|p| [p.lon, p.lat])
                .collect();
            if coords.len() < 2 {
                return None;
            }
            ("LineString".to_string(), serde_json::json!(coords))
        }
        super::GeometryType::Area => {
            let coords: Vec<[f64; 2]> = geom.points.iter()
                .map(|p| [p.lon, p.lat])
                .collect();
            if coords.len() < 3 {
                return None;
            }
            // GeoJSON polygons need to be wrapped in an array (for rings)
            ("Polygon".to_string(), serde_json::json!([coords]))
        }
    };

    // Get object class info
    let (obj_acronym, obj_name) = if let Some(dict) = dictionary {
        if let Some(obj) = dict.get_object(feature.object_class) {
            (obj.acronym.clone(), obj.name.clone())
        } else {
            (format!("OBJ_{}", feature.object_class), format!("Object {}", feature.object_class))
        }
    } else {
        (format!("OBJ_{}", feature.object_class), format!("Object {}", feature.object_class))
    };

    // Determine layer for styling
    let layer = classify_layer(feature.object_class);

    // Extract common attributes
    let depth = extract_depth(feature);
    let name = extract_name(feature);
    let color = extract_color(feature);

    // Build additional attributes
    let mut attributes = HashMap::new();
    for (code, value) in &feature.attributes {
        let key = if let Some(dict) = dictionary {
            dict.get_attribute(*code)
                .map(|a| a.acronym.clone())
                .unwrap_or_else(|| format!("attr_{}", code))
        } else {
            format!("attr_{}", code)
        };
        attributes.insert(key, serde_json::json!(value.as_string()));
    }

    Some(GeoJsonFeature {
        feature_type: "Feature".to_string(),
        geometry: GeoJsonGeometry {
            geom_type,
            coordinates,
        },
        properties: GeoJsonProperties {
            obj_class: feature.object_class,
            obj_acronym,
            obj_name,
            geom_type: match feature.geometry_type {
                super::GeometryType::Point => "Point",
                super::GeometryType::Line => "Line",
                super::GeometryType::Area => "Polygon",
            }.to_string(),
            layer,
            depth,
            name,
            color,
            attributes,
        },
    })
}

/// Classify feature into a styling layer
fn classify_layer(object_class: u16) -> String {
    match object_class {
        // Navigation aids
        object_codes::LIGHTS => "lights",
        object_codes::BCNCAR | object_codes::BCNLAT | object_codes::BCNISD
        | object_codes::BCNSAW | object_codes::BCNSPP => "beacons",
        object_codes::BOYCAR | object_codes::BOYLAT | object_codes::BOYISD
        | object_codes::BOYSAW | object_codes::BOYSPP | object_codes::BOYINB => "buoys",

        // Depths and soundings
        object_codes::SOUNDG => "soundings",
        object_codes::DEPCNT => "depth_contours",
        object_codes::DEPARE => "depth_areas",

        // Land and water
        object_codes::LNDARE | object_codes::LNDRGN => "land",
        object_codes::COALNE | object_codes::ZEMCNT => "coastline",  // Zero meter contour is essentially coastline
        object_codes::SLCONS => "shoreline",  // Shoreline construction (piers, seawalls, etc.)
        object_codes::SEAARE => "sea_area",
        object_codes::RIVERS => "rivers",
        object_codes::ITDARE => "intertidal",  // Intertidal area (tidal flats)
        object_codes::SBDARE | object_codes::VEGARE => "seabed",  // Seabed/vegetation areas

        // Hazards and caution areas
        object_codes::OBSTRN => "obstructions",
        object_codes::WRECKS => "wrecks",
        object_codes::UWTROC => "rocks",
        object_codes::CTNARE => "caution_area",

        // Infrastructure
        object_codes::BRIDGE => "bridges",
        object_codes::PILBOP => "pilot_boarding",
        object_codes::BUAARE | object_codes::BUISGL => "buildings",

        // Areas
        object_codes::ACHARE | object_codes::ACHBRT | object_codes::ACHPNT => "anchorage",
        object_codes::FAIRWY => "fairway",
        object_codes::DRGARE => "dredged_area",
        object_codes::RESARE => "restricted_area",

        // Traffic separation
        object_codes::TSSLPT | object_codes::TSEZNE => "traffic_separation",

        // Cables and pipelines
        object_codes::CBLSUB | object_codes::CBLOHD | object_codes::PIPSOL => "cables",

        // Default
        _ => "other",
    }.to_string()
}

/// Extract depth value from feature attributes
fn extract_depth(feature: &Cm93Feature) -> Option<f64> {
    // Try VALSOU (sounding value) first
    if let Some(val) = feature.attributes.get(&attr_codes::VALSOU) {
        return val.as_f64();
    }
    // Try VALDCO (depth contour value)
    if let Some(val) = feature.attributes.get(&attr_codes::VALDCO) {
        return val.as_f64();
    }
    // Try DRVAL1 (depth range minimum)
    if let Some(val) = feature.attributes.get(&attr_codes::DRVAL1) {
        return val.as_f64();
    }
    None
}

/// Extract name from feature attributes
fn extract_name(feature: &Cm93Feature) -> Option<String> {
    if let Some(val) = feature.attributes.get(&attr_codes::OBJNAM) {
        let s = val.as_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

/// Extract color from feature attributes
fn extract_color(feature: &Cm93Feature) -> Option<String> {
    if let Some(val) = feature.attributes.get(&attr_codes::COLOUR) {
        let s = val.as_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_bounds() {
        let bounds = tile_bounds(0, 0, 0);
        assert!((bounds.min_lon - (-180.0)).abs() < 0.001);
        assert!((bounds.max_lon - 180.0).abs() < 0.001);
    }

    #[test]
    fn test_scale_for_zoom() {
        assert_eq!(scale_for_zoom(0), Cm93Scale::Z);
        assert_eq!(scale_for_zoom(10), Cm93Scale::D);
        assert_eq!(scale_for_zoom(16), Cm93Scale::G);
    }

    #[test]
    fn test_classify_layer() {
        assert_eq!(classify_layer(object_codes::SOUNDG), "soundings");
        assert_eq!(classify_layer(object_codes::LIGHTS), "lights");
        assert_eq!(classify_layer(object_codes::LNDARE), "land");
    }
}
