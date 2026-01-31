/**
 * useDownloadArea - State management for offline area downloads
 *
 * This hook manages the polygon drawing workflow and download configuration
 * for custom offline map areas.
 *
 * Follows the same reducer pattern as useRouteManager.
 */

import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import type { AOIBounds, PolygonPoint, BasemapProvider } from '../types';
import { DOWNLOAD_AREA_LIMITS } from '../types';
import {
  polygonToBounds,
  calculateTileCount,
  estimateDownloadSize,
  isValidPolygon,
} from '../utils/tileCalculations';

// ============ State Interface ============

export interface DownloadAreaManagerState {
  // Drawing state
  isDrawing: boolean;
  isConfiguring: boolean;
  polygonPoints: PolygonPoint[];

  // Computed bounds (from polygon)
  bounds: AOIBounds | null;

  // Configuration
  downloadName: string;
  minZoom: number;
  maxZoom: number;
  basemapId: BasemapProvider;

  // Estimates (computed from bounds + zoom)
  estimatedTileCount: number;
  estimatedSizeBytes: number;

  // Download state
  isDownloading: boolean;
  downloadProgress: number;
  downloadedTiles: number;
  totalTiles: number;
  downloadPhase: string | null; // "Downloading tiles", "Creating offline pack", "Storing to disk"
  error: string | null;
}

// ============ Action Types ============

type DownloadAreaAction =
  | { type: 'START_DRAWING' }
  | { type: 'ADD_POINT'; payload: PolygonPoint }
  | { type: 'REMOVE_LAST_POINT' }
  | { type: 'FINISH_DRAWING' }
  | { type: 'CANCEL_DRAWING' }
  | { type: 'UPDATE_NAME'; payload: string }
  | { type: 'UPDATE_ZOOM_RANGE'; payload: { minZoom?: number; maxZoom?: number } }
  | { type: 'UPDATE_BASEMAP'; payload: BasemapProvider }
  | { type: 'UPDATE_ESTIMATES'; payload: { tileCount: number; sizeBytes: number } }
  | { type: 'START_DOWNLOAD' }
  | { type: 'DOWNLOAD_PROGRESS'; payload: { percent: number; downloadedTiles?: number; totalTiles?: number; phase: string | null } }
  | { type: 'DOWNLOAD_SUCCESS' }
  | { type: 'DOWNLOAD_ERROR'; payload: string }
  | { type: 'RESET' };

// ============ Initial State ============

const initialState: DownloadAreaManagerState = {
  isDrawing: false,
  isConfiguring: false,
  polygonPoints: [],
  bounds: null,
  downloadName: '',
  minZoom: DOWNLOAD_AREA_LIMITS.DEFAULT_MIN_ZOOM,
  maxZoom: DOWNLOAD_AREA_LIMITS.DEFAULT_MAX_ZOOM,
  basemapId: 'osm',
  estimatedTileCount: 0,
  estimatedSizeBytes: 0,
  isDownloading: false,
  downloadProgress: 0,
  downloadedTiles: 0,
  totalTiles: 0,
  downloadPhase: null,
  error: null,
};

// ============ Reducer ============

function downloadAreaReducer(
  state: DownloadAreaManagerState,
  action: DownloadAreaAction
): DownloadAreaManagerState {
  switch (action.type) {
    case 'START_DRAWING':
      return {
        ...initialState,
        isDrawing: true,
        downloadName: `Download ${new Date().toLocaleDateString()}`,
      };

    case 'ADD_POINT':
      console.log(`[useDownloadArea] ADD_POINT #${state.polygonPoints.length + 1}: lat=${action.payload.lat.toFixed(6)}, lon=${action.payload.lon.toFixed(6)}`);
      return {
        ...state,
        polygonPoints: [...state.polygonPoints, action.payload],
      };

    case 'REMOVE_LAST_POINT':
      return {
        ...state,
        polygonPoints: state.polygonPoints.slice(0, -1),
      };

    case 'FINISH_DRAWING': {
      // Log polygon points before calculating bounds
      console.log('[useDownloadArea] FINISH_DRAWING - Polygon points:', JSON.stringify(state.polygonPoints, null, 2));

      const bounds = polygonToBounds(state.polygonPoints);

      // Log calculated bounds
      console.log('[useDownloadArea] FINISH_DRAWING - Calculated bounds:', JSON.stringify(bounds, null, 2));

      if (!bounds || !isValidPolygon(state.polygonPoints)) {
        console.error('[useDownloadArea] FINISH_DRAWING - Invalid polygon or bounds');
        return {
          ...state,
          error: 'Please draw a valid polygon with at least 3 points',
        };
      }

      // Log the final bounds that will be used for download
      console.log('[useDownloadArea] FINISH_DRAWING - Final AOI bounds:');
      console.log(`  minLon: ${bounds.minLon} (${bounds.minLon.toFixed(6)})`);
      console.log(`  maxLon: ${bounds.maxLon} (${bounds.maxLon.toFixed(6)})`);
      console.log(`  minLat: ${bounds.minLat} (${bounds.minLat.toFixed(6)})`);
      console.log(`  maxLat: ${bounds.maxLat} (${bounds.maxLat.toFixed(6)})`);

      return {
        ...state,
        isDrawing: false,
        isConfiguring: true,
        bounds,
        error: null,
      };
    }

    case 'CANCEL_DRAWING':
      return initialState;

    case 'UPDATE_NAME':
      return {
        ...state,
        downloadName: action.payload,
      };

    case 'UPDATE_ZOOM_RANGE':
      return {
        ...state,
        minZoom: action.payload.minZoom ?? state.minZoom,
        maxZoom: action.payload.maxZoom ?? state.maxZoom,
      };

    case 'UPDATE_BASEMAP':
      return {
        ...state,
        basemapId: action.payload,
      };

    case 'UPDATE_ESTIMATES':
      return {
        ...state,
        estimatedTileCount: action.payload.tileCount,
        estimatedSizeBytes: action.payload.sizeBytes,
      };

    case 'START_DOWNLOAD':
      return {
        ...state,
        isDownloading: true,
        downloadProgress: 0,
        error: null,
      };

    case 'DOWNLOAD_PROGRESS':
      return {
        ...state,
        downloadProgress: action.payload.percent,
        downloadedTiles: action.payload.downloadedTiles ?? 0,
        totalTiles: action.payload.totalTiles ?? 0,
        downloadPhase: action.payload.phase,
      };

    case 'DOWNLOAD_SUCCESS':
      return initialState;

    case 'DOWNLOAD_ERROR':
      return {
        ...state,
        isDownloading: false,
        error: action.payload,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ============ Hook ============

export interface UseDownloadAreaOptions {
  maxZoomLimit?: number; // From entitlements
}

export function useDownloadArea(options: UseDownloadAreaOptions = {}) {
  const [state, dispatch] = useReducer(downloadAreaReducer, initialState);

  // Keep refs for access in callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  // Effective max zoom (bounded by entitlement)
  const effectiveMaxZoom = useMemo(() => {
    const entitlementMax = options.maxZoomLimit ?? 22;
    return Math.min(state.maxZoom, entitlementMax);
  }, [state.maxZoom, options.maxZoomLimit]);

  // Update maxZoom when entitlement limit changes (e.g., entitlements load after init)
  // If maxZoomLimit increases (14 -> 16), update maxZoom to the new limit
  useEffect(() => {
    if (options.maxZoomLimit !== undefined) {
      // If current maxZoom is at the old default (14) and new limit is higher, update to new limit
      if (state.maxZoom === DOWNLOAD_AREA_LIMITS.DEFAULT_MAX_ZOOM && options.maxZoomLimit > state.maxZoom) {
        dispatch({ type: 'UPDATE_ZOOM_RANGE', payload: { maxZoom: options.maxZoomLimit } });
      }
    }
  }, [options.maxZoomLimit, state.maxZoom]);

  // ============ Derived State ============

  const isActive = state.isDrawing || state.isConfiguring;
  const canFinishDrawing = state.polygonPoints.length >= 3;
  const canDownload =
    state.isConfiguring &&
    state.bounds !== null &&
    state.downloadName.trim() !== '' &&
    state.estimatedTileCount > 0 &&
    state.estimatedTileCount <= DOWNLOAD_AREA_LIMITS.MAX_TILE_COUNT;

  const tileCountWarning =
    state.estimatedTileCount > DOWNLOAD_AREA_LIMITS.WARNING_TILE_COUNT;
  const tileCountError =
    state.estimatedTileCount > DOWNLOAD_AREA_LIMITS.MAX_TILE_COUNT;

  // ============ Actions ============

  const startDrawing = useCallback(() => {
    dispatch({ type: 'START_DRAWING' });
  }, []);

  const addPoint = useCallback((lat: number, lon: number) => {
    dispatch({ type: 'ADD_POINT', payload: { lat, lon } });
  }, []);

  const removeLastPoint = useCallback(() => {
    dispatch({ type: 'REMOVE_LAST_POINT' });
  }, []);

  const finishDrawing = useCallback(() => {
    dispatch({ type: 'FINISH_DRAWING' });
  }, []);

  const cancelDrawing = useCallback(() => {
    dispatch({ type: 'CANCEL_DRAWING' });
  }, []);

  const updateName = useCallback((name: string) => {
    dispatch({ type: 'UPDATE_NAME', payload: name });
  }, []);

  const updateZoomRange = useCallback(
    (minZoom?: number, maxZoom?: number) => {
      // Enforce entitlement max zoom limit
      const clampedMax = maxZoom !== undefined
        ? Math.min(maxZoom, options.maxZoomLimit ?? 22)
        : undefined;
      dispatch({ type: 'UPDATE_ZOOM_RANGE', payload: { minZoom, maxZoom: clampedMax } });
    },
    [options.maxZoomLimit]
  );

  const updateBasemap = useCallback((basemapId: BasemapProvider) => {
    dispatch({ type: 'UPDATE_BASEMAP', payload: basemapId });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // ============ Download Actions ============

  const startDownload = useCallback(async (
    requestCustomPack: (
      bounds: AOIBounds,
      zoomLevels: number[],
      basemapId: string,
      name: string
    ) => Promise<string | null>
  ) => {
    const currentState = stateRef.current;

    console.log('[useDownloadArea] startDownload called with state:', {
      bounds: currentState.bounds,
      downloadName: currentState.downloadName,
      minZoom: currentState.minZoom,
      maxZoom: currentState.maxZoom,
      basemapId: currentState.basemapId,
      effectiveMaxZoom,
    });

    if (!currentState.bounds || !currentState.downloadName.trim()) {
      console.error('[useDownloadArea] Invalid configuration - missing bounds or name');
      dispatch({ type: 'DOWNLOAD_ERROR', payload: 'Invalid configuration - missing bounds or name' });
      return null;
    }

    dispatch({ type: 'START_DOWNLOAD' });

    try {
      // Build zoom levels array
      const zoomLevels: number[] = [];
      for (let z = currentState.minZoom; z <= effectiveMaxZoom; z++) {
        zoomLevels.push(z);
      }
      console.log('[useDownloadArea] Requesting download with zoom levels:', zoomLevels);

      const packId = await requestCustomPack(
        currentState.bounds,
        zoomLevels,
        currentState.basemapId,
        currentState.downloadName.trim()
      );

      console.log('[useDownloadArea] requestCustomPack returned:', packId);

      if (packId) {
        // Return pack_id for progress polling - don't dispatch SUCCESS yet
        // The caller should poll for progress and dispatch SUCCESS when complete
        return packId;
      } else {
        console.error('[useDownloadArea] No pack_id returned from requestCustomPack');
        dispatch({ type: 'DOWNLOAD_ERROR', payload: 'No pack ID returned - download may have failed silently' });
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[useDownloadArea] Download error:', errorMessage, error);
      dispatch({
        type: 'DOWNLOAD_ERROR',
        payload: errorMessage || 'Download failed - check console for details',
      });
      return null;
    }
  }, [effectiveMaxZoom]);

  const updateProgress = useCallback((
    percent: number,
    phase: string | null = null,
    downloadedTiles?: number,
    totalTiles?: number
  ) => {
    dispatch({ type: 'DOWNLOAD_PROGRESS', payload: { percent, downloadedTiles, totalTiles, phase } });
  }, []);

  // ============ Effects ============

  // Recalculate estimates when bounds or zoom changes
  useEffect(() => {
    if (!state.bounds) {
      dispatch({ type: 'UPDATE_ESTIMATES', payload: { tileCount: 0, sizeBytes: 0 } });
      return;
    }

    const tileCount = calculateTileCount(state.bounds, state.minZoom, effectiveMaxZoom);
    const sizeBytes = estimateDownloadSize(tileCount, state.basemapId);

    dispatch({ type: 'UPDATE_ESTIMATES', payload: { tileCount, sizeBytes } });
  }, [state.bounds, state.minZoom, effectiveMaxZoom, state.basemapId]);

  return {
    // State
    state,
    stateRef,

    // Derived state
    isActive,
    canFinishDrawing,
    canDownload,
    tileCountWarning,
    tileCountError,
    effectiveMaxZoom,

    // Actions
    startDrawing,
    addPoint,
    removeLastPoint,
    finishDrawing,
    cancelDrawing,
    updateName,
    updateZoomRange,
    updateBasemap,
    startDownload,
    updateProgress,
    reset,

    // Raw dispatch for advanced use
    dispatch,
  };
}

// Export types for consumers
export type { DownloadAreaAction };
