// ==============================================
// Licensing Agent Client Service
// ==============================================
//
// TypeScript wrapper for Tauri LA commands.
// Provides typed interface for all LA operations.
//
// When LA is not available, falls back to direct HTTP to Horizon backend.
//

import { invoke } from '@tauri-apps/api/core';

// ==============================================
// Types
// ==============================================

export interface DeviceStatus {
  registered: boolean;
  device_id?: string;
  horizon_url?: string;
  registered_at?: string;
}

export interface EntitlementCheck {
  allowed: boolean;
  reason?: string;
  expires_at?: string;
  value?: unknown;
}

export interface Entitlement {
  key: string;
  value?: unknown;
  expires_at: string;
}

export interface PackInfo {
  id: string;
  region_slug: string;
  name: string;
  status: 'pending' | 'downloading' | 'ready' | 'expired' | 'error';
  tile_count?: number;
  size_bytes?: number;
  expires_at: string;
}

export interface PackBounds {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface PackCatalogRegion {
  id: string;
  name: string;
  slug: string;
  description?: string;
  bounds: PackBounds;
  available_zoom_levels: number[];
  estimated_size_bytes?: number;
  provider: string;
}

export interface TileData {
  tile: string; // base64 encoded
  content_type: string;
}

export interface RegistrationResult {
  success: boolean;
  device_id?: string;
}

// ==============================================
// LA Client API
// ==============================================

/**
 * Check if LA is available and connectable
 */
export async function checkConnection(): Promise<boolean> {
  try {
    return await invoke<boolean>('la_check_connection');
  } catch {
    return false;
  }
}

/**
 * Get device registration status
 */
export async function getDeviceStatus(): Promise<DeviceStatus> {
  return await invoke<DeviceStatus>('la_get_device_status');
}

/**
 * Register device with registration code
 */
export async function registerDevice(code: string): Promise<RegistrationResult> {
  return await invoke<RegistrationResult>('la_register_device', { code });
}

/**
 * Force sync with Horizon
 */
export async function sync(): Promise<boolean> {
  return await invoke<boolean>('la_sync');
}

/**
 * Check a specific entitlement
 */
export async function checkEntitlement(key: string): Promise<EntitlementCheck> {
  return await invoke<EntitlementCheck>('la_check_entitlement', { key });
}

/**
 * List all entitlements
 */
export async function listEntitlements(): Promise<Entitlement[]> {
  return await invoke<Entitlement[]>('la_list_entitlements');
}

/**
 * List downloaded packs
 */
export async function listPacks(): Promise<PackInfo[]> {
  return await invoke<PackInfo[]>('la_list_packs');
}

/**
 * Get pack catalog from Horizon
 */
export async function getPackCatalog(): Promise<PackCatalogRegion[]> {
  return await invoke<PackCatalogRegion[]>('la_get_pack_catalog');
}

/**
 * Request pack download
 */
export async function requestPack(
  regionSlug: string,
  zoomLevels?: number[]
): Promise<{ pack_id: string; status: string }> {
  return await invoke<{ pack_id: string; status: string }>('la_request_pack', {
    region_slug: regionSlug,
    zoom_levels: zoomLevels,
  });
}

/**
 * Get pack status
 */
export async function getPackStatus(packId: string): Promise<PackInfo> {
  return await invoke<PackInfo>('la_get_pack_status', { pack_id: packId });
}

/**
 * Delete a pack
 */
export async function deletePack(packId: string): Promise<boolean> {
  return await invoke<boolean>('la_delete_pack', { pack_id: packId });
}

/**
 * Get a tile from LA
 */
export async function getTile(
  z: number,
  x: number,
  y: number,
  layer?: string
): Promise<TileData> {
  return await invoke<TileData>('la_get_tile', { z, x, y, layer });
}

// ==============================================
// Helper Functions
// ==============================================

/**
 * Convert base64 tile to ArrayBuffer
 */
export function tileToArrayBuffer(tile: TileData): ArrayBuffer {
  const binary = atob(tile.tile);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Calculate days until expiry
 */
export function daysUntilExpiry(expiresAt: string): number {
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Check if pack is expired
 */
export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
