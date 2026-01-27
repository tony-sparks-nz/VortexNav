// Tauri command bindings for VortexNav

import { invoke } from '@tauri-apps/api/core';
import type { ApiKeys, ThemeMode, BasemapProvider, GebcoStatus, GebcoSettings, BaseNauticalStatus, BaseNauticalSettings, Cm93Status, GeoJsonTile, Cm93Settings, Cm93SettingsBackend, Route, RouteTag, RouteWithWaypoints, RouteStatistics, GpxImportResult, Track, TrackPoint, TrackWithPoints } from '../types';

// ============ Response Types ============

interface CommandResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// Backend settings structure (matches Rust)
export interface BackendSettings {
  theme: string;
  basemap: string;
  show_openseamap: boolean;
  esri_api_key: string | null;
  last_lat: number | null;
  last_lon: number | null;
  last_zoom: number | null;
}

// Individual satellite information
export interface SatelliteInfo {
  prn: number;
  elevation: number | null;
  azimuth: number | null;
  snr: number | null;
  constellation: string;
}

// GPS data from NMEA parser
export interface GpsData {
  latitude: number | null;
  longitude: number | null;
  speed_knots: number | null;
  course: number | null;
  heading: number | null;
  altitude: number | null;
  fix_quality: number | null;
  satellites: number | null;
  hdop: number | null;
  vdop: number | null;
  pdop: number | null;
  timestamp: string | null;
  fix_type: string | null;
  satellites_info: SatelliteInfo[];
}

// GPS source types
export type GpsSourceType = 'serial_port' | 'tcp_stream' | 'simulated';

// GPS connection status
export type GpsConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'receiving_data'
  | 'error';

// Detected serial port
export interface DetectedPort {
  port_name: string;
  port_type: string;
  manufacturer: string | null;
  product: string | null;
  serial_number: string | null;
  is_likely_gps: boolean;
}

// GPS source configuration
export interface GpsSourceConfig {
  id: string;
  name: string;
  source_type: GpsSourceType;
  port_name: string | null;
  baud_rate: number;
  enabled: boolean;
  priority: number;
}

// GPS source status
export interface GpsSourceStatus {
  source_id: string | null;
  source_name: string | null;
  status: GpsConnectionStatus;
  last_error: string | null;
  sentences_received: number;
  last_fix_time: string | null;
}

// Waypoint definition
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

// MBTiles metadata
export interface MBTilesMetadata {
  name: string | null;
  format: string | null;
  bounds: string | null;
  center: string | null;
  minzoom: number | null;
  maxzoom: number | null;
  description: string | null;
}

// Chart info
export interface ChartInfo {
  id: string;
  name: string;
  path: string;
  metadata: MBTilesMetadata;
}

// ============ Settings Commands ============

export async function getSettings(): Promise<BackendSettings> {
  const result = await invoke<CommandResult<BackendSettings>>('get_settings');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get settings');
  }
  return result.data;
}

export async function saveSettings(settings: BackendSettings): Promise<void> {
  const result = await invoke<CommandResult<null>>('save_settings', { settings });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save settings');
  }
}

// Convert frontend settings to backend format
export function toBackendSettings(
  theme: ThemeMode,
  basemap: BasemapProvider,
  showOpenSeaMap: boolean,
  apiKeys: ApiKeys,
  lastLat?: number,
  lastLon?: number,
  lastZoom?: number
): BackendSettings {
  return {
    theme,
    basemap,
    show_openseamap: showOpenSeaMap,
    esri_api_key: apiKeys.esri || null,
    last_lat: lastLat ?? null,
    last_lon: lastLon ?? null,
    last_zoom: lastZoom ?? null,
  };
}

// Convert backend settings to frontend format
export function fromBackendSettings(settings: BackendSettings): {
  theme: ThemeMode;
  basemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
  lastPosition: { lat: number; lon: number } | null;
  lastZoom: number | null;
} {
  return {
    theme: settings.theme as ThemeMode,
    basemap: settings.basemap as BasemapProvider,
    showOpenSeaMap: settings.show_openseamap,
    apiKeys: {
      esri: settings.esri_api_key || undefined,
    },
    lastPosition:
      settings.last_lat != null && settings.last_lon != null
        ? { lat: settings.last_lat, lon: settings.last_lon }
        : null,
    lastZoom: settings.last_zoom,
  };
}

// ============ GEBCO Bathymetry Commands ============

/**
 * Get GEBCO bathymetry data availability status
 */
export async function getGebcoStatus(): Promise<GebcoStatus> {
  const result = await invoke<CommandResult<GebcoStatus>>('get_gebco_status');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get GEBCO status');
  }
  return result.data;
}

/**
 * Get GEBCO visualization settings
 */
export async function getGebcoSettings(): Promise<GebcoSettings> {
  const result = await invoke<CommandResult<GebcoSettings>>('get_gebco_settings');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get GEBCO settings');
  }
  return result.data;
}

/**
 * Save GEBCO visualization settings
 */
export async function saveGebcoSettings(settings: GebcoSettings): Promise<void> {
  const result = await invoke<CommandResult<null>>('save_gebco_settings', { settings });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save GEBCO settings');
  }
}

// ============ Base Nautical Chart Commands ============

/**
 * Get base nautical chart availability status
 */
export async function getBaseNauticalStatus(): Promise<BaseNauticalStatus> {
  const result = await invoke<CommandResult<BaseNauticalStatus>>('get_base_nautical_status');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get base nautical chart status');
  }
  return result.data;
}

/**
 * Get base nautical chart settings
 */
export async function getBaseNauticalSettings(): Promise<BaseNauticalSettings> {
  const result = await invoke<CommandResult<BaseNauticalSettings>>('get_base_nautical_settings');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get base nautical chart settings');
  }
  return result.data;
}

/**
 * Save base nautical chart settings
 */
export async function saveBaseNauticalSettings(settings: BaseNauticalSettings): Promise<void> {
  const result = await invoke<CommandResult<null>>('save_base_nautical_settings', { settings });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save base nautical chart settings');
  }
}

/**
 * CM93 conversion result
 */
export interface Cm93ConversionResult {
  success: boolean;
  output_path: string | null;
  tiles_rendered: number;
  error: string | null;
}

/**
 * Convert CM93 chart database to MBTiles base nautical chart
 * @param cm93Path - Path to the CM93 database directory
 * @returns Conversion result
 */
export async function convertCm93ToBaseNautical(cm93Path: string): Promise<Cm93ConversionResult> {
  const result = await invoke<CommandResult<Cm93ConversionResult>>('convert_cm93_to_base_nautical', { cm93Path });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to convert CM93 to base nautical chart');
  }
  return result.data;
}

// ============ CM93 Vector Chart Commands ============

/**
 * Initialize the CM93 vector chart server
 * @param path - Path to the CM93 database directory
 * @returns Server status
 */
export async function initCm93Server(path: string): Promise<Cm93Status> {
  const result = await invoke<CommandResult<Cm93Status>>('init_cm93_server', { path });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to initialize CM93 server');
  }
  return result.data;
}

/**
 * Get CM93 vector chart server status
 */
export async function getCm93Status(): Promise<Cm93Status> {
  const result = await invoke<CommandResult<Cm93Status>>('get_cm93_status');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get CM93 status');
  }
  return result.data;
}

/**
 * Get CM93 vector features as GeoJSON for a tile
 * @param z - Zoom level
 * @param x - Tile X coordinate
 * @param y - Tile Y coordinate
 * @returns GeoJSON FeatureCollection
 */
export async function getCm93Tile(z: number, x: number, y: number): Promise<GeoJsonTile> {
  const result = await invoke<CommandResult<GeoJsonTile>>('get_cm93_tile', { z, x, y });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get CM93 tile');
  }
  return result.data;
}

/**
 * Get CM93 vector features as GeoJSON for a bounding box
 * @param minLat - Minimum latitude
 * @param minLon - Minimum longitude
 * @param maxLat - Maximum latitude
 * @param maxLon - Maximum longitude
 * @param zoom - Zoom level (determines scale)
 * @returns GeoJSON FeatureCollection
 */
export async function getCm93Features(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  zoom: number
): Promise<GeoJsonTile> {
  const result = await invoke<CommandResult<GeoJsonTile>>('get_cm93_features', {
    minLat,
    minLon,
    maxLat,
    maxLon,
    zoom,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get CM93 features');
  }
  return result.data;
}

/**
 * Get CM93 visualization settings
 */
export async function getCm93Settings(): Promise<Cm93Settings> {
  const result = await invoke<CommandResult<Cm93SettingsBackend>>('get_cm93_settings');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get CM93 settings');
  }
  // Convert from backend snake_case to frontend camelCase
  return {
    enabled: result.data.enabled,
    opacity: result.data.opacity,
    showSoundings: result.data.show_soundings,
    showDepthContours: result.data.show_depth_contours,
    showLights: result.data.show_lights,
    showBuoys: result.data.show_buoys,
    showLand: result.data.show_land,
    showObstructions: result.data.show_obstructions,
    cm93Path: result.data.cm93_path,
  };
}

/**
 * Save CM93 visualization settings
 */
export async function saveCm93Settings(settings: Cm93Settings): Promise<void> {
  // Convert from frontend camelCase to backend snake_case
  const backendSettings: Cm93SettingsBackend = {
    enabled: settings.enabled,
    opacity: settings.opacity,
    show_soundings: settings.showSoundings,
    show_depth_contours: settings.showDepthContours,
    show_lights: settings.showLights,
    show_buoys: settings.showBuoys,
    show_land: settings.showLand,
    show_obstructions: settings.showObstructions,
    cm93_path: settings.cm93Path,
  };
  const result = await invoke<CommandResult<null>>('save_cm93_settings', { settings: backendSettings });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save CM93 settings');
  }
}

// ============ GPS Commands ============

export async function getGpsData(): Promise<GpsData> {
  const result = await invoke<CommandResult<GpsData>>('get_gps_data');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get GPS data');
  }
  return result.data;
}

export async function getGpsStatus(): Promise<GpsSourceStatus> {
  const result = await invoke<CommandResult<GpsSourceStatus>>('get_gps_status');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get GPS status');
  }
  return result.data;
}

export async function listSerialPorts(): Promise<DetectedPort[]> {
  const result = await invoke<CommandResult<DetectedPort[]>>('list_serial_ports');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to list serial ports');
  }
  return result.data;
}

export async function testGpsPort(portName: string, baudRate: number): Promise<boolean> {
  const result = await invoke<CommandResult<boolean>>('test_gps_port', {
    portName,
    baudRate,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to test GPS port');
  }
  return result.data ?? false;
}

export async function getGpsSources(): Promise<GpsSourceConfig[]> {
  const result = await invoke<CommandResult<GpsSourceConfig[]>>('get_gps_sources');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get GPS sources');
  }
  return result.data;
}

export async function saveGpsSource(source: GpsSourceConfig): Promise<void> {
  const result = await invoke<CommandResult<null>>('save_gps_source', { source });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save GPS source');
  }
}

export async function deleteGpsSource(id: string): Promise<void> {
  const result = await invoke<CommandResult<null>>('delete_gps_source', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete GPS source');
  }
}

export async function updateGpsPriorities(priorities: [string, number][]): Promise<void> {
  const result = await invoke<CommandResult<null>>('update_gps_priorities', { priorities });
  if (!result.success) {
    throw new Error(result.error || 'Failed to update GPS priorities');
  }
}

export async function startGps(): Promise<void> {
  const result = await invoke<CommandResult<null>>('start_gps');
  if (!result.success) {
    throw new Error(result.error || 'Failed to start GPS');
  }
}

export async function stopGps(): Promise<void> {
  const result = await invoke<CommandResult<null>>('stop_gps');
  if (!result.success) {
    throw new Error(result.error || 'Failed to stop GPS');
  }
}

export async function getNmeaBuffer(): Promise<string[]> {
  const result = await invoke<CommandResult<string[]>>('get_nmea_buffer');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get NMEA buffer');
  }
  return result.data;
}

export async function clearNmeaBuffer(): Promise<void> {
  const result = await invoke<CommandResult<null>>('clear_nmea_buffer');
  if (!result.success) {
    throw new Error(result.error || 'Failed to clear NMEA buffer');
  }
}

// ============ Waypoint Commands ============

export async function getWaypoints(): Promise<Waypoint[]> {
  const result = await invoke<CommandResult<Waypoint[]>>('get_waypoints');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get waypoints');
  }
  return result.data;
}

export async function createWaypoint(waypoint: Omit<Waypoint, 'id' | 'created_at'>): Promise<number> {
  const result = await invoke<CommandResult<number>>('create_waypoint', {
    waypoint: { ...waypoint, id: null, created_at: null },
  });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to create waypoint');
  }
  return result.data;
}

export async function updateWaypoint(waypoint: Waypoint): Promise<void> {
  const result = await invoke<CommandResult<null>>('update_waypoint', { waypoint });
  if (!result.success) {
    throw new Error(result.error || 'Failed to update waypoint');
  }
}

/**
 * Update only the position (lat/lon) of a waypoint.
 * This is safe for drag operations - it won't overwrite name/symbol/description.
 */
export async function updateWaypointPosition(id: number, lat: number, lon: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('update_waypoint_position', { id, lat, lon });
  if (!result.success) {
    throw new Error(result.error || 'Failed to update waypoint position');
  }
}

export async function deleteWaypoint(id: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('delete_waypoint', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete waypoint');
  }
}

export async function toggleWaypointHidden(id: number, hidden: boolean): Promise<void> {
  const result = await invoke<CommandResult<null>>('toggle_waypoint_hidden', { id, hidden });
  if (!result.success) {
    throw new Error(result.error || 'Failed to toggle waypoint hidden state');
  }
}

// ============ Route Commands ============

/**
 * Get all routes with their waypoints and tags
 */
export async function getRoutes(): Promise<RouteWithWaypoints[]> {
  const result = await invoke<CommandResult<RouteWithWaypoints[]>>('get_routes');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get routes');
  }
  return result.data;
}

/**
 * Get a single route by ID
 */
export async function getRoute(id: number): Promise<RouteWithWaypoints> {
  const result = await invoke<CommandResult<RouteWithWaypoints>>('get_route', { id });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get route');
  }
  return result.data;
}

/**
 * Create a new route with waypoints and tags
 * @returns The new route ID
 */
export async function createRoute(
  route: Omit<Route, 'id' | 'created_at' | 'updated_at'>,
  waypointIds: number[],
  tagIds: number[]
): Promise<number> {
  const result = await invoke<CommandResult<number>>('create_route', {
    route: { ...route, id: null, created_at: null, updated_at: null },
    waypointIds,
    tagIds,
  });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to create route');
  }
  return result.data;
}

/**
 * Update an existing route
 */
export async function updateRoute(
  route: Route,
  waypointIds: number[],
  tagIds: number[]
): Promise<void> {
  const result = await invoke<CommandResult<null>>('update_route', {
    route,
    waypointIds,
    tagIds,
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to update route');
  }
}

/**
 * Delete a route
 */
export async function deleteRoute(id: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('delete_route', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete route');
  }
}

/**
 * Get the count of waypoints exclusive to a route (not used by other routes).
 * This helps the UI show how many waypoints would be deleted.
 */
export async function getRouteExclusiveWaypointCount(id: number): Promise<number> {
  const result = await invoke<CommandResult<number>>('get_route_exclusive_waypoint_count', { id });
  if (!result.success || result.data === null || result.data === undefined) {
    throw new Error(result.error || 'Failed to get exclusive waypoint count');
  }
  return result.data;
}

/**
 * Delete a route and optionally its exclusive waypoints (waypoints not used by other routes).
 * @returns The IDs of waypoints that were deleted
 */
export async function deleteRouteWithWaypoints(
  id: number,
  deleteWaypoints: boolean
): Promise<number[]> {
  const result = await invoke<CommandResult<number[]>>('delete_route_with_waypoints', {
    id,
    deleteWaypoints,
  });
  if (!result.success || result.data === null || result.data === undefined) {
    throw new Error(result.error || 'Failed to delete route with waypoints');
  }
  return result.data;
}

/**
 * Duplicate a route with a new name
 * @returns The new route ID
 */
export async function duplicateRoute(id: number, newName: string): Promise<number> {
  const result = await invoke<CommandResult<number>>('duplicate_route', { id, newName });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to duplicate route');
  }
  return result.data;
}

/**
 * Reverse the waypoint order of a route
 */
export async function reverseRoute(id: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('reverse_route', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to reverse route');
  }
}

/**
 * Set the active route for navigation (or clear with null)
 */
export async function setActiveRoute(id: number | null): Promise<void> {
  const result = await invoke<CommandResult<null>>('set_active_route', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to set active route');
  }
}

/**
 * Toggle the hidden state of a route
 */
export async function toggleRouteHidden(id: number, hidden: boolean): Promise<void> {
  const result = await invoke<CommandResult<null>>('toggle_route_hidden', { id, hidden });
  if (!result.success) {
    throw new Error(result.error || 'Failed to toggle route hidden state');
  }
}

// ============ Route Tag Commands ============

/**
 * Get all route tags
 */
export async function getRouteTags(): Promise<RouteTag[]> {
  const result = await invoke<CommandResult<RouteTag[]>>('get_route_tags');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get route tags');
  }
  return result.data;
}

/**
 * Create a new route tag
 * @returns The new tag ID
 */
export async function createRouteTag(tag: Omit<RouteTag, 'id' | 'created_at'>): Promise<number> {
  const result = await invoke<CommandResult<number>>('create_route_tag', {
    tag: { ...tag, id: null, created_at: null },
  });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to create route tag');
  }
  return result.data;
}

/**
 * Update an existing route tag
 */
export async function updateRouteTag(tag: RouteTag): Promise<void> {
  const result = await invoke<CommandResult<null>>('update_route_tag', { tag });
  if (!result.success) {
    throw new Error(result.error || 'Failed to update route tag');
  }
}

/**
 * Delete a route tag
 */
export async function deleteRouteTag(id: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('delete_route_tag', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete route tag');
  }
}

// ============ Route Statistics Commands ============

/**
 * Calculate route statistics from waypoint IDs
 */
export async function calculateRouteStatistics(
  waypointIds: number[],
  speedKn: number
): Promise<RouteStatistics> {
  const result = await invoke<CommandResult<RouteStatistics>>('calculate_route_statistics', {
    waypointIds,
    speedKn,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to calculate route statistics');
  }
  return result.data;
}

// ============ GPX Import/Export Commands ============

/**
 * Import a GPX file, creating routes and waypoints
 */
export async function importGpx(filePath: string): Promise<GpxImportResult> {
  const result = await invoke<CommandResult<GpxImportResult>>('import_gpx', { filePath });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to import GPX file');
  }
  return result.data;
}

/**
 * Export a single route to a GPX file
 */
export async function exportRouteGpx(routeId: number, filePath: string): Promise<void> {
  const result = await invoke<CommandResult<null>>('export_route_gpx', { routeId, filePath });
  if (!result.success) {
    throw new Error(result.error || 'Failed to export route to GPX');
  }
}

/**
 * Export multiple routes to a single GPX file
 */
export async function exportRoutesGpx(routeIds: number[], filePath: string): Promise<void> {
  const result = await invoke<CommandResult<null>>('export_routes_gpx', { routeIds, filePath });
  if (!result.success) {
    throw new Error(result.error || 'Failed to export routes to GPX');
  }
}

/**
 * Get GPX XML string for a route (for clipboard/sharing)
 */
export async function getRouteGpxString(routeId: number): Promise<string> {
  const result = await invoke<CommandResult<string>>('get_route_gpx_string', { routeId });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get route GPX');
  }
  return result.data;
}

/**
 * Get a text summary of a route for sharing
 */
export async function getRouteSummaryText(routeId: number): Promise<string> {
  const result = await invoke<CommandResult<string>>('get_route_summary_text', { routeId });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get route summary');
  }
  return result.data;
}

// ============ Track Recording Commands ============

/**
 * Get all tracks
 */
export async function getTracks(): Promise<Track[]> {
  const result = await invoke<CommandResult<Track[]>>('get_tracks');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get tracks');
  }
  return result.data;
}

/**
 * Get a single track by ID
 */
export async function getTrack(id: number): Promise<Track> {
  const result = await invoke<CommandResult<Track>>('get_track', { id });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get track');
  }
  return result.data;
}

/**
 * Get a track with all its points
 */
export async function getTrackWithPoints(id: number): Promise<TrackWithPoints> {
  const result = await invoke<CommandResult<TrackWithPoints>>('get_track_with_points', { id });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get track with points');
  }
  return result.data;
}

/**
 * Get all tracks with their points
 */
export async function getTracksWithPoints(): Promise<TrackWithPoints[]> {
  const result = await invoke<CommandResult<TrackWithPoints[]>>('get_tracks_with_points');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get tracks with points');
  }
  return result.data;
}

/**
 * Start recording a new track
 * @returns The new track ID
 */
export async function startTrackRecording(name: string): Promise<number> {
  const result = await invoke<CommandResult<number>>('start_track_recording', { name });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to start track recording');
  }
  return result.data;
}

/**
 * Stop recording the current track
 * @returns The finalized track
 */
export async function stopTrackRecording(): Promise<Track | null> {
  const result = await invoke<CommandResult<Track | null>>('stop_track_recording');
  if (!result.success) {
    throw new Error(result.error || 'Failed to stop track recording');
  }
  return result.data;
}

/**
 * Get the currently recording track (if any)
 */
export async function getRecordingTrack(): Promise<Track | null> {
  const result = await invoke<CommandResult<Track | null>>('get_recording_track');
  if (!result.success) {
    throw new Error(result.error || 'Failed to get recording track');
  }
  return result.data;
}

/**
 * Add a point to the currently recording track
 * @returns The new point ID
 */
export async function addTrackPoint(
  lat: number,
  lon: number,
  heading?: number | null,
  cog?: number | null,
  sog?: number | null
): Promise<number> {
  const result = await invoke<CommandResult<number>>('add_track_point', {
    lat,
    lon,
    heading: heading ?? null,
    cog: cog ?? null,
    sog: sog ?? null,
  });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to add track point');
  }
  return result.data;
}

/**
 * Update track metadata
 */
export async function updateTrack(track: Track): Promise<void> {
  const result = await invoke<CommandResult<null>>('update_track', { track });
  if (!result.success) {
    throw new Error(result.error || 'Failed to update track');
  }
}

/**
 * Toggle track visibility
 */
export async function toggleTrackHidden(id: number, hidden: boolean): Promise<void> {
  const result = await invoke<CommandResult<null>>('toggle_track_hidden', { id, hidden });
  if (!result.success) {
    throw new Error(result.error || 'Failed to toggle track hidden state');
  }
}

/**
 * Delete a track and all its points
 */
export async function deleteTrack(id: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('delete_track', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete track');
  }
}

/**
 * Get track points for a track
 */
export async function getTrackPoints(trackId: number): Promise<TrackPoint[]> {
  const result = await invoke<CommandResult<TrackPoint[]>>('get_track_points', { trackId });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get track points');
  }
  return result.data;
}

/**
 * Get GPX XML string for a track (for clipboard/sharing)
 */
export async function getTrackGpxString(trackId: number): Promise<string> {
  const result = await invoke<CommandResult<string>>('get_track_gpx_string', { trackId });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get track GPX');
  }
  return result.data;
}

/**
 * Export a track to a GPX file
 */
export async function exportTrackGpx(trackId: number, filePath: string): Promise<void> {
  const result = await invoke<CommandResult<null>>('export_track_gpx', { trackId, filePath });
  if (!result.success) {
    throw new Error(result.error || 'Failed to export track to GPX');
  }
}

/**
 * Convert a track to a route
 * @param maxWaypoints Maximum number of waypoints (simplifies track)
 * @returns The new route ID
 */
export async function convertTrackToRoute(trackId: number, maxWaypoints: number = 50): Promise<number> {
  const result = await invoke<CommandResult<number>>('convert_track_to_route', {
    trackId,
    maxWaypoints,
  });
  if (!result.success || result.data === null) {
    throw new Error(result.error || 'Failed to convert track to route');
  }
  return result.data;
}

// ============ Chart/MBTiles Commands ============

export async function listCharts(): Promise<ChartInfo[]> {
  const result = await invoke<CommandResult<ChartInfo[]>>('list_charts');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to list charts');
  }
  return result.data;
}

export async function getTile(chartId: string, z: number, x: number, y: number): Promise<Uint8Array> {
  const result = await invoke<number[]>('get_tile', { chartId, z, x, y });
  return new Uint8Array(result);
}

export async function getChartsDirectory(): Promise<string> {
  const result = await invoke<CommandResult<string>>('get_charts_directory');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get charts directory');
  }
  return result.data;
}

export async function importChart(sourcePath: string): Promise<ChartInfo> {
  const result = await invoke<CommandResult<ChartInfo>>('import_chart', { sourcePath });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to import chart');
  }
  return result.data;
}

export async function removeChart(chartId: string): Promise<void> {
  const result = await invoke<CommandResult<null>>('remove_chart', { chartId });
  if (!result.success) {
    throw new Error(result.error || 'Failed to remove chart');
  }
}

// Chart layer state for persistence
export interface ChartLayerStateInput {
  chartId: string;
  enabled: boolean;
  opacity: number;
  zOrder: number;
}

// Chart layer state from backend (uses snake_case)
export interface ChartLayerStateBackend {
  chart_id: string;
  enabled: boolean;
  opacity: number;
  z_order: number;
}

export async function saveChartLayerState(layerState: ChartLayerStateInput): Promise<void> {
  // Convert to backend format (snake_case)
  const backendState = {
    chart_id: layerState.chartId,
    enabled: layerState.enabled,
    opacity: layerState.opacity,
    z_order: layerState.zOrder,
  };
  const result = await invoke<CommandResult<null>>('save_chart_layer_state', { layerState: backendState });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save chart layer state');
  }
}

export async function getChartLayerStates(): Promise<ChartLayerStateInput[]> {
  const result = await invoke<CommandResult<ChartLayerStateBackend[]>>('get_chart_layer_states');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get chart layer states');
  }
  // Convert from backend format to frontend format
  return result.data.map((state) => ({
    chartId: state.chart_id,
    enabled: state.enabled,
    opacity: state.opacity,
    zOrder: state.z_order,
  }));
}

// ============ Chart Custom Metadata ============

export interface ChartCustomMetadataInput {
  chartId: string;
  customName: string | null;
  customDescription: string | null;
  customMinZoom: number | null;
  customMaxZoom: number | null;
}

interface ChartCustomMetadataBackend {
  chart_id: string;
  custom_name: string | null;
  custom_description: string | null;
  custom_min_zoom: number | null;
  custom_max_zoom: number | null;
}

export async function saveChartCustomMetadata(metadata: ChartCustomMetadataInput): Promise<void> {
  const backendMetadata = {
    chart_id: metadata.chartId,
    custom_name: metadata.customName,
    custom_description: metadata.customDescription,
    custom_min_zoom: metadata.customMinZoom,
    custom_max_zoom: metadata.customMaxZoom,
  };
  const result = await invoke<CommandResult<null>>('save_chart_custom_metadata', { metadata: backendMetadata });
  if (!result.success) {
    throw new Error(result.error || 'Failed to save chart custom metadata');
  }
}

export async function getChartCustomMetadata(chartId: string): Promise<ChartCustomMetadataInput | null> {
  const result = await invoke<CommandResult<ChartCustomMetadataBackend | null>>('get_chart_custom_metadata', { chartId });
  if (!result.success) {
    throw new Error(result.error || 'Failed to get chart custom metadata');
  }
  if (!result.data) return null;
  return {
    chartId: result.data.chart_id,
    customName: result.data.custom_name,
    customDescription: result.data.custom_description,
    customMinZoom: result.data.custom_min_zoom,
    customMaxZoom: result.data.custom_max_zoom,
  };
}

export async function getAllChartCustomMetadata(): Promise<ChartCustomMetadataInput[]> {
  const result = await invoke<CommandResult<ChartCustomMetadataBackend[]>>('get_all_chart_custom_metadata');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get all chart custom metadata');
  }
  return result.data.map((meta) => ({
    chartId: meta.chart_id,
    customName: meta.custom_name,
    customDescription: meta.custom_description,
    customMinZoom: meta.custom_min_zoom,
    customMaxZoom: meta.custom_max_zoom,
  }));
}

// ============ Utility Commands ============

export async function getAppDataDir(): Promise<string> {
  const result = await invoke<CommandResult<string>>('get_app_data_dir');
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get app data directory');
  }
  return result.data;
}

// ============ Check if running in Tauri ============

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ============ Utility: Generate UUID ============

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============ Navigation Utilities ============

const EARTH_RADIUS_NM = 3440.065; // Earth radius in nautical miles

/**
 * Calculate the distance between two points using the Haversine formula
 * @returns Distance in nautical miles
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_NM * c;
}

/**
 * Calculate the initial bearing from point 1 to point 2
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Format distance for display
 */
export function formatDistance(nm: number): string {
  if (nm < 0.1) {
    // Show in meters for very short distances
    const meters = nm * 1852;
    return `${Math.round(meters)}m`;
  } else if (nm < 10) {
    return `${nm.toFixed(2)} nm`;
  } else {
    return `${nm.toFixed(1)} nm`;
  }
}

/**
 * Format bearing for display
 */
export function formatBearing(degrees: number): string {
  return `${Math.round(degrees).toString().padStart(3, '0')}°`;
}

/**
 * Calculate Velocity Made Good toward a waypoint
 * @param sog Speed Over Ground in knots
 * @param cog Course Over Ground in degrees
 * @param bearing Bearing to waypoint in degrees
 * @returns VMG in knots (positive = closing, negative = opening)
 */
export function calculateVMG(sog: number, cog: number, bearing: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const angleDiff = bearing - cog;
  return sog * Math.cos(toRad(angleDiff));
}

/**
 * Calculate ETA to waypoint
 * @param distanceNm Distance in nautical miles
 * @param vmgKnots VMG in knots
 * @returns ETA as Date or null if not calculable
 */
export function calculateETA(distanceNm: number, vmgKnots: number): Date | null {
  if (vmgKnots <= 0.1) return null; // Not making progress
  const hoursToGo = distanceNm / vmgKnots;
  const msToGo = hoursToGo * 60 * 60 * 1000;
  return new Date(Date.now() + msToGo);
}

/**
 * Format ETA for display (24-hour time)
 */
export function formatETA(eta: Date | null): string {
  if (!eta) return '--:--';
  const hours = eta.getHours().toString().padStart(2, '0');
  const minutes = eta.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Format time to go for display
 */
export function formatTTG(distanceNm: number, vmgKnots: number): string {
  if (vmgKnots <= 0.1) return '-- h -- m';
  const hoursToGo = distanceNm / vmgKnots;
  const hours = Math.floor(hoursToGo);
  const minutes = Math.round((hoursToGo - hours) * 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format VMG for display with direction indicator
 */
export function formatVMG(vmg: number): string {
  const sign = vmg >= 0 ? '+' : '';
  return `${sign}${vmg.toFixed(1)} kn`;
}
