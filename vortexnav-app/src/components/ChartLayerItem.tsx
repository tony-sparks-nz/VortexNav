// Chart Layer Item Component - Individual chart layer control (compact version)
import type { ChartLayer, ThemeMode } from '../types';

interface ChartLayerItemProps {
  layer: ChartLayer;
  theme: ThemeMode;
  isSelected?: boolean;
  onToggle: () => void;
  onSelect?: () => void;
  onZoomTo: () => void;
  onRemove: () => void;
  onEdit?: () => void;
}

// Check if a chart has complete metadata for proper display
function hasCompleteMetadata(layer: ChartLayer): boolean {
  return layer.bounds !== undefined &&
         layer.minZoom !== undefined &&
         layer.maxZoom !== undefined;
}

export function ChartLayerItem({
  layer,
  isSelected,
  onToggle,
  onSelect,
  onZoomTo,
  onRemove,
  onEdit,
}: ChartLayerItemProps) {
  const isComplete = hasCompleteMetadata(layer);
  const missingBounds = !layer.bounds;
  const missingZoom = layer.minZoom === undefined || layer.maxZoom === undefined;

  const handleClick = (e: React.MouseEvent) => {
    // Don't select when clicking on buttons or toggle
    if ((e.target as HTMLElement).closest('button, label')) return;
    onSelect?.();
  };

  return (
    <div
      className={`chart-layer-item ${!layer.enabled ? 'chart-layer-item--disabled' : ''} ${!isComplete ? 'chart-layer-item--incomplete' : ''} ${isSelected ? 'chart-layer-item--selected' : ''}`}
      onClick={handleClick}
    >
      <div className="chart-layer-item__header">
        <label className="chart-layer-item__toggle">
          <input
            type="checkbox"
            checked={layer.enabled}
            onChange={onToggle}
            disabled={missingBounds}
          />
          <span className="chart-layer-item__toggle-slider" />
        </label>

        <div className="chart-layer-item__info">
          <div className="chart-layer-item__name-row">
            <span className="chart-layer-item__name" title={layer.name}>
              {layer.chartId}
            </span>
            {missingBounds && (
              <span
                className="chart-layer-item__warning"
                title="Missing bounds metadata - chart cannot be displayed. Run 'Fix Bounds' from catalog manager."
              >
                ⚠️
              </span>
            )}
            {/* Show opacity percentage inline */}
            {layer.enabled && !missingBounds && (
              <span className="chart-layer-item__opacity-badge">
                {Math.round(layer.opacity * 100)}%
              </span>
            )}
          </div>
          <div className="chart-layer-item__meta">
            <span className="chart-layer-item__full-name" title={layer.name}>
              {layer.name !== layer.chartId ? layer.name : (layer.type === 'vector' ? 'Vector Chart' : 'Raster Chart')}
            </span>
            {missingBounds && <span className="chart-layer-item__meta--warning">• No bounds</span>}
            {missingZoom && !missingBounds && <span className="chart-layer-item__meta--warning">• No zoom range</span>}
          </div>
        </div>

        <div className="chart-layer-item__actions">
          {layer.bounds && (
            <button
              className="chart-layer-item__btn"
              onClick={onZoomTo}
              title="Zoom to chart bounds"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
                <path d="M11 8v6M8 11h6" />
              </svg>
            </button>
          )}
          {onEdit && (
            <button
              className="chart-layer-item__btn"
              onClick={onEdit}
              title="Edit chart metadata"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          <button
            className="chart-layer-item__btn chart-layer-item__btn--danger"
            onClick={onRemove}
            title="Remove chart"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
