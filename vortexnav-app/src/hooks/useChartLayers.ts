// Chart Layers Hook - Manages MBTiles chart layer state
import { useState, useEffect, useCallback } from 'react';
import type { ChartLayer } from '../types';
import {
  listCharts,
  importChart,
  removeChart,
  saveChartLayerState,
  getChartLayerStates,
  isTauri,
  type ChartInfo,
  type ChartLayerStateInput,
} from './useTauri';

interface UseChartLayersReturn {
  layers: ChartLayer[];
  isLoading: boolean;
  error: string | null;
  refreshLayers: () => Promise<void>;
  addChartFromFile: () => Promise<void>;
  removeLayer: (chartId: string) => Promise<void>;
  toggleLayer: (chartId: string) => Promise<void>;
  setLayerOpacity: (chartId: string, opacity: number) => Promise<void>;
  zoomToLayer: (chartId: string) => [number, number, number, number] | null;
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
 * Parse bounds string "minlon,minlat,maxlon,maxlat" to array
 */
function parseBounds(bounds: string | null): [number, number, number, number] | undefined {
  if (!bounds) return undefined;
  const parts = bounds.split(',').map(Number);
  if (parts.length === 4 && parts.every(n => !isNaN(n))) {
    return parts as [number, number, number, number];
  }
  return undefined;
}

/**
 * Convert ChartInfo and layer state to ChartLayer
 */
function chartInfoToLayer(chart: ChartInfo, state?: ChartLayerStateInput): ChartLayer {
  return {
    id: chart.id,
    chartId: chart.id,
    name: chart.name,
    type: getTileType(chart.metadata.format),
    format: chart.metadata.format || 'png',
    enabled: state?.enabled ?? true,
    opacity: state?.opacity ?? 1.0,
    zOrder: state?.zOrder ?? 0,
    bounds: parseBounds(chart.metadata.bounds),
    minZoom: chart.metadata.minzoom ?? undefined,
    maxZoom: chart.metadata.maxzoom ?? undefined,
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

      // Load available charts and their saved states
      const [charts, states] = await Promise.all([
        listCharts(),
        getChartLayerStates(),
      ]);

      // Create a map of states by chartId for quick lookup
      const stateMap = new Map(states.map(s => [s.chartId, s]));

      // Convert to ChartLayer, applying saved state
      const chartLayers = charts.map(chart =>
        chartInfoToLayer(chart, stateMap.get(chart.id))
      );

      // Sort by zOrder
      chartLayers.sort((a, b) => a.zOrder - b.zOrder);

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

  // Toggle layer visibility
  const toggleLayer = useCallback(async (chartId: string) => {
    if (!isTauri()) return;

    try {
      const layer = layers.find(l => l.chartId === chartId);
      if (!layer) return;

      const newEnabled = !layer.enabled;

      // Update local state immediately for responsiveness
      setLayers(prev => prev.map(l =>
        l.chartId === chartId ? { ...l, enabled: newEnabled } : l
      ));

      // Save to backend
      await saveChartLayerState({
        chartId,
        enabled: newEnabled,
        opacity: layer.opacity,
        zOrder: layer.zOrder,
      });
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
  const zoomToLayer = useCallback((chartId: string): [number, number, number, number] | null => {
    const layer = layers.find(l => l.chartId === chartId);
    return layer?.bounds ?? null;
  }, [layers]);

  return {
    layers,
    isLoading,
    error,
    refreshLayers,
    addChartFromFile,
    removeLayer,
    toggleLayer,
    setLayerOpacity,
    zoomToLayer,
  };
}
