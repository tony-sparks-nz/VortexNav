// VortexNav Type Definitions

export type ThemeMode = 'day' | 'dusk' | 'night';

export type BasemapProvider =
  | 'osm'
  | 'opentopomap'
  | 'google-satellite-free'
  | 'google-hybrid-free'
  | 'esri-satellite'
  | 'esri-ocean';

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
  requiresApiKey?: 'esri';
  offline: boolean;
}

export const BASEMAP_OPTIONS: BasemapOption[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    description: 'Standard street map',
    offline: true,
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    description: 'Topographic map with terrain',
    offline: true,
  },
  {
    id: 'google-satellite-free',
    name: 'Google Satellite',
    description: 'Satellite imagery (no API key required)',
    offline: false,
  },
  {
    id: 'google-hybrid-free',
    name: 'Google Hybrid',
    description: 'Satellite with labels (no API key required)',
    offline: false,
  },
  {
    id: 'esri-satellite',
    name: 'Esri World Imagery',
    description: 'High-resolution satellite (requires API key)',
    requiresApiKey: 'esri',
    offline: false,
  },
  {
    id: 'esri-ocean',
    name: 'Esri Ocean Basemap',
    description: 'Ocean-focused with bathymetry (requires API key)',
    requiresApiKey: 'esri',
    offline: false,
  },
];

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
  bounds?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  minZoom?: number;
  maxZoom?: number;
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
