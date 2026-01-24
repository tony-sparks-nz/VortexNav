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

export async function updateGpsData(nmeaData: string): Promise<GpsData> {
  const result = await invoke<CommandResult<GpsData>>('update_gps_data', { nmeaData });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to update GPS data');
  }
  return result.data;
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
