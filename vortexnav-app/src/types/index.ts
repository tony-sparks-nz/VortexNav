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
