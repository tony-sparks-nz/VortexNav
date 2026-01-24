// Tauri command bindings for VortexNav

import { invoke } from '@tauri-apps/api/core';
import type { ApiKeys, ThemeMode, BasemapProvider } from '../types';

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

export async function deleteWaypoint(id: number): Promise<void> {
  const result = await invoke<CommandResult<null>>('delete_waypoint', { id });
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete waypoint');
  }
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
