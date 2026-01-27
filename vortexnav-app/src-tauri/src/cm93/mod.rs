// CM93 Chart Parser Module
// Based on OpenCPN's CM93 implementation (GPL v2)
// Reference: https://github.com/OpenCPN/OpenCPN

mod decode;
mod cell;
mod geometry;
mod dictionary;
mod reader;
mod renderer;
mod server;

pub use decode::*;
pub use cell::*;
pub use geometry::*;
pub use dictionary::*;
pub use reader::*;
pub use renderer::*;
pub use server::*;

use std::path::PathBuf;
use thiserror::Error;

/// CM93 scale levels (Z=overview, G=harbor detail)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Cm93Scale {
    Z = 0,  // 1:20,000,000 - Overview
    A = 1,  // 1:3,000,000
    B = 2,  // 1:1,000,000
    C = 3,  // 1:200,000
    D = 4,  // 1:100,000
    E = 5,  // 1:50,000
    F = 6,  // 1:20,000
    G = 7,  // 1:7,500 - Harbor
}

impl Cm93Scale {
    pub fn from_char(c: char) -> Option<Self> {
        match c.to_ascii_uppercase() {
            'Z' => Some(Self::Z),
            'A' => Some(Self::A),
            'B' => Some(Self::B),
            'C' => Some(Self::C),
            'D' => Some(Self::D),
            'E' => Some(Self::E),
            'F' => Some(Self::F),
            'G' => Some(Self::G),
            _ => None,
        }
    }

    pub fn to_char(self) -> char {
        match self {
            Self::Z => 'Z',
            Self::A => 'A',
            Self::B => 'B',
            Self::C => 'C',
            Self::D => 'D',
            Self::E => 'E',
            Self::F => 'F',
            Self::G => 'G',
        }
    }

    /// Get the nominal scale denominator
    pub fn scale_denominator(self) -> u32 {
        match self {
            Self::Z => 20_000_000,
            Self::A => 3_000_000,
            Self::B => 1_000_000,
            Self::C => 200_000,
            Self::D => 100_000,
            Self::E => 50_000,
            Self::F => 20_000,
            Self::G => 7_500,
        }
    }

    /// Get the cell size divisor for this scale
    /// Basic cell size is 20 minutes, divided by this value
    pub fn cell_divisor(self) -> u32 {
        match self {
            Self::Z => 1,
            Self::A => 1,
            Self::B => 1,
            Self::C => 3,
            Self::D => 3,
            Self::E => 6,
            Self::F => 12,
            Self::G => 24,
        }
    }
}

/// CM93 parsing errors
#[derive(Error, Debug)]
pub enum Cm93Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid CM93 directory structure: {0}")]
    InvalidDirectory(String),

    #[error("Cell not found: {0}")]
    CellNotFound(String),

    #[error("Invalid cell data: {0}")]
    InvalidCellData(String),

    #[error("Decode error: {0}")]
    DecodeError(String),

    #[error("Dictionary error: {0}")]
    DictionaryError(String),

    #[error("Unsupported CM93 version")]
    UnsupportedVersion,
}

/// CM93 semimajor axis for coordinate transformations
/// This corresponds to the International 1924 ellipsoid
pub const CM93_SEMIMAJOR_AXIS: f64 = 6_378_388.0;

/// Degrees to radians conversion constant
pub const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;

/// Radians to degrees conversion constant
pub const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;

/// CM93 geometry types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryType {
    Point = 1,
    Line = 2,
    Area = 4,
}

impl GeometryType {
    pub fn from_u8(val: u8) -> Option<Self> {
        match val {
            1 => Some(Self::Point),
            2 => Some(Self::Line),
            4 => Some(Self::Area),
            _ => None,
        }
    }
}

/// A CM93 chart database root
#[derive(Debug)]
pub struct Cm93Database {
    pub root_path: PathBuf,
    pub dictionary: Option<Cm93Dictionary>,
    /// Maps (scale, cell_index) -> file path
    pub cell_paths: std::collections::HashMap<(Cm93Scale, u32), PathBuf>,
}

impl Cm93Database {
    /// Open a CM93 database from a root directory
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, Cm93Error> {
        let root_path = path.into();

        if !root_path.exists() {
            return Err(Cm93Error::InvalidDirectory(
                format!("Path does not exist: {:?}", root_path)
            ));
        }

        // Check for required files
        let dict_path = root_path.join("CM93OBJ.DIC");
        let attr_path = root_path.join("CM93ATTR.DIC");

        if !dict_path.exists() || !attr_path.exists() {
            return Err(Cm93Error::InvalidDirectory(
                "Missing CM93OBJ.DIC or CM93ATTR.DIC".to_string()
            ));
        }

        // Load dictionaries
        let dictionary = Cm93Dictionary::load(&root_path)?;

        // Scan for all cell files and store their paths
        let mut cell_paths = std::collections::HashMap::new();
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

        for scale in scales {
            let scale_char = scale.to_char().to_string();
            if let Ok(entries) = std::fs::read_dir(&root_path) {
                for entry in entries.flatten() {
                    let dir_path = entry.path();
                    if dir_path.is_dir() {
                        let scale_dir = dir_path.join(&scale_char);
                        if scale_dir.exists() {
                            if let Ok(cell_entries) = std::fs::read_dir(&scale_dir) {
                                for cell_entry in cell_entries.flatten() {
                                    let cell_path = cell_entry.path();
                                    if cell_path.is_file() {
                                        if let Some(cell_index) = parse_cell_filename(&cell_path, scale) {
                                            cell_paths.insert((scale, cell_index), cell_path);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        eprintln!("[CM93 Database] Indexed {} cell files across all scales", cell_paths.len());

        Ok(Self {
            root_path,
            dictionary: Some(dictionary),
            cell_paths,
        })
    }

    /// Get the path to a cell file (from indexed paths)
    pub fn get_cell_path(&self, cell_index: u32, scale: Cm93Scale) -> Option<PathBuf> {
        self.cell_paths.get(&(scale, cell_index)).cloned()
    }

    /// List all available cells at a given scale
    pub fn list_cells(&self, scale: Cm93Scale) -> Vec<u32> {
        let mut cells: Vec<u32> = self.cell_paths
            .keys()
            .filter(|(s, _)| *s == scale)
            .map(|(_, idx)| *idx)
            .collect();
        cells.sort();
        cells.dedup();
        cells
    }
}

/// Calculate cell index from latitude and longitude
/// Based on OpenCPN's CM93 implementation
pub fn lat_lon_to_cell_index(lat: f64, lon: f64, scale: Cm93Scale) -> u32 {
    // Cell size in degrees (20 minutes = 1/3 degree, divided by scale factor)
    let cell_size = 20.0 / 60.0 / scale.cell_divisor() as f64;

    // Normalize longitude to 0-360 range
    let lon_norm = lon + 180.0;
    // Normalize latitude to 0-180 range
    let lat_norm = lat + 90.0;

    // Calculate grid indices
    let lon_idx = (lon_norm / cell_size).floor() as u32;
    let lat_idx = (lat_norm / cell_size).floor() as u32;

    // Combine into cell index: lat * 10000 + lon
    lat_idx * 10000 + lon_idx
}

/// Calculate latitude and longitude from cell index
/// Returns the SW corner of the cell
pub fn cell_index_to_lat_lon(cell_index: u32, scale: Cm93Scale) -> (f64, f64) {
    // Cell size in degrees
    let cell_size = 20.0 / 60.0 / scale.cell_divisor() as f64;

    let lat_idx = cell_index / 10000;
    let lon_idx = cell_index % 10000;

    // Convert back to geographic coordinates
    let lon = (lon_idx as f64 * cell_size) - 180.0;
    let lat = (lat_idx as f64 * cell_size) - 90.0;

    // Debug output for first few conversions
    static LOGGED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let logged_count = LOGGED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if logged_count < 5 {
        eprintln!(
            "[CM93] cell_index_to_lat_lon: idx={} scale={:?} cell_size={:.6}° -> lat={:.4}, lon={:.4}",
            cell_index, scale, cell_size, lat, lon
        );
    }

    (lat, lon)
}

/// Parse a cell filename to extract the cell index
fn parse_cell_filename(path: &PathBuf, scale: Cm93Scale) -> Option<u32> {
    let filename = path.file_stem()?.to_str()?;

    // Debug: log the first few filenames we encounter
    static LOGGED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let logged_count = LOGGED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if logged_count < 10 {
        eprintln!("[CM93] Parsing filename: '{}' at scale {:?}", filename, scale);
    }

    // CM93 cell filenames encode lat/lon position
    // Format varies but generally encodes the cell's geographic location
    // We need to parse this and calculate the cell index

    if filename.len() >= 7 {
        // Try to parse as numeric cell identifier
        if let Ok(num) = filename.parse::<u32>() {
            if logged_count < 10 {
                eprintln!("[CM93]   -> parsed as decimal: {}", num);
            }
            return Some(num);
        }

        // Try hex format
        if let Ok(num) = u32::from_str_radix(filename, 16) {
            if logged_count < 10 {
                eprintln!("[CM93]   -> parsed as hex: {} (0x{})", num, filename);
            }
            return Some(num);
        }
    }

    if logged_count < 10 {
        eprintln!("[CM93]   -> failed to parse!");
    }

    // Fallback: use file position to calculate approximate index
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scale_conversion() {
        assert_eq!(Cm93Scale::from_char('Z'), Some(Cm93Scale::Z));
        assert_eq!(Cm93Scale::from_char('g'), Some(Cm93Scale::G));
        assert_eq!(Cm93Scale::Z.to_char(), 'Z');
    }

    #[test]
    fn test_cell_index_roundtrip() {
        let lat = 37.5;
        let lon = -122.5;
        let scale = Cm93Scale::C;

        let index = lat_lon_to_cell_index(lat, lon, scale);
        let (lat2, lon2) = cell_index_to_lat_lon(index, scale);

        // Should be close (within cell size)
        assert!((lat - lat2).abs() < 1.0);
        assert!((lon - lon2).abs() < 1.0);
    }
}
