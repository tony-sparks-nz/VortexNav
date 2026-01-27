// Chart Edit Modal - Edit chart name, description, and zoom levels
import { useState, useEffect } from 'react';
import type { ChartLayer, ThemeMode } from '../types';

interface ChartEditModalProps {
  chart: ChartLayer;
  theme: ThemeMode;
  onSave: (chartId: string, metadata: {
    customName: string | null;
    customDescription: string | null;
    customMinZoom: number | null;
    customMaxZoom: number | null;
  }) => void;
  onClose: () => void;
}

export function ChartEditModal({ chart, theme, onSave, onClose }: ChartEditModalProps) {
  // Form state - initialize with custom values if set, otherwise use original
  const [name, setName] = useState(chart.customName ?? chart.name);
  const [description, setDescription] = useState(chart.customDescription ?? chart.description ?? '');
  const [minZoom, setMinZoom] = useState<string>(
    chart.customMinZoom?.toString() ?? chart.minZoom?.toString() ?? ''
  );
  const [maxZoom, setMaxZoom] = useState<string>(
    chart.customMaxZoom?.toString() ?? chart.maxZoom?.toString() ?? ''
  );

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = () => {
    const parsedMinZoom = minZoom.trim() ? parseInt(minZoom, 10) : null;
    const parsedMaxZoom = maxZoom.trim() ? parseInt(maxZoom, 10) : null;

    onSave(chart.chartId, {
      customName: name.trim() !== chart.name ? name.trim() : null,
      customDescription: description.trim() || null,
      customMinZoom: !isNaN(parsedMinZoom as number) ? parsedMinZoom : null,
      customMaxZoom: !isNaN(parsedMaxZoom as number) ? parsedMaxZoom : null,
    });
    onClose();
  };

  const handleReset = () => {
    // Reset to original values (clear custom overrides)
    onSave(chart.chartId, {
      customName: null,
      customDescription: null,
      customMinZoom: null,
      customMaxZoom: null,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`chart-edit-modal chart-edit-modal--${theme}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chart-edit-modal__header">
          <h3>Edit Chart</h3>
          <button className="chart-edit-modal__close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="chart-edit-modal__content">
          {/* Chart ID (read-only) */}
          <div className="chart-edit-modal__field">
            <label>Chart ID</label>
            <input type="text" value={chart.chartId} disabled />
          </div>

          {/* Name */}
          <div className="chart-edit-modal__field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Chart name..."
            />
            {chart.customName && (
              <small className="chart-edit-modal__hint">
                Original: {chart.name}
              </small>
            )}
          </div>

          {/* Description */}
          <div className="chart-edit-modal__field">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Chart description..."
              rows={3}
            />
          </div>

          {/* Zoom Range */}
          <div className="chart-edit-modal__row">
            <div className="chart-edit-modal__field chart-edit-modal__field--half">
              <label>Min Zoom</label>
              <input
                type="number"
                min="0"
                max="22"
                value={minZoom}
                onChange={(e) => setMinZoom(e.target.value)}
                placeholder={chart.minZoom?.toString() ?? '0'}
              />
            </div>
            <div className="chart-edit-modal__field chart-edit-modal__field--half">
              <label>Max Zoom</label>
              <input
                type="number"
                min="0"
                max="22"
                value={maxZoom}
                onChange={(e) => setMaxZoom(e.target.value)}
                placeholder={chart.maxZoom?.toString() ?? '22'}
              />
            </div>
          </div>

          {/* Original zoom info */}
          <div className="chart-edit-modal__info">
            <small>
              Original zoom range: {chart.minZoom ?? '?'} - {chart.maxZoom ?? '?'}
            </small>
          </div>

          {/* Bounds info (read-only) */}
          {chart.rawBoundsString && (
            <div className="chart-edit-modal__field">
              <label>Bounds</label>
              <input
                type="text"
                value={chart.rawBoundsString}
                disabled
                title="Bounds are extracted from the MBTiles file and cannot be edited"
              />
            </div>
          )}
        </div>

        <div className="chart-edit-modal__footer">
          <button
            className="chart-edit-modal__btn chart-edit-modal__btn--reset"
            onClick={handleReset}
            title="Reset to original values from MBTiles file"
          >
            Reset
          </button>
          <div className="chart-edit-modal__spacer" />
          <button
            className="chart-edit-modal__btn chart-edit-modal__btn--cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="chart-edit-modal__btn chart-edit-modal__btn--save"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
