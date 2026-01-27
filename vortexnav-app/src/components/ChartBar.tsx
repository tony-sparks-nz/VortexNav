// OpenCPN-style chart selection bar
// Shows colored rectangles for charts overlapping the current viewport

import { useMemo, useState, useCallback } from 'react';
import { ChartLayer } from '../types';
import { LngLatBounds } from 'maplibre-gl';

interface ChartBarProps {
  chartLayers: ChartLayer[];
  viewportBounds: LngLatBounds | null;
  currentZoom: number;
  onToggleChart: (chartId: string) => void;
  allChartsHidden: boolean;
  onToggleAllCharts: () => void;
  showChartOutlines: boolean;
  onToggleChartOutlines: () => void;
  highlightedChartId: string | null;
  onChartHover: (chartId: string | null) => void;
}

type ChartType = 'rnc' | 'mbtiles';

/**
 * Determine if a chart is an RNC chart (from .kap conversion) or MBTiles
 */
function getChartType(layer: ChartLayer): ChartType {
  const format = layer.format?.toLowerCase();

  // Vector formats are always MBTiles
  if (format === 'pbf' || format === 'mvt') return 'mbtiles';

  // Check if chartId looks like an RNC chart ID (e.g., NZ411101, WS21102, TK11101)
  const rncPattern = /^[A-Z]{2}\d{4,6}$/;
  if (rncPattern.test(layer.chartId)) return 'rnc';

  return 'mbtiles';
}

/**
 * Check if chart bounds overlap with viewport bounds
 */
function boundsOverlap(
  chartBounds: [number, number, number, number] | undefined,
  viewportBounds: LngLatBounds | null
): boolean {
  if (!chartBounds || !viewportBounds) return false;

  const [chartMinLon, chartMinLat, chartMaxLon, chartMaxLat] = chartBounds;

  // Validate bounds - reject if any value is NaN or infinite
  if (!isFinite(chartMinLon) || !isFinite(chartMinLat) ||
      !isFinite(chartMaxLon) || !isFinite(chartMaxLat)) {
    console.warn('Invalid chart bounds (NaN or Infinite):', chartBounds);
    return false;
  }

  const viewMinLon = viewportBounds.getWest();
  const viewMaxLon = viewportBounds.getEast();
  const viewMinLat = viewportBounds.getSouth();
  const viewMaxLat = viewportBounds.getNorth();

  // Handle normal case (no antimeridian crossing)
  if (chartMinLon <= chartMaxLon) {
    // Standard bounding box overlap check
    return !(
      chartMaxLon < viewMinLon ||
      chartMinLon > viewMaxLon ||
      chartMaxLat < viewMinLat ||
      chartMinLat > viewMaxLat
    );
  }

  // Chart crosses antimeridian (chartMinLon > chartMaxLon)
  // Split into two boxes: [chartMinLon, 180] and [-180, chartMaxLon]
  const overlapWest = !(
    180 < viewMinLon ||
    chartMinLon > viewMaxLon ||
    chartMaxLat < viewMinLat ||
    chartMinLat > viewMaxLat
  );

  const overlapEast = !(
    chartMaxLon < viewMinLon ||
    -180 > viewMaxLon ||
    chartMaxLat < viewMinLat ||
    chartMinLat > viewMaxLat
  );

  return overlapWest || overlapEast;
}

/**
 * Get abbreviated display name for chart
 */
function getDisplayName(layer: ChartLayer): string {
  // Use chartId for RNC charts, truncate longer names
  if (layer.chartId.length <= 10) {
    return layer.chartId;
  }
  // For longer names, show first 8 chars
  return layer.chartId.slice(0, 8) + '...';
}

export function ChartBar({
  chartLayers,
  viewportBounds,
  currentZoom,
  onToggleChart,
  allChartsHidden,
  onToggleAllCharts,
  showChartOutlines,
  onToggleChartOutlines,
  highlightedChartId,
  onChartHover,
}: ChartBarProps) {
  const [tooltipChart, setTooltipChart] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Filter and sort charts
  const visibleCharts = useMemo(() => {
    // Consider charts with bounds OR zoomBounds (zoomBounds exists for antimeridian-crossing charts)
    const chartsWithBounds = chartLayers.filter(l => l.bounds || l.zoomBounds);

    // Debug: log filtering inputs (reduced verbosity)
    if (viewportBounds) {
      console.log('ChartBar filtering:', {
        totalCharts: chartLayers.length,
        chartsWithBounds: chartsWithBounds.length,
        viewport: `[${viewportBounds.getWest().toFixed(3)}, ${viewportBounds.getSouth().toFixed(3)}, ${viewportBounds.getEast().toFixed(3)}, ${viewportBounds.getNorth().toFixed(3)}]`,
        currentZoom: currentZoom.toFixed(1),
      });
    }

    // Filter to charts that overlap viewport and are in zoom range
    const overlapping = chartsWithBounds.filter((layer) => {
      // Always show all bounded charts if no viewport bounds yet
      if (!viewportBounds) {
        console.log(`  Chart ${layer.chartId}: INCLUDED (no viewport bounds yet)`);
        return true;
      }

      // Check bounds overlap - use zoomBounds as fallback for antimeridian-crossing charts
      const boundsToCheck = layer.bounds || layer.zoomBounds;
      const overlaps = boundsOverlap(boundsToCheck, viewportBounds);

      if (!overlaps) {
        // Only log non-overlapping charts at debug level
        console.debug(`  Chart ${layer.chartId}: EXCLUDED (no overlap)`, {
          bounds: boundsToCheck?.map(n => n.toFixed(3)).join(', '),
        });
        return false;
      }

      // Filter by zoom range - show charts that are "relevant" to current zoom
      // We show charts if the current zoom is within ±2 levels of the chart's optimal range
      const layerMinZoom = layer.minZoom ?? 0;
      const layerMaxZoom = layer.maxZoom ?? 22;
      const zoomBuffer = 2; // Tighter buffer to reduce irrelevant charts

      // If zoom metadata is missing (defaults used), include the chart but note it
      const hasZoomMeta = layer.minZoom !== undefined && layer.maxZoom !== undefined;
      const inZoomRange = currentZoom >= layerMinZoom - zoomBuffer && currentZoom <= layerMaxZoom + zoomBuffer;

      if (!inZoomRange) {
        console.debug(`  Chart ${layer.chartId}: EXCLUDED (zoom ${currentZoom.toFixed(1)} outside [${layerMinZoom}-${layerMaxZoom}])`);
        return false;
      }

      console.log(`  Chart ${layer.chartId}: INCLUDED (zoom ${hasZoomMeta ? `[${layerMinZoom}-${layerMaxZoom}]` : 'no zoom meta'})`);

      return true;
    });

    console.log('ChartBar result:', {
      visibleCount: overlapping.length,
      chartIds: overlapping.map(l => l.chartId),
    });

    // Sort by maxZoom descending (most zoomed = more detail = left side)
    return overlapping.sort((a, b) => {
      const aZoom = a.maxZoom ?? 18;
      const bZoom = b.maxZoom ?? 18;
      return bZoom - aZoom;
    });
  }, [chartLayers, viewportBounds, currentZoom]);

  // Handle long press for tooltip
  const handleLongPress = useCallback(
    (chartId: string, event: React.TouchEvent | React.MouseEvent) => {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      setTooltipChart(chartId);
      setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top });
    },
    []
  );

  const handleTouchEnd = useCallback(() => {
    setTooltipChart(null);
  }, []);

  // Don't render if no charts
  if (visibleCharts.length === 0) {
    return null;
  }

  return (
    <div className={`chart-bar ${allChartsHidden ? 'chart-bar--all-hidden' : ''}`}>
      {/* Global visibility toggle */}
      <button
        className={`chart-bar__toggle ${allChartsHidden ? 'chart-bar__toggle--off' : 'chart-bar__toggle--on'}`}
        onClick={onToggleAllCharts}
        title={allChartsHidden ? 'Show all charts' : 'Hide all charts'}
        aria-label={allChartsHidden ? 'Show all charts' : 'Hide all charts'}
        aria-pressed={!allChartsHidden}
      >
        {allChartsHidden ? (
          // Eye-off icon
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          // Eye icon
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>

      {/* Chart outlines toggle */}
      <button
        className={`chart-bar__toggle chart-bar__toggle--outline ${showChartOutlines ? 'chart-bar__toggle--on' : 'chart-bar__toggle--off'}`}
        onClick={onToggleChartOutlines}
        title={showChartOutlines ? 'Hide chart outlines' : 'Show chart outlines'}
        aria-label={showChartOutlines ? 'Hide chart outlines' : 'Show chart outlines'}
        aria-pressed={showChartOutlines}
      >
        {/* Rectangle/frame icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      </button>

      {visibleCharts.map((layer) => {
        const chartType = getChartType(layer);
        const displayName = getDisplayName(layer);
        const isHighlighted = highlightedChartId === layer.chartId;

        const className = [
          'chart-bar__item',
          `chart-bar__item--${chartType}`,
          layer.enabled ? 'chart-bar__item--enabled' : 'chart-bar__item--disabled',
          isHighlighted ? 'chart-bar__item--highlighted' : '',
        ].join(' ');

        return (
          <button
            key={layer.chartId}
            className={className}
            onClick={() => onToggleChart(layer.chartId)}
            onMouseEnter={() => onChartHover(layer.chartId)}
            onMouseLeave={() => onChartHover(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              handleLongPress(layer.chartId, e);
            }}
            onTouchStart={(e) => {
              // Long press detection
              const timer = setTimeout(() => handleLongPress(layer.chartId, e), 500);
              (e.target as HTMLElement).dataset.longPressTimer = String(timer);
            }}
            onTouchEnd={(e) => {
              const timer = (e.target as HTMLElement).dataset.longPressTimer;
              if (timer) {
                clearTimeout(Number(timer));
              }
              handleTouchEnd();
            }}
            title={layer.name}
            aria-label={`${layer.name} - ${layer.enabled ? 'visible' : 'hidden'}`}
            aria-pressed={layer.enabled}
          >
            <span className="chart-bar__item-label">{displayName}</span>
          </button>
        );
      })}

      {/* Tooltip for long press */}
      {tooltipChart && (
        <div
          className="chart-bar__tooltip"
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y - 40,
          }}
        >
          {chartLayers.find((l) => l.chartId === tooltipChart)?.name || tooltipChart}
        </div>
      )}
    </div>
  );
}
