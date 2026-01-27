# CM93 Vector Chart Implementation

## Status: PAUSED (Development in Progress)

**Last Updated:** January 2026
**Current State:** Partially functional with known rendering artifacts

---

## Overview

This module implements parsing and rendering of CM93 proprietary vector nautical charts developed by C-MAP. CM93 is a multi-scale worldwide chart database used in marine navigation systems.

## Current Capabilities

### Working Features
- **Cell Discovery:** Scans CM93 database directory structure to find available cells
- **Scale Detection:** Identifies available scale levels (Z, A, B, C, D, E, F, G)
- **Header Parsing:** Fast header-only parsing for spatial indexing (138 bytes per cell)
- **Full Cell Parsing:** Decodes encrypted CM93 cell data including:
  - Geographic bounds (WGS84)
  - Mercator projection bounds (International 1924 ellipsoid)
  - Edge/vector geometry records
  - Feature records with object class codes
  - Attribute records
- **Coordinate Transformation:** Converts CM93 internal coordinates (0-65535) to geographic lat/lon
- **GeoJSON Export:** Converts features to GeoJSON for MapLibre GL rendering
- **Spatial Indexing:** Efficient lookup of cells by geographic bounds
- **Basic Filtering:** Filters cell boundary connectors, metadata objects, and degenerate geometries

### Known Issues (As of Pause)

1. **Diagonal Line Artifacts:** Long diagonal lines appear across the map, likely from:
   - Incorrect edge assembly across cell boundaries
   - Edges being connected that shouldn't be (different feature types)
   - Possible misinterpretation of edge index flags

2. **Cell Boundary Seams:** Visible seams at cell boundaries where:
   - Depth contours don't align perfectly
   - Land areas have slight gaps or overlaps
   - Coastlines show discontinuities

3. **Missing/Incomplete Features:**
   - Soundings (point features) not fully implemented
   - Some area features may have incorrect ring assembly
   - Navigation aids (lights, buoys) geometry incomplete

---

## Architecture

### Module Structure

```
cm93/
├── mod.rs          - Module exports and shared types (Cm93Scale, GeometryType, Cm93Error)
├── cell.rs         - Cell file parsing (header, edges, features, attributes)
├── database.rs     - Database directory structure and cell discovery
├── decode.rs       - CM93 XOR cipher decryption
├── dictionary.rs   - Object class and attribute code definitions
├── geometry.rs     - Coordinate transformation (CM93 -> Mercator -> WGS84)
├── reader.rs       - High-level reader with caching and spatial queries
├── renderer.rs     - Tile-based rendering (partially implemented)
├── server.rs       - GeoJSON conversion and filtering
└── README.md       - This documentation
```

### Key Data Flow

```
CM93 File (.A00, .B00, etc.)
    ↓ decode.rs (XOR decryption)
Cell Binary Data
    ↓ cell.rs (parse header, edges, features)
Cm93Cell { header, features, transform }
    ↓ reader.rs (spatial indexing, caching)
Feature Queries by Bounds
    ↓ server.rs (GeoJSON conversion, filtering)
GeoJSON FeatureCollection
    ↓ MapLibre GL (frontend rendering)
Visual Map Display
```

---

## Technical Details

### CM93 Coordinate System

CM93 uses a two-stage coordinate transformation:

1. **Internal Coordinates:** Points stored as 16-bit unsigned integers (0-65535)
2. **Mercator Projection:** International 1924 ellipsoid (different from WGS84)
3. **Geographic (WGS84):** Final lat/lon output

**Transformation Formula:**
```rust
merc_x = easting_min + point.x * x_rate
merc_y = northing_min + point.y * y_rate
// Then inverse Mercator to get lat/lon
```

### Cell Header Structure (138 bytes)

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | Signature (typically 138) |
| 4 | 2 | Unknown |
| 6 | 4 | Unknown |
| 10 | 8 | lon_min (f64) |
| 18 | 8 | lat_min (f64) |
| 26 | 8 | lon_max (f64) |
| 34 | 8 | lat_max (f64) |
| 42 | 8 | easting_min (f64) |
| 50 | 8 | northing_min (f64) |
| 58 | 8 | easting_max (f64) |
| 66 | 8 | northing_max (f64) |
| 74 | 4 | x_rate (f32) |
| 78 | 4 | y_rate (f32) |
| ... | ... | Additional header fields |

### Edge Index Format

Features reference edges using a 16-bit index with flags:
- **Bits 0-12:** Edge index (0-8191)
- **Bit 13:** Reverse direction flag
- **Bits 14-15:** Reserved/unknown

### Scale Levels

| Scale | Char | Description | Typical Coverage |
|-------|------|-------------|------------------|
| Z | 'Z' | Overview | World |
| A | 'A' | General | Continental |
| B | 'B' | Coastal | Regional |
| C | 'C' | Approach | Area |
| D | 'D' | Harbor | Coastal |
| E | 'E' | Berthing | Harbor approach |
| F | 'F' | Detail | Harbor detail |
| G | 'G' | Precise | Berth/dock |

---

## Filtering Logic (Current Implementation)

### Cell Boundary Connector Detection (`server.rs`)

Filters line features that are:
- Perfectly vertical (constant longitude) or horizontal (constant latitude)
- Short segments (< 0.1 degrees span)
- 2-point straight lines on cell boundaries

### Metadata Object Filtering

Skips object class codes >= 200 (coverage, quality metadata)

### Degenerate Area Filtering

Filters polygon features with:
- Aspect ratio > 50:1
- Very small extent (< 0.01 degrees in one dimension)
- Zero-area bounding boxes

---

## Reference Materials

### OpenCPN Implementation
- Location: `c:\Dev\VortexNav\reference\opencpn\cm93.cpp`
- Contains comprehensive CM93 parsing logic (GPL v2)
- Key functions to study:
  - `Ingest_CM93_Cell()` - Cell parsing
  - `ProcessVectorEdges()` - Edge processing
  - `CreateObjChain()` - Feature assembly
  - M_COVR handling for coverage regions

### CM93 Dictionary Files
- `CM93OBJ.DIC` - Object class definitions
- `CM93ATTR.DIC` - Attribute definitions
- Located in CM93 database root directory

---

## Next Steps (When Resuming)

### Priority 1: Fix Diagonal Lines
1. **Investigate edge assembly:** The diagonal lines suggest edges from different features are being incorrectly connected
2. **Review OpenCPN's `CreateObjChain()`:** Understand how they assemble feature geometry from edges
3. **Check connected node handling:** CM93 uses connected nodes to join edges - we may be missing this

### Priority 2: Improve Cell Boundary Handling
1. **Implement M_COVR clipping:** Use coverage regions to clip rendering
2. **Add edge stitching:** Merge edges across cell boundaries for continuous features
3. **Review cell overlap strategy:** Some systems render overlapping cell regions

### Priority 3: Complete Feature Types
1. **Soundings:** Implement 3D point parsing for depth soundings
2. **Point features:** Fix 2D point geometry for buoys, lights, etc.
3. **Area rings:** Verify polygon ring assembly (exterior vs holes)

### Investigation Areas
- The `geom_prim` byte may have additional flags we're not handling
- Edge direction (bit 13) may need different handling for area vs line features
- The "virtual overhead" subtraction (-4 bytes) may be incorrect for some feature types

---

## Test Data

**Current Test Location:** New Zealand waters (visible in screenshot)
- Position: ~36°40'S 174°44'E (Auckland area)
- Multiple scale levels visible in chart bar

---

## API Reference

### Main Entry Points

```rust
// Initialize CM93 reader
let reader = Cm93Reader::open(path_to_cm93_root)?;

// Get features in geographic bounds
let features = reader.get_features_in_bounds(
    scale, min_lat, min_lon, max_lat, max_lon
)?;

// Convert to GeoJSON
let geojson = server.get_features_in_bounds(
    min_lat, min_lon, max_lat, max_lon, zoom
)?;
```

### Tauri Commands

```rust
#[tauri::command]
fn init_cm93(path: String) -> Result<Cm93Status, String>

#[tauri::command]
fn get_cm93_features(bounds: Bounds, zoom: u8) -> Result<GeoJson, String>
```

---

## Files Modified During This Session

1. `server.rs` - Added cell boundary, metadata, and degenerate geometry filtering
2. `cell.rs` - Added `parse_header_only()` for fast spatial indexing
3. `reader.rs` - Updated to use header-only parsing for index building
4. `geometry.rs` - Coordinate transformation (reviewed, working correctly)
5. `dictionary.rs` - Object and attribute code definitions (reference only)

---

## Performance Notes

- **Spatial index build:** Now instant (reads 138 bytes per cell instead of full file)
- **Cell caching:** Reader caches parsed cells to avoid re-parsing
- **Feature count:** San Francisco area returns ~372 features at typical zoom
- **Memory:** Each parsed cell kept in memory until cache limit reached

---

## Contact/Context

This implementation is based on reverse-engineering the CM93 format with reference to OpenCPN's GPL v2 implementation. The format is proprietary to C-MAP/Navionics and documentation is not publicly available.

When resuming work, start by reading this document and the OpenCPN reference code in `reference/opencpn/cm93.cpp`.
