// Chart Layers Hook - Manages MBTiles chart layer state
import { useState, useEffect, useCallback } from 'react';
import type { ChartLayer } from '../types';
import {
  listCharts,
  importChart,
  removeChart,
  saveChartLayerState,
  getChartLayerStates,
  getAllChartCustomMetadata,
  saveChartCustomMetadata,
  isTauri,
  type ChartInfo,
  type ChartLayerStateInput,
  type ChartCustomMetadataInput,
} from './useTauri';

interface UseChartLayersReturn {
  layers: ChartLayer[];
  isLoading: boolean;
  error: string | null;
  refreshLayers: () => Promise<void>;
  addChartFromFile: () => Promise<void>;
  removeLayer: (chartId: string) => Promise<void>;
  removeMultipleLayers: (chartIds: string[]) => Promise<void>;
  toggleLayer: (chartId: string) => Promise<void>;
  setLayerOpacity: (chartId: string, opacity: number) => Promise<void>;
  zoomToLayer: (chartId: string) => [number, number, number, number] | null;
  updateChartMetadata: (chartId: string, metadata: Partial<Omit<ChartCustomMetadataInput, 'chartId'>>) => Promise<void>;
}

/**
 * Determine tile type from format string
 */
function getTileType(format: string | null): 'raster' | 'vector' {
  if (!format) return 'raster';
  const vectorFormats = ['pbf', 'mvt'];
  return vectorFormats.includes(format.toLowerCase()) ? 'vector' : 'raster';
}

/**
 * Bounds analysis result for handling various edge cases
 */
type BoundsType = 'normal' | 'antimeridian-east-to-west' | 'antimeridian-west-to-east' | 'inverted';

interface BoundsAnalysis {
  type: BoundsType;
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Analyze bounds and determine how to handle them
 *
 * Antimeridian crossing patterns:
 * Type A (east-to-west): minLon > 0 && maxLon < 0 (e.g., 175 to -175)
 *   - Chart crosses going EAST from positive lon to negative lon through 180°
 * Type B (west-to-east): minLon < 0 && maxLon > 0 && span > 180 (e.g., -175 to 175)
 *   - Chart crosses going WEST from negative lon to positive lon through -180°/180°
 *   - The "mathematical" span is >180° but the actual coverage is <180°
 *
 * Also handles:
 * - Inverted bounds (minLon > maxLon, same sign) - swap to fix
 * - Normal bounds (minLon < maxLon, standard case)
 */
function analyzeBounds(minLon: number, minLat: number, maxLon: number, maxLat: number): BoundsAnalysis {
  const span = maxLon - minLon;

  // Case 1: Antimeridian Type A - positive minLon, negative maxLon
  // Example: 175°E to 175°W - crosses EAST through 180°
  if (minLon > 0 && maxLon < 0) {
    console.log(`Antimeridian crossing (east-to-west): ${minLon}° to ${maxLon}°`);
    return { type: 'antimeridian-east-to-west', west: minLon, south: minLat, east: maxLon, north: maxLat };
  }

  // Case 2: Antimeridian Type B - negative minLon, positive maxLon, span > 180°
  // Example: -174.55 to 175.53 - mathematical span is 350° but actual is ~10° crossing antimeridian
  if (minLon < 0 && maxLon > 0 && span > 180) {
    console.log(`Antimeridian crossing (west-to-east): ${minLon}° to ${maxLon}° (span ${span.toFixed(1)}°)`);
    return { type: 'antimeridian-west-to-east', west: minLon, south: minLat, east: maxLon, north: maxLat };
  }

  // Case 3: Inverted bounds (minLon > maxLon but same sign)
  // Likely a data entry error - swap to normalize
  if (minLon > maxLon) {
    console.log(`Inverted bounds: [${minLon}, ${maxLon}] -> [${maxLon}, ${minLon}]`);
    return { type: 'inverted', west: maxLon, south: minLat, east: minLon, north: maxLat };
  }

  // Case 4: Normal bounds
  return { type: 'normal', west: minLon, south: minLat, east: maxLon, north: maxLat };
}

/**
 * Parse bounds string "minlon,minlat,maxlon,maxlat" for MapLibre source
 *
 * For antimeridian-crossing charts, returns undefined to disable bounds constraint
 * (MapLibre doesn't support antimeridian-crossing bounds on sources)
 *
 * For inverted or normal bounds, returns normalized [west, south, east, north]
 */
function parseBounds(bounds: string | null): [number, number, number, number] | undefined {
  if (!bounds) return undefined;

  const parts = bounds.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n))) {
    return undefined;
  }

  const [minLon, minLat, maxLon, maxLat] = parts;
  const analysis = analyzeBounds(minLon, minLat, maxLon, maxLat);

  // For any antimeridian-crossing type, disable bounds constraint
  // MapLibre sources don't support antimeridian-crossing bounds
  if (analysis.type === 'antimeridian-east-to-west' || analysis.type === 'antimeridian-west-to-east') {
    console.log(`Disabling bounds constraint for antimeridian-crossing chart (${analysis.type})`);
    return undefined;
  }

  // Return normalized bounds [west, south, east, north]
  return [analysis.west, analysis.south, analysis.east, analysis.north];
}

/**
 * Calculate the center and span for antimeridian-crossing bounds
 */
function calculateAntimeridianCenter(analysis: BoundsAnalysis): { center: number; span: number } {
  if (analysis.type === 'antimeridian-east-to-west') {
    // Type A: from positive (e.g., 175) to negative (e.g., -175)
    // Chart spans: west (175) -> 180 -> east (-175)
    const eastSpan = 180 - analysis.west;   // 180 - 175 = 5°
    const westSpan = 180 + analysis.east;   // 180 + (-175) = 5°
    const totalSpan = eastSpan + westSpan;  // 10°
    const center = 180 - (westSpan / 2) + (eastSpan / 2);
    const adjustedCenter = center > 180 ? center - 360 : center;
    return { center: adjustedCenter, span: totalSpan };
  } else {
    // Type B: from negative (e.g., -175) to positive (e.g., 175)
    // Chart spans: west (-175) -> -180/180 -> east (175)
    const westSpan = 180 + analysis.west;   // 180 + (-175) = 5°
    const eastSpan = 180 - analysis.east;   // 180 - 175 = 5°
    const totalSpan = westSpan + eastSpan;  // 10°
    const center = -180 + (westSpan / 2) - (eastSpan / 2);
    const adjustedCenter = center < -180 ? center + 360 : center;
    return { center: adjustedCenter, span: totalSpan };
  }
}

/**
 * Parse bounds for zoom-to functionality
 *
 * For antimeridian-crossing charts, we calculate the true center and span
 * and return bounds that will zoom to the correct area.
 */
function parseBoundsForZoom(bounds: string | null): [number, number, number, number] | undefined {
  if (!bounds) return undefined;

  const parts = bounds.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n))) {
    return undefined;
  }

  const [minLon, minLat, maxLon, maxLat] = parts;
  const analysis = analyzeBounds(minLon, minLat, maxLon, maxLat);

  // Handle antimeridian-crossing charts
  if (analysis.type === 'antimeridian-east-to-west' || analysis.type === 'antimeridian-west-to-east') {
    const { center, span } = calculateAntimeridianCenter(analysis);
    const halfSpan = Math.min(span / 2, 90); // Cap at reasonable zoom

    // Create bounds around the center
    // Note: These may cross the antimeridian, but at least center correctly
    let zoomWest = center - halfSpan;
    let zoomEast = center + halfSpan;

    // Normalize to [-180, 180] range
    if (zoomWest < -180) zoomWest += 360;
    if (zoomEast > 180) zoomEast -= 360;

    console.log(`Antimeridian zoom: center=${center.toFixed(2)}°, span=${span.toFixed(2)}° -> [${zoomWest.toFixed(2)}, ${zoomEast.toFixed(2)}]`);

    // Return the side that's closest to the center of the chart for best zoom behavior
    // For most antimeridian charts, using the dateline-crossing bounds works best
    return [
      Math.min(zoomWest, zoomEast),
      analysis.south,
      Math.max(zoomWest, zoomEast),
      analysis.north
    ];
  }

  // Return normalized bounds for normal/inverted cases
  return [analysis.west, analysis.south, analysis.east, analysis.north];
}

/**
 * Convert ChartInfo and layer state to ChartLayer
 */
function chartInfoToLayer(
  chart: ChartInfo,
  state?: ChartLayerStateInput,
  customMeta?: ChartCustomMetadataInput
): ChartLayer {
  const boundsStr = chart.metadata.bounds;

  // Use custom values if set, otherwise fall back to original metadata
  // Convert null to undefined to ensure consistent handling
  const metadataMinZoom = chart.metadata.minzoom ?? undefined;
  const metadataMaxZoom = chart.metadata.maxzoom ?? undefined;
  const effectiveMinZoom = customMeta?.customMinZoom ?? metadataMinZoom;
  const effectiveMaxZoom = customMeta?.customMaxZoom ?? metadataMaxZoom;

  const bounds = parseBounds(boundsStr);
  const zoomBounds = parseBoundsForZoom(boundsStr);

  // Diagnostic for antimeridian charts
  if (!bounds && zoomBounds) {
    console.info(`ChartLayer DIAG: ${chart.id} is antimeridian-crossing`, {
      rawBounds: boundsStr,
      bounds,
      zoomBounds,
      minZoom: effectiveMinZoom,
      maxZoom: effectiveMaxZoom,
    });
  }

  return {
    id: chart.id,
    chartId: chart.id,
    name: customMeta?.customName ?? chart.name,
    type: getTileType(chart.metadata.format),
    format: chart.metadata.format || 'png',
    enabled: state?.enabled ?? true,
    opacity: state?.opacity ?? 1.0,
    zOrder: state?.zOrder ?? 0,
    bounds, // For MapLibre source (undefined for antimeridian-crossing)
    zoomBounds, // For zoom-to functionality
    minZoom: effectiveMinZoom,
    maxZoom: effectiveMaxZoom,
    rawBoundsString: boundsStr ?? undefined,
    // Store custom metadata for display and editing
    description: chart.metadata.description ?? undefined,
    customName: customMeta?.customName ?? undefined,
    customDescription: customMeta?.customDescription ?? undefined,
    customMinZoom: customMeta?.customMinZoom ?? undefined,
    customMaxZoom: customMeta?.customMaxZoom ?? undefined,
  };
}

export function useChartLayers(): UseChartLayersReturn {
  const [layers, setLayers] = useState<ChartLayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load charts and layer states
  const refreshLayers = useCallback(async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Load available charts, saved states, and custom metadata
      const [charts, states, customMetadata] = await Promise.all([
        listCharts(),
        getChartLayerStates(),
        getAllChartCustomMetadata(),
      ]);

      // Create maps for quick lookup
      const stateMap = new Map(states.map(s => [s.chartId, s]));
      const customMetaMap = new Map(customMetadata.map(m => [m.chartId, m]));

      // Convert to ChartLayer, applying saved state and custom metadata
      const chartLayers = charts.map(chart =>
        chartInfoToLayer(chart, stateMap.get(chart.id), customMetaMap.get(chart.id))
      );

      // Sort by zOrder
      chartLayers.sort((a, b) => a.zOrder - b.zOrder);

      // SINGLE-SELECT ENFORCEMENT: Ensure only one chart is enabled at load time
      // If multiple are enabled from saved state, keep only the first one enabled
      const enabledCharts = chartLayers.filter(l => l.enabled);
      if (enabledCharts.length > 1) {
        console.info(`[useChartLayers] Multiple charts enabled (${enabledCharts.length}), enforcing single-select`);
        // Keep only the first enabled chart, disable the rest
        let foundFirst = false;
        for (const layer of chartLayers) {
          if (layer.enabled) {
            if (!foundFirst) {
              foundFirst = true;
            } else {
              layer.enabled = false;
              // Also save the disabled state to backend
              saveChartLayerState({
                chartId: layer.chartId,
                enabled: false,
                opacity: layer.opacity,
                zOrder: layer.zOrder,
              }).catch(err => console.error('Failed to save disabled state:', err));
            }
          }
        }
      }

      setLayers(chartLayers);
    } catch (err) {
      console.error('Failed to load chart layers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load charts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refreshLayers();
  }, [refreshLayers]);

  // Import chart from file
  const addChartFromFile = useCallback(async () => {
    if (!isTauri()) return;

    try {
      // Dynamic import to avoid issues when not in Tauri
      const { open } = await import('@tauri-apps/plugin-dialog');

      const selected = await open({
        multiple: true,
        filters: [{ name: 'MBTiles Charts', extensions: ['mbtiles'] }],
      });

      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];

      for (const path of paths) {
        await importChart(path);
      }

      // Refresh layer list
      await refreshLayers();
    } catch (err) {
      console.error('Failed to import chart:', err);
      setError(err instanceof Error ? err.message : 'Failed to import chart');
    }
  }, [refreshLayers]);

  // Remove a layer
  const removeLayer = useCallback(async (chartId: string) => {
    if (!isTauri()) return;

    try {
      await removeChart(chartId);
      await refreshLayers();
    } catch (err) {
      console.error('Failed to remove chart:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove chart');
    }
  }, [refreshLayers]);

  // Remove multiple layers at once
  const removeMultipleLayers = useCallback(async (chartIds: string[]) => {
    if (!isTauri() || chartIds.length === 0) return;

    try {
      setIsLoading(true);
      // Remove each chart - could be optimized with batch API if needed
      for (const chartId of chartIds) {
        await removeChart(chartId);
      }
      await refreshLayers();
    } catch (err) {
      console.error('Failed to remove charts:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove charts');
    } finally {
      setIsLoading(false);
    }
  }, [refreshLayers]);

  // Toggle layer visibility (single-select: only one chart visible at a time)
  const toggleLayer = useCallback(async (chartId: string) => {
    if (!isTauri()) return;

    try {
      const layer = layers.find(l => l.chartId === chartId);
      if (!layer) return;

      // If clicking on already-enabled chart, just disable it
      // If clicking on disabled chart, enable it and disable all others
      const newEnabled = !layer.enabled;

      // Update local state immediately for responsiveness
      // Single-select: when enabling a chart, disable all others
      setLayers(prev => prev.map(l => {
        if (l.chartId === chartId) {
          return { ...l, enabled: newEnabled };
        }
        // If we're enabling a chart, disable all others
        if (newEnabled && l.enabled) {
          return { ...l, enabled: false };
        }
        return l;
      }));

      // Save to backend - save the toggled chart
      await saveChartLayerState({
        chartId,
        enabled: newEnabled,
        opacity: layer.opacity,
        zOrder: layer.zOrder,
      });

      // If enabling this chart, also save disabled state for others
      if (newEnabled) {
        for (const otherLayer of layers) {
          if (otherLayer.chartId !== chartId && otherLayer.enabled) {
            await saveChartLayerState({
              chartId: otherLayer.chartId,
              enabled: false,
              opacity: otherLayer.opacity,
              zOrder: otherLayer.zOrder,
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to toggle layer:', err);
      // Revert on error
      await refreshLayers();
    }
  }, [layers, refreshLayers]);

  // Set layer opacity
  const setLayerOpacity = useCallback(async (chartId: string, opacity: number) => {
    if (!isTauri()) return;

    try {
      const layer = layers.find(l => l.chartId === chartId);
      if (!layer) return;

      // Clamp opacity between 0 and 1
      const clampedOpacity = Math.max(0, Math.min(1, opacity));

      // Update local state immediately
      setLayers(prev => prev.map(l =>
        l.chartId === chartId ? { ...l, opacity: clampedOpacity } : l
      ));

      // Save to backend
      await saveChartLayerState({
        chartId,
        enabled: layer.enabled,
        opacity: clampedOpacity,
        zOrder: layer.zOrder,
      });
    } catch (err) {
      console.error('Failed to set layer opacity:', err);
    }
  }, [layers]);

  // Get bounds for a layer (for zoom-to functionality)
  // Uses zoomBounds which handles antimeridian-crossing charts
  const zoomToLayer = useCallback((chartId: string): [number, number, number, number] | null => {
    const layer = layers.find(l => l.chartId === chartId);
    return layer?.zoomBounds ?? layer?.bounds ?? null;
  }, [layers]);

  // Update custom metadata for a chart
  const updateChartMetadata = useCallback(async (
    chartId: string,
    metadata: Partial<Omit<ChartCustomMetadataInput, 'chartId'>>
  ) => {
    if (!isTauri()) return;

    try {
      const layer = layers.find(l => l.chartId === chartId);
      if (!layer) return;

      // Merge with existing custom metadata
      const fullMetadata: ChartCustomMetadataInput = {
        chartId,
        customName: metadata.customName !== undefined ? metadata.customName : (layer.customName ?? null),
        customDescription: metadata.customDescription !== undefined ? metadata.customDescription : (layer.customDescription ?? null),
        customMinZoom: metadata.customMinZoom !== undefined ? metadata.customMinZoom : (layer.customMinZoom ?? null),
        customMaxZoom: metadata.customMaxZoom !== undefined ? metadata.customMaxZoom : (layer.customMaxZoom ?? null),
      };

      // Update local state immediately for responsiveness
      setLayers(prev => prev.map(l =>
        l.chartId === chartId ? {
          ...l,
          name: fullMetadata.customName ?? l.name,
          customName: fullMetadata.customName ?? undefined,
          customDescription: fullMetadata.customDescription ?? undefined,
          customMinZoom: fullMetadata.customMinZoom ?? undefined,
          customMaxZoom: fullMetadata.customMaxZoom ?? undefined,
          minZoom: fullMetadata.customMinZoom ?? l.minZoom,
          maxZoom: fullMetadata.customMaxZoom ?? l.maxZoom,
        } : l
      ));

      // Save to backend
      await saveChartCustomMetadata(fullMetadata);
    } catch (err) {
      console.error('Failed to update chart metadata:', err);
      // Revert on error
      await refreshLayers();
    }
  }, [layers, refreshLayers]);

  return {
    layers,
    isLoading,
    error,
    refreshLayers,
    addChartFromFile,
    removeLayer,
    removeMultipleLayers,
    toggleLayer,
    setLayerOpacity,
    zoomToLayer,
    updateChartMetadata,
  };
}
