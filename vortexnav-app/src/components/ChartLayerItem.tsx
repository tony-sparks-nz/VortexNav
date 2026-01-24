// Chart Layer Item Component - Individual chart layer control
import type { ChartLayer, ThemeMode } from '../types';

interface ChartLayerItemProps {
  layer: ChartLayer;
  theme: ThemeMode;
  onToggle: () => void;
  onOpacityChange: (opacity: number) => void;
  onZoomTo: () => void;
  onRemove: () => void;
}

export function ChartLayerItem({
  layer,
  onToggle,
  onOpacityChange,
  onZoomTo,
  onRemove,
}: ChartLayerItemProps) {
  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onOpacityChange(parseFloat(e.target.value));
  };

  return (
    <div className={`chart-layer-item ${!layer.enabled ? 'chart-layer-item--disabled' : ''}`}>
      <div className="chart-layer-item__header">
        <label className="chart-layer-item__toggle">
          <input
            type="checkbox"
            checked={layer.enabled}
            onChange={onToggle}
          />
          <span className="chart-layer-item__toggle-slider" />
        </label>

        <div className="chart-layer-item__info">
          <span className="chart-layer-item__name" title={layer.name}>
            {layer.name}
          </span>
          <div className="chart-layer-item__meta">
            <span>{layer.type === 'vector' ? 'Vector' : 'Raster'}</span>
            {layer.format && <span>• {layer.format.toUpperCase()}</span>}
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

      {layer.enabled && (
        <div className="chart-layer-item__opacity">
          <span className="chart-layer-item__opacity-label">Opacity</span>
          <input
            type="range"
            className="chart-layer-item__opacity-slider"
            min="0"
            max="1"
            step="0.05"
            value={layer.opacity}
            onChange={handleOpacityChange}
          />
          <span className="chart-layer-item__opacity-value">
            {Math.round(layer.opacity * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
