// ==============================================
// Vortex Protocol Handler for MapLibre GL
// ==============================================
//
// Routes tile requests through the Licensing Agent for:
// - Offline pack tiles
// - Entitlement-gated premium tiles
// - Usage tracking and audit
//
// URL format: vortex://{layer}/{z}/{x}/{y}
//

import { invoke } from '@tauri-apps/api/core';
import maplibregl from 'maplibre-gl';

interface VortexTileResponse {
  tile: string; // base64 encoded
  content_type: string;
}

interface TileResponse {
  data: ArrayBuffer;
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Register the vortex:// protocol with MapLibre GL.
 * This routes tile requests through the Licensing Agent for:
 * - Offline pack access
 * - Entitlement checking
 * - Premium provider access (future)
 *
 * URL format: vortex://{layer}/{z}/{x}/{y}
 *
 * Layers:
 * - "default" - Primary chart layer (from any available pack)
 * - "{region_slug}" - Specific regional pack
 * - "osm" - OpenStreetMap tiles (if entitled)
 * - "sentinel" - Sentinel-2 imagery (if entitled)
 * - "esri" - Esri World Imagery (if entitled)
 */
export function registerVortexProtocol(): void {
  // Check if protocol is already registered
  if ((maplibregl as unknown as { getProtocol?: (name: string) => unknown }).getProtocol?.('vortex')) {
    return;
  }

  maplibregl.addProtocol('vortex', async (params: { url: string }, _abortController: AbortController): Promise<TileResponse> => {
    // Parse URL: vortex://{layer}/{z}/{x}/{y}
    const match = params.url.match(/vortex:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);

    if (!match) {
      throw new Error(`Invalid vortex URL: ${params.url}`);
    }

    const [, layer, zStr, xStr, yStr] = match;
    const z = parseInt(zStr, 10);
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    try {
      console.debug(`Vortex: Requesting ${layer}/${z}/${x}/${y}`);

      // Request tile from LA via Tauri
      const tileData = await invoke<VortexTileResponse>('la_get_tile', {
        z,
        x,
        y,
        layer,
      });

      console.debug(`Vortex: Received ${layer}/${z}/${x}/${y}`);

      // Convert base64 to ArrayBuffer
      const arrayBuffer = base64ToArrayBuffer(tileData.tile);

      return {
        data: arrayBuffer,
      };
    } catch (error) {
      // Return empty tile for missing tiles
      console.debug(`Vortex: Tile not found ${layer}/${z}/${x}/${y}`, error);
      return {
        data: new ArrayBuffer(0),
      };
    }
  });
}

/**
 * Unregister the vortex:// protocol.
 */
export function unregisterVortexProtocol(): void {
  if ((maplibregl as unknown as { getProtocol?: (name: string) => unknown }).getProtocol?.('vortex')) {
    maplibregl.removeProtocol('vortex');
  }
}

/**
 * Create a MapLibre tile source configuration for vortex:// protocol.
 *
 * @param layer - The layer name (e.g., "default", "osm", "sentinel")
 * @param options - Additional source options
 */
export function createVortexTileSource(
  layer: string = 'default',
  options: {
    minzoom?: number;
    maxzoom?: number;
    tileSize?: number;
    bounds?: [number, number, number, number];
  } = {}
): maplibregl.RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [`vortex://${layer}/{z}/{x}/{y}`],
    tileSize: options.tileSize || 256,
    minzoom: options.minzoom || 0,
    maxzoom: options.maxzoom || 18,
    bounds: options.bounds,
  };
}

/**
 * Check if LA is available for vortex:// protocol
 */
export async function isVortexAvailable(): Promise<boolean> {
  try {
    const result = await invoke<boolean>('la_check_connection');
    return result;
  } catch {
    return false;
  }
}
