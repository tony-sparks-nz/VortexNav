// CM93 Geometry and Coordinate Transformation
// Based on OpenCPN's CM93 implementation (GPL v2)
// Reference: https://github.com/OpenCPN/OpenCPN

use super::{CM93_SEMIMAJOR_AXIS, DEG_TO_RAD, RAD_TO_DEG};

/// A point in CM93 internal coordinates (16-bit encoded)
#[derive(Debug, Clone, Copy, Default)]
pub struct Cm93Point {
    pub x: i32,
    pub y: i32,
}

/// A point in Mercator projection coordinates
#[derive(Debug, Clone, Copy, Default)]
pub struct MercatorPoint {
    pub x: f64,
    pub y: f64,
}

/// A point in WGS84 geographic coordinates
#[derive(Debug, Clone, Copy, Default)]
pub struct GeoPoint {
    pub lat: f64,
    pub lon: f64,
}

/// CM93 cell geographic reference for coordinate transformation
/// Uses the actual Mercator bounds from the CM93 cell header
#[derive(Debug, Clone)]
pub struct CellTransform {
    /// Mercator easting minimum (from cell header, International 1924 ellipsoid)
    pub easting_min: f64,
    /// Mercator northing minimum (from cell header, International 1924 ellipsoid)
    pub northing_min: f64,
    /// X scale factor: (easting_max - easting_min) / 65535
    pub x_rate: f64,
    /// Y scale factor: (northing_max - northing_min) / 65535
    pub y_rate: f64,
}

impl CellTransform {
    /// Create a new cell transform from cell header Mercator bounds
    pub fn new(
        easting_min: f64,
        northing_min: f64,
        x_rate: f64,
        y_rate: f64,
    ) -> Self {
        Self {
            easting_min,
            northing_min,
            x_rate,
            y_rate,
        }
    }

    /// Transform a CM93 encoded point to geographic coordinates
    /// CM93 stores points as 16-bit unsigned values [0, 65535] that scale to Mercator coordinates
    pub fn to_geo(&self, point: Cm93Point) -> GeoPoint {
        // CM93 coordinate formula:
        // merc_x = easting_min + point.x * x_rate
        // merc_y = northing_min + point.y * y_rate
        let merc_x = self.easting_min + (point.x as f64 * self.x_rate);
        let merc_y = self.northing_min + (point.y as f64 * self.y_rate);

        mercator_to_geo(MercatorPoint { x: merc_x, y: merc_y })
    }

    /// Transform multiple points efficiently
    pub fn to_geo_batch(&self, points: &[Cm93Point]) -> Vec<GeoPoint> {
        points
            .iter()
            .map(|point| {
                let merc_x = self.easting_min + (point.x as f64 * self.x_rate);
                let merc_y = self.northing_min + (point.y as f64 * self.y_rate);
                mercator_to_geo(MercatorPoint { x: merc_x, y: merc_y })
            })
            .collect()
    }
}

/// Convert geographic coordinates to CM93 Mercator projection
/// Uses the International 1924 ellipsoid (CM93's reference)
pub fn geo_to_mercator(lat: f64, lon: f64) -> MercatorPoint {
    let lat_rad = lat * DEG_TO_RAD;
    let lon_rad = lon * DEG_TO_RAD;

    // Mercator X is simply longitude scaled by the ellipsoid radius
    let x = CM93_SEMIMAJOR_AXIS * lon_rad;

    // Mercator Y uses the spherical approximation
    // y = R * ln(tan(π/4 + lat/2))
    let y = CM93_SEMIMAJOR_AXIS * ((std::f64::consts::FRAC_PI_4 + lat_rad / 2.0).tan().ln());

    MercatorPoint { x, y }
}

/// Convert CM93 Mercator projection to geographic coordinates
pub fn mercator_to_geo(point: MercatorPoint) -> GeoPoint {
    // Longitude is straightforward
    let lon_rad = point.x / CM93_SEMIMAJOR_AXIS;
    let lon = lon_rad * RAD_TO_DEG;

    // Latitude uses inverse Mercator formula
    // lat = 2 * atan(exp(y/R)) - π/2
    let lat_rad = 2.0 * (point.y / CM93_SEMIMAJOR_AXIS).exp().atan() - std::f64::consts::FRAC_PI_2;
    let lat = lat_rad * RAD_TO_DEG;

    GeoPoint { lat, lon }
}

/// Apply WGS84 correction to CM93 coordinates
/// CM93 uses International 1924 ellipsoid, we need WGS84
pub fn apply_wgs84_correction(point: &mut GeoPoint, lat_correction: f64, lon_correction: f64) {
    point.lat += lat_correction;
    point.lon += lon_correction;
}

/// Calculate the WGS84 offset for a given location
/// This is a simplified version - actual CM93 may have regional offsets
pub fn get_wgs84_offset(lat: f64, _lon: f64) -> (f64, f64) {
    // The offset between International 1924 and WGS84 varies by location
    // These are approximate values - exact values would come from datum transformation
    // For most areas, the difference is small (< 100 meters)

    // Simplified model: offset increases slightly with latitude
    let lat_offset = 0.0001 * lat.abs().cos();
    let lon_offset = 0.0001;

    (lat_offset, lon_offset)
}

/// CM93 polyline/polygon geometry
#[derive(Debug, Clone)]
pub struct Cm93Geometry {
    /// Geometry type (1=point, 2=line, 4=area)
    pub geom_type: u8,
    /// Coordinates in geographic space
    pub points: Vec<GeoPoint>,
    /// For areas: indices where rings start (first ring is exterior, rest are holes)
    pub ring_starts: Vec<usize>,
}

impl Cm93Geometry {
    /// Create a point geometry
    pub fn point(lat: f64, lon: f64) -> Self {
        Self {
            geom_type: 1,
            points: vec![GeoPoint { lat, lon }],
            ring_starts: Vec::new(),
        }
    }

    /// Create a line geometry
    pub fn line(points: Vec<GeoPoint>) -> Self {
        Self {
            geom_type: 2,
            points,
            ring_starts: Vec::new(),
        }
    }

    /// Create an area geometry (closed polygon)
    pub fn area(points: Vec<GeoPoint>, ring_starts: Vec<usize>) -> Self {
        Self {
            geom_type: 4,
            points,
            ring_starts: if ring_starts.is_empty() {
                vec![0]
            } else {
                ring_starts
            },
        }
    }

    /// Get bounding box [min_lon, min_lat, max_lon, max_lat]
    pub fn bounds(&self) -> [f64; 4] {
        if self.points.is_empty() {
            return [0.0, 0.0, 0.0, 0.0];
        }

        let mut min_lon = f64::MAX;
        let mut min_lat = f64::MAX;
        let mut max_lon = f64::MIN;
        let mut max_lat = f64::MIN;

        for p in &self.points {
            min_lon = min_lon.min(p.lon);
            min_lat = min_lat.min(p.lat);
            max_lon = max_lon.max(p.lon);
            max_lat = max_lat.max(p.lat);
        }

        [min_lon, min_lat, max_lon, max_lat]
    }

    /// Check if geometry is valid
    pub fn is_valid(&self) -> bool {
        match self.geom_type {
            1 => !self.points.is_empty(),
            2 => self.points.len() >= 2,
            4 => self.points.len() >= 3,
            _ => false,
        }
    }

    /// Convert to GeoJSON-style coordinate arrays
    pub fn to_coordinates(&self) -> serde_json::Value {
        use serde_json::json;

        match self.geom_type {
            1 => {
                // Point: [lon, lat]
                if let Some(p) = self.points.first() {
                    json!([p.lon, p.lat])
                } else {
                    json!(null)
                }
            }
            2 => {
                // LineString: [[lon, lat], ...]
                json!(self
                    .points
                    .iter()
                    .map(|p| vec![p.lon, p.lat])
                    .collect::<Vec<_>>())
            }
            4 => {
                // Polygon: [[[lon, lat], ...], [...holes...]]
                if self.ring_starts.is_empty() {
                    json!([self
                        .points
                        .iter()
                        .map(|p| vec![p.lon, p.lat])
                        .collect::<Vec<_>>()])
                } else {
                    let mut rings = Vec::new();
                    for (i, &start) in self.ring_starts.iter().enumerate() {
                        let end = self
                            .ring_starts
                            .get(i + 1)
                            .copied()
                            .unwrap_or(self.points.len());
                        let ring: Vec<Vec<f64>> = self.points[start..end]
                            .iter()
                            .map(|p| vec![p.lon, p.lat])
                            .collect();
                        rings.push(ring);
                    }
                    json!(rings)
                }
            }
            _ => json!(null),
        }
    }
}

/// Read a signed 16-bit delta value from CM93 geometry stream
/// CM93 uses delta encoding for coordinates
pub fn read_delta(data: &[u8], offset: &mut usize) -> Option<i16> {
    if *offset + 2 > data.len() {
        return None;
    }

    let val = i16::from_le_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    Some(val)
}

/// Read an unsigned 16-bit value
pub fn read_u16(data: &[u8], offset: &mut usize) -> Option<u16> {
    if *offset + 2 > data.len() {
        return None;
    }

    let val = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    Some(val)
}

/// Read an unsigned 32-bit value
pub fn read_u32(data: &[u8], offset: &mut usize) -> Option<u32> {
    if *offset + 4 > data.len() {
        return None;
    }

    let val = u32::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
    ]);
    *offset += 4;
    Some(val)
}

/// Read a 32-bit float value
pub fn read_f32(data: &[u8], offset: &mut usize) -> Option<f32> {
    if *offset + 4 > data.len() {
        return None;
    }

    let val = f32::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
    ]);
    *offset += 4;
    Some(val)
}

/// Read a 64-bit float (double) value
pub fn read_f64(data: &[u8], offset: &mut usize) -> Option<f64> {
    if *offset + 8 > data.len() {
        return None;
    }

    let val = f64::from_le_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
        data[*offset + 4],
        data[*offset + 5],
        data[*offset + 6],
        data[*offset + 7],
    ]);
    *offset += 8;
    Some(val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mercator_roundtrip() {
        let lat = 37.7749;
        let lon = -122.4194;

        let merc = geo_to_mercator(lat, lon);
        let geo = mercator_to_geo(merc);

        assert!((geo.lat - lat).abs() < 0.0001);
        assert!((geo.lon - lon).abs() < 0.0001);
    }

    #[test]
    fn test_geometry_bounds() {
        let geom = Cm93Geometry::line(vec![
            GeoPoint { lat: 10.0, lon: 20.0 },
            GeoPoint { lat: 30.0, lon: 40.0 },
            GeoPoint { lat: 20.0, lon: 30.0 },
        ]);

        let bounds = geom.bounds();
        assert_eq!(bounds[0], 20.0); // min_lon
        assert_eq!(bounds[1], 10.0); // min_lat
        assert_eq!(bounds[2], 40.0); // max_lon
        assert_eq!(bounds[3], 30.0); // max_lat
    }

    #[test]
    fn test_geometry_validity() {
        assert!(Cm93Geometry::point(0.0, 0.0).is_valid());
        assert!(Cm93Geometry::line(vec![
            GeoPoint { lat: 0.0, lon: 0.0 },
            GeoPoint { lat: 1.0, lon: 1.0 }
        ])
        .is_valid());
        assert!(!Cm93Geometry::line(vec![GeoPoint { lat: 0.0, lon: 0.0 }]).is_valid());
    }
}
