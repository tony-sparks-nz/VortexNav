# VortexNav: Research Pack & Implementation Plan

## Executive Summary

VortexNav is a modern marine navigation application designed to replace OpenCPN for blue water cruisers, optimized for offline-first operation on the Vortex Scout (Ubuntu kiosk) and integrated with Vortex Command (vessel data hub) and Vortex Horizon (offline satellite-augmented charts).

This document provides:
- Deep research on OpenCPN capabilities and limitations
- Analysis of satellite imagery options for offline marine charts
- Catalog of open marine data sources
- Reference architecture for vessel telemetry
- Five prioritized MVP functions
- Phased implementation roadmap

**Key Strategic Decisions:**
- **Platform**: Tauri 2.0 + Rust backend with web frontend (MapLibre GL JS)
- **Data Model**: Signal K-compatible JSON schema with SQLite + TimescaleDB hybrid storage
- **Rendering**: MapLibre GL Native for GPU-accelerated vector/raster tile rendering
- **Offline**: MBTiles containers with delta sync for updates

---

## 1. OpenCPN Capability Map

### 1.1 Core Features Inventory

| Domain | Feature | Implementation | Plugin? | Keep/Redesign |
|--------|---------|----------------|---------|---------------|
| **Chart Display** | BSB Raster (RNC) | Native C++/OpenGL | No | Keep format support |
| | S-57 Vector (ENC) | Native C++/OpenGL | No | Keep, modernize renderer |
| | S-63 Encrypted ENC | Native with IHO scheme | No | Keep (OEM licensing required) |
| | MBTiles overlay | Native | No | **Expand significantly** |
| | Chart quilting | Native | No | Keep, improve performance |
| | CM93 charts | Native | No | Deprecate (legacy format) |
| **Navigation** | GPS position tracking | Native NMEA | No | Keep |
| | Route planning | Native | No | **Redesign UX** |
| | Waypoints/marks | Native SQLite | No | Keep, add cloud sync |
| | Track recording | Native | No | Keep, add analytics |
| | Autopilot output | Native NMEA | No | Keep |
| **AIS** | AIS target display | Native | No | Keep |
| | CPA/TCPA alarms | Native | No | **Enhance with ML prediction** |
| | AIS MOB/SART | Native | No | Keep |
| **Weather** | GRIB display | Plugin (grib_pi) | Yes | **Integrate into core** |
| | Weather routing | Plugin (weather_routing_pi) | Yes | **Integrate into core** |
| **Tides/Currents** | Prediction display | Native (XTide data) | No | Keep, update data format |
| **Radar** | Radar overlay | Plugin (radar_pi) | Yes | Defer to v2 |
| **Instruments** | Dashboard display | Plugin (dashboard_pi) | Yes | **Integrate into core** |
| **Logging** | Logbook | Plugin (logbook_pi) | Yes | **Integrate into core** |
| **Charts Download** | Chart catalogs | Plugin (chartdl_pi) | Yes | **Integrate into core** |

### 1.2 OpenCPN Architecture Analysis

**Strengths to Preserve:**
- Responsive C++ core with OpenGL acceleration
- Robust NMEA 0183/2000 parsing
- Mature chart format support (BSB, S-57)
- Active plugin ecosystem (50+ plugins)
- Cross-platform via wxWidgets

**Weaknesses to Address:**
- **Monolithic architecture**: Single process combines NMEA multiplexing, rendering, UI, and plugin management
- **Touch interface**: Poor support for touchscreens - double-click emulation issues, mode-locking bugs
- **Settings sprawl**: Complex options scattered across menus, overwhelming for new users
- **Plugin fragmentation**: Critical features (GRIB, weather routing, dashboard) require separate plugins
- **WebView rendering**: No native support for modern web-based tile services
- **Mobile**: Android port exists but limited functionality
- **Update cadence**: Slow release cycle, plugin compatibility issues between versions

### 1.3 User Pain Points (from Cruisers Forum research)

1. **Touch interaction**: "Very difficult to build a user-friendly cockpit touch system with OpenCPN's current implementation"
2. **Hardware requirements**: Lack of truly excellent outdoor display solutions (multi-touch PCAP, 1500+ nit, IP66+)
3. **Mode confusion**: Measure distance mode locks screen, no exit on touchscreen
4. **Display jumping**: Course-up + auto-follow causes erratic behavior with multiple GPS inputs
5. **Learning curve**: "Powerful but complex software" - steep learning curve for new users
6. **Plugin management**: Manual plugin installation, version compatibility issues

---

## 2. Imagery & Tile Pipeline Matrix

### 2.1 Source Comparison

| Source | Resolution | Refresh | Cost Model | Offline Suitability | Licensing Risk | Implementation Complexity |
|--------|-----------|---------|------------|---------------------|----------------|---------------------------|
| **Sentinel-2** | 10m (visible), 20-60m (other bands) | 5-day revisit | Free (Copernicus) | **Excellent** - public domain | **Low** - CC BY-SA | **Medium** - cloud masking, mosaicking needed |
| **Esri World Imagery** | 0.3m (urban) to 15m (global) | Varies by region | Free (non-commercial) or $0.10-0.15/1K tiles | **Good** - World Imagery for Export layer | **Medium** - commercial use requires license | **Low** - ready-to-use tiles |
| **Planet PlanetScope** | 3m daily, 50cm (SkySat) | Daily | Enterprise pricing (~$10K+/year minimum) | **Limited** - API access, no bulk offline | **High** - strict licensing | **High** - tasking, processing pipeline |
| **Landsat 8/9** | 15-30m | 16-day | Free (USGS) | **Excellent** - public domain | **Low** | **Medium** - similar to Sentinel-2 |
| **NOAA Chart Display** | N/A (vector/raster charts) | Weekly | Free | **Excellent** - MBTiles available | **None** - public domain | **Low** - direct download |
| **OpenMapTiles Satellite** | Varies (global z0-13) | Static | $1,200 one-time | **Excellent** - pre-packaged | **Low** - commercial license | **Very Low** - ready-to-serve |

### 2.2 Recommended Pipeline for Vortex Horizon

**Tier 1: Global Base Layer**
- Source: Sentinel-2 cloudless mosaics (SentinelMap or custom processing)
- Resolution: 10m base, suitable for z0-z14
- Licensing: CC BY-SA - redistributable
- Processing: Pre-generate MBTiles packages by region

**Tier 2: Coastal Enhancement**
- Source: Esri World Imagery (licensed for commercial distribution) OR custom Sentinel-2 processing
- Resolution: 0.3-1m for harbors, anchorages, reef areas
- Coverage: User-requested areas, major cruising destinations
- Verify current: Esri licensing terms for offline redistribution

**Tier 3: Chart Integration**
- NOAA ENC/MBTiles for US waters (free, immediate)
- OpenSeaMap overlay for global POIs
- Country-specific free charts where available (NZ, Brazil, Argentina, Peru)

### 2.3 Tile Generation Pipeline Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Source Imagery  │────▶│ Processing Node  │────▶│ MBTiles Store   │
│ (Sentinel-2,    │     │ - Cloud masking  │     │ (Regional       │
│  Esri, etc.)    │     │ - Color balance  │     │  packages)      │
└─────────────────┘     │ - Tile slicing   │     └─────────────────┘
                        │ - Compression    │              │
                        └──────────────────┘              ▼
                                                  ┌─────────────────┐
                                                  │ Distribution    │
                                                  │ (Vortex Horizon │
                                                  │  CDN/offline)   │
                                                  └─────────────────┘
```

---

## 3. Open Marine Data Catalog

### 3.1 Nautical Charts & Hydrographic Data

| Source | Coverage | Format | License | Update Cadence | Notes |
|--------|----------|--------|---------|----------------|-------|
| **NOAA ENC** | US coastal, Great Lakes, territories | S-57, MBTiles | Public domain | Weekly | Primary source for US waters |
| **NOAA Custom Chart** | US waters | PDF, GeoTIFF | Public domain | On-demand | User-defined extents |
| **LINZ (New Zealand)** | NZ waters | S-57 | CC BY 4.0 | Monthly | Free redistribution allowed |
| **Brazil DHN** | Brazilian waters | BSB, S-57 | Free download | Varies | Direct from navy |
| **Argentina SHN** | Argentine waters | BSB | Free download | Varies | Registration required |
| **Peru DHN** | Peruvian waters | BSB | Free download | Varies | Limited coverage |
| **Inland ENC (EU)** | European inland waterways | S-57 | Free | Varies | Via national agencies |

**Verify current**: UKHO, Australia AHS, and most European HOs require commercial licensing

### 3.2 Coastlines, Bathymetry & Land

| Source | Coverage | Resolution | Format | License | Notes |
|--------|----------|------------|--------|---------|-------|
| **GEBCO 2025** | Global ocean | 15 arc-second (~450m) | NetCDF, GeoTIFF | Public domain | Best free global bathymetry |
| **GEBCO Contours** | Global ocean | Derived from grid | Shapefile | ODbL | Via OpenDEM |
| **Natural Earth** | Global | 1:10m to 1:110m | Shapefile, GeoJSON | Public domain | Coastlines, land polygons |
| **OpenStreetMap** | Global | Varies | PBF, Shapefile | ODbL | Coastlines, land features |

### 3.3 Navigation Aids & POIs

| Source | Coverage | Data Types | Format | License | Update Cadence |
|--------|----------|------------|--------|---------|----------------|
| **OpenSeaMap** | Global | Lights, buoys, beacons, harbors, anchorages | OSM tags, KAP | ODbL | Community-driven |
| **NOAA ATON** | US waters | Aids to navigation | Various | Public domain | Regular updates |
| **List of Lights** | Global | Major lights | Various | Public domain | Annual |
| **Noonsite** | Global | Cruising destinations, formalities | API/Web | Commercial | Community-driven |

### 3.4 Weather & Ocean Data

| Source | Coverage | Parameters | Format | License | Update Cadence |
|--------|----------|------------|--------|---------|----------------|
| **GFS (NOAA)** | Global | Wind, pressure, temp, precip, waves | GRIB2 | Public domain | 4x daily (00,06,12,18 UTC) |
| **ECMWF Open** | Global | Wind, pressure, temp | GRIB2 | CC BY 4.0 | 2x daily |
| **WW3 (NOAA)** | Global ocean | Wave height, direction, period | GRIB2 | Public domain | 4x daily |
| **RTOFS (NOAA)** | Atlantic, Gulf | Currents, SST | GRIB2 | Public domain | Daily |
| **HYCOM** | Global | Currents, temp, salinity | NetCDF | Public domain | Daily |

### 3.5 Tides & Currents

| Source | Coverage | Data Type | Access | License | Notes |
|--------|----------|-----------|--------|---------|-------|
| **NOAA CO-OPS** | US waters | Predictions, harmonics | REST API | Public domain | Harmonic constituents available |
| **XTide harmonics** | Global (limited) | Predictions | File download | GPL | Used by OpenCPN |
| **WXTide32** | Global | Predictions | Standalone app | Freeware | Windows only |

### 3.6 AIS Data

| Source | Type | Access | License | Notes |
|--------|------|--------|---------|-------|
| **Local receiver** | Real-time | NMEA 0183/2000 | N/A | Primary source for VortexNav |
| **AISHub** | Aggregated | API | Data sharing agreement | Requires contribution |
| **MarineTraffic** | Aggregated | API | Commercial | Historical data available |

---

## 4. MVP: Five Core Functions

### Selection Rationale

For global blue water cruisers, safety and situational awareness take priority over convenience features. The MVP focuses on:
1. **Getting safely from A to B** (charting, navigation)
2. **Not hitting anything** (AIS, collision avoidance)
3. **Knowing what's coming** (weather)
4. **Recording what happened** (logging)
5. **Finding safe haven** (anchoring)

### 4.1 Function 1: Chart Display & Situational Awareness

**Why it matters:**
- Offshore: Position awareness relative to hazards, traffic separation schemes, restricted areas
- Near-shore: Reef/shoal avoidance, channel navigation, harbor approach
- Foundation for all other navigation functions

**User Stories:**
- *Planning*: "I can view charts at multiple scales, see depth contours, identify hazards, and understand the coastline before departure"
- *Underway*: "I can see my position updating in real-time, with heading line and track history, oriented heads-up or north-up as I prefer"
- *Anchoring*: "I can zoom to satellite imagery showing the actual seabed and coral/sand patterns"

**Data Dependencies:**
- S-57 ENC parser (vector charts)
- BSB raster chart support (legacy compatibility)
- MBTiles reader (satellite imagery, NOAA tiles)
- NMEA GPS input (position, COG, SOG)
- OpenSeaMap overlay (POIs, aids to navigation)

**UI Expectations (Touch Kiosk):**
- Single-finger pan, two-finger zoom/rotate
- Large touch targets (minimum 44x44px)
- High-contrast day/night modes
- Quick-access zoom presets (harbor, coastal, offshore)
- Sunlight-readable color scheme

**Offline Requirements:**
- All charts fully functional with no connectivity
- Pre-downloaded regional packages (e.g., "Caribbean," "South Pacific")
- Graceful degradation when charts unavailable

**V1 Scope:**
- S-57 ENC display with standard symbology
- MBTiles raster overlay (satellite, NOAA tiles)
- GPS position/track with configurable trail length
- North-up, heads-up, course-up orientation
- Day/dusk/night color schemes
- Basic chart info queries (tap-to-identify)

**Later:**
- S-63 encrypted chart support (requires OEM licensing)
- Custom symbology profiles
- Split-screen multi-chart view
- 3D terrain visualization

---

### 4.2 Function 2: Route Planning & Navigation Execution

**Why it matters:**
- Offshore: Great circle vs rhumb line decisions, waypoint sequencing, ETA calculations
- Near-shore: Channel navigation, avoiding obstacles, approach planning
- Critical for watchkeeping and autopilot integration

**User Stories:**
- *Planning*: "I can create a route by tapping waypoints, see total distance and estimated time, and optimize for safety or efficiency"
- *Underway*: "I can see my next waypoint, XTE, bearing, and distance, with clear visual guidance on the chart"
- *Watchkeeping*: "I can see when I'll arrive at each waypoint, and get alerts for course deviations"

**Data Dependencies:**
- Chart data (for hazard avoidance in route planning)
- GPS position (for route following)
- NMEA autopilot output (APB, RMB sentences)
- Tidal current data (for ETA adjustments)

**UI Expectations:**
- Tap-to-add waypoints with drag adjustment
- Route list sidebar with distances and ETAs
- Clear XTE bar indicator for course keeping
- Large, glance-able next waypoint display

**Offline Requirements:**
- Full route planning with no connectivity
- Pre-calculated great circle routes
- Local storage of routes and waypoints

**V1 Scope:**
- Create/edit/delete routes and waypoints
- Rhumb line and great circle routing
- Active navigation with XTE, BTW, DTW, TTG
- NMEA output for autopilot
- Route import/export (GPX format)
- Simple arrival/departure alarms

**Later:**
- Automatic hazard avoidance routing
- Weather-optimized routing integration
- Tidal gate planning
- Multi-leg voyage planning

---

### 4.3 Function 3: AIS Display & Collision Avoidance

**Why it matters:**
- Offshore: Traffic separation, collision avoidance in shipping lanes
- Near-shore: Dense traffic management, ferry crossings, fishing fleet awareness
- Safety-critical function - reduces collision risk

**User Stories:**
- *Planning*: "I can see current traffic patterns to plan my route avoiding congested areas"
- *Underway*: "I can see all AIS targets with their COG vectors, and dangerous targets are highlighted"
- *Alert*: "I receive audio/visual alarm when CPA/TCPA thresholds are breached"

**Data Dependencies:**
- AIS receiver input (NMEA 0183/2000 or Signal K)
- Own ship GPS data (for relative calculations)
- Target database for persistence

**UI Expectations:**
- AIS targets as oriented triangles with COG vectors
- Color coding by target type (cargo, tanker, sailing, fishing)
- CPA/TCPA values visible on tap
- Dangerous targets highlighted in red
- Target list sortable by CPA, distance, name

**Offline Requirements:**
- Fully functional with local AIS receiver
- No dependency on internet-based AIS services
- Historical target track storage

**V1 Scope:**
- Decode AIVDM/AIVDO messages (Class A, B)
- Display targets with heading/COG vectors
- Calculate and display CPA/TCPA
- Configurable alarm thresholds
- Target list with filtering
- MOB/SART detection and alert

**Later:**
- AIS target prediction with course change detection
- Anchor watch using AIS positions
- Integration with radar overlay
- Collision avoidance suggestions

---

### 4.4 Function 4: Weather Display & GRIB Visualization

**Why it matters:**
- Offshore: Passage weather windows, storm avoidance, routing decisions
- Near-shore: Departure timing, local wind patterns, sea state
- Enables informed go/no-go decisions

**User Stories:**
- *Planning*: "I can download weather forecasts for my route, visualize wind/waves/pressure over time, and choose optimal departure window"
- *Underway*: "I can see forecast updates, animate weather progression, and adjust plans if conditions change"
- *Analysis*: "I can compare multiple weather models (GFS, ECMWF) to assess forecast uncertainty"

**Data Dependencies:**
- GRIB file parser (GRIB1, GRIB2 formats)
- GFS/ECMWF/WW3 model access (via Saildocs, OpenGribs, or direct download)
- Position data for localized display

**UI Expectations:**
- Wind barbs with color-coded speed
- Animated timeline slider
- Pressure isobars overlay
- Wave height/direction arrows
- Swipe-to-animate gesture

**Offline Requirements:**
- Download GRIB files while connected
- Full visualization and animation offline
- Multiple model storage for comparison

**V1 Scope:**
- GRIB1 and GRIB2 parser
- Wind (barbs, color gradient)
- Pressure (isobars)
- Waves (height, direction, period)
- Animation with time slider
- Saildocs email-based download instructions

**Later:**
- Direct GRIB download from NOAA/ECMWF
- Weather routing optimization
- Ensemble forecasts for uncertainty
- Historical weather playback

---

### 4.5 Function 5: Logging, Alarms & Voyage Replay

**Why it matters:**
- Offshore: Incident reconstruction, watch handover, passage analysis
- Near-shore: Docking records, maintenance triggers, fuel consumption
- Insurance, customs, and legal documentation

**User Stories:**
- *Underway*: "The system automatically logs position, speed, heading, and key events every few minutes"
- *Watchkeeping*: "I can add manual log entries for weather, sail changes, sightings, and watch handover"
- *Post-voyage*: "I can replay my voyage, see what happened when, and export for analysis or records"

**Data Dependencies:**
- All NMEA data streams (GPS, instruments, AIS)
- Manual entry interface
- Time-series storage

**UI Expectations:**
- Automatic logging (configurable interval)
- One-tap event buttons (reef, tack, engine on/off)
- Voyage timeline with scrub-to-replay
- Export to CSV, GPX, PDF

**Offline Requirements:**
- All logging fully local
- Sync to cloud when connected (optional)
- Local storage management (auto-archive old voyages)

**V1 Scope:**
- Automatic position/instrument logging (configurable 1-60 min)
- Manual event log entries
- Alarm system (anchor drag, AIS CPA, waypoint arrival, XTE)
- Basic voyage playback on chart
- GPX track export

**Later:**
- Cloud sync for voyage backup
- Fuel/engine hour tracking
- Maintenance reminders based on engine hours
- PDF voyage report generation
- Integration with customs/cruising documentation

---

## 5. Reference Architecture

### 5.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VORTEX SCOUT (Kiosk)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  VortexNav  │  │   MapLibre  │  │   SQLite    │  │   MBTiles   │   │
│  │  (Tauri)    │──│   GL JS     │──│   (config,  │──│   (charts,  │   │
│  │             │  │             │  │   routes)   │  │   imagery)  │   │
│  └──────┬──────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│         │                                                               │
│         │ WebSocket/HTTP                                                │
└─────────┼───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        VORTEX COMMAND (Hub)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Signal K   │  │ TimescaleDB │  │   Sync      │  │   NMEA      │   │
│  │  Server     │──│ (telemetry) │──│   Engine    │──│   Gateway   │   │
│  │             │  │             │  │             │  │             │   │
│  └──────┬──────┘  └─────────────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                                  │                 │          │
└─────────┼──────────────────────────────────┼─────────────────┼──────────┘
          │                                  │                 │
          │ Satellite/LTE (when available)   │                 │
          ▼                                  ▼                 ▼
┌─────────────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   VORTEX CLOUD          │    │   NMEA 2000     │    │   NMEA 0183     │
│  - Fleet dashboard      │    │   Network       │    │   Instruments   │
│  - Telemetry archive    │    │                 │    │                 │
│  - Alert notifications  │    │                 │    │                 │
└─────────────────────────┘    └─────────────────┘    └─────────────────┘
```

### 5.2 Data Ingestion & Storage

**Edge Layer (Vortex Command):**

```
NMEA Inputs          Signal K Server         TimescaleDB
───────────────────────────────────────────────────────────
NMEA 0183 ────┐
              │     ┌─────────────────┐     ┌─────────────┐
NMEA 2000 ────┼────▶│ Signal K Server │────▶│ Telemetry   │
              │     │ (Node.js)       │     │ (time-series│
AIS ──────────┤     │                 │     │  hypertable)│
              │     │ Normalizes to   │     │             │
GNSS ─────────┘     │ Signal K JSON   │     │ 30-day hot  │
                    │                 │     │ + cold tier │
                    └────────┬────────┘     └─────────────┘
                             │
                             │ WebSocket
                             ▼
                    ┌─────────────────┐
                    │ VortexNav       │
                    │ (real-time UI)  │
                    └─────────────────┘
```

**Storage Strategy:**

| Data Type | Hot Storage (Edge) | Cold Storage (Edge) | Cloud Archive |
|-----------|-------------------|--------------------|--------------|
| Position | TimescaleDB (30 days, 1Hz) | Compressed parquet (1 year) | S3 (indefinite) |
| Instruments | TimescaleDB (30 days, 1Hz) | Compressed parquet | S3 |
| AIS tracks | TimescaleDB (7 days) | SQLite archive | Optional |
| Events/logs | SQLite | SQLite | S3 |
| Routes/waypoints | SQLite | SQLite | S3 |
| Config | SQLite | N/A | User cloud |

**Recommended Edge Storage:**
- **TimescaleDB**: Best query performance for time-series on Raspberry Pi class hardware (230+ inserts/sec in research benchmarks)
- **SQLite**: Configuration, routes, events (low-write, high-read)
- **MBTiles**: Chart/imagery tiles (read-only)

### 5.3 Cloud Sync Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Vortex Command                         │
│  ┌─────────────┐     ┌─────────────┐                     │
│  │ Sync Queue  │     │ Offline     │                     │
│  │ (SQLite)    │     │ Buffer      │                     │
│  │             │     │ (72h data)  │                     │
│  └──────┬──────┘     └──────┬──────┘                     │
│         │                   │                             │
│         └─────────┬─────────┘                             │
│                   │                                       │
└───────────────────┼───────────────────────────────────────┘
                    │ Delta sync (gRPC or MQTT)
                    │ Priorities: events > position > instruments
                    ▼
┌───────────────────────────────────────────────────────────┐
│                    Vortex Cloud                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ API Gateway │──│ TimescaleDB │──│ Alert       │       │
│  │ (gRPC/REST) │  │ (long-term) │  │ Engine      │       │
│  └─────────────┘  └─────────────┘  └──────┬──────┘       │
│                                           │               │
│                                    ┌──────▼──────┐       │
│                                    │ Notification│       │
│                                    │ (SMS/Email/ │       │
│                                    │  Push)      │       │
│                                    └─────────────┘       │
└───────────────────────────────────────────────────────────┘
```

### 5.4 Signal K Schema (Example)

```json
{
  "vessels": {
    "urn:mrn:imo:mmsi:123456789": {
      "navigation": {
        "position": {
          "value": { "longitude": -122.4, "latitude": 37.8 },
          "timestamp": "2026-01-24T12:00:00Z"
        },
        "courseOverGroundTrue": { "value": 1.57 },
        "speedOverGround": { "value": 3.5 }
      },
      "environment": {
        "wind": {
          "angleApparent": { "value": 0.78 },
          "speedApparent": { "value": 7.2 }
        },
        "depth": {
          "belowTransducer": { "value": 12.5 }
        }
      }
    }
  }
}
```

---

## 6. Technical Strategy

### 6.1 Platform Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Desktop/Kiosk App** | Tauri 2.0 (Rust + Web) | 10x smaller than Electron, native performance, Linux/Ubuntu support |
| **Chart Rendering** | MapLibre GL JS | GPU-accelerated, vector tiles, open source, mature ecosystem |
| **Native Rendering** | MapLibre Native (future) | For embedded/low-power scenarios |
| **Data Visualization** | deck.gl | High-performance WebGL layers for tracks, weather |
| **State Management** | Zustand or Jotai | Lightweight, TypeScript-friendly |
| **Backend (Command)** | Rust + Actix-web | Performance, memory safety, single binary |
| **NMEA Processing** | Rust (custom) or Signal K | Signal K for compatibility, Rust for performance |

### 6.2 Data Model

**Chart/Tile Layer:**
```typescript
interface TileSource {
  id: string;
  type: 'mbtiles' | 'xyz' | 'wms' | 's57';
  path: string;  // local path or URL
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number];
  attribution: string;
  license: 'public_domain' | 'cc_by' | 'cc_by_sa' | 'commercial' | 'restricted';
}
```

**Navigation Objects:**
```typescript
interface Waypoint {
  id: string;
  name: string;
  position: { lat: number; lon: number };
  symbol: string;
  description?: string;
  createdAt: string;
  modifiedAt: string;
  syncStatus: 'local' | 'synced' | 'conflict';
}

interface Route {
  id: string;
  name: string;
  waypoints: string[];  // waypoint IDs in order
  type: 'rhumb' | 'great_circle';
  totalDistance: number;
  createdAt: string;
  modifiedAt: string;
}
```

**Telemetry (Signal K compatible):**
```typescript
interface TelemetryPoint {
  timestamp: string;
  path: string;  // e.g., "navigation.position"
  value: any;
  source: string;
}
```

### 6.3 Offline-First Architecture

**Principles:**
1. **Local-first data**: All user data stored locally, cloud is backup
2. **Graceful degradation**: Full functionality with no connectivity
3. **Delta sync**: Only changed data synchronized when connected
4. **Storage budgets**: Configurable limits with automatic archival

**Storage Constraints (Vortex Scout):**
- Target: 64GB minimum storage
- Chart allocation: 40GB (covers major cruising regions)
- Telemetry: 10GB (30 days at 1Hz for all instruments)
- Application: 1GB
- Buffer: 13GB

**Power Constraints:**
- Target: <5W average consumption
- Chart rendering: GPU acceleration reduces CPU load
- Background sync: Defer non-critical sync to shore power
- Sensor polling: Configurable intervals (1-60 sec)

### 6.4 Compliance & Licensing Strategy

**Data Classification:**

| Category | Examples | Redistribution | VortexNav Approach |
|----------|----------|----------------|-------------------|
| **Public Domain** | NOAA charts, GFS weather, GEBCO | Unrestricted | Bundle freely |
| **Open License** | OpenSeaMap (ODbL), Sentinel-2 (CC BY-SA) | With attribution | Bundle with attribution |
| **Commercial License** | Esri imagery, Planet | Per agreement | License for Vortex Horizon |
| **Restricted** | S-63 ENCs, most national HOs | Prohibited | User provides own credentials |

**Risk Mitigations:**
1. **Provider abstraction**: Abstract data sources behind interfaces for easy substitution
2. **Provenance metadata**: Track source and license of all data
3. **Audit trail**: Log all data access for compliance review
4. **User credentials**: S-63 and commercial charts use user's own license
5. **Clear separation**: Vortex Horizon (our content) vs. user-provided content

---

## 7. Implementation Roadmap

**Key Decisions (from stakeholder input):**
- **Platform**: Ubuntu/Linux only for MVP (Vortex Scout focus)
- **S-63 Charts**: Deferred to post-MVP (rely on free charts: NOAA, NZ, Brazil)
- **Cloud Sync**: Core differentiator - included in MVP scope
- **Timeline**: 6-9 months aggressive target

### Phase 0: Foundation (3 weeks)
**Goal:** Project scaffolding, core infrastructure, and cloud backend skeleton

- [ ] Set up Tauri 2.0 project with Rust backend (Ubuntu/Linux target only)
- [ ] Implement basic MapLibre GL JS integration
- [ ] Create MBTiles reader and tile server
- [ ] Establish SQLite schema for config/routes/waypoints
- [ ] Build NMEA 0183 parser (Rust)
- [ ] Create basic day/night theme system
- [ ] **Cloud**: Set up API skeleton (Rust/Actix or Go) with auth framework
- [ ] **Cloud**: Provision TimescaleDB instance for telemetry

**Deliverable:** App shell displaying MBTiles + cloud backend accepting connections

**Key Risks:**
- MapLibre WebView performance on target hardware
- Tauri + MapLibre integration complexity

---

### Phase 1: Chart Display + Cloud Foundation (5 weeks)
**Goal:** Functional chart viewer with sync infrastructure

- [ ] Implement S-57 ENC parser (integrate existing library - no custom parser)
- [ ] Chart quilting (multiple charts at different scales)
- [ ] Pan/zoom touch gestures with inertia
- [ ] Chart orientation (north-up, heads-up, course-up)
- [ ] Basic chart object queries (tap-to-identify)
- [ ] OpenSeaMap overlay integration
- [ ] **Cloud**: Define sync protocol (gRPC or WebSocket)
- [ ] **Cloud**: Implement device registration and authentication
- [ ] **Cloud**: Build sync queue with offline buffering

**Deliverable:** Full chart viewing + authenticated cloud connection

**Key Risks:**
- S-57 parsing complexity (use existing library to mitigate)
- Sync protocol design affecting all subsequent phases

---

### Phase 2: Navigation + Position Sync (4 weeks)
**Goal:** Route planning with real-time position streaming to cloud

- [ ] Waypoint CRUD with SQLite persistence
- [ ] Route creation (tap-to-add waypoints)
- [ ] Rhumb line and great circle calculations
- [ ] Active navigation display (XTE, BTW, DTW, TTG)
- [ ] NMEA output (APB, RMB) for autopilot
- [ ] GPX import/export
- [ ] **Cloud**: Real-time position streaming (1/min when connected)
- [ ] **Cloud**: Route/waypoint sync with conflict resolution
- [ ] **Cloud**: Basic fleet dashboard showing vessel positions

**Deliverable:** Complete navigation with live position on fleet dashboard

**Key Risks:**
- Conflict resolution for routes edited offline on multiple devices
- Data usage on metered satellite connections

---

### Phase 3: AIS + Alert Infrastructure (4 weeks)
**Goal:** AIS collision avoidance with cloud-based alerting

- [ ] AIVDM/AIVDO message parser
- [ ] AIS target database with track history
- [ ] Target display (oriented triangles, COG vectors)
- [ ] CPA/TCPA calculation engine
- [ ] Configurable alarm thresholds
- [ ] Target list with filtering/sorting
- [ ] **Cloud**: Alert engine for boundary breaches, anchor drag
- [ ] **Cloud**: Push notification delivery (SMS/email)
- [ ] **Cloud**: Alert configuration UI (web dashboard)

**Deliverable:** AIS awareness + remote alerts to shore contacts

**Key Risks:**
- Alert delivery reliability via satellite
- False positive rate for anchor drag detection

---

### Phase 4: Weather + Voyage Logging (4 weeks)
**Goal:** GRIB visualization and voyage recording with cloud backup

- [ ] GRIB1 and GRIB2 parser (Rust)
- [ ] Wind barb rendering layer (deck.gl)
- [ ] Pressure isobars, wave visualization
- [ ] Timeline animation with slider
- [ ] Automatic position/instrument logging
- [ ] Manual event log entry interface
- [ ] **Cloud**: Telemetry archival (all logged data synced)
- [ ] **Cloud**: Voyage playback from cloud storage
- [ ] **Cloud**: "Black box" incident reconstruction capability

**Deliverable:** Weather display + complete voyage history in cloud

**Key Risks:**
- Storage costs for high-frequency telemetry
- GRIB parsing edge cases across models

---

### Phase 5: Vortex Command Integration (3 weeks)
**Goal:** Hub integration with Signal K

- [ ] Signal K client implementation
- [ ] TimescaleDB telemetry storage (on Command device)
- [ ] WebSocket real-time data stream
- [ ] Instrument dashboard widgets
- [ ] Unified sync: Scout ↔ Command ↔ Cloud
- [ ] Connection status and automatic failover

**Deliverable:** Full data pipeline: Instruments → Command → Scout → Cloud

**Key Risks:**
- Signal K schema variations between installations
- Three-tier sync complexity

---

### Phase 6: Polish, Hardening & Beta (4 weeks)
**Goal:** Production-ready for beta cruisers

- [ ] Comprehensive touch gesture refinement
- [ ] Performance optimization profiling
- [ ] Error handling and graceful recovery
- [ ] Offline mode resilience testing (weeks without connectivity)
- [ ] User documentation (quick start, troubleshooting)
- [ ] Linux installer (.deb package)
- [ ] Crash reporting and diagnostics
- [ ] Beta user onboarding and feedback collection

**Deliverable:** Beta release for 10-20 early adopter vessels

**Total Timeline: ~27 weeks (6-7 months)**

---

### Post-MVP Roadmap

| Phase | Scope | Timeline |
|-------|-------|----------|
| **v1.1** | S-63 encrypted chart support (begin OEM certification) | +3-6 months |
| **v1.2** | Windows/macOS ports | +2-3 months |
| **v1.3** | Weather routing optimization | +2 months |
| **v1.4** | Radar overlay integration | +3 months |
| **v2.0** | Mobile companion app (iOS/Android) | +6 months |

---

## 8. Key Unknowns & Validation Plan

### 8.1 Technical Validation Required

| Unknown | Risk Level | Validation Approach | Timeline |
|---------|------------|---------------------|----------|
| MapLibre GL JS performance on Vortex Scout hardware | **High** | Build prototype, benchmark with 1000+ tiles | Phase 0, Week 2 |
| S-57 parsing performance | **High** | Test with NOAA ENC catalog, measure load times | Phase 1, Week 1 |
| MBTiles serving at scale | **Medium** | Load test with 40GB chart database | Phase 0, Week 3 |
| Touch responsiveness at 60fps | **High** | Profile on target hardware, optimize gestures | Phase 1, Week 4 |
| TimescaleDB on ARM (Command) | **Medium** | Benchmark insert/query on Raspberry Pi 4 | Phase 6, Week 1 |
| WebView memory usage | **Medium** | Profile under extended operation (24h) | Phase 7, Week 1 |
| Tauri IPC overhead | **Low** | Measure Rust-JS round-trip latency | Phase 0, Week 1 |

### 8.2 Product Validation Required

| Unknown | Validation Approach | Timeline |
|---------|---------------------|----------|
| Touch UX for offshore conditions | User testing with wet/gloved hands | Phase 7 |
| Day/night color scheme effectiveness | Field testing at sea | Phase 7 |
| Alarm audibility in cockpit | Field testing with engine noise | Phase 3 |
| GRIB download via satellite link | Test with Iridium GO, Starlink | Phase 4 |
| Storage budget adequacy (64GB) | Analyze cruiser chart/region needs | Phase 1 |

### 8.3 Business/Legal Validation Required

| Unknown | Validation Approach | Timeline |
|---------|---------------------|----------|
| Esri offline redistribution terms | Direct contact with Esri licensing | Immediate |
| S-63 OEM certification requirements | Contact IHO, review process | Phase 1 |
| Planet pricing for coastal coverage | Sales engagement | Phase 0 |
| Insurance implications of non-SOLAS software | Marine insurance consultation | Before launch |

---

## 9. Immediate Next Steps (First 10 Tasks)

**Week 1-2 Sprint:**

1. **Create Tauri 2.0 project scaffold** with Rust backend and TypeScript frontend (Ubuntu/Linux target)
2. **Integrate MapLibre GL JS** and verify WebGL rendering on Ubuntu/Vortex Scout hardware
3. **Design cloud sync protocol** - define gRPC/WebSocket message schemas for position, routes, alerts
4. **Set up cloud backend skeleton** - Rust/Actix API with authentication (JWT/OAuth2)
5. **Provision cloud infrastructure** - TimescaleDB instance, API hosting, notification service accounts

**Week 2-3 Sprint:**

6. **Implement MBTiles reader** in Rust with tile serving endpoint
7. **Build NMEA 0183 parser** for GPS (RMC, GGA) and basic instruments
8. **Create SQLite schema** for configuration, routes, waypoints, and sync queue
9. **Evaluate S-57 parsing libraries** - test [s57tiler](https://github.com/nickovs/s57tiler) or similar, avoid custom implementation
10. **Benchmark MapLibre performance** with large MBTiles dataset on target hardware

**Parallel Business Tasks:**

- **Contact Esri** regarding Vortex Horizon offline satellite imagery licensing
- **Define beta program criteria** - identify 10-20 vessels for Phase 6 beta
- **Establish satellite connectivity test plan** - procure Iridium GO or Starlink for sync testing

---

## Sources

### OpenCPN Research
- [OpenCPN Official Site](https://opencpn.org/)
- [OpenCPN GitHub](https://github.com/OpenCPN/OpenCPN)
- [OpenCPN Chart Formats](https://opencpn.org/wiki/dokuwiki/doku.php?id=opencpn:manual_advanced:charts:formats)
- [OpenCPN Problems Discussion - Cruisers Forum](https://www.cruisersforum.com/forums/f134/opencpn-problems-and-limitations-192355.html)
- [OpenCPN Architecture Issues - GitHub](https://github.com/OpenCPN/OpenCPN/issues/2354)

### Satellite Imagery
- [Sentinel-2 - Wikipedia](https://en.wikipedia.org/wiki/Sentinel-2)
- [Copernicus Data Space](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-data/sentinel-2)
- [SentinelMap](https://www.sentinelmap.eu/)
- [Esri Basemaps](https://www.esri.com/en-us/arcgis/products/arcgis-location-platform/services/basemaps)
- [Planet Maritime](https://www.planet.com/industries/maritime/)
- [Planet Pricing](https://www.planet.com/pricing/)

### Marine Data Sources
- [OpenSeaMap](https://map.openseamap.org/)
- [NOAA ENC](https://www.nauticalcharts.noaa.gov/charts/noaa-enc.html)
- [GEBCO Bathymetry](https://www.gebco.net/data-products/gridded-bathymetry-data)
- [NOAA Tides & Currents API](https://api.tidesandcurrents.noaa.gov/api/prod/)
- [OpenGribs](https://opengribs.org/en/gribs)
- [GFS Model - LuckGrib](https://luckgrib.com/models/gfs/)

### Technical Architecture
- [Signal K Overview](https://signalk.org/overview/)
- [Signal K GitHub](https://github.com/signalk/specification)
- [MapLibre GL JS](https://maplibre.org/)
- [MapLibre Native](https://github.com/maplibre/maplibre-native)
- [deck.gl with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre)
- [Tauri 2.0](https://v2.tauri.app/)
- [Time Series DB Comparison Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7302557/)

### AIS & Data Protocols
- [AIVDM Protocol Decoding](https://gpsd.gitlab.io/gpsd/AIVDM.html)
- [pyais - Python AIS Library](https://github.com/M0r13n/pyais)
- [S-63 Encryption Standard](https://en.wikipedia.org/wiki/S-63_(encryption_standard))
- [IHO S-63 FAQ](https://iho.int/en/s-63-faq)

---

*Document version: 1.0*
*Created: 2026-01-24*
*Author: VortexNav Planning Team*
