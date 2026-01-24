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
  timestamp: string | null;
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
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// ============ Utility: Generate UUID ============

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
