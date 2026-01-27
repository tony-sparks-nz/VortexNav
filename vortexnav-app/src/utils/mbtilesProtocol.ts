// MBTiles Protocol Handler for MapLibre GL
// Bridges MapLibre tile requests to Tauri IPC for local MBTiles files

import { invoke } from '@tauri-apps/api/core';
import maplibregl from 'maplibre-gl';

interface TileResponse {
  data: ArrayBuffer;
}

/**
 * Register the mbtiles:// protocol with MapLibre GL.
 * This allows MapLibre to load tiles from local MBTiles files via Tauri IPC.
 *
 * URL format: mbtiles://{chartId}/{z}/{x}/{y}
 */
export function registerMBTilesProtocol(): void {
  // Check if protocol is already registered
  if ((maplibregl as unknown as { getProtocol?: (name: string) => unknown }).getProtocol?.('mbtiles')) {
    return;
  }

  maplibregl.addProtocol('mbtiles', async (params: { url: string }, _abortController: AbortController): Promise<TileResponse> => {
    // Parse URL: mbtiles://{chartId}/{z}/{x}/{y}
    const match = params.url.match(/mbtiles:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);

    if (!match) {
      throw new Error(`Invalid mbtiles URL: ${params.url}`);
    }

    const [, chartId, zStr, xStr, yStr] = match;
    const z = parseInt(zStr, 10);
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    try {
      // Request tile from Tauri backend
      // Use info-level logging for antimeridian diagnostic (NZ1463801)
      const isAntimeridianDiag = chartId.includes('NZ1463801');
      if (isAntimeridianDiag) {
        console.info(`MBTiles DIAG: Requesting ${chartId}/z${z}/x${x}/y${y}`);
      } else {
        console.debug(`MBTiles: Requesting ${chartId}/${z}/${x}/${y}`);
      }

      const tileData = await invoke<number[]>('get_tile', {
        chartId,
        z,
        x,
        y,
      });

      if (isAntimeridianDiag) {
        console.info(`MBTiles DIAG: Received ${chartId}/z${z}/x${x}/y${y}, ${tileData.length} bytes`);
      } else {
        console.debug(`MBTiles: Received ${chartId}/${z}/${x}/${y}, ${tileData.length} bytes`);
      }

      // Convert number array to Uint8Array then to ArrayBuffer
      const uint8Array = new Uint8Array(tileData);

      return {
        data: uint8Array.buffer,
      };
    } catch (error) {
      // Return empty tile for missing tiles (common in sparse tilesets)
      // MapLibre will handle this gracefully
      const isAntimeridianDiag = chartId.includes('NZ1463801');
      if (isAntimeridianDiag) {
        console.info(`MBTiles DIAG: Tile not found ${chartId}/z${z}/x${x}/y${y}`, error);
      } else {
        console.debug(`Tile not found or error: ${chartId}/${z}/${x}/${y}`, error);
      }
      return {
        data: new ArrayBuffer(0),
      };
    }
  });
}

/**
 * Unregister the mbtiles:// protocol.
 * Call this when cleaning up if needed.
 */
export function unregisterMBTilesProtocol(): void {
  if ((maplibregl as unknown as { getProtocol?: (name: string) => unknown }).getProtocol?.('mbtiles')) {
    maplibregl.removeProtocol('mbtiles');
  }
}
