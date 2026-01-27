// CM93 Cell Parser
// Parses individual CM93 cell files
// Based on OpenCPN's CM93 implementation (GPL v2)

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use super::decode::decode_buffer;
use super::geometry::{
    read_f32, read_f64, read_u16, read_u32, CellTransform, Cm93Geometry, Cm93Point, GeoPoint,
};
use super::{Cm93Error, Cm93Scale, GeometryType};

/// CM93 cell file header
#[derive(Debug, Clone)]
pub struct CellHeader {
    /// Header signature/version
    pub signature: u32,
    /// Geographic bounds (WGS84)
    pub lon_min: f64,
    pub lat_min: f64,
    pub lon_max: f64,
    pub lat_max: f64,
    /// Mercator bounds (International 1924 ellipsoid)
    pub easting_min: f64,
    pub northing_min: f64,
    pub easting_max: f64,
    pub northing_max: f64,
    /// Scale factors: (max - min) / 65535
    pub x_rate: f64,
    pub y_rate: f64,
    /// Number of feature records
    pub feature_count: u32,
    /// Number of edge (line) records
    pub edge_count: u32,
    /// Number of connected node records
    pub connected_node_count: u32,
    /// Offset to feature table
    pub feature_table_offset: u32,
    /// Offset to geometry data
    pub geometry_offset: u32,
}

/// A feature (object) in a CM93 cell
#[derive(Debug, Clone)]
pub struct Cm93Feature {
    /// Object class code
    pub object_class: u16,
    /// Feature ID within cell
    pub feature_id: u16,
    /// Geometry type
    pub geometry_type: GeometryType,
    /// Geometry data
    pub geometry: Cm93Geometry,
    /// Attributes (code -> value)
    pub attributes: HashMap<u16, AttributeValue>,
}

/// CM93 attribute value types
#[derive(Debug, Clone)]
pub enum AttributeValue {
    Integer(i32),
    Float(f64),
    String(String),
    List(Vec<i32>),
}

impl AttributeValue {
    pub fn as_string(&self) -> String {
        match self {
            AttributeValue::Integer(i) => i.to_string(),
            AttributeValue::Float(f) => f.to_string(),
            AttributeValue::String(s) => s.clone(),
            AttributeValue::List(l) => l
                .iter()
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(","),
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            AttributeValue::Integer(i) => Some(*i as f64),
            AttributeValue::Float(f) => Some(*f),
            _ => None,
        }
    }
}

/// A parsed CM93 cell
#[derive(Debug)]
pub struct Cm93Cell {
    /// Cell header
    pub header: CellHeader,
    /// Cell index
    pub cell_index: u32,
    /// Scale level
    pub scale: Cm93Scale,
    /// Coordinate transformation
    pub transform: CellTransform,
    /// Features in this cell
    pub features: Vec<Cm93Feature>,
}

impl Cm93Cell {
    /// Parse only the header of a CM93 cell to get bounds quickly
    /// This reads only the first 138 bytes instead of the entire file
    pub fn parse_header_only(path: &Path) -> Result<[f64; 4], Cm93Error> {
        use std::io::Read;

        let mut file = File::open(path).map_err(Cm93Error::Io)?;

        // Read only the header portion (138 bytes)
        let mut header_data = [0u8; 150];
        let bytes_read = file.read(&mut header_data).map_err(Cm93Error::Io)?;

        if bytes_read < 138 {
            return Err(Cm93Error::InvalidCellData(
                format!("File too small: {} bytes (need 138)", bytes_read)
            ));
        }

        // Decode header using CM93 cipher
        decode_buffer(&mut header_data[..bytes_read]);

        // Parse just the geographic bounds from offset 10
        let mut offset = 10;
        let lon_min = read_f64(&header_data, &mut offset).unwrap_or(0.0);
        let lat_min = read_f64(&header_data, &mut offset).unwrap_or(0.0);
        let lon_max = read_f64(&header_data, &mut offset).unwrap_or(0.0);
        let lat_max = read_f64(&header_data, &mut offset).unwrap_or(0.0);

        Ok([lon_min, lat_min, lon_max, lat_max])
    }

    /// Parse a CM93 cell file
    pub fn parse(path: &Path, scale: Cm93Scale, cell_index: u32) -> Result<Self, Cm93Error> {
        // Read entire file
        let mut file = File::open(path).map_err(Cm93Error::Io)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(Cm93Error::Io)?;

        if data.len() < 128 {
            return Err(Cm93Error::InvalidCellData(
                "File too small for valid cell".to_string(),
            ));
        }

        // Decode the entire file using CM93 substitution cipher
        decode_buffer(&mut data);

        // Parse header
        let header = Self::parse_header(&data)?;

        // Create coordinate transform using Mercator bounds from header
        let transform = CellTransform::new(
            header.easting_min,
            header.northing_min,
            header.x_rate,
            header.y_rate,
        );

        // Parse features
        let features = Self::parse_features(&data, &header, &transform)?;

        Ok(Self {
            header,
            cell_index,
            scale,
            transform,
            features,
        })
    }

    /// Parse cell header from decoded data
    /// Based on OpenCPN's CM93 header structure
    ///
    /// CM93 cell file format (from OpenCPN):
    /// - Prolog (10 bytes):
    ///   - offset 0: ushort word0 (length of prolog + header = 138)
    ///   - offset 2: int int0 (length of vector table)
    ///   - offset 6: int int1 (length of feature table)
    /// - Header (128 bytes, starting at offset 10):
    ///   - 8 doubles for geographic and Mercator bounds
    ///   - Various ushorts and ints for record counts
    fn parse_header(data: &[u8]) -> Result<CellHeader, Cm93Error> {
        // Need at least 10 (prolog) + 128 (header) = 138 bytes
        if data.len() < 138 {
            return Err(Cm93Error::InvalidCellData(
                format!("File too small: {} bytes (need 138)", data.len())
            ));
        }

        // First, read the prolog (10 bytes)
        let mut offset = 0;
        let prolog_header_len = read_u16(data, &mut offset).unwrap_or(0);
        let _vector_table_len = read_u32(data, &mut offset).unwrap_or(0);
        let _feature_table_len = read_u32(data, &mut offset).unwrap_or(0);

        // Header starts at offset 10 (after prolog)
        // OpenCPN CM93 header format:
        // Offset 10: lon_min (double, 8 bytes)
        // Offset 18: lat_min (double, 8 bytes)
        // Offset 26: lon_max (double, 8 bytes)
        // Offset 34: lat_max (double, 8 bytes)
        // Offset 42: easting_min (double, 8 bytes)
        // Offset 50: northing_min (double, 8 bytes)
        // Offset 58: easting_max (double, 8 bytes)
        // Offset 66: northing_max (double, 8 bytes)
        // Offset 74: usn_vector_records (ushort, 2 bytes)
        // ... etc

        // Read geographic bounds as doubles (offset is now 10)
        let lon_min = read_f64(data, &mut offset).unwrap_or(0.0);
        let lat_min = read_f64(data, &mut offset).unwrap_or(0.0);
        let lon_max = read_f64(data, &mut offset).unwrap_or(0.0);
        let lat_max = read_f64(data, &mut offset).unwrap_or(0.0);

        // Read Mercator bounds
        let easting_min = read_f64(data, &mut offset).unwrap_or(0.0);
        let northing_min = read_f64(data, &mut offset).unwrap_or(0.0);
        let easting_max = read_f64(data, &mut offset).unwrap_or(0.0);
        let northing_max = read_f64(data, &mut offset).unwrap_or(0.0);

        // Now at offset 74 - read record counts (offset = 10 + 64 = 74)
        let edge_count = read_u16(data, &mut offset).unwrap_or(0) as u32;
        let _n_vector_points = read_u32(data, &mut offset).unwrap_or(0);
        let _m_46 = read_u32(data, &mut offset).unwrap_or(0);
        let _m_4a = read_u32(data, &mut offset).unwrap_or(0);
        let point3d_count = read_u16(data, &mut offset).unwrap_or(0) as u32;

        // Read more fields per OpenCPN structure
        let _m_50 = read_u32(data, &mut offset).unwrap_or(0);
        let _m_54 = read_u32(data, &mut offset).unwrap_or(0);
        let point2d_count = read_u16(data, &mut offset).unwrap_or(0) as u32;
        let _m_5a = read_u16(data, &mut offset).unwrap_or(0);
        let _m_5c = read_u16(data, &mut offset).unwrap_or(0);
        let feature_count = read_u16(data, &mut offset).unwrap_or(0) as u32;

        // Compute scale factors from Mercator bounds
        // OpenCPN: transform_x_rate = delta_x / 65535
        let delta_x = easting_max - easting_min;
        let delta_y = northing_max - northing_min;

        let x_rate = if delta_x.abs() > 0.001 { delta_x / 65535.0 } else { 1.0 };
        let y_rate = if delta_y.abs() > 0.001 { delta_y / 65535.0 } else { 1.0 };

        // Calculate data section offsets
        let header_end = 138u32;
        let feature_table_offset = header_end;
        let geometry_offset = 0;

        Ok(CellHeader {
            signature: prolog_header_len as u32,
            lon_min,
            lat_min,
            lon_max,
            lat_max,
            easting_min,
            northing_min,
            easting_max,
            northing_max,
            x_rate,
            y_rate,
            feature_count,
            edge_count,
            connected_node_count: point3d_count + point2d_count,
            feature_table_offset,
            geometry_offset,
        })
    }

    /// Parse all data sections from cell (OpenCPN format)
    ///
    /// File structure after header:
    /// 1. Vector records (edges) - n = edge_count
    /// 2. 3D point records (soundings) - n = point3d_count
    /// 3. 2D point records - n = point2d_count
    /// 4. Feature records - n = feature_count
    fn parse_features(
        data: &[u8],
        header: &CellHeader,
        transform: &CellTransform,
    ) -> Result<Vec<Cm93Feature>, Cm93Error> {
        let mut features = Vec::new();

        // CM93 file layout after prolog (10 bytes):
        // - Header: 128 bytes (offset 10-138)
        // - Vector data section: vector_table_len bytes (edges + 3D points + 2D points)
        // - Feature data section: feature_table_len bytes
        //
        // The prolog contains: word0 (138) + vector_table_len + feature_table_len = file_length
        // Features start at: 138 + vector_table_len

        // Get vector_table_len from prolog (stored in signature field)
        let prolog_header_len = header.signature; // This was word0 (138)

        // Re-read prolog to get table lengths
        let mut prolog_offset = 0usize;
        let _word0 = read_u16(data, &mut prolog_offset).unwrap_or(138);
        let vector_table_len = read_u32(data, &mut prolog_offset).unwrap_or(0) as usize;
        let feature_table_len = read_u32(data, &mut prolog_offset).unwrap_or(0) as usize;

        // Debug logging - disabled for production
        let verbose = false;

        // Vector section starts at offset 138
        let vector_section_start = 138usize;
        // Feature section starts after vector section
        let feature_section_start = vector_section_start + vector_table_len;

        if verbose {
            eprintln!("[CM93 Parse] Header: edge_count={}, lon=({:.4}, {:.4}), lat=({:.4}, {:.4})",
                header.edge_count, header.lon_min, header.lon_max, header.lat_min, header.lat_max);
            eprintln!("[CM93 Parse] Header: easting=({:.2}, {:.2}), northing=({:.2}, {:.2})",
                header.easting_min, header.easting_max, header.northing_min, header.northing_max);
            eprintln!("[CM93 Parse] Header: x_rate={}, y_rate={}", header.x_rate, header.y_rate);
            eprintln!("[CM93 Parse] vector_table_len={}, feature_table_len={}, feature_start={}",
                vector_table_len, feature_table_len, feature_section_start);

            // Dump first 32 bytes of vector section
            eprintln!("[CM93 Parse] Vector section first 32 bytes @{}:", vector_section_start);
            for row in 0..2 {
                let row_start = vector_section_start + row * 16;
                if row_start + 16 <= data.len() {
                    eprint!("[CM93 Parse]   @{:5}: ", row_start);
                    for i in 0..16 {
                        eprint!("{:02x} ", data[row_start + i]);
                    }
                    eprintln!();
                }
            }
        }

        // 1. Parse vector records (edges) from vector section
        let mut offset = vector_section_start;
        let mut edge_geometries: Vec<Vec<Cm93Point>> = Vec::with_capacity(header.edge_count as usize);

        for edge_idx in 0..header.edge_count {
            if offset + 2 > data.len() || offset >= feature_section_start {
                if verbose { eprintln!("[CM93 Parse] Edge {} truncated at offset {}", edge_idx, offset); }
                break;
            }

            let npoints = read_u16(data, &mut offset).unwrap_or(0) as usize;

            // Log first 10 edges and any edge with unusual npoints
            if verbose && (edge_idx < 10 || npoints > 100 || npoints == 0) {
                eprintln!("[CM93 Parse] Edge {} @offset {}: npoints={}", edge_idx, offset - 2, npoints);
            }

            let mut points = Vec::with_capacity(npoints);
            for _ in 0..npoints {
                if offset + 4 > data.len() || offset >= feature_section_start { break; }
                let x = read_u16(data, &mut offset).unwrap_or(0) as i32;
                let y = read_u16(data, &mut offset).unwrap_or(0) as i32;
                points.push(Cm93Point { x, y });
            }
            edge_geometries.push(points);
        }

        // Verify edge section ends before feature section starts
        let edge_section_end = offset;
        if verbose {
            eprintln!("[CM93 Parse] Parsed {} edges, edge section ended at offset {}",
                edge_geometries.len(), edge_section_end);
            eprintln!("[CM93 Parse] Gap between edges and features: {} bytes",
                feature_section_start.saturating_sub(edge_section_end));
            eprintln!("[CM93 Parse] Transform: easting_min={}, northing_min={}, x_rate={}, y_rate={}",
                transform.easting_min, transform.northing_min, transform.x_rate, transform.y_rate);

            // Log first 5 edges with their points and transformed coordinates
            for (idx, edge) in edge_geometries.iter().take(5).enumerate() {
                if edge.len() > 0 {
                    let first_pt = &edge[0];
                    let last_pt = &edge[edge.len() - 1];
                    let first_geo = transform.to_geo(*first_pt);
                    let last_geo = transform.to_geo(*last_pt);
                    eprintln!("[CM93 Parse] Edge {}: {} points, raw[0]=({}, {}) -> geo({:.4}, {:.4}), raw[last]=({}, {}) -> geo({:.4}, {:.4})",
                        idx, edge.len(),
                        first_pt.x, first_pt.y, first_geo.lat, first_geo.lon,
                        last_pt.x, last_pt.y, last_geo.lat, last_geo.lon);
                }
            }
        }

        // The gap should contain 3D points and 2D points
        // Parse 2D points which are used for point features
        let point2d_start = edge_section_end;
        // Skip past 3D point records first (point3d_count records, each: n_points(u16) + n_points*(x,y,z))
        // For now, we don't parse 3D points, but we need to account for 2D points
        // 2D points are stored as a simple array of (x,y) pairs after 3D points

        // The 2D point array comes after 3D points and is used by point features
        // For now, just note we're not parsing them - features that need them will have empty geometry

        // 2. Parse 3D point records (soundings) - comes after edges in vector section
        // Each 3D point record: npoints (u16) + points (6 bytes each: x,y,z)
        let mut point3d_array: Vec<(Cm93Point, u16)> = Vec::new();
        // Skip for now - we'd need m_n_point3d_records count

        // 3. Parse 2D point records - comes after 3D points
        // Each is just x,y (4 bytes) - simple array
        let mut point2d_array: Vec<Cm93Point> = Vec::new();
        // Skip for now - we'd need exact count

        // 4. Parse feature records from feature section
        offset = feature_section_start;
        let feature_section_end = feature_section_start + feature_table_len;

        if verbose {
            eprintln!("[CM93 Parse] Feature section: {} to {} ({} features)",
                feature_section_start, feature_section_end, header.feature_count);

            // Dump first 64 bytes of feature section to see pattern
            eprintln!("[CM93 Parse] Feature section first 64 bytes:");
            for row in 0..4 {
                let row_start = feature_section_start + row * 16;
                if row_start + 16 <= data.len() {
                    eprint!("[CM93 Parse]   @{:5}: ", row_start);
                    for i in 0..16 {
                        eprint!("{:02x} ", data[row_start + i]);
                    }
                    eprintln!();
                }
            }
        }

        // Feature format: object_type (1) + geom_prim (1) + obj_desc_bytes (2) + data...
        for feat_idx in 0..header.feature_count {
            if offset + 4 > data.len() || offset >= feature_section_end {
                if verbose { eprintln!("[CM93 Parse] Feature {} ended at offset {} (section end={})", feat_idx, offset, feature_section_end); }
                break;
            }

            let feature_start = offset;

            // Dump raw bytes for first few features
            if verbose && feat_idx < 10 {
                eprintln!("[CM93 Parse] Feature {} raw bytes @{}: {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x}",
                    feat_idx, offset,
                    data.get(offset).copied().unwrap_or(0),
                    data.get(offset+1).copied().unwrap_or(0),
                    data.get(offset+2).copied().unwrap_or(0),
                    data.get(offset+3).copied().unwrap_or(0),
                    data.get(offset+4).copied().unwrap_or(0),
                    data.get(offset+5).copied().unwrap_or(0),
                    data.get(offset+6).copied().unwrap_or(0),
                    data.get(offset+7).copied().unwrap_or(0),
                    data.get(offset+8).copied().unwrap_or(0),
                    data.get(offset+9).copied().unwrap_or(0),
                    data.get(offset+10).copied().unwrap_or(0),
                    data.get(offset+11).copied().unwrap_or(0));
            }

            let object_type = data[offset];
            offset += 1;
            let geom_prim = data[offset];
            offset += 1;
            let obj_desc_bytes = read_u16(data, &mut offset).unwrap_or(0) as usize;

            if verbose && feat_idx < 10 {
                eprintln!("[CM93 Parse] Feature {}: offset={}, otype={}, gprim=0x{:02x}, desc_bytes={}, geom_type={}",
                    feat_idx, feature_start, object_type, geom_prim, obj_desc_bytes, geom_prim & 0x0F);
            }

            // CM93 obj_desc_bytes includes 4 bytes of "virtual overhead" for features with:
            // - Attributes (gprim & 0x80): OpenCPN does obj_desc_bytes -= 5 after reading nattr
            // - Area/Line geometry (gprim & 0x0F == 2 or 4): also has overhead
            // The actual file bytes = obj_desc_bytes - 4 when overhead applies
            let geom_type_raw = geom_prim & 0x0F;
            let has_geometry = geom_type_raw == 2 || geom_type_raw == 4; // LINE or AREA
            let has_attributes = (geom_prim & 0x80) != 0;

            // Apply -4 overhead for features with geometry OR attributes
            let actual_data_bytes = if (has_geometry || has_attributes) && obj_desc_bytes >= 4 {
                obj_desc_bytes - 4
            } else {
                obj_desc_bytes
            };

            let feature_data_end = offset + actual_data_bytes;
            if feature_data_end > feature_section_end {
                if verbose {
                    eprintln!("[CM93 Parse] Feature {} has invalid size {} (actual {}) at offset {} (would go to {} but section ends at {})",
                        feat_idx, obj_desc_bytes, actual_data_bytes, offset - 4, feature_data_end, feature_section_end);
                    eprintln!("[CM93 Parse]   Remaining section bytes: {}", feature_section_end - offset);
                }
                break;
            }

            let geom_type_code = geom_prim & 0x0F;
            let geometry_type = match geom_type_code {
                1 => GeometryType::Point,
                2 => GeometryType::Line,
                4 => GeometryType::Area,
                8 => GeometryType::Point, // 3D point (sounding)
                _ => {
                    // Skip unknown geometry type - jump to end of this feature's data
                    offset = feature_data_end;
                    continue;
                }
            };

            let mut geometry_points: Vec<GeoPoint> = Vec::new();

            match geom_type_code {
                2 | 4 => {
                    // LINE or AREA - read n_elements then edge indices
                    // Edge index format: bits 0-12 = edge index, bit 13 = reverse flag
                    if offset + 2 > feature_data_end { offset = feature_data_end; }
                    else {
                        let n_elements = read_u16(data, &mut offset).unwrap_or(0) as usize;

                        for _ in 0..n_elements {
                            if offset + 2 > feature_data_end { break; }
                            let edge_index = read_u16(data, &mut offset).unwrap_or(0);
                            let actual_index = (edge_index & 0x1FFF) as usize;
                            let reverse = (edge_index & 0x2000) != 0; // Bit 13 = reverse direction

                            if actual_index < edge_geometries.len() {
                                let edge_points = &edge_geometries[actual_index];
                                let mut geo_points = transform.to_geo_batch(edge_points);

                                // Log sample edge references for first 3 features
                                if verbose && feat_idx < 3 {
                                    eprintln!("[CM93 Parse] Feature {} uses edge {} ({} pts), reverse={}",
                                        feat_idx, actual_index, edge_points.len(), reverse);
                                    if let Some(first) = edge_points.first() {
                                        eprintln!("[CM93 Parse]   First pt: raw=({}, {})", first.x, first.y);
                                    }
                                }

                                // Reverse edge direction if flag is set
                                if reverse {
                                    geo_points.reverse();
                                }

                                // Skip first point if we already have points (avoid duplicates at junctions)
                                if !geometry_points.is_empty() && !geo_points.is_empty() {
                                    geometry_points.extend(geo_points.into_iter().skip(1));
                                } else {
                                    geometry_points.extend(geo_points);
                                }
                            } else if verbose && feat_idx < 3 {
                                eprintln!("[CM93 Parse] Feature {} references invalid edge index {}", feat_idx, actual_index);
                            }
                        }
                    }
                }
                1 => {
                    // 2D POINT - read index into point2d_array
                    if offset + 2 <= feature_data_end {
                        let point_index = read_u16(data, &mut offset).unwrap_or(0) as usize;
                        if point_index < point2d_array.len() {
                            let pt = &point2d_array[point_index];
                            let geo = transform.to_geo(*pt);
                            geometry_points.push(geo);
                        }
                    }
                }
                8 => {
                    // 3D POINT (sounding) - read index into point3d_array
                    if offset + 2 <= feature_data_end {
                        let point_index = read_u16(data, &mut offset).unwrap_or(0) as usize;
                        if point_index < point3d_array.len() {
                            let (pt, _depth) = &point3d_array[point_index];
                            let geo = transform.to_geo(*pt);
                            geometry_points.push(geo);
                        }
                    }
                }
                _ => {}
            }

            // Skip to end of this feature's actual data in the file
            // This ensures we stay aligned with the next feature
            offset = feature_data_end;

            if verbose && feat_idx < 10 {
                eprintln!("[CM93 Parse] Feature {} consumed {} bytes, next feature at {}",
                    feat_idx, actual_data_bytes, offset);
            }

            let mut attributes = HashMap::new();

            // Create geometry
            let geometry = match geometry_type {
                GeometryType::Point => {
                    if geometry_points.is_empty() {
                        Cm93Geometry::point(0.0, 0.0)
                    } else {
                        Cm93Geometry::point(geometry_points[0].lat, geometry_points[0].lon)
                    }
                }
                GeometryType::Line => Cm93Geometry::line(geometry_points),
                GeometryType::Area => Cm93Geometry::area(geometry_points, vec![0]),
            };

            features.push(Cm93Feature {
                object_class: object_type as u16,
                feature_id: feat_idx as u16,
                geometry_type,
                geometry,
                attributes,
            });
        }

        if verbose {
            let with_geom = features.iter().filter(|f| !f.geometry.points.is_empty()).count();
            eprintln!("[CM93 Parse] Parsed {} features, {} with geometry points", features.len(), with_geom);

            // Sample first 3 features with geometry to verify edge assembly
            for (idx, feat) in features.iter().enumerate().take(5) {
                if !feat.geometry.points.is_empty() && feat.geometry.points.len() < 200 {
                    eprintln!("[CM93 Parse] Feature {} (class={}, type={:?}): {} points",
                        idx, feat.object_class, feat.geometry_type, feat.geometry.points.len());
                    // Show first few point coordinates
                    for (i, pt) in feat.geometry.points.iter().take(5).enumerate() {
                        eprintln!("[CM93 Parse]   pt[{}]: ({:.4}, {:.4})", i, pt.lat, pt.lon);
                    }
                    if feat.geometry.points.len() > 5 {
                        eprintln!("[CM93 Parse]   ... and {} more points", feat.geometry.points.len() - 5);
                    }
                }
            }
        }

        Ok(features)
    }

    /// Parse geometry from raw data
    fn parse_geometry(
        data: &[u8],
        offset: usize,
        geom_type: GeometryType,
        transform: &CellTransform,
    ) -> Result<Cm93Geometry, Cm93Error> {
        let mut off = offset;

        match geom_type {
            GeometryType::Point => {
                // Single point
                if off + 4 > data.len() {
                    return Ok(Cm93Geometry::point(0.0, 0.0));
                }
                let x = read_u16(data, &mut off).unwrap_or(0) as i32;
                let y = read_u16(data, &mut off).unwrap_or(0) as i32;
                let geo = transform.to_geo(Cm93Point { x, y });
                Ok(Cm93Geometry::point(geo.lat, geo.lon))
            }
            GeometryType::Line => {
                // Line string with delta-encoded vertices
                if off + 2 > data.len() {
                    return Ok(Cm93Geometry::line(Vec::new()));
                }
                let point_count = read_u16(data, &mut off).unwrap_or(0) as usize;

                if point_count == 0 || off + 4 > data.len() {
                    return Ok(Cm93Geometry::line(Vec::new()));
                }

                // First point is absolute
                let mut x = read_u16(data, &mut off).unwrap_or(0) as i32;
                let mut y = read_u16(data, &mut off).unwrap_or(0) as i32;

                let mut cm93_points = vec![Cm93Point { x, y }];

                // Remaining points are delta-encoded
                for _ in 1..point_count {
                    if off + 4 > data.len() {
                        break;
                    }
                    let dx = read_u16(data, &mut off).unwrap_or(0) as i16 as i32;
                    let dy = read_u16(data, &mut off).unwrap_or(0) as i16 as i32;
                    x += dx;
                    y += dy;
                    cm93_points.push(Cm93Point { x, y });
                }

                let geo_points = transform.to_geo_batch(&cm93_points);
                Ok(Cm93Geometry::line(geo_points))
            }
            GeometryType::Area => {
                // Polygon with multiple rings
                if off + 2 > data.len() {
                    return Ok(Cm93Geometry::area(Vec::new(), Vec::new()));
                }
                let ring_count = read_u16(data, &mut off).unwrap_or(0) as usize;

                let mut all_points = Vec::new();
                let mut ring_starts = Vec::new();

                for _ in 0..ring_count {
                    if off + 2 > data.len() {
                        break;
                    }
                    ring_starts.push(all_points.len());

                    let point_count = read_u16(data, &mut off).unwrap_or(0) as usize;
                    if point_count == 0 || off + 4 > data.len() {
                        continue;
                    }

                    // First point absolute
                    let mut x = read_u16(data, &mut off).unwrap_or(0) as i32;
                    let mut y = read_u16(data, &mut off).unwrap_or(0) as i32;
                    let mut cm93_points = vec![Cm93Point { x, y }];

                    // Delta-encoded points
                    for _ in 1..point_count {
                        if off + 4 > data.len() {
                            break;
                        }
                        let dx = read_u16(data, &mut off).unwrap_or(0) as i16 as i32;
                        let dy = read_u16(data, &mut off).unwrap_or(0) as i16 as i32;
                        x += dx;
                        y += dy;
                        cm93_points.push(Cm93Point { x, y });
                    }

                    let geo_points = transform.to_geo_batch(&cm93_points);
                    all_points.extend(geo_points);
                }

                Ok(Cm93Geometry::area(all_points, ring_starts))
            }
        }
    }

    /// Get geographic bounds of the cell
    /// Uses header bounds which are parsed from the cell file
    pub fn bounds(&self) -> [f64; 4] {
        // Use header bounds - they come from the file and are reliable
        // Don't compute from features as many have empty geometry
        [
            self.header.lon_min,
            self.header.lat_min,
            self.header.lon_max,
            self.header.lat_max,
        ]
    }

    /// Filter features by object class
    pub fn features_by_class(&self, object_class: u16) -> Vec<&Cm93Feature> {
        self.features
            .iter()
            .filter(|f| f.object_class == object_class)
            .collect()
    }

    /// Get all soundings (depth points)
    pub fn soundings(&self) -> Vec<(GeoPoint, f64)> {
        use super::dictionary::attr_codes::VALSOU;
        use super::dictionary::object_codes::SOUNDG;

        self.features_by_class(SOUNDG)
            .iter()
            .filter_map(|f| {
                let depth = f.attributes.get(&VALSOU)?.as_f64()?;
                let point = f.geometry.points.first()?;
                Some((*point, depth))
            })
            .collect()
    }

    /// Get all depth contours
    pub fn depth_contours(&self) -> Vec<(&Cm93Geometry, f64)> {
        use super::dictionary::attr_codes::VALDCO;
        use super::dictionary::object_codes::DEPCNT;

        self.features_by_class(DEPCNT)
            .iter()
            .filter_map(|f| {
                let depth = f.attributes.get(&VALDCO)?.as_f64()?;
                Some((&f.geometry, depth))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attribute_value() {
        let int_val = AttributeValue::Integer(42);
        assert_eq!(int_val.as_string(), "42");
        assert_eq!(int_val.as_f64(), Some(42.0));

        let float_val = AttributeValue::Float(3.14);
        assert_eq!(float_val.as_f64(), Some(3.14));

        let str_val = AttributeValue::String("test".to_string());
        assert_eq!(str_val.as_string(), "test");
        assert_eq!(str_val.as_f64(), None);
    }
}
