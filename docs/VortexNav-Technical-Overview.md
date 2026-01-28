# VortexNav Technical and Functional Overview

**Document Version:** 1.0
**Date:** January 2026
**Classification:** Internal Technical Documentation

---

## Executive Summary

VortexNav is a professional-grade marine navigation application designed for deployment on Ubuntu-based navigation tablets. Built using modern cross-platform technologies, the application provides comprehensive chart management, real-time GPS positioning, route planning, and track recording capabilities. VortexNav operates as a standalone navigation system with functionality controlled through integration with a cloud-based SaaS subscription management layer, enabling remote feature provisioning, licensing, and user management.

---

## 1. System Architecture

### 1.1 Technology Stack

VortexNav employs a hybrid architecture combining web technologies for the user interface with native Rust code for performance-critical operations:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 19.1 + TypeScript 5.8 | User interface and interaction |
| **Build System** | Vite 7.0 | Fast development and production bundling |
| **Map Rendering** | MapLibre GL 5.16 | WebGL-accelerated vector/raster map display |
| **Desktop Framework** | Tauri 2.0 | Native application wrapper using system WebView |
| **Backend Core** | Rust | GPS handling, chart parsing, data persistence |
| **Database** | SQLite | Local configuration and navigation data storage |

The Tauri framework provides significant advantages over Electron-based alternatives, delivering a smaller application footprint (approximately 10-15MB versus 150MB+), reduced memory consumption, and native system integration whilst maintaining cross-platform compatibility across Windows, macOS, and Linux distributions including Ubuntu.

### 1.2 Application Structure

The application follows a clear separation of concerns:

```
vortexnav-app/
├── src/                    # React frontend application
│   ├── components/         # UI components (MapView, LayerSwitcher, etc.)
│   ├── hooks/              # React hooks for state management
│   ├── types/              # TypeScript interface definitions
│   └── utils/              # Utility functions
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands.rs     # 60+ Tauri command handlers
│   │   ├── database.rs     # SQLite abstraction layer
│   │   ├── gps.rs          # GPS source management
│   │   ├── nmea.rs         # NMEA 0183 sentence parsing
│   │   ├── cm93/           # Vector chart processing module
│   │   ├── gpx.rs          # GPX import/export functionality
│   │   └── chart_converter.rs  # Raster chart conversion
│   └── Cargo.toml          # Rust dependencies
```

Communication between the React frontend and Rust backend occurs through Tauri's Inter-Process Communication (IPC) mechanism, providing type-safe command invocation with automatic serialisation/deserialisation of data structures.

---

## 2. Core Functional Capabilities

### 2.1 Chart Management

VortexNav provides comprehensive support for multiple nautical chart formats, enabling mariners to utilise their existing chart collections:

**Supported Chart Formats:**

| Format | Type | Implementation |
|--------|------|----------------|
| **MBTiles** | Raster | Direct SQLite tile serving |
| **BSB/KAP** | Raster | Conversion via GDAL integration |
| **GeoTIFF** | Raster | Conversion via GDAL integration |
| **CM93** | Vector | Native Rust parser with GeoJSON rendering |
| **S-57 ENC** | Vector | Catalog-based download workflow |

The chart rendering system implements a carefully designed layer stacking model ensuring proper visual hierarchy:

1. **Basemap Layer** - Foundation maps (OpenStreetMap, ESRI, Google Satellite)
2. **Nautical Vector Layers** - CM93 data (soundings, navigation aids, depth contours)
3. **Bathymetry Layers** - GEBCO ocean depth visualisation
4. **Raster Chart Layers** - User-imported MBTiles charts
5. **Overlay Layers** - OpenSeaMap navigation aids
6. **Navigation Layers** - Active routes and vessel position

Users can toggle individual chart visibility, adjust opacity values, and reorder charts within the layer panel. The system persists layer states to the local database, ensuring configuration consistency across sessions.

### 2.2 GPS and Position Management

The GPS subsystem supports multiple data sources with automatic failover capabilities:

**GPS Source Types:**
- **Serial Port** - Direct connection to NMEA 0183 devices
- **TCP Stream** - Network-based GPS data reception
- **Simulated GPS** - Development and demonstration mode

The NMEA parser extracts essential navigation data including latitude, longitude, speed over ground (SOG), course over ground (COG), heading, and satellite constellation information. The system maintains a priority-ordered list of GPS sources, automatically switching to secondary sources upon primary failure.

GPS status monitoring provides real-time feedback:
- Connection state (disconnected, connecting, connected, receiving data, error)
- Sentence count and last fix timestamp
- Error diagnostics for troubleshooting

### 2.3 Waypoint Management

Waypoints serve as fundamental navigation elements. The system provides:

- **Creation Methods** - Right-click map placement or coordinate entry
- **Drag Repositioning** - Interactive map-based editing
- **Metadata Support** - Names, descriptions, and symbol categorisation
- **Visibility Control** - Individual waypoint show/hide functionality
- **Persistence** - All waypoints stored in local SQLite database

### 2.4 Route Planning

The route planning system enables comprehensive voyage preparation:

**Route Features:**
- Ordered waypoint sequences defining navigation paths
- Configurable estimated speed for ETA calculations (default: 5.0 knots)
- Colour coding for visual differentiation (default: magenta per IMO standards)
- Tagging system for categorisation (Coastal, Ocean Crossing, Harbor Entry, etc.)
- Route statistics including total distance, leg bearings, and estimated duration

**Navigation Calculations:**
- **Distance** - Haversine formula computing great-circle distances in nautical miles
- **Bearing** - Initial bearing calculation between waypoints
- **VMG** - Velocity Made Good toward active waypoint
- **ETA/TTG** - Estimated Time of Arrival and Time To Go

Route manipulation functions include duplication, reversal, and extension capabilities. The system supports route sharing through GPX export and human-readable text summaries.

### 2.5 Track Recording

Automatic track recording captures vessel movement for voyage documentation:

- **Interval Recording** - Configurable capture frequency (default: 5 seconds)
- **Movement Filtering** - Minimum distance threshold (5 metres) to reduce noise
- **Data Capture** - Position, timestamp, heading, COG, and SOG per point
- **Track-to-Route Conversion** - Recorded tracks can be converted to navigable routes

Track data exports to standard GPX format for compatibility with external navigation systems and voyage analysis software.

---

## 3. Map Display and Basemap Options

VortexNav integrates with multiple online tile providers, offering flexibility for different operational requirements:

| Provider | Type | API Key Required |
|----------|------|------------------|
| OpenStreetMap | Street Map | No |
| OpenTopoMap | Topographic | No |
| Google Satellite | Aerial Imagery | No |
| ESRI World Imagery | Aerial Imagery | Optional |
| ESRI Ocean Basemap | Marine | Optional |
| Bing Maps | Aerial Imagery | Yes |
| HERE Aerial | Aerial Imagery | Yes |
| Mapbox Satellite | Aerial Imagery | Yes |
| Sentinel-2 | Satellite Imagery | No |
| OpenSeaMap | Navigation Overlay | No |

The MapLibre GL rendering engine provides hardware-accelerated WebGL display, supporting smooth pan, zoom, and rotation interactions. Map orientation modes include north-up (traditional) and heading-up (vessel-centred rotation based on GPS heading).

---

## 4. Data Storage Architecture

### 4.1 SQLite Database Schema

All application data persists in a local SQLite database, ensuring offline operation capability:

| Table | Purpose |
|-------|---------|
| `app_settings` | Global preferences, API keys, last map position |
| `waypoints` | Navigation waypoint definitions |
| `routes` | Route metadata and configuration |
| `route_waypoints` | Route-to-waypoint relationships |
| `tracks` | Recorded vessel trail metadata |
| `track_points` | Individual track position records |
| `gps_sources` | GPS device configurations |
| `chart_layer_states` | Per-chart visibility and opacity settings |
| `catalogs` | Downloaded chart catalog references |

### 4.2 File Storage

Chart data and configuration files reside in platform-appropriate directories:

- **Charts Directory** - MBTiles files and GEBCO bathymetry data
- **Configuration Database** - SQLite database file
- **Converted Charts** - Output from BSB/GeoTIFF conversion processes

---

## 5. SaaS Integration Architecture

### 5.1 Subscription Management Integration

VortexNav is designed to operate in conjunction with the Vortex Marine SaaS platform, which provides:

**User Management:**
- Account registration and authentication
- Email/password or federated identity options
- Role-based access (standard user, administrator, super administrator)

**Subscription Control:**
- Feature tier management (Basic, Professional, Enterprise)
- Chart download quotas and tracking
- Usage analytics and reporting

**License Enforcement:**
- Device registration and activation
- Offline grace period handling
- Multi-device subscription support

### 5.2 Integration Points

The tablet application communicates with the subscription server for:

1. **Initial Activation** - Device registration against user account
2. **Feature Provisioning** - Retrieving enabled feature flags based on subscription tier
3. **Chart Downloads** - Authenticated access to premium chart catalogs
4. **Usage Reporting** - Anonymous telemetry for service improvement
5. **License Validation** - Periodic verification of subscription status

The architecture supports offline operation, caching subscription state locally with configurable validity periods. Upon internet connectivity restoration, the application synchronises with the subscription server to refresh license status.

### 5.3 Backend Services

The Vortex Marine backend (vortex-backend) provides REST API endpoints for:

- `/api/local-auth/*` - Authentication (register, login, password management)
- `/api/users/*` - User profile and preferences
- `/api/subscriptions/*` - Subscription status and management
- `/api/charts/*` - Chart catalog and download services
- `/api/orders/*` - Purchase processing and history

Authentication utilises JWT tokens with configurable expiration, supporting both online and offline validation scenarios.

---

## 6. Ubuntu Tablet Deployment

### 6.1 Target Platform Requirements

VortexNav deployment on Ubuntu-based navigation tablets requires:

**Minimum Specifications:**
- Ubuntu 20.04 LTS or later (including Ubuntu Touch variants)
- WebKitGTK 2.40+ (Tauri runtime dependency)
- 2GB RAM minimum (4GB recommended)
- 500MB storage for application (additional for charts)
- GPS hardware or external NMEA 0183 device
- Display resolution: 1280x800 minimum

**Optional Components:**
- GDAL 3.0+ for raster chart conversion
- Network connectivity for subscription validation and chart downloads

### 6.2 Installation and Configuration

The application distributes as:
- **AppImage** - Universal Linux package requiring no installation
- **Debian Package (.deb)** - System-level installation with dependency management

Initial configuration includes:
1. GPS source setup (serial port or network stream)
2. Chart directory specification
3. Subscription account linkage
4. Basemap and overlay preferences

### 6.3 Offline Operation

VortexNav maintains full functionality during offline periods:
- All charts stored locally in MBTiles format
- Waypoints, routes, and tracks persisted to SQLite
- GPS data processed locally without network dependency
- Cached subscription state enables feature access

Upon connectivity restoration, the application:
- Validates subscription status with backend
- Synchronises any pending usage data
- Downloads queued chart updates if applicable

---

## 7. Security Considerations

### 7.1 Data Protection

- Local database uses SQLite with file-system permissions
- API communications secured via HTTPS/TLS
- JWT tokens include expiration and audience validation
- Sensitive credentials stored in platform-appropriate secure storage

### 7.2 Authentication

- Password hashing uses bcrypt with 12 salt rounds
- JWT tokens valid for 7 days with refresh capability
- Role-based access control for administrative functions

---

## 8. Future Development Considerations

The architecture supports extension for:

- **AIS Integration** - Automatic Identification System vessel tracking
- **Weather Overlay** - Real-time meteorological data display
- **Tidal Information** - Tidal stream and height predictions
- **S-57 ENC Rendering** - Full vector chart symbol library
- **Multi-device Synchronisation** - Cloud-based waypoint and route sharing
- **Advanced Routing** - Weather-optimised passage planning

---

## 9. Conclusion

VortexNav represents a modern approach to marine navigation software, combining the performance benefits of native Rust code with the flexibility of web-based user interfaces. The Tauri framework enables deployment across multiple platforms whilst maintaining a lightweight footprint suitable for embedded tablet devices.

The integration with the Vortex Marine SaaS platform provides a robust mechanism for subscription management, feature provisioning, and user administration, enabling a sustainable commercial model whilst ensuring mariners have access to professional-grade navigation capabilities.

The system's offline-first architecture ensures reliability in maritime environments where network connectivity may be intermittent, whilst the comprehensive chart format support allows users to leverage existing chart collections without format conversion barriers.

---

**Document Prepared By:** Vortex Marine Development Team
**Contact:** technical@vortexmarine.com

