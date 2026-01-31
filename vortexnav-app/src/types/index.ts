// VortexNav Type Definitions

export type ThemeMode = 'day' | 'dusk' | 'night';

export type BasemapProvider =
  | 'none'
  | 'osm'
  | 'opentopomap'
  | 'google-satellite-free'
  | 'google-hybrid-free'
  | 'esri-satellite'
  | 'esri-ocean'
  | 'sentinel-2'
  | 'bing-satellite'
  | 'mapbox-satellite'
  | 'here-satellite';

export interface Position {
  lat: number;
  lon: number;
}

export interface Vessel {
  position: Position | null;
  heading: number | null;
  cog: number | null; // Course Over Ground
  sog: number | null; // Speed Over Ground (knots)
}

export interface MapState {
  center: Position;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface ApiKeys {
  esri?: string;    // ArcGIS Location Platform API key
  mapbox?: string;  // Mapbox access token
  here?: string;    // HERE API key
}

export interface AppSettings {
  theme: ThemeMode;
  basemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
}

export interface AppState {
  settings: AppSettings;
  vessel: Vessel;
  map: MapState;
  connected: boolean;
}

// Basemap metadata for UI display
export interface BasemapOption {
  id: BasemapProvider;
  name: string;
  description: string;
  requiresApiKey?: 'esri' | 'mapbox' | 'here';
  offline: boolean;
  /** Whether this basemap can be downloaded for offline use.
   * Some providers (Google, Bing) prohibit tile caching in their ToS. */
  downloadable: boolean;
}

export const BASEMAP_OPTIONS: BasemapOption[] = [
  {
    id: 'none',
    name: 'None',
    description: 'No basemap - show only chart layers',
    offline: true,
    downloadable: false,
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    description: 'Standard street map',
    offline: true,
    downloadable: true,
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    description: 'Topographic map with terrain',
    offline: true,
    downloadable: true,
  },
  {
    id: 'google-satellite-free',
    name: 'Google Satellite',
    description: 'Satellite imagery (no API key required)',
    offline: false,
    downloadable: false, // Google ToS prohibits tile caching
  },
  {
    id: 'google-hybrid-free',
    name: 'Google Hybrid',
    description: 'Satellite with labels (no API key required)',
    offline: false,
    downloadable: false, // Google ToS prohibits tile caching
  },
  {
    id: 'esri-satellite',
    name: 'Esri World Imagery',
    description: 'High-resolution satellite (requires API key)',
    requiresApiKey: 'esri',
    offline: false,
    downloadable: true,
  },
  {
    id: 'esri-ocean',
    name: 'Esri Ocean Basemap',
    description: 'Ocean-focused with bathymetry (requires API key)',
    requiresApiKey: 'esri',
    offline: false,
    downloadable: true,
  },
  {
    id: 'sentinel-2',
    name: 'Sentinel-2 Cloudless',
    description: 'ESA Sentinel-2 satellite mosaic (10m resolution)',
    offline: false,
    downloadable: true,
  },
  {
    id: 'bing-satellite',
    name: 'Bing Satellite',
    description: 'Microsoft Bing aerial imagery',
    offline: false,
    downloadable: false, // Bing ToS prohibits tile caching
  },
  {
    id: 'mapbox-satellite',
    name: 'Mapbox Satellite',
    description: 'High-resolution satellite (requires API key)',
    requiresApiKey: 'mapbox',
    offline: false,
    downloadable: false, // Mapbox ToS restricts offline caching
  },
  {
    id: 'here-satellite',
    name: 'HERE Satellite',
    description: 'HERE aerial imagery (requires API key)',
    requiresApiKey: 'here',
    offline: false,
    downloadable: false, // HERE ToS restricts offline caching
  },
];

/** Get basemaps that can be downloaded for offline use */
export const DOWNLOADABLE_BASEMAPS = BASEMAP_OPTIONS.filter(b => b.downloadable);

/** Check if a basemap can be downloaded for offline use */
export function isBasemapDownloadable(basemapId: BasemapProvider): boolean {
  const basemap = BASEMAP_OPTIONS.find(b => b.id === basemapId);
  return basemap?.downloadable ?? false;
}

// MBTiles metadata from backend
export interface MBTilesMetadata {
  name: string | null;
  format: string | null;
  bounds: string | null;
  center: string | null;
  minzoom: number | null;
  maxzoom: number | null;
  description: string | null;
}

// Chart info returned from list_charts
export interface ChartInfo {
  id: string;
  name: string;
  path: string;
  metadata: MBTilesMetadata;
}

// Chart layer state for persistence
export interface ChartLayerState {
  chartId: string;
  enabled: boolean;
  opacity: number;
  zOrder: number;
}

// Chart custom metadata - user-editable overrides
export interface ChartCustomMetadata {
  chart_id: string;
  custom_name: string | null;
  custom_description: string | null;
  custom_min_zoom: number | null;
  custom_max_zoom: number | null;
}

// Full chart layer with chart info and state combined
export interface ChartLayer {
  id: string;
  chartId: string;
  name: string;
  type: 'raster' | 'vector';
  format: string;
  enabled: boolean;
  opacity: number;
  zOrder: number;
  bounds?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat] - for MapLibre source (undefined for antimeridian-crossing)
  zoomBounds?: [number, number, number, number]; // Bounds for zoom-to functionality (handles antimeridian)
  minZoom?: number;
  maxZoom?: number;
  rawBoundsString?: string; // Original bounds string from metadata
  // Custom metadata overrides
  description?: string;
  customName?: string;
  customDescription?: string;
  customMinZoom?: number;
  customMaxZoom?: number;
}

// ============ Catalog Types ============

// Chart catalog (imported from XML)
export interface ChartCatalog {
  id: number | null;
  name: string;
  catalog_type: 'RNC' | 'ENC';
  source_type: 'file' | 'url';
  source_path: string;
  imported_at: string | null;
  last_refreshed: string | null;
  chart_count: number | null;
}

// Download status for catalog charts
export type DownloadStatus =
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'converting'
  | 'ready'
  | 'needs_conversion'
  | 'failed';

// Chart available in a catalog
export interface CatalogChart {
  id: number | null;
  catalog_id: number;
  chart_id: string;
  title: string;
  chart_type: 'RNC' | 'ENC';
  format: string | null;
  scale: number | null;
  status: string | null;
  download_url: string;
  file_size: number | null;
  last_updated: string | null;
  bounds: string | null;
  download_status: DownloadStatus;
  download_progress: number;
  download_path: string | null;
  mbtiles_path: string | null;
  error_message: string | null;
}

// Download progress info
export interface DownloadProgress {
  chartId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: 'pending' | 'downloading' | 'extracting' | 'converting' | 'complete' | 'error';
  error?: string;
}

// GDAL availability info
export interface GdalInfo {
  available: boolean;
  version: string | null;
  gdal_translate_path: string | null;
  ogr2ogr_path: string | null;
  install_hint: string | null;
}

// Command result wrapper from backend
export interface CommandResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// Result of importing charts from a folder
export interface FolderImportResult {
  total_found: number;
  converted: number;
  failed: number;
  skipped: number;
  imported_charts: ChartInfo[];
  errors: string[];
}

// Progress update during folder import
export interface ImportProgress {
  phase: 'scanning' | 'converting' | 'complete';
  current: number;
  total: number;
  current_file: string;
  converted: number;
  skipped: number;
  failed: number;
}

// Information about a scanned chart file (before import)
export interface ScannedChartFile {
  path: string;
  name: string;
  extension: string;
  size_bytes: number;
  parent_folder: string;
  already_imported: boolean;
}

// Result of scanning a folder for chart files
export interface ScanFolderResult {
  files: ScannedChartFile[];
  total_count: number;
  already_imported_count: number;
}

// Result of tagging charts with BSB metadata
export interface TagResult {
  total_bsb_files: number;
  total_mappings: number;
  charts_updated: number;
  charts_not_found: number;
  errors: string[];
}

// Result of fixing chart bounds
export interface FixBoundsResult {
  charts_checked: number;
  charts_already_had_bounds: number;
  charts_updated: number;
  charts_kap_not_found: number;
  charts_bounds_failed: number;
  errors: string[];
}

// ============ Waypoint Management Types ============

// Form data for creating/editing waypoints
export interface WaypointFormData {
  name: string;
  lat: string;  // String for form input handling
  lon: string;  // String for form input handling
  description: string;
  symbol: string;
  showLabel: boolean;  // Whether to show label on map
}

// Edit state for waypoint management
export type WaypointEditStatus = 'idle' | 'creating' | 'editing' | 'saving';

export interface WaypointEditState {
  status: WaypointEditStatus;
  waypointId: number | null;
  formData: WaypointFormData | null;
  isDirty: boolean;
  error: string | null;
}

// Dragging state for waypoint markers
export interface WaypointDraggingState {
  id: number;
  lat: number;
  lon: number;
}

// Note: WaypointManagerState is defined in useWaypointManager.ts
// to avoid circular imports with the Waypoint type from useTauri.ts

// ============ GEBCO Bathymetry Types ============

// GEBCO data availability status
export interface GebcoStatus {
  dem_available: boolean;
  hillshade_available: boolean;  // Pre-rendered hillshade (alternative to DEM)
  color_available: boolean;
  contours_available: boolean;
  dem_path: string | null;
  dem_size_bytes: number | null;
}

// GEBCO visualization settings
export interface GebcoSettings {
  show_hillshade: boolean;
  show_color: boolean;
  show_contours: boolean;
  hillshade_opacity: number;
  color_opacity: number;
  contour_interval: number;  // meters: 10, 50, 100, 500, 1000
}

// Default GEBCO settings (OFF by default - nautical chart provides depth data)
export const DEFAULT_GEBCO_SETTINGS: GebcoSettings = {
  show_hillshade: false,
  show_color: false,
  show_contours: false,
  hillshade_opacity: 0.3,
  color_opacity: 0.5,
  contour_interval: 100,
};

// Contour interval options for UI
export const CONTOUR_INTERVALS = [
  { value: 10, label: '10m' },
  { value: 50, label: '50m' },
  { value: 100, label: '100m' },
  { value: 500, label: '500m' },
  { value: 1000, label: '1000m' },
] as const;

// ============ Nautical Chart Types (Consolidated UI) ============
// These types are used by the frontend UI - combines CM93 vector data under "Nautical Chart" name
// Backend still uses Cm93Settings/Cm93Status for API compatibility

// Nautical Chart status (frontend-facing, wraps Cm93Status)
export interface NauticalChartStatus {
  initialized: boolean;
  availableScales: string[];  // ['Z', 'A', 'B', 'C', 'D', 'E', 'F', 'G']
  dataPath: string | null;
}

// Nautical Chart settings (frontend-facing, wraps Cm93Settings)
export interface NauticalChartSettings {
  enabled: boolean;
  opacity: number;
  showSoundings: boolean;
  showDepthContours: boolean;
  showLights: boolean;
  showBuoys: boolean;
  showLand: boolean;
  showObstructions: boolean;
  dataPath: string | null;
}

// Default nautical chart settings (all features ON for marine professionals)
export const DEFAULT_NAUTICAL_SETTINGS: NauticalChartSettings = {
  enabled: true,
  opacity: 1.0,
  showSoundings: true,
  showDepthContours: true,
  showLights: true,
  showBuoys: true,
  showLand: true,
  showObstructions: true,
  dataPath: null,
};

// ============ Base Nautical Chart Types (Legacy - kept for backend compatibility) ============

// Base nautical chart availability status
export interface BaseNauticalStatus {
  available: boolean;
  path: string | null;
  size_bytes: number | null;
}

// Base nautical chart settings
export interface BaseNauticalSettings {
  enabled: boolean;
  opacity: number;
}

// Default base nautical chart settings
export const DEFAULT_BASE_NAUTICAL_SETTINGS: BaseNauticalSettings = {
  enabled: true,
  opacity: 0.8,
};

// ============ CM93 Vector Chart Types (Backend API - internal use) ============

// CM93 server status
export interface Cm93Status {
  initialized: boolean;
  available_scales: string[];  // ['Z', 'A', 'B', 'C', 'D', 'E', 'F', 'G']
  path: string | null;
}

// GeoJSON tile response from CM93 server
export interface GeoJsonTile {
  type: string;  // "FeatureCollection"
  features: GeoJsonFeature[];
  tileInfo: TileInfo;
}

// GeoJSON feature
export interface GeoJsonFeature {
  type: string;  // "Feature"
  geometry: GeoJsonGeometry;
  properties: GeoJsonProperties;
}

// GeoJSON geometry
export interface GeoJsonGeometry {
  type: string;  // "Point", "LineString", "Polygon"
  coordinates: number[] | number[][] | number[][][];
}

// Feature properties with S57/CM93 attributes
export interface GeoJsonProperties {
  objClass: number;       // S57 object class code
  objAcronym: string;     // S57 acronym (e.g., "SOUNDG", "LIGHTS")
  objName: string;        // Human-readable name
  geomType: string;       // "Point", "Line", "Polygon"
  layer: string;          // Styling layer (e.g., "soundings", "lights")
  depth?: number;         // Depth value for soundings/contours
  name?: string;          // Object name from chart
  color?: string;         // Color attribute
  [key: string]: unknown; // Additional attributes
}

// Tile metadata
export interface TileInfo {
  z: number;
  x: number;
  y: number;
  scale: string;  // CM93 scale character
}

// CM93 visualization settings (matches Rust Cm93Settings)
export interface Cm93Settings {
  enabled: boolean;
  opacity: number;
  showSoundings: boolean;
  showDepthContours: boolean;
  showLights: boolean;
  showBuoys: boolean;
  showLand: boolean;
  showObstructions: boolean;
  cm93Path: string | null;
}

// Backend format for CM93 settings (snake_case)
export interface Cm93SettingsBackend {
  enabled: boolean;
  opacity: number;
  show_soundings: boolean;
  show_depth_contours: boolean;
  show_lights: boolean;
  show_buoys: boolean;
  show_land: boolean;
  show_obstructions: boolean;
  cm93_path: string | null;
}

// Default CM93 settings
export const DEFAULT_CM93_SETTINGS: Cm93Settings = {
  enabled: true,
  opacity: 1.0,
  showSoundings: true,
  showDepthContours: true,
  showLights: true,
  showBuoys: true,
  showLand: true,
  showObstructions: true,
  cm93Path: null,
};

// ============ Route Management Types ============

// Core route data (matches Rust Route struct)
export interface Route {
  id: number | null;
  name: string;
  description: string | null;
  color: string | null;  // Route line color (hex, e.g., '#c026d3')
  is_active: boolean;    // Currently navigating this route
  hidden: boolean;       // Route visibility: true = hidden, false = visible
  total_distance_nm: number | null;  // Cached total distance
  estimated_speed_kn: number;  // For ETA calculations (default 5.0)
  created_at: string | null;
  updated_at: string | null;
}

// Route tag for categorization
export interface RouteTag {
  id: number | null;
  name: string;
  color: string | null;  // Tag badge color
  created_at: string | null;
}

// Route with associated waypoints and tags
export interface RouteWithWaypoints {
  route: Route;
  waypoints: Waypoint[];
  tags: RouteTag[];
}

// Route statistics calculated from waypoints
export interface RouteStatistics {
  total_distance_nm: number;
  waypoint_count: number;
  estimated_time_hours: number;
  leg_distances: number[];  // Distance between consecutive waypoints
  leg_bearings: number[];   // Bearing from each waypoint to next
}

// Waypoint type (imported from useTauri but defined here for route context)
export interface Waypoint {
  id: number | null;
  name: string;
  lat: number;
  lon: number;
  description: string | null;
  symbol: string | null;
  show_label: boolean;
  hidden: boolean;
  created_at: string | null;
}

// Edit state for route management
export type RouteEditStatus = 'idle' | 'creating' | 'editing' | 'selecting_waypoints' | 'saving';

export interface RouteEditState {
  status: RouteEditStatus;
  routeId: number | null;
  formData: RouteFormData | null;
  selectedWaypointIds: number[];
  selectedTagIds: number[];
  isDirty: boolean;
  error: string | null;
}

// Form data for creating/editing routes
export interface RouteFormData {
  name: string;
  description: string;
  color: string;
  estimated_speed_kn: string;  // String for form input handling
}

// Map creation mode state (for drawing routes on map)
export interface RouteCreationModeState {
  active: boolean;
  routeName: string;
  tempWaypoints: TempWaypoint[];
}

// Temporary waypoint during route creation on map
export interface TempWaypoint {
  id: string;  // Temporary client-side ID (e.g., 'temp-1')
  name: string;
  lat: number;
  lon: number;
}

// Sorting options for route list
export type RouteSortOption = 'name' | 'date' | 'distance' | 'waypoints';
export type RouteSortDirection = 'asc' | 'desc';

// Filter state for route library
export interface RouteFilterState {
  searchQuery: string;
  selectedTagIds: number[];
  sortBy: RouteSortOption;
  sortDirection: RouteSortDirection;
}

// Default filter state
export const DEFAULT_ROUTE_FILTER: RouteFilterState = {
  searchQuery: '',
  selectedTagIds: [],
  sortBy: 'date',
  sortDirection: 'desc',
};

// Marine-appropriate route colors
export interface RouteColorOption {
  id: string;
  name: string;
}

export const ROUTE_COLORS: RouteColorOption[] = [
  { id: '#c026d3', name: 'Magenta' },   // Standard course line (IMO)
  { id: '#ef4444', name: 'Red' },       // Danger/caution
  { id: '#f97316', name: 'Orange' },    // Alternative route
  { id: '#22c55e', name: 'Green' },     // Safe passage
  { id: '#3b82f6', name: 'Blue' },      // Ocean crossing
  { id: '#8b5cf6', name: 'Purple' },    // Historic/favorite
  { id: '#06b6d4', name: 'Cyan' },      // Coastal
  { id: '#eab308', name: 'Yellow' },    // Caution/review
];

// Default route color (magenta - IMO standard for course lines)
export const DEFAULT_ROUTE_COLOR = '#c026d3';

// Default tags for new installations
export const DEFAULT_ROUTE_TAGS: Omit<RouteTag, 'id' | 'created_at'>[] = [
  { name: 'Favorites', color: '#eab308' },
  { name: 'Coastal', color: '#06b6d4' },
  { name: 'Ocean Crossing', color: '#3b82f6' },
  { name: 'Harbor Entry', color: '#22c55e' },
  { name: 'Anchorage Approach', color: '#8b5cf6' },
  { name: 'Emergency', color: '#ef4444' },
  { name: 'Historic', color: '#f97316' },
];

// GPX import result
export interface GpxImportResult {
  routes_imported: number;
  waypoints_imported: number;
  tracks_imported: number;
  errors: string[];
}

// Route summary for sharing
export interface RouteSummary {
  name: string;
  description: string | null;
  waypoint_count: number;
  total_distance_nm: number;
  estimated_time_hours: number;
  waypoints: Array<{
    name: string;
    lat: number;
    lon: number;
    leg_distance_nm: number | null;
    leg_bearing: number | null;
  }>;
}

// ============ Track Recording Types ============

// Core track data (matches Rust Track struct)
export interface Track {
  id: number | null;
  name: string;
  description: string | null;
  color: string | null;  // Track line color (hex, e.g., '#06b6d4')
  is_recording: boolean;
  started_at: string | null;
  ended_at: string | null;
  total_distance_nm: number | null;
  point_count: number;
  hidden: boolean;
  created_at: string | null;
}

// Track point (position in a recorded track)
export interface TrackPoint {
  id: number | null;
  track_id: number;
  lat: number;
  lon: number;
  timestamp: string;
  sequence: number;
  heading: number | null;
  cog: number | null;
  sog: number | null;
}

// Track with all its points
export interface TrackWithPoints {
  track: Track;
  points: TrackPoint[];
}

// Edit state for track management
export type TrackEditStatus = 'idle' | 'editing' | 'saving';

export interface TrackEditState {
  status: TrackEditStatus;
  trackId: number | null;
  formData: TrackFormData | null;
  isDirty: boolean;
  error: string | null;
}

// Form data for editing tracks
export interface TrackFormData {
  name: string;
  description: string;
  color: string;
}

// Recording state for the track manager
export interface RecordingState {
  isRecording: boolean;
  trackId: number | null;
  pointCount: number;
  distance: number;
  startedAt: string | null;
}

// Sorting options for track list
export type TrackSortOption = 'name' | 'date' | 'distance' | 'points';
export type TrackSortDirection = 'asc' | 'desc';

// Filter state for track list
export interface TrackFilterState {
  searchQuery: string;
  sortBy: TrackSortOption;
  sortDirection: TrackSortDirection;
}

// Default filter state
export const DEFAULT_TRACK_FILTER: TrackFilterState = {
  searchQuery: '',
  sortBy: 'date',
  sortDirection: 'desc',
};

// Track colors (same as route but with cyan as default)
export const TRACK_COLORS = [
  { id: '#06b6d4', name: 'Cyan' },      // Default for tracks
  { id: '#c026d3', name: 'Magenta' },
  { id: '#ef4444', name: 'Red' },
  { id: '#f97316', name: 'Orange' },
  { id: '#22c55e', name: 'Green' },
  { id: '#3b82f6', name: 'Blue' },
  { id: '#8b5cf6', name: 'Purple' },
  { id: '#eab308', name: 'Yellow' },
];

// Default track color (cyan - distinct from magenta routes)
export const DEFAULT_TRACK_COLOR = '#06b6d4';

// Recording interval in milliseconds (5 seconds)
export const TRACK_RECORDING_INTERVAL = 5000;

// Minimum movement in meters before recording a new point
export const TRACK_MIN_MOVEMENT_METERS = 5;

// ============ Download Area (Offline Pack) Types ============

// Area of Interest bounds for offline downloads
export interface AOIBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

// Polygon point for user-drawn areas
export interface PolygonPoint {
  lat: number;
  lon: number;
}

// Download area configuration
export interface DownloadAreaConfig {
  name: string;
  bounds: AOIBounds;
  polygonPoints: PolygonPoint[];
  minZoom: number;
  maxZoom: number;
  basemapId: string;
}

// Tile estimate returned from backend
export interface TileEstimate {
  tileCount: number;
  estimatedSizeBytes: number;
}

// Download area state
export interface DownloadAreaState {
  isDrawing: boolean;
  isConfiguring: boolean;
  polygonPoints: PolygonPoint[];
  bounds: AOIBounds | null;
  downloadName: string;
  minZoom: number;
  maxZoom: number;
  estimatedTileCount: number;
  estimatedSizeBytes: number;
  isDownloading: boolean;
  downloadProgress: number;
  error: string | null;
}

// Download area edit status
export type DownloadAreaStatus = 'idle' | 'drawing' | 'configuring' | 'downloading';

// Validation limits for downloads
export const DOWNLOAD_AREA_LIMITS = {
  MIN_BOUNDS_DEGREES: 0.001,
  WARNING_TILE_COUNT: 50000,
  MAX_TILE_COUNT: 200000,
  DEFAULT_MIN_ZOOM: 6,
  DEFAULT_MAX_ZOOM: 14,
} as const;

// Average tile size estimates by provider (bytes)
export const TILE_SIZE_ESTIMATES: Record<string, number> = {
  osm: 25000,
  'google-satellite-free': 45000,
  'google-hybrid-free': 50000,
  'esri-satellite': 40000,
  default: 30000,
};
