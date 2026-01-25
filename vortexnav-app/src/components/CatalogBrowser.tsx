// Catalog Browser component for viewing and downloading charts from a catalog

import { useState } from 'react';
import { CatalogChart, GdalInfo, DownloadStatus } from '../types';
import { useCatalogCharts } from '../hooks/useCatalogCharts';

interface CatalogBrowserProps {
  catalogId: number;
  catalogName: string;
  catalogType: 'RNC' | 'ENC';
  gdalInfo: GdalInfo | null;
  onBack: () => void;
  onChartReady?: () => void;
}

export function CatalogBrowser({
  catalogId,
  catalogName,
  catalogType,
  gdalInfo,
  onBack,
  onChartReady,
}: CatalogBrowserProps) {
  const {
    charts,
    loading,
    error,
    filter,
    setFilter,
    downloadChart,
    stats,
  } = useCatalogCharts(catalogId);

  const [selectedCharts, setSelectedCharts] = useState<Set<number>>(new Set());
  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());

  const handleDownload = async (chart: CatalogChart) => {
    if (!chart.id) return;

    setDownloadingIds(prev => new Set(prev).add(chart.id!));

    try {
      const result = await downloadChart(chart.id);
      if (result?.download_status === 'ready' && onChartReady) {
        onChartReady();
      }
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(chart.id!);
        return next;
      });
    }
  };

  const handleDownloadSelected = async () => {
    for (const chartId of selectedCharts) {
      const chart = charts.find(c => c.id === chartId);
      if (chart && chart.download_status === 'available') {
        await handleDownload(chart);
      }
    }
    setSelectedCharts(new Set());
  };

  const toggleChartSelection = (chartId: number) => {
    setSelectedCharts(prev => {
      const next = new Set(prev);
      if (next.has(chartId)) {
        next.delete(chartId);
      } else {
        next.add(chartId);
      }
      return next;
    });
  };

  const selectAllAvailable = () => {
    const availableIds = charts
      .filter(c => c.id && c.download_status === 'available')
      .map(c => c.id!);
    setSelectedCharts(new Set(availableIds));
  };

  const clearSelection = () => {
    setSelectedCharts(new Set());
  };

  const getStatusBadge = (status: DownloadStatus) => {
    const badges: Record<DownloadStatus, { label: string; className: string }> = {
      available: { label: 'Available', className: 'status-available' },
      downloading: { label: 'Downloading...', className: 'status-downloading' },
      downloaded: { label: 'Downloaded', className: 'status-downloaded' },
      converting: { label: 'Converting...', className: 'status-converting' },
      ready: { label: 'Ready', className: 'status-ready' },
      needs_conversion: { label: 'Needs GDAL', className: 'status-needs-conversion' },
      failed: { label: 'Failed', className: 'status-failed' },
    };
    return badges[status] || { label: status, className: '' };
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatScale = (scale: number | null) => {
    if (!scale) return '';
    if (scale >= 1000000) return `1:${(scale / 1000000).toFixed(1)}M`;
    if (scale >= 1000) return `1:${(scale / 1000).toFixed(0)}K`;
    return `1:${scale}`;
  };

  return (
    <div className="catalog-browser">
      <div className="catalog-browser-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div className="catalog-title">
          <h3>{catalogName}</h3>
          <span className={`catalog-type ${catalogType.toLowerCase()}`}>{catalogType}</span>
        </div>
      </div>

      {!gdalInfo?.available && (
        <div className="gdal-warning">
          <strong>GDAL is not installed.</strong> Charts will be downloaded but cannot be converted for display.
          {gdalInfo?.install_hint && (
            <pre className="gdal-install-hint">{gdalInfo.install_hint}</pre>
          )}
        </div>
      )}

      {error && <div className="catalog-error">{error}</div>}

      <div className="catalog-stats">
        <span>Total: {stats.total}</span>
        <span>Active: {stats.active}</span>
        <span>Ready: {stats.ready}</span>
        <span>Available: {stats.available}</span>
        {stats.needsConversion > 0 && (
          <span className="needs-conversion">Needs Conversion: {stats.needsConversion}</span>
        )}
      </div>

      <div className="catalog-filters">
        <input
          type="text"
          placeholder="Search charts..."
          value={filter.search}
          onChange={(e) => setFilter(prev => ({ ...prev, search: e.target.value }))}
          className="search-input"
        />
        <select
          value={filter.status || ''}
          onChange={(e) => setFilter(prev => ({ ...prev, status: e.target.value || null }))}
          className="status-filter"
        >
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select
          value={filter.downloadStatus || ''}
          onChange={(e) => setFilter(prev => ({
            ...prev,
            downloadStatus: (e.target.value as DownloadStatus) || null
          }))}
          className="download-filter"
        >
          <option value="">All Downloads</option>
          <option value="available">Available</option>
          <option value="ready">Ready</option>
          <option value="downloading">Downloading</option>
          <option value="needs_conversion">Needs Conversion</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="selection-actions">
        <button onClick={selectAllAvailable} disabled={stats.available === 0}>
          Select All Available
        </button>
        <button onClick={clearSelection} disabled={selectedCharts.size === 0}>
          Clear Selection ({selectedCharts.size})
        </button>
        <button
          onClick={handleDownloadSelected}
          disabled={selectedCharts.size === 0 || loading}
          className="download-selected-btn"
        >
          Download Selected
        </button>
      </div>

      {loading && <div className="catalog-loading">Loading charts...</div>}

      <div className="chart-list">
        {charts.length === 0 && !loading && (
          <div className="no-charts">No charts match the current filters.</div>
        )}

        {charts.map(chart => {
          const statusBadge = getStatusBadge(chart.download_status);
          const isDownloading = downloadingIds.has(chart.id!) || chart.download_status === 'downloading';
          const canDownload = chart.download_status === 'available';
          const isSelected = selectedCharts.has(chart.id!);

          return (
            <div
              key={chart.id}
              className={`chart-item ${isSelected ? 'selected' : ''}`}
            >
              <div className="chart-checkbox">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleChartSelection(chart.id!)}
                  disabled={!canDownload}
                />
              </div>
              <div className="chart-info">
                <div className="chart-title">{chart.title}</div>
                <div className="chart-meta">
                  <span className="chart-id">{chart.chart_id}</span>
                  {chart.scale && (
                    <span className="chart-scale">{formatScale(chart.scale)}</span>
                  )}
                  {chart.file_size && (
                    <span className="chart-size">{formatFileSize(chart.file_size)}</span>
                  )}
                  <span className={`chart-status ${chart.status?.toLowerCase()}`}>
                    {chart.status}
                  </span>
                </div>
                {chart.error_message && (
                  <div className="chart-error" title={chart.error_message}>
                    Error: {chart.error_message.substring(0, 50)}...
                  </div>
                )}
              </div>
              <div className="chart-actions">
                <span className={`download-status ${statusBadge.className}`}>
                  {statusBadge.label}
                </span>
                {canDownload && (
                  <button
                    className="download-btn"
                    onClick={() => handleDownload(chart)}
                    disabled={isDownloading}
                  >
                    {isDownloading ? 'Downloading...' : 'Download'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
