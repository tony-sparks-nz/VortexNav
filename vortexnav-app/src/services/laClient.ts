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
  downloaded_at?: string;
  bounds?: PackBounds;
  zoom_levels?: number[];
  provider?: string;
  storage_path?: string;
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
 * Reset device identity to allow re-registration
 * WARNING: This clears all stored identity and entitlements
 */
export async function resetDevice(): Promise<{ success: boolean; message: string }> {
  return await invoke<{ success: boolean; message: string }>('la_reset_device');
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
    regionSlug,  // camelCase for Tauri
    zoomLevels,  // camelCase for Tauri
  });
}

/**
 * Get pack status
 */
export async function getPackStatus(packId: string): Promise<PackInfo> {
  return await invoke<PackInfo>('la_get_pack_status', { packId });  // camelCase for Tauri
}

/**
 * Delete a pack
 */
export async function deletePack(packId: string): Promise<boolean> {
  return await invoke<boolean>('la_delete_pack', { packId });  // camelCase for Tauri
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
// Custom Pack (Download Area) API
// ==============================================

export interface CustomPackBounds {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface CustomPackRequest {
  bounds: CustomPackBounds;
  zoom_levels: number[];
  basemap_id: string;
  name: string;
}

export interface CustomPackResult {
  pack_id: string;
  status: string;
  tile_count: number;
}

export interface TileEstimateResult {
  tile_count: number;
  estimated_size_bytes: number;
}

export interface DownloadProgressResult {
  pack_id: string;
  total_tiles: number;
  downloaded_tiles: number;
  failed_tiles: number;
  percent: number;
  status: string;
  phase?: string; // "Downloading tiles", "Creating offline pack", "Storing to disk"
  paused?: boolean;
  eta_seconds?: number;  // Estimated time remaining in seconds
  tiles_per_second?: number;  // Current download speed
}

/**
 * Request a custom pack download for a user-defined area
 */
export async function requestCustomPack(
  bounds: CustomPackBounds,
  zoomLevels: number[],
  basemapId: string,
  name: string
): Promise<CustomPackResult> {
  console.log('[laClient] requestCustomPack called with:', {
    bounds,
    zoomLevels,
    basemapId,
    name,
  });

  try {
    // Tauri expects camelCase parameter names from JavaScript
    const result = await invoke<CustomPackResult>('la_request_custom_pack', {
      bounds,
      zoomLevels,  // camelCase for Tauri
      basemapId,   // camelCase for Tauri
      name,
    });
    console.log('[laClient] requestCustomPack success:', result);
    return result;
  } catch (error) {
    console.error('[laClient] requestCustomPack FAILED:', error);
    throw error;
  }
}

/**
 * Estimate tile count and size for a custom area
 * (Can be used for preview before downloading)
 */
export async function estimatePackTiles(
  bounds: CustomPackBounds,
  zoomLevels: number[]
): Promise<TileEstimateResult> {
  return await invoke<TileEstimateResult>('la_estimate_pack_tiles', {
    bounds,
    zoomLevels,  // camelCase for Tauri
  });
}

/**
 * Get download progress for a pack
 */
export async function getDownloadProgress(
  packId: string
): Promise<DownloadProgressResult> {
  console.warn('[laClient] getDownloadProgress called for pack:', packId);
  const result = await invoke<DownloadProgressResult>('la_get_download_progress', {
    packId,  // camelCase for Tauri
  });
  console.warn('[laClient] getDownloadProgress result:', result);
  return result;
}

// ==============================================
// Download Control (Pause/Resume/Cancel)
// ==============================================

export interface PauseResumeResult {
  paused?: boolean;
  resumed?: boolean;
}

export interface CancelResult {
  cancelled?: boolean;
}

/**
 * Pause a download
 */
export async function pauseDownload(packId: string): Promise<PauseResumeResult> {
  console.log('[laClient] pauseDownload called for pack:', packId);
  return await invoke<PauseResumeResult>('la_pause_download', { packId });
}

/**
 * Resume a paused download
 */
export async function resumeDownload(packId: string): Promise<PauseResumeResult> {
  console.log('[laClient] resumeDownload called for pack:', packId);
  return await invoke<PauseResumeResult>('la_resume_download', { packId });
}

/**
 * Cancel a download
 */
export async function cancelDownload(packId: string): Promise<CancelResult> {
  console.log('[laClient] cancelDownload called for pack:', packId);
  return await invoke<CancelResult>('la_cancel_download', { packId });
}

// ==============================================
// Export Pack
// ==============================================

export interface ExportPackResult {
  success: boolean;
  destination_path: string;
  size_bytes: number;
}

/**
 * Export a pack's MBTiles file to user-specified location
 */
export async function exportPack(
  packId: string,
  destinationPath: string
): Promise<ExportPackResult> {
  console.log('[laClient] exportPack called:', packId, destinationPath);
  return await invoke<ExportPackResult>('la_export_pack', {
    packId,
    destinationPath,
  });
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
