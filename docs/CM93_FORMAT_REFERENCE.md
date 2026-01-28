# CM93 Chart Format Reference

Based on analysis of OpenCPN's implementation (GPL v2)
Reference: https://github.com/OpenCPN/OpenCPN

## Overview

CM93 is a proprietary vector chart format developed by C-MAP (now Navico). Files are XOR-encoded and use a specific binary structure for storing nautical chart data including coastlines, depth contours, soundings, navigation aids, and other maritime features.

## Directory Organization

CM93 data is organized in a hierarchical directory structure:
```
CM93_ROOT/
├── CM93OBJ.DIC     # Object class dictionary
├── CM93ATTR.DIC    # Attribute dictionary
├── 003XXYYYYY/     # Scale Z (1:20M) directories
│   └── Z/          # Cell files for scale Z
├── 009XXYYYYY/     # Scale A (1:3M) directories
│   └── A/
├── 015XXYYYYY/     # Scale B (1:1M) directories
│   └── B/
├── 021XXYYYYY/     # Scale C (1:200K) directories
│   └── C/
├── 027XXYYYYY/     # Scale D (1:100K) directories
│   └── D/
├── 033XXYYYYY/     # Scale E (1:50K) directories
│   └── E/
├── 039XXYYYYY/     # Scale F (1:20K) directories
│   └── F/
└── 045XXYYYYY/     # Scale G (1:7.5K) directories
    └── G/
```

Directory naming: `SSSLLOOOO` where:
- `SSS` = Scale prefix (003, 009, 015, 021, 027, 033, 039, 045)
- `LL` = Latitude band (degrees)
- `OOOO` = Longitude band (degrees)

### Scale Levels

| Scale | Prefix | Denominator | Cell Size |
|-------|--------|-------------|-----------|
| Z | 003 | 1:20,000,000 | 20 minutes |
| A | 009 | 1:3,000,000 | 20 minutes |
| B | 015 | 1:1,000,000 | 20 minutes |
| C | 021 | 1:200,000 | 6.67 minutes |
| D | 027 | 1:100,000 | 6.67 minutes |
| E | 033 | 1:50,000 | 3.33 minutes |
| F | 039 | 1:20,000 | 1.67 minutes |
| G | 045 | 1:7,500 | 0.83 minutes |

---

## XOR Decoding

### The Substitution Cipher

CM93 uses a substitution cipher based on a 256-byte lookup table. **Every byte** read from a CM93 cell file must be decoded using this table.

### Table_0 (256 bytes)

```c
static const unsigned char Table_0[256] = {
    0xCD, 0xEA, 0xDC, 0x48, 0x3E, 0x6D, 0xCA, 0x7B, 0x52, 0xE1,
    0xA4, 0x8E, 0xAB, 0x05, 0xA7, 0x97, 0xB9, 0x60, 0x39, 0x85,
    0x7C, 0x56, 0x7A, 0xBA, 0x68, 0x6E, 0xF5, 0x5D, 0x02, 0x4E,
    0x0F, 0xA1, 0x27, 0x24, 0x41, 0x34, 0x00, 0x5A, 0xFE, 0xCB,
    0xD0, 0xFA, 0xF8, 0x6C, 0x74, 0x96, 0x9E, 0x0E, 0xC2, 0x49,
    0xE3, 0xE5, 0xC0, 0x3B, 0x59, 0x18, 0xA9, 0x86, 0x8F, 0x30,
    0xC3, 0xA8, 0x22, 0x0A, 0x14, 0x1A, 0xB2, 0xC9, 0xC7, 0xED,
    0xAA, 0x29, 0x94, 0x75, 0x0D, 0xAC, 0x0C, 0xF4, 0xBB, 0xC5,
    0x3F, 0xFD, 0xD9, 0x9C, 0x4F, 0xD5, 0x84, 0x1E, 0xB1, 0x81,
    0x69, 0xB4, 0x09, 0xB8, 0x3C, 0xAF, 0xA3, 0x08, 0xBF, 0xE0,
    0x9A, 0xD7, 0xF7, 0x8C, 0x67, 0x66, 0xAE, 0xD4, 0x4C, 0xA5,
    0xEC, 0xF9, 0xB6, 0x64, 0x78, 0x06, 0x5B, 0x9B, 0xF2, 0x99,
    0xCE, 0xDB, 0x53, 0x55, 0x65, 0x8D, 0x07, 0x33, 0x04, 0x37,
    0x92, 0x26, 0x23, 0xB5, 0x58, 0xDA, 0x2F, 0xB3, 0x40, 0x5E,
    0x7F, 0x4B, 0x62, 0x80, 0xE4, 0x6F, 0x73, 0x1D, 0xDF, 0x17,
    0xCC, 0x28, 0x25, 0x2D, 0xEE, 0x3A, 0x98, 0xE2, 0x01, 0x0B,
    0xDD, 0xBC, 0x90, 0xB0, 0xFC, 0x95, 0x76, 0x93, 0x46, 0x57,
    0x2C, 0x2B, 0x50, 0x11, 0x0B, 0xC1, 0xF0, 0xE7, 0xD6, 0x21,
    0x31, 0xDE, 0xFF, 0xD8, 0x12, 0xA6, 0x4D, 0x8A, 0x13, 0x43,
    0x45, 0x38, 0xD2, 0x87, 0xA0, 0xEF, 0x82, 0xF1, 0x47, 0x89,
    0x6A, 0xC8, 0x54, 0x1B, 0x16, 0x7E, 0x79, 0xBD, 0x6B, 0x91,
    0xA2, 0x71, 0x36, 0xB7, 0x03, 0x3D, 0x72, 0xC6, 0x44, 0x8B,
    0xCF, 0x15, 0x9F, 0x32, 0xC4, 0x77, 0x83, 0x63, 0x20, 0x88,
    0xF6, 0xAD, 0xF3, 0xE8, 0x4A, 0xE9, 0x35, 0x1C, 0x5F, 0x19,
    0x1F, 0x7D, 0x70, 0xFB, 0xD1, 0x51, 0x10, 0xD3, 0x2E, 0x61,
    0x9D, 0x5C, 0x2A, 0x42, 0xBE, 0xE6
};
```

### Building Encode/Decode Tables

```c
unsigned char Encode_table[256];
unsigned char Decode_table[256];

void CreateDecodeTable() {
    for (int i = 0; i < 256; i++) {
        unsigned char a = Table_0[i] ^ 8;  // XOR with 8
        Encode_table[i] = a;
        Decode_table[(int)a] = (unsigned char)i;
    }
}
```

The relationship is:
- `Encode_table[original_byte] = encoded_byte`
- `Decode_table[encoded_byte] = original_byte`

### Decoding Functions

```c
// Decode a single byte
unsigned char decode_byte(unsigned char b) {
    return Decode_table[b];
}

// Decode a buffer in-place
void decode_buffer(unsigned char* data, int length) {
    for (int i = 0; i < length; i++) {
        data[i] = Decode_table[data[i]];
    }
}

// Read, decode, and return little-endian u16
unsigned short read_decoded_u16(unsigned char* data, int offset) {
    return decode_byte(data[offset]) |
           (decode_byte(data[offset + 1]) << 8);
}

// Read, decode, and return little-endian u32
unsigned int read_decoded_u32(unsigned char* data, int offset) {
    return decode_byte(data[offset]) |
           (decode_byte(data[offset + 1]) << 8) |
           (decode_byte(data[offset + 2]) << 16) |
           (decode_byte(data[offset + 3]) << 24);
}

// Read, decode, and return little-endian f64
double read_decoded_f64(unsigned char* data, int offset) {
    unsigned char bytes[8];
    for (int i = 0; i < 8; i++) {
        bytes[i] = decode_byte(data[offset + i]);
    }
    return *(double*)bytes;  // Assuming little-endian host
}
```

---

## Complete Cell File Structure

A CM93 cell file consists of four main sections:

```
┌────────────────────────────────────┐
│         PROLOG (10 bytes)          │  ← File validation
├────────────────────────────────────┤
│         HEADER (128 bytes)         │  ← Cell metadata & counts
├────────────────────────────────────┤
│         VECTOR TABLE               │  ← Edge/line geometries
│    (variable size from prolog)     │
├────────────────────────────────────┤
│         FEATURE TABLE              │  ← Chart objects
│    (variable size from prolog)     │
└────────────────────────────────────┘
```

### File Size Validation

```
file_length = word0 + vector_table_length + feature_table_length
```

Where `word0` is typically 138 (10-byte prolog + 128-byte header).

---

## Prolog (10 bytes)

The prolog provides section sizes for file validation:

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | word0 | u16 | 2 | Header end offset (typically 138) |
| 2 | word1 | u16 | 2 | Unknown (usually 0) |
| 4 | vector_table_length | u32 | 4 | Size of vector section in bytes |
| 8 | feature_table_length | u16 | 2 | Size of feature section in bytes |

**Note**: All values must be decoded before use.

### Prolog Validation

```c
bool validate_prolog(unsigned char* data, int file_size) {
    unsigned short word0 = read_decoded_u16(data, 0);
    unsigned int vector_len = read_decoded_u32(data, 4);
    unsigned short feature_len = read_decoded_u16(data, 8);

    // word0 should be 138 (prolog + header)
    // Sum should equal file size
    return (word0 + vector_len + feature_len) == file_size;
}
```

---

## Header (128 bytes, starting at offset 10)

The header contains cell bounds and record counts:

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 10 | lon_min | f64 | 8 | Minimum longitude (degrees) |
| 18 | lat_min | f64 | 8 | Minimum latitude (degrees) |
| 26 | lon_max | f64 | 8 | Maximum longitude (degrees) |
| 34 | lat_max | f64 | 8 | Maximum latitude (degrees) |
| 42 | easting_min | f64 | 8 | Mercator easting min |
| 50 | northing_min | f64 | 8 | Mercator northing min |
| 58 | easting_max | f64 | 8 | Mercator easting max |
| 66 | northing_max | f64 | 8 | Mercator northing max |
| 74 | usn_vector_records | u16 | 2 | Number of edge records |
| 76 | n_vector_record_points | i32 | 4 | Total points in all edges |
| 80 | m_46 | i32 | 4 | Reserved |
| 84 | m_4a | i32 | 4 | Reserved (related to vectors) |
| 88 | usn_point3d_records | u16 | 2 | Number of 3D point records (soundings) |
| 90 | usn_point2d_records | u16 | 2 | Number of 2D point records |
| 92 | usn_feature_records | u16 | 2 | Number of feature records |
| 94 | m_5e | u16 | 2 | Reserved |
| 96 | m_60 | i32 | 4 | Reserved |
| 100 | x_rate | f64 | 8 | X scale factor (Mercator units/CM93 unit) |
| 108 | y_rate | f64 | 8 | Y scale factor (Mercator units/CM93 unit) |
| 116 | x_origin | i32 | 4 | X offset in CM93 coordinates |
| 120 | y_origin | i32 | 4 | Y offset in CM93 coordinates |

**Header offsets are file offsets (add 10 for prolog).**

---

## Vector Table (Edges)

The vector table starts at offset 138 (after prolog + header) and contains edge records.

### Vector Table Structure

```
┌─────────────────────────────────────┐
│     Edge Index Table                │  ← Offsets to each edge
│  (usn_vector_records * 4 bytes)     │
├─────────────────────────────────────┤
│     Point Data Tables               │  ← 3D and 2D point data
├─────────────────────────────────────┤
│     Edge Coordinate Data            │  ← Delta-encoded coordinates
└─────────────────────────────────────┘
```

### Edge Index Table

Each entry is a 4-byte offset pointing to the edge data within the vector section:

```c
// Read edge index table
int* edge_offsets = malloc(usn_vector_records * sizeof(int));
for (int i = 0; i < usn_vector_records; i++) {
    edge_offsets[i] = read_decoded_u32(vector_data, i * 4);
}
```

### Point Tables

#### 3D Points (Soundings)

Located after edge index table. Each 3D point is 6 bytes:

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | x | i16 | 2 | X coordinate (CM93 units) |
| 2 | y | i16 | 2 | Y coordinate (CM93 units) |
| 4 | z | i16 | 2 | Depth/height value |

```c
// 3D points start after edge index table
int point3d_offset = usn_vector_records * 4;

typedef struct {
    short x, y, z;
} Point3D;

Point3D* points3d = malloc(usn_point3d_records * sizeof(Point3D));
for (int i = 0; i < usn_point3d_records; i++) {
    int off = point3d_offset + i * 6;
    points3d[i].x = (short)read_decoded_u16(vector_data, off);
    points3d[i].y = (short)read_decoded_u16(vector_data, off + 2);
    points3d[i].z = (short)read_decoded_u16(vector_data, off + 4);
}
```

#### 2D Points

Located after 3D points. Each 2D point is 4 bytes:

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | x | i16 | 2 | X coordinate (CM93 units) |
| 2 | y | i16 | 2 | Y coordinate (CM93 units) |

```c
int point2d_offset = point3d_offset + (usn_point3d_records * 6);

typedef struct {
    short x, y;
} Point2D;

Point2D* points2d = malloc(usn_point2d_records * sizeof(Point2D));
for (int i = 0; i < usn_point2d_records; i++) {
    int off = point2d_offset + i * 4;
    points2d[i].x = (short)read_decoded_u16(vector_data, off);
    points2d[i].y = (short)read_decoded_u16(vector_data, off + 2);
}
```

### Edge Coordinate Data

Edge coordinates are stored using delta encoding. Each edge starts with an absolute coordinate, then subsequent points are deltas from the previous point.

```c
typedef struct {
    int point_count;
    short* x_coords;
    short* y_coords;
} Edge;

Edge read_edge(unsigned char* vector_data, int edge_offset, int next_edge_offset) {
    Edge edge;
    int offset = edge_offset;

    // Calculate point count from size (each point is 4 bytes: 2 for x, 2 for y)
    int data_size = next_edge_offset - edge_offset;
    edge.point_count = data_size / 4;

    edge.x_coords = malloc(edge.point_count * sizeof(short));
    edge.y_coords = malloc(edge.point_count * sizeof(short));

    // First point is absolute
    short x = (short)read_decoded_u16(vector_data, offset);
    short y = (short)read_decoded_u16(vector_data, offset + 2);
    edge.x_coords[0] = x;
    edge.y_coords[0] = y;
    offset += 4;

    // Subsequent points are deltas
    for (int i = 1; i < edge.point_count; i++) {
        short dx = (short)read_decoded_u16(vector_data, offset);
        short dy = (short)read_decoded_u16(vector_data, offset + 2);
        x += dx;
        y += dy;
        edge.x_coords[i] = x;
        edge.y_coords[i] = y;
        offset += 4;
    }

    return edge;
}
```

---

## Feature Table

The feature table starts immediately after the vector table and contains all chart objects.

### Feature Record Format

**CRITICAL**: This is the most complex part of CM93 parsing. Each feature has a variable-length format.

```
┌─────────────────────────────────────────────────────────────┐
│ otype (1 byte)        Object type code                      │
├─────────────────────────────────────────────────────────────┤
│ geom_prim (1 byte)    Geometry primitive + flags            │
├─────────────────────────────────────────────────────────────┤
│ obj_desc_bytes (2 bytes)  Size descriptor (see below!)      │
├─────────────────────────────────────────────────────────────┤
│ [Variable Data - depends on geom_prim flags]                │
│   - Attributes (if bit 7 set)                               │
│   - Related objects (if bit 4 set)                          │
│   - Geometry data (edge indices, point indices, etc.)       │
└─────────────────────────────────────────────────────────────┘
```

### geom_prim Byte (Bit Flags)

| Bits | Mask | Description |
|------|------|-------------|
| 0-3 | 0x0F | Geometry type |
| 4 | 0x10 | Has related object records |
| 5-6 | 0x60 | Reserved |
| 7 | 0x80 | Has attributes |

**Geometry Types (bits 0-3):**
- `1` = Point (single 2D or 3D point)
- `2` = Line (sequence of edges)
- `4` = Area (closed polygon, possibly with holes)
- `8` = 3D point (sounding with depth)

### THE CRITICAL obj_desc_bytes RULE

**This is the most important implementation detail:**

`obj_desc_bytes` includes 4 bytes of "virtual overhead" that **does not exist in the file** when the feature has LINE/AREA geometry OR has attributes.

```c
// Calculate actual data bytes to read
int actual_bytes = obj_desc_bytes;

bool has_geometry = (geom_prim & 0x0F) == 2 || (geom_prim & 0x0F) == 4;  // LINE or AREA
bool has_attributes = (geom_prim & 0x80) != 0;

if ((has_geometry || has_attributes) && obj_desc_bytes >= 4) {
    actual_bytes = obj_desc_bytes - 4;  // Subtract virtual overhead!
}
```

**Failure to apply this -4 adjustment will cause:**
- Reading past the end of the current feature
- Corrupted parsing of subsequent features
- "Invalid size" errors or garbage data

### Feature Parsing Algorithm

```c
typedef struct {
    unsigned char otype;
    unsigned char geom_prim;
    int n_attributes;
    // ... attribute data
    int n_related;
    // ... related object data
    // ... geometry data
} Feature;

void parse_features(unsigned char* feature_data, int feature_table_length, int n_features) {
    int offset = 0;

    for (int i = 0; i < n_features && offset < feature_table_length; i++) {
        // Read fixed header (4 bytes)
        unsigned char otype = decode_byte(feature_data[offset]);
        unsigned char geom_prim = decode_byte(feature_data[offset + 1]);
        unsigned short obj_desc_bytes = read_decoded_u16(feature_data, offset + 2);
        offset += 4;

        // Extract flags
        int geom_type = geom_prim & 0x0F;
        bool has_related = (geom_prim & 0x10) != 0;
        bool has_attributes = (geom_prim & 0x80) != 0;
        bool has_line_or_area = (geom_type == 2 || geom_type == 4);

        // CRITICAL: Calculate actual data bytes
        int actual_bytes = obj_desc_bytes;
        if ((has_line_or_area || has_attributes) && obj_desc_bytes >= 4) {
            actual_bytes -= 4;
        }

        int data_end = offset + actual_bytes;

        // Parse variable data
        int n_attr = 0;
        if (has_attributes && offset < data_end) {
            n_attr = decode_byte(feature_data[offset]);
            offset += 1;

            // Read attributes (see Attribute Parsing section)
            offset = parse_attributes(feature_data, offset, n_attr);
        }

        if (has_related && offset < data_end) {
            // Read related object count and data
            unsigned char rel_count = decode_byte(feature_data[offset]);
            offset += 1;
            offset += rel_count * 3;  // Each related record is 3 bytes
        }

        // Parse geometry based on type
        switch (geom_type) {
            case 1:  // 2D Point
                parse_point_geometry(feature_data, offset, data_end);
                break;
            case 2:  // Line
                parse_line_geometry(feature_data, offset, data_end);
                break;
            case 4:  // Area
                parse_area_geometry(feature_data, offset, data_end);
                break;
            case 8:  // 3D Point (sounding)
                parse_sounding_geometry(feature_data, offset, data_end);
                break;
        }

        // Move to next feature
        offset = data_end;
    }
}
```

### Attribute Parsing

Attributes are key-value pairs. The key is an index into CM93ATTR.DIC.

```c
typedef struct {
    unsigned char attr_code;
    unsigned char value_type;  // Encoded in high bits
    union {
        int int_value;
        float float_value;
        char* string_value;
    } value;
} Attribute;

int parse_attributes(unsigned char* data, int offset, int n_attr) {
    for (int i = 0; i < n_attr; i++) {
        unsigned char attr_code = decode_byte(data[offset]);
        offset += 1;

        // Value type is encoded in attribute code or follows
        // Implementation varies - see OpenCPN for exact details

        // Read value based on type
        // ...
    }
    return offset;
}
```

### Line Geometry Parsing

Line features reference edges from the vector table.

```c
void parse_line_geometry(unsigned char* data, int offset, int end_offset) {
    // Read number of edge references
    unsigned short n_edges = read_decoded_u16(data, offset);
    offset += 2;

    // Read edge indices
    for (int i = 0; i < n_edges && offset + 2 <= end_offset; i++) {
        unsigned short edge_ref = read_decoded_u16(data, offset);
        offset += 2;

        // IMPORTANT: Edge index encoding
        int edge_index = edge_ref & 0x1FFF;      // Lower 13 bits = edge index
        int segment_usage = edge_ref >> 13;      // Upper 3 bits = usage flags

        // segment_usage values:
        // 0 = use entire edge forward
        // 1 = use entire edge reversed
        // 2 = use first segment only
        // 3 = use last segment only
        // etc.

        // Look up edge in vector table and build geometry
    }
}
```

### Area Geometry Parsing

Areas are closed polygons, potentially with interior rings (holes).

```c
void parse_area_geometry(unsigned char* data, int offset, int end_offset) {
    // Areas can have multiple rings (exterior + holes)
    // Format: ring_count, then for each ring: edge_count + edges

    // Read exterior ring
    unsigned short n_exterior_edges = read_decoded_u16(data, offset);
    offset += 2;

    for (int i = 0; i < n_exterior_edges && offset + 2 <= end_offset; i++) {
        unsigned short edge_ref = read_decoded_u16(data, offset);
        offset += 2;

        int edge_index = edge_ref & 0x1FFF;
        int segment_usage = edge_ref >> 13;
        // Build exterior ring from edges
    }

    // Check for interior rings (holes)
    // ...
}
```

### Point Geometry Parsing

```c
void parse_point_geometry(unsigned char* data, int offset, int end_offset) {
    // Point features reference a 2D point from the point table
    unsigned short point_index = read_decoded_u16(data, offset);
    // Look up point in points2d table
}

void parse_sounding_geometry(unsigned char* data, int offset, int end_offset) {
    // Sounding features reference a 3D point from the point table
    unsigned short point_index = read_decoded_u16(data, offset);
    // Look up point in points3d table
    // The z value is the depth/height
}
```

---

## Coordinate Transformation

### CM93 Coordinate System

CM93 uses the International 1924 ellipsoid with Mercator projection.

```c
#define CM93_SEMIMAJOR_AXIS 6378388.0  // International 1924
#define DEG_TO_RAD (M_PI / 180.0)
#define RAD_TO_DEG (180.0 / M_PI)
```

### Cell Transform Parameters

Each cell has transform parameters from the header:

| Parameter | Description |
|-----------|-------------|
| lat_min, lon_min | Cell origin in geographic coordinates |
| x_rate | Mercator X units per CM93 coordinate unit |
| y_rate | Mercator Y units per CM93 coordinate unit |
| x_origin | X offset in CM93 coordinate space |
| y_origin | Y offset in CM93 coordinate space |

### CM93 Point to Geographic

```c
typedef struct {
    double lat_min, lon_min;
    double x_rate, y_rate;
    int x_origin, y_origin;
} CellTransform;

// Convert geographic to Mercator
void geo_to_mercator(double lat, double lon, double* merc_x, double* merc_y) {
    double lat_rad = lat * DEG_TO_RAD;
    double lon_rad = lon * DEG_TO_RAD;

    *merc_x = CM93_SEMIMAJOR_AXIS * lon_rad;
    *merc_y = CM93_SEMIMAJOR_AXIS * log(tan(M_PI_4 + lat_rad / 2.0));
}

// Convert Mercator to geographic
void mercator_to_geo(double merc_x, double merc_y, double* lat, double* lon) {
    *lon = (merc_x / CM93_SEMIMAJOR_AXIS) * RAD_TO_DEG;
    *lat = (2.0 * atan(exp(merc_y / CM93_SEMIMAJOR_AXIS)) - M_PI_2) * RAD_TO_DEG;
}

// Transform CM93 point to geographic
void transform_point(CellTransform* xform, int cm93_x, int cm93_y,
                     double* lat, double* lon) {
    // Step 1: Apply offset to get cell-relative coordinates
    double x_rel = cm93_x - xform->x_origin;
    double y_rel = cm93_y - xform->y_origin;

    // Step 2: Scale to Mercator
    double merc_x = x_rel * xform->x_rate;
    double merc_y = y_rel * xform->y_rate;

    // Step 3: Add cell origin in Mercator projection
    double origin_merc_x, origin_merc_y;
    geo_to_mercator(xform->lat_min, xform->lon_min, &origin_merc_x, &origin_merc_y);

    merc_x += origin_merc_x;
    merc_y += origin_merc_y;

    // Step 4: Convert to geographic
    mercator_to_geo(merc_x, merc_y, lat, lon);
}
```

---

## Object Classes (S-57 Compatible)

CM93 uses S-57-compatible object class codes. Common classes:

| Code | Acronym | Description |
|------|---------|-------------|
| 1 | ADMARE | Administration area |
| 2 | AIRARE | Airport area |
| 3 | ACHBRT | Anchor berth |
| 4 | ACHARE | Anchorage area |
| 42 | DEPARE | Depth area |
| 43 | DEPCNT | Depth contour |
| 71 | LNDARE | Land area |
| 72 | LNDELV | Land elevation |
| 75 | LIGHTS | Light |
| 86 | OBSTRN | Obstruction |
| 129 | SOUNDG | Sounding |
| 153 | BOYCAR | Buoy cardinal |
| 154 | BOYLAT | Buoy lateral |

The full mapping is in CM93OBJ.DIC.

---

## Implementation Checklist

1. **Initialization**
   - [ ] Build decode/encode tables from Table_0

2. **File Validation**
   - [ ] Read and decode prolog (10 bytes)
   - [ ] Validate: word0 + vector_len + feature_len = file_size

3. **Header Parsing**
   - [ ] Read and decode 128-byte header
   - [ ] Extract bounds (lat/lon min/max)
   - [ ] Extract transform parameters (x_rate, y_rate, origins)
   - [ ] Extract record counts

4. **Vector Table**
   - [ ] Read edge index table
   - [ ] Read 3D point table
   - [ ] Read 2D point table
   - [ ] Parse edge coordinate data (delta-encoded)

5. **Feature Table**
   - [ ] For each feature:
     - [ ] Read otype, geom_prim, obj_desc_bytes
     - [ ] **Apply -4 overhead for LINE/AREA or attributes**
     - [ ] Parse attributes if present
     - [ ] Parse related objects if present
     - [ ] Parse geometry (point/line/area)

6. **Coordinate Transform**
   - [ ] Transform CM93 coordinates to geographic using cell transform

---

## Common Pitfalls

1. **Forgetting to decode**: Every byte must be run through the decode table.

2. **obj_desc_bytes overhead**: The -4 adjustment is critical. Without it, parsing will fail after a few features.

3. **Edge index encoding**: Remember to mask with 0x1FFF for the actual index.

4. **Delta encoding**: Edge coordinates after the first are deltas, not absolute.

5. **Empty cells**: Some cells have 0 features - this is valid.

6. **Byte order**: CM93 is little-endian throughout.

---

## References

- OpenCPN Source Code: https://github.com/OpenCPN/OpenCPN
  - `src/cm93.cpp` - Main CM93 implementation
  - `src/cm93.h` - Data structures
- S-57 Standard (for object/attribute definitions)
- IHO Transfer Standard for Digital Hydrographic Data
