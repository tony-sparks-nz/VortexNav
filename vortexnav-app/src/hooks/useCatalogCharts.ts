// Hook for browsing and managing catalog charts

import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CatalogChart, CommandResult, DownloadStatus } from '../types';

export interface ChartFilter {
  search: string;
  status: string | null;  // 'Active', 'Cancelled', null for all
  downloadStatus: DownloadStatus | null;
  minScale: number | null;
  maxScale: number | null;
}

export function useCatalogCharts(catalogId: number | null) {
  const [charts, setCharts] = useState<CatalogChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChartFilter>({
    search: '',
    status: null,
    downloadStatus: null,
    minScale: null,
    maxScale: null,
  });

  // Load charts from backend
  const refreshCharts = useCallback(async () => {
    if (catalogId === null) {
      setCharts([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CommandResult<CatalogChart[]>>('list_catalog_charts', {
        catalogId
      });

      if (result.success && result.data) {
        setCharts(result.data);
      } else {
        setError(result.error || 'Failed to load charts');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [catalogId]);

  // Load charts when catalog changes
  useEffect(() => {
    refreshCharts();
  }, [refreshCharts]);

  // Apply filters to charts
  const filteredCharts = useMemo(() => {
    return charts.filter(chart => {
      // Search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        if (!chart.title.toLowerCase().includes(searchLower) &&
            !chart.chart_id.toLowerCase().includes(searchLower)) {
          return false;
        }
      }

      // Status filter
      if (filter.status && chart.status !== filter.status) {
        return false;
      }

      // Download status filter
      if (filter.downloadStatus && chart.download_status !== filter.downloadStatus) {
        return false;
      }

      // Scale filters
      if (filter.minScale && chart.scale && chart.scale < filter.minScale) {
        return false;
      }
      if (filter.maxScale && chart.scale && chart.scale > filter.maxScale) {
        return false;
      }

      return true;
    });
  }, [charts, filter]);

  // Download a chart
  const downloadChart = useCallback(async (chartDbId: number) => {
    setError(null);

    // Optimistically update status
    setCharts(prev => prev.map(c =>
      c.id === chartDbId ? { ...c, download_status: 'downloading' as DownloadStatus } : c
    ));

    try {
      const result = await invoke<CommandResult<CatalogChart>>('download_catalog_chart', {
        chartDbId
      });

      if (result.success && result.data) {
        // Update chart in list
        setCharts(prev => prev.map(c =>
          c.id === chartDbId ? result.data! : c
        ));
        return result.data;
      } else {
        setError(result.error || 'Failed to download chart');
        // Revert optimistic update
        await refreshCharts();
        return null;
      }
    } catch (err) {
      setError(String(err));
      await refreshCharts();
      return null;
    }
  }, [refreshCharts]);

  // Download multiple charts
  const downloadCharts = useCallback(async (chartDbIds: number[]) => {
    const results: CatalogChart[] = [];

    for (const id of chartDbIds) {
      const result = await downloadChart(id);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }, [downloadChart]);

  // Get chart by ID
  const getChart = useCallback(async (chartDbId: number) => {
    try {
      const result = await invoke<CommandResult<CatalogChart | null>>('get_catalog_chart', {
        chartId: chartDbId
      });

      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Failed to get chart:', err);
      return null;
    }
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total = charts.length;
    const available = charts.filter(c => c.download_status === 'available').length;
    const downloading = charts.filter(c => c.download_status === 'downloading').length;
    const ready = charts.filter(c => c.download_status === 'ready').length;
    const failed = charts.filter(c => c.download_status === 'failed').length;
    const needsConversion = charts.filter(c => c.download_status === 'needs_conversion').length;
    const active = charts.filter(c => c.status === 'Active').length;
    const cancelled = charts.filter(c => c.status === 'Cancelled').length;

    return {
      total,
      available,
      downloading,
      ready,
      failed,
      needsConversion,
      active,
      cancelled,
    };
  }, [charts]);

  return {
    charts: filteredCharts,
    allCharts: charts,
    loading,
    error,
    filter,
    setFilter,
    refreshCharts,
    downloadChart,
    downloadCharts,
    getChart,
    stats,
  };
}
