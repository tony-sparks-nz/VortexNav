/**
 * DownloadAreaOverlay - Header bar for download area configuration
 *
 * Shows during polygon drawing and configuration phases.
 * Follows the same pattern as RouteCreationOverlay.
 */

import { useMemo } from 'react';
import type { ThemeMode, PolygonPoint, BasemapProvider } from '../types';
import { DOWNLOAD_AREA_LIMITS, DOWNLOADABLE_BASEMAPS } from '../types';
import {
  formatBytes,
  formatArea,
  calculateSquareMiles,
  polygonToBounds,
} from '../utils/tileCalculations';

interface DownloadAreaOverlayProps {
  theme: ThemeMode;
  // Drawing phase
  isDrawing: boolean;
  polygonPoints: PolygonPoint[];
  // Configuration phase
  isConfiguring: boolean;
  downloadName: string;
  basemapId: BasemapProvider;
  minZoom: number;
  maxZoom: number;
  maxZoomLimit: number; // From entitlements
  estimatedTileCount: number;
  estimatedSizeBytes: number;
  // Download state
  isDownloading: boolean;
  downloadProgress: number;
  downloadedTiles: number;
  totalTiles: number;
  downloadPhase: string | null; // "Downloading tiles", "Creating offline pack", "Storing to disk"
  error: string | null;
  // Layout
  rightPanelOpen?: boolean;
  // Callbacks
  onNameChange: (name: string) => void;
  onBasemapChange: (basemapId: BasemapProvider) => void;
  onMinZoomChange: (zoom: number) => void;
  onMaxZoomChange: (zoom: number) => void;
  onUndo: () => void;
  onCancel: () => void;
  onFinishDrawing: () => void;
  onStartDownload: () => void;
}

export function DownloadAreaOverlay({
  theme,
  isDrawing,
  polygonPoints,
  isConfiguring,
  downloadName,
  basemapId,
  minZoom,
  maxZoom,
  maxZoomLimit,
  estimatedTileCount,
  estimatedSizeBytes,
  isDownloading,
  downloadProgress,
  downloadedTiles,
  totalTiles,
  downloadPhase,
  error,
  rightPanelOpen = false,
  onNameChange,
  onBasemapChange,
  onMinZoomChange,
  onMaxZoomChange,
  onUndo,
  onCancel,
  onFinishDrawing,
  onStartDownload,
}: DownloadAreaOverlayProps) {
  // Calculate area from polygon
  const areaInfo = useMemo(() => {
    const bounds = polygonToBounds(polygonPoints);
    if (!bounds) return null;
    const sqMiles = calculateSquareMiles(bounds);
    return formatArea(sqMiles);
  }, [polygonPoints]);

  const canFinishDrawing = polygonPoints.length >= 3;
  const tileCountWarning = estimatedTileCount > DOWNLOAD_AREA_LIMITS.WARNING_TILE_COUNT;
  const tileCountError = estimatedTileCount > DOWNLOAD_AREA_LIMITS.MAX_TILE_COUNT;
  const canDownload =
    isConfiguring &&
    downloadName.trim() !== '' &&
    estimatedTileCount > 0 &&
    !tileCountError &&
    !isDownloading;

  const className = [
    'download-area-overlay',
    `download-area-overlay--${theme}`,
    rightPanelOpen ? 'download-area-overlay--panel-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Render drawing mode UI
  if (isDrawing) {
    return (
      <div className={className}>
        <div className="download-area-overlay__title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Draw Download Area</span>
        </div>

        <div className="download-area-overlay__stats">
          <div className="download-area-overlay__stat">
            <span className="download-area-overlay__stat-value">{polygonPoints.length}</span>
            <span className="download-area-overlay__stat-label">Points</span>
          </div>
          {areaInfo && (
            <div className="download-area-overlay__stat">
              <span className="download-area-overlay__stat-value">{areaInfo}</span>
              <span className="download-area-overlay__stat-label">Area</span>
            </div>
          )}
        </div>

        <div className="download-area-overlay__hint">
          Click to add points. Double-click or press Finish to close polygon.
        </div>

        <div className="download-area-overlay__actions">
          <button
            className="download-area-overlay__btn download-area-overlay__btn--secondary"
            onClick={onUndo}
            disabled={polygonPoints.length === 0}
            title="Remove last point"
          >
            Undo
          </button>
          <button
            className="download-area-overlay__btn download-area-overlay__btn--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="download-area-overlay__btn download-area-overlay__btn--primary"
            onClick={onFinishDrawing}
            disabled={!canFinishDrawing}
            title={canFinishDrawing ? 'Close polygon' : 'Add at least 3 points'}
          >
            Finish
          </button>
        </div>
      </div>
    );
  }

  // Render configuration mode UI
  if (isConfiguring) {
    return (
      <div className={className}>
        {/* Name input */}
        <input
          type="text"
          className="download-area-overlay__name-input"
          value={downloadName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Name..."
          disabled={isDownloading}
        />

        {/* Basemap selector - only downloadable basemaps */}
        <select
          className="download-area-overlay__basemap-select"
          value={basemapId}
          onChange={(e) => onBasemapChange(e.target.value as BasemapProvider)}
          disabled={isDownloading}
        >
          {DOWNLOADABLE_BASEMAPS.map((basemap) => (
            <option key={basemap.id} value={basemap.id}>
              {basemap.name}
            </option>
          ))}
        </select>

        {/* Dual-thumb zoom range */}
        <div className="download-area-overlay__zoom-range">
          <span className="download-area-overlay__zoom-label">
            Z {minZoom}-{maxZoom}
            {maxZoom >= maxZoomLimit && <span className="download-area-overlay__zoom-limit">★</span>}
          </span>
          <div className="download-area-overlay__range-track">
            <input
              type="range"
              className="download-area-overlay__range-min"
              min={1}
              max={maxZoomLimit}
              value={minZoom}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val < maxZoom) onMinZoomChange(val);
              }}
              disabled={isDownloading}
            />
            <input
              type="range"
              className="download-area-overlay__range-max"
              min={1}
              max={maxZoomLimit}
              value={maxZoom}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val > minZoom) onMaxZoomChange(val);
              }}
              disabled={isDownloading}
            />
          </div>
        </div>

        {/* Compact stats */}
        <div className="download-area-overlay__stats-compact">
          {areaInfo && <span>{areaInfo}</span>}
          <span className={tileCountError ? 'error' : tileCountWarning ? 'warning' : ''}>
            {estimatedTileCount.toLocaleString()} tiles
          </span>
          <span>{formatBytes(estimatedSizeBytes)}</span>
        </div>

        {/* Actions with inline progress */}
        <div className="download-area-overlay__actions">
          {isDownloading ? (
            <div className="download-area-overlay__progress-inline">
              <div className="download-area-overlay__progress-ring">
                <svg viewBox="0 0 36 36">
                  <circle className="download-area-overlay__progress-bg" cx="18" cy="18" r="16" />
                  <circle
                    className="download-area-overlay__progress-fill"
                    cx="18" cy="18" r="16"
                    strokeDasharray={`${downloadProgress}, 100`}
                  />
                </svg>
                <span className="download-area-overlay__progress-percent">
                  {downloadedTiles.toLocaleString()}/{totalTiles.toLocaleString()}
                </span>
              </div>
              {downloadPhase && (
                <span className="download-area-overlay__phase-text">{downloadPhase}</span>
              )}
              <button
                className="download-area-overlay__btn download-area-overlay__btn--secondary"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          ) : error ? (
            <div className="download-area-overlay__error-inline">
              <span className="download-area-overlay__error-text" title={error}>⚠ Error</span>
              <button
                className="download-area-overlay__btn download-area-overlay__btn--secondary"
                onClick={onCancel}
              >
                Close
              </button>
              <button
                className="download-area-overlay__btn download-area-overlay__btn--primary"
                onClick={onStartDownload}
                disabled={!canDownload}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <button
                className="download-area-overlay__btn download-area-overlay__btn--secondary"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="download-area-overlay__btn download-area-overlay__btn--primary"
                onClick={onStartDownload}
                disabled={!canDownload}
                title={
                  !downloadName.trim()
                    ? 'Enter a name'
                    : tileCountError
                    ? 'Too many tiles'
                    : estimatedTileCount === 0
                    ? 'Invalid area'
                    : 'Start download'
                }
              >
                Download
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Not active - don't render
  return null;
}
