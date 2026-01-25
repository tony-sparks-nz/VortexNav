// Chart converter using GDAL for BSB/S-57 to MBTiles conversion
//
// Supports bundled GISInternals GDAL distribution or system-installed GDAL.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConversionError {
    #[error("GDAL not found. Please install GDAL and ensure gdal_translate is in PATH")]
    GdalNotFound,
    #[error("Conversion failed: {0}")]
    ConversionFailed(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GdalInfo {
    pub available: bool,
    pub version: Option<String>,
    pub gdal_translate_path: Option<String>,
    pub ogr2ogr_path: Option<String>,
    pub install_hint: Option<String>,
}

/// Bundled GDAL installation info (GISInternals SDK)
#[derive(Debug, Clone)]
struct BundledGdal {
    sdk_root: PathBuf,
    gdal_translate: PathBuf,
    ogr2ogr: PathBuf,
    gdaladdo: PathBuf,
    gdalwarp: PathBuf,
    gdalinfo: PathBuf,
}

/// Find bundled GISInternals GDAL installation
#[cfg(target_os = "windows")]
fn find_bundled_gdal() -> Option<BundledGdal> {
    // Check relative to the executable first, then known locations
    let possible_roots = [
        // Relative to project for development
        PathBuf::from(r"C:\Dev\VortexNav\gdal"),
        // Could add more locations here
    ];

    for sdk_root in &possible_roots {
        let apps_dir = sdk_root.join("bin").join("gdal").join("apps");
        let gdal_translate = apps_dir.join("gdal_translate.exe");
        let ogr2ogr = apps_dir.join("ogr2ogr.exe");
        let gdaladdo = apps_dir.join("gdaladdo.exe");
        let gdalwarp = apps_dir.join("gdalwarp.exe");
        let gdalinfo = apps_dir.join("gdalinfo.exe");

        if gdal_translate.exists() && ogr2ogr.exists() {
            return Some(BundledGdal {
                sdk_root: sdk_root.clone(),
                gdal_translate,
                ogr2ogr,
                gdaladdo,
                gdalwarp,
                gdalinfo,
            });
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn find_bundled_gdal() -> Option<BundledGdal> {
    None
}

/// Run a GDAL command using bundled GISInternals SDK
#[cfg(target_os = "windows")]
fn run_bundled_gdal_command(bundled: &BundledGdal, exe_path: &Path, args: &[&str]) -> std::io::Result<std::process::Output> {
    let sdk_root = &bundled.sdk_root;

    // Build PATH with all required directories
    let bin_path = sdk_root.join("bin");
    let apps_path = sdk_root.join("bin").join("gdal").join("apps");
    let proj_path = sdk_root.join("bin").join("proj9").join("apps");

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{};{};{};{}",
        bin_path.display(),
        apps_path.display(),
        proj_path.display(),
        current_path
    );

    Command::new(exe_path)
        .args(args)
        .env("PATH", new_path)
        .env("GDAL_DATA", sdk_root.join("bin").join("gdal-data"))
        .env("GDAL_DRIVER_PATH", sdk_root.join("bin").join("gdal").join("plugins"))
        .env("PROJ_LIB", sdk_root.join("bin").join("proj9").join("SHARE"))
        .output()
}

/// Check if GDAL tools are available on the system
pub fn check_gdal_available() -> GdalInfo {
    let mut info = GdalInfo {
        available: false,
        version: None,
        gdal_translate_path: None,
        ogr2ogr_path: None,
        install_hint: None,
    };

    // First, check for bundled GISInternals GDAL (Windows)
    #[cfg(target_os = "windows")]
    {
        if let Some(bundled) = find_bundled_gdal() {
            if let Ok(output) = run_bundled_gdal_command(&bundled, &bundled.gdal_translate, &["--version"]) {
                if output.status.success() {
                    info.available = true;
                    info.gdal_translate_path = Some(format!("bundled:{}", bundled.sdk_root.display()));
                    info.ogr2ogr_path = Some(format!("bundled:{}", bundled.sdk_root.display()));
                    if let Ok(version) = String::from_utf8(output.stdout) {
                        info.version = Some(version.trim().to_string());
                    }
                    return info;
                }
            }
        }
    }

    // Fall back to checking if gdal_translate is in PATH
    if let Ok(output) = Command::new("gdal_translate").arg("--version").output() {
        if output.status.success() {
            info.available = true;
            info.gdal_translate_path = Some("gdal_translate".to_string());
            if let Ok(version) = String::from_utf8(output.stdout) {
                info.version = Some(version.trim().to_string());
            }
        }
    }

    // Check ogr2ogr for vector (S-57) support
    if info.ogr2ogr_path.is_none() {
        if let Ok(output) = Command::new("ogr2ogr").arg("--version").output() {
            if output.status.success() {
                info.ogr2ogr_path = Some("ogr2ogr".to_string());
            }
        }
    }

    // Provide installation hint if GDAL not found
    if !info.available {
        #[cfg(target_os = "windows")]
        {
            info.install_hint = Some(
                "GDAL not found. Download GISInternals GDAL SDK from:\n\
                 https://www.gisinternals.com/release.php\n\
                 Extract to C:\\Dev\\VortexNav\\gdal and restart.".to_string()
            );
        }
        #[cfg(target_os = "macos")]
        {
            info.install_hint = Some(
                "Install GDAL using Homebrew:\n\
                 brew install gdal".to_string()
            );
        }
        #[cfg(target_os = "linux")]
        {
            info.install_hint = Some(
                "Install GDAL using your package manager:\n\
                 Ubuntu/Debian: sudo apt install gdal-bin\n\
                 Fedora: sudo dnf install gdal".to_string()
            );
        }
    }

    info
}

/// Run a GDAL command (handles both bundled and PATH-based installations)
fn run_gdal_command(cmd_name: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        // Try bundled GDAL first
        if let Some(bundled) = find_bundled_gdal() {
            let exe_path = match cmd_name {
                "gdal_translate" => &bundled.gdal_translate,
                "ogr2ogr" => &bundled.ogr2ogr,
                "gdaladdo" => &bundled.gdaladdo,
                "gdalwarp" => &bundled.gdalwarp,
                "gdalinfo" => &bundled.gdalinfo,
                _ => return Command::new(cmd_name).args(args).output(),
            };
            return run_bundled_gdal_command(&bundled, exe_path, args);
        }
    }

    // Fall back to PATH-based command
    Command::new(cmd_name).args(args).output()
}

/// Get chart geographic bounds from gdalinfo
/// Returns (min_lon, min_lat, max_lon, max_lat) if successful
fn get_chart_bounds(input_path: &Path) -> Option<(f64, f64, f64, f64)> {
    let input_str = input_path.to_str()?;

    // Use gdalinfo to get the geographic bounds in WGS84
    let output = run_gdal_command("gdalinfo", &["-json", input_str]).ok()?;

    if !output.status.success() {
        log::warn!("gdalinfo failed for {}", input_str);
        return None;
    }

    let info_str = String::from_utf8_lossy(&output.stdout);

    // Look for wgs84Extent in the JSON output
    // Format: "wgs84Extent": { "type": "Polygon", "coordinates": [[[lon,lat], ...]] }
    if let Some(extent_start) = info_str.find("wgs84Extent") {
        if let Some(coords_start) = info_str[extent_start..].find("coordinates") {
            let coords_section = &info_str[extent_start + coords_start..];

            // Extract all coordinate pairs
            let mut lons: Vec<f64> = Vec::new();
            let mut lats: Vec<f64> = Vec::new();

            // Simple regex-like extraction: find number pairs
            let mut in_bracket = 0;
            let mut current_num = String::new();
            let mut numbers: Vec<f64> = Vec::new();

            for ch in coords_section.chars().take(2000) {
                match ch {
                    '[' => in_bracket += 1,
                    ']' => {
                        if !current_num.is_empty() {
                            if let Ok(n) = current_num.parse::<f64>() {
                                numbers.push(n);
                            }
                            current_num.clear();
                        }
                        in_bracket -= 1;
                        if in_bracket <= 1 {
                            break; // End of coordinates array
                        }
                    }
                    ',' | ' ' => {
                        if !current_num.is_empty() {
                            if let Ok(n) = current_num.parse::<f64>() {
                                numbers.push(n);
                            }
                            current_num.clear();
                        }
                    }
                    c if c.is_numeric() || c == '.' || c == '-' => {
                        current_num.push(c);
                    }
                    _ => {}
                }
            }

            // Parse pairs of [lon, lat]
            for chunk in numbers.chunks(2) {
                if chunk.len() == 2 {
                    let lon = chunk[0];
                    let lat = chunk[1];
                    if lon.abs() <= 180.0 && lat.abs() <= 90.0 {
                        lons.push(lon);
                        lats.push(lat);
                    }
                }
            }

            if !lons.is_empty() && !lats.is_empty() {
                let min_lon = lons.iter().cloned().fold(f64::INFINITY, f64::min);
                let max_lon = lons.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                let min_lat = lats.iter().cloned().fold(f64::INFINITY, f64::min);
                let max_lat = lats.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

                log::info!("Chart {} bounds: lon=[{}, {}], lat=[{}, {}]",
                    input_path.file_name().unwrap_or_default().to_string_lossy(),
                    min_lon, max_lon, min_lat, max_lat);

                return Some((min_lon, min_lat, max_lon, max_lat));
            }
        }
    }

    log::warn!("Could not parse bounds from gdalinfo for {}", input_str);
    None
}


/// Write bounds to MBTiles metadata table
fn write_mbtiles_bounds(mbtiles_path: &Path, bounds: (f64, f64, f64, f64)) -> Result<(), String> {
    use rusqlite::Connection;

    let (min_lon, min_lat, max_lon, max_lat) = bounds;
    let bounds_str = format!("{},{},{},{}", min_lon, min_lat, max_lon, max_lat);

    let conn = Connection::open(mbtiles_path)
        .map_err(|e| format!("Failed to open MBTiles: {}", e))?;

    // Check if 'bounds' row exists
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM metadata WHERE name = 'bounds'",
        [],
        |row| row.get(0)
    ).unwrap_or(false);

    if exists {
        conn.execute(
            "UPDATE metadata SET value = ?1 WHERE name = 'bounds'",
            [&bounds_str]
        ).map_err(|e| format!("Failed to update bounds: {}", e))?;
    } else {
        conn.execute(
            "INSERT INTO metadata (name, value) VALUES ('bounds', ?1)",
            [&bounds_str]
        ).map_err(|e| format!("Failed to insert bounds: {}", e))?;
    }

    log::info!("Wrote bounds to MBTiles: {}", bounds_str);
    Ok(())
}

/// Write or update a metadata field in an MBTiles file
/// This is a public function that can be called after conversion to add chart metadata
pub fn write_mbtiles_metadata(mbtiles_path: &Path, name: &str, value: &str) -> Result<(), String> {
    use rusqlite::Connection;

    let conn = Connection::open(mbtiles_path)
        .map_err(|e| format!("Failed to open MBTiles: {}", e))?;

    // Check if row exists
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM metadata WHERE name = ?1",
        [name],
        |row| row.get(0)
    ).unwrap_or(false);

    if exists {
        conn.execute(
            "UPDATE metadata SET value = ?1 WHERE name = ?2",
            [value, name]
        ).map_err(|e| format!("Failed to update {}: {}", name, e))?;
    } else {
        conn.execute(
            "INSERT INTO metadata (name, value) VALUES (?1, ?2)",
            [name, value]
        ).map_err(|e| format!("Failed to insert {}: {}", name, e))?;
    }

    log::debug!("Wrote MBTiles metadata {}={}", name, value);
    Ok(())
}

/// Convert a BSB/KAP raster chart to MBTiles
///
/// BSB/KAP charts use a color palette (typically 16-128 colors), which causes
/// problems with GDAL's resampling algorithms. The solution is to:
/// 1. Expand the palette to RGBA first using gdal_translate -expand rgba
/// 2. Reproject to Web Mercator using gdalwarp
/// 3. Convert to MBTiles using gdal_translate
/// 4. Add overviews using gdaladdo
pub fn convert_bsb_to_mbtiles(
    input_path: &Path,
    output_path: &Path,
) -> Result<PathBuf, ConversionError> {
    let gdal_info = check_gdal_available();

    if !gdal_info.available {
        return Err(ConversionError::GdalNotFound);
    }

    let input_str = input_path.to_str().unwrap();
    let output_str = output_path.to_str().unwrap();

    // Get chart bounds BEFORE conversion (from the source KAP file)
    let chart_bounds = get_chart_bounds(input_path);

    // Create temp file paths
    let temp_expanded = output_path.with_extension("expanded.tif");
    let temp_expanded_str = temp_expanded.to_str().unwrap();
    let temp_warped = output_path.with_extension("warped.tif");
    let temp_warped_str = temp_warped.to_str().unwrap();

    // Step 1: Expand the color palette to RGBA
    // This is CRITICAL for BSB/KAP files which use indexed color palettes.
    // Without this step, GDAL's resampling produces garbage output.
    log::info!("Step 1: Expanding palette to RGBA for {}", input_str);
    let expand_output = run_gdal_command(
        "gdal_translate",
        &[
            "-expand", "rgba",    // Convert palette to RGBA
            input_str,
            temp_expanded_str
        ]
    )?;

    if !expand_output.status.success() {
        let stderr = String::from_utf8_lossy(&expand_output.stderr);
        return Err(ConversionError::ConversionFailed(
            format!("Failed to expand palette: {}", stderr)
        ));
    }

    // Step 2: Reproject to Web Mercator (EPSG:3857)
    // Using multi-threading for faster processing while maintaining cubic quality
    log::info!("Step 2: Reprojecting to Web Mercator (multi-threaded)");
    let warp_output = run_gdal_command(
        "gdalwarp",
        &[
            "-t_srs", "EPSG:3857",    // Target: Web Mercator
            "-r", "cubic",             // Cubic resampling for best quality
            "-multi",                  // Enable multi-threaded processing
            "-wo", "NUM_THREADS=ALL_CPUS",  // Use all available CPU cores
            temp_expanded_str,
            temp_warped_str
        ]
    )?;

    // Clean up expanded temp file
    let _ = std::fs::remove_file(&temp_expanded);

    if !warp_output.status.success() {
        let stderr = String::from_utf8_lossy(&warp_output.stderr);
        let _ = std::fs::remove_file(&temp_warped);
        return Err(ConversionError::ConversionFailed(
            format!("Failed to reproject: {}", stderr)
        ));
    }

    // Step 3: Convert to MBTiles with PNG tiles (which support transparency)
    log::info!("Step 3: Converting to MBTiles");
    let translate_output = run_gdal_command(
        "gdal_translate",
        &[
            "-of", "MBTiles",
            "-co", "TILE_FORMAT=PNG",     // PNG supports transparency
            temp_warped_str,
            output_str
        ]
    )?;

    // Clean up warped temp file
    let _ = std::fs::remove_file(&temp_warped);

    if !translate_output.status.success() {
        let stderr = String::from_utf8_lossy(&translate_output.stderr);
        return Err(ConversionError::ConversionFailed(
            format!("Failed to create MBTiles: {}", stderr)
        ));
    }

    // Step 4: Build overviews (zoom levels) using gdaladdo
    // Use nearest-neighbor resampling to preserve text sharpness at lower zooms
    log::info!("Step 4: Building overviews");
    let gdaladdo_result = run_gdal_command(
        "gdaladdo",
        &["-r", "nearest", output_str, "2", "4", "8", "16"]
    );

    if let Ok(output) = gdaladdo_result {
        if !output.status.success() {
            log::warn!("Failed to build overviews, chart may have limited zoom levels");
        }
    }

    // Write bounds to MBTiles metadata (from original chart)
    if let Some(bounds) = chart_bounds {
        if let Err(e) = write_mbtiles_bounds(output_path, bounds) {
            log::warn!("Failed to write bounds to MBTiles: {}", e);
        }
    }

    log::info!("Successfully converted {} to MBTiles", input_str);
    Ok(output_path.to_path_buf())
}

/// Convert an S-57 ENC chart to MBTiles (vector tiles)
pub fn convert_s57_to_mbtiles(
    input_path: &Path,
    output_path: &Path,
) -> Result<PathBuf, ConversionError> {
    let gdal_info = check_gdal_available();

    if gdal_info.ogr2ogr_path.is_none() {
        return Err(ConversionError::GdalNotFound);
    }

    let input_str = input_path.to_str().unwrap();
    let output_str = output_path.to_str().unwrap();

    // Convert S-57 to MBTiles using ogr2ogr
    // Note: This creates vector tiles, which MapLibre can render
    let output = run_gdal_command(
        "ogr2ogr",
        &["-f", "MBTiles", output_str, input_str]
    )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ConversionError::ConversionFailed(stderr.to_string()));
    }

    Ok(output_path.to_path_buf())
}

/// Get the output path for a converted chart
pub fn get_mbtiles_output_path(charts_dir: &Path, chart_id: &str) -> PathBuf {
    charts_dir.join(format!("{}.mbtiles", chart_id))
}

/// Detect the chart format from file extension
pub fn detect_chart_format(path: &Path) -> Option<&'static str> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext.to_lowercase().as_str() {
            "mbtiles" => "MBTiles",
            "kap" | "bsb" | "cap" => "BSB",
            "000" => "S57",
            _ => "Unknown",
        })
}

/// Convert a chart file to MBTiles based on its format
pub fn convert_to_mbtiles(
    input_path: &Path,
    output_path: &Path,
) -> Result<PathBuf, ConversionError> {
    let format = detect_chart_format(input_path);

    match format {
        Some("MBTiles") => {
            // Already MBTiles, just copy
            std::fs::copy(input_path, output_path)?;
            Ok(output_path.to_path_buf())
        }
        Some("BSB") => convert_bsb_to_mbtiles(input_path, output_path),
        Some("S57") => convert_s57_to_mbtiles(input_path, output_path),
        Some(fmt) => Err(ConversionError::UnsupportedFormat(fmt.to_string())),
        None => Err(ConversionError::UnsupportedFormat("Unknown".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_chart_format() {
        assert_eq!(detect_chart_format(Path::new("chart.mbtiles")), Some("MBTiles"));
        assert_eq!(detect_chart_format(Path::new("NZ1234.KAP")), Some("BSB"));
        assert_eq!(detect_chart_format(Path::new("US5CA01M.000")), Some("S57"));
        assert_eq!(detect_chart_format(Path::new("readme.txt")), Some("Unknown"));
    }

    #[test]
    fn test_check_gdal() {
        let info = check_gdal_available();
        // Just verify it doesn't panic - GDAL may or may not be installed
        println!("GDAL available: {}", info.available);
        if let Some(version) = info.version {
            println!("GDAL version: {}", version);
        }
    }
}
