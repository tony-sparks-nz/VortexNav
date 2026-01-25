import { useState, useCallback, useMemo } from 'react';
import type { BasemapProvider, ApiKeys, ThemeMode, ChartLayer } from '../types';
import { BASEMAP_OPTIONS } from '../types';
import { ChartLayerItem } from './ChartLayerItem';
import { CatalogManager } from './CatalogManager';

interface LayerSwitcherProps {
  theme: ThemeMode;
  currentBasemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
  chartLayers: ChartLayer[];
  chartLayersLoading: boolean;
  onBasemapChange: (basemap: BasemapProvider) => void;
  onOpenSeaMapToggle: (show: boolean) => void;
  onApiKeysChange: (keys: ApiKeys) => void;
  onAddChart: () => void;
  onRemoveChart: (chartId: string) => void;
  onRemoveMultipleCharts?: (chartIds: string[]) => void;
  onToggleChart: (chartId: string) => void;
  onChartOpacity: (chartId: string, opacity: number) => void;
  onZoomToChart: (chartId: string) => void;
  onRefreshCharts: () => void;
  onClose: () => void;
}

export function LayerSwitcher({
  theme,
  currentBasemap,
  showOpenSeaMap,
  apiKeys,
  chartLayers,
  chartLayersLoading,
  onBasemapChange,
  onOpenSeaMapToggle,
  onApiKeysChange,
  onAddChart,
  onRemoveChart,
  onRemoveMultipleCharts,
  onToggleChart,
  onChartOpacity,
  onZoomToChart,
  onRefreshCharts,
  onClose,
}: LayerSwitcherProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [tempEsriKey, setTempEsriKey] = useState(apiKeys.esri || '');
  const [showCatalogManager, setShowCatalogManager] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const [selectedForOpacity, setSelectedForOpacity] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState('');

  // Filter charts by name
  const filteredChartLayers = useMemo(() => {
    if (!nameFilter.trim()) return chartLayers;
    const filter = nameFilter.toLowerCase().trim();
    return chartLayers.filter(l =>
      l.name.toLowerCase().includes(filter) ||
      l.chartId.toLowerCase().includes(filter)
    );
  }, [chartLayers, nameFilter]);

  // Get the selected chart for opacity control
  const selectedChart = selectedForOpacity
    ? chartLayers.find(l => l.chartId === selectedForOpacity)
    : null;

  // Toggle selection for a single chart
  const toggleChartSelection = useCallback((chartId: string) => {
    setSelectedForDeletion(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chartId)) {
        newSet.delete(chartId);
      } else {
        newSet.add(chartId);
      }
      return newSet;
    });
  }, []);

  // Select or deselect all filtered charts
  const toggleSelectAll = useCallback(() => {
    const filteredIds = new Set(filteredChartLayers.map(l => l.chartId));
    const allFilteredSelected = filteredChartLayers.every(l => selectedForDeletion.has(l.chartId));

    if (allFilteredSelected) {
      // Deselect all filtered charts
      setSelectedForDeletion(prev => {
        const newSet = new Set(prev);
        filteredIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    } else {
      // Select all filtered charts
      setSelectedForDeletion(prev => new Set([...prev, ...filteredIds]));
    }
  }, [filteredChartLayers, selectedForDeletion]);

  // Show all selected charts (make visible)
  const showSelectedCharts = useCallback(() => {
    selectedForDeletion.forEach(chartId => {
      const layer = chartLayers.find(l => l.chartId === chartId);
      if (layer && !layer.enabled) {
        onToggleChart(chartId);
      }
    });
  }, [selectedForDeletion, chartLayers, onToggleChart]);

  // Hide all selected charts (make invisible)
  const hideSelectedCharts = useCallback(() => {
    selectedForDeletion.forEach(chartId => {
      const layer = chartLayers.find(l => l.chartId === chartId);
      if (layer && layer.enabled) {
        onToggleChart(chartId);
      }
    });
  }, [selectedForDeletion, chartLayers, onToggleChart]);

  // Delete all selected charts
  const deleteSelectedCharts = useCallback(async () => {
    if (selectedForDeletion.size === 0) return;

    const confirmMessage = selectedForDeletion.size === chartLayers.length
      ? `Delete ALL ${chartLayers.length} charts? This cannot be undone.`
      : `Delete ${selectedForDeletion.size} selected chart(s)? This cannot be undone.`;

    if (!window.confirm(confirmMessage)) return;

    if (onRemoveMultipleCharts) {
      onRemoveMultipleCharts(Array.from(selectedForDeletion));
    } else {
      // Fallback: delete one by one
      for (const chartId of selectedForDeletion) {
        onRemoveChart(chartId);
      }
    }
    setSelectedForDeletion(new Set());
  }, [selectedForDeletion, chartLayers.length, onRemoveMultipleCharts, onRemoveChart]);

  const allFilteredSelected = filteredChartLayers.length > 0 &&
    filteredChartLayers.every(l => selectedForDeletion.has(l.chartId));
  const someSelected = selectedForDeletion.size > 0;

  const handleSaveKeys = () => {
    onApiKeysChange({
      esri: tempEsriKey || undefined,
    });
    setShowSettings(false);
  };

  const isBasemapAvailable = (option: typeof BASEMAP_OPTIONS[0]): boolean => {
    if (!option.requiresApiKey) return true;
    if (option.requiresApiKey === 'esri') return !!apiKeys.esri;
    return true;
  };

  // Check if any basemap requires an API key (to show settings button)
  const hasApiKeyOptions = BASEMAP_OPTIONS.some(opt => opt.requiresApiKey);

  return (
    <div className={`layer-panel layer-panel--${theme}`}>
      <div className="layer-panel__header">
        <h2>Layers</h2>
        <button className="layer-panel__close" onClick={onClose}>×</button>
      </div>

      <div className="layer-panel__content">
        <div className="layer-panel__section">
          <div className="layer-panel__section-header">
            <h3>Basemap</h3>
            {hasApiKeyOptions && (
              <button
                className="layer-panel__settings-btn"
                onClick={() => setShowSettings(!showSettings)}
                title="API Settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}
          </div>

          {showSettings ? (
            <div className="layer-panel__settings">
              <div className="layer-panel__field">
                <label>Esri API Key (optional)</label>
                <input
                  type="password"
                  value={tempEsriKey}
                  onChange={(e) => setTempEsriKey(e.target.value)}
                  placeholder="Enter Esri API key..."
                />
                <small>
                  Required for Esri imagery. {' '}
                  <a href="https://developers.arcgis.com/sign-up/" target="_blank" rel="noopener noreferrer">
                    Get free API key
                  </a>
                </small>
              </div>

              <button className="layer-panel__save-btn" onClick={handleSaveKeys}>
                Save
              </button>
            </div>
          ) : (
            <>
              <div className="layer-panel__basemaps">
                {BASEMAP_OPTIONS.map((option) => {
                  const available = isBasemapAvailable(option);
                  const needsKey = option.requiresApiKey && !available;

                  return (
                    <button
                      key={option.id}
                      className={`basemap-option ${currentBasemap === option.id ? 'active' : ''} ${!available ? 'disabled' : ''}`}
                      onClick={() => available && onBasemapChange(option.id)}
                      disabled={!available}
                      title={needsKey ? `Requires ${option.requiresApiKey} API key` : option.description}
                    >
                      <span className="basemap-option__name">{option.name}</span>
                      {!option.offline && <span className="basemap-option__badge">Online</span>}
                      {needsKey && <span className="basemap-option__badge basemap-option__badge--key">Key</span>}
                    </button>
                  );
                })}
              </div>

              <div className="layer-panel__overlays">
                <h4>Overlays</h4>
                <label className="overlay-toggle">
                  <input
                    type="checkbox"
                    checked={showOpenSeaMap}
                    onChange={(e) => onOpenSeaMapToggle(e.target.checked)}
                  />
                  <span>OpenSeaMap (nautical features)</span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Chart Catalogs Section */}
        <div className="layer-panel__section layer-panel__catalogs">
          <div className="layer-panel__section-header">
            <h3>Chart Catalogs</h3>
            <button
              className="layer-panel__add-btn"
              onClick={() => setShowCatalogManager(!showCatalogManager)}
              title={showCatalogManager ? "Hide catalog manager" : "Show catalog manager"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {showCatalogManager ? (
                  <path d="M18 15l-6-6-6 6" />
                ) : (
                  <path d="M6 9l6 6 6-6" />
                )}
              </svg>
            </button>
          </div>

          {showCatalogManager && (
            <CatalogManager
              theme={theme}
              onChartReady={() => {
                onRefreshCharts();
              }}
            />
          )}
        </div>

        {/* Offline Charts Section */}
        <div className="layer-panel__section layer-panel__charts">
          <div className="layer-panel__section-header">
            <h3>Offline Charts ({chartLayers.length})</h3>
            <button
              className="layer-panel__add-btn"
              onClick={onAddChart}
              title="Import MBTiles chart"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {chartLayersLoading ? (
            <div className="layer-panel__loading">Loading charts...</div>
          ) : chartLayers.length === 0 ? (
            <div className="layer-panel__empty">
              No charts loaded. Click + to import MBTiles files.
            </div>
          ) : (
            <>
              {/* Name filter */}
              <div className="layer-panel__filter">
                <input
                  type="text"
                  className="layer-panel__filter-input"
                  placeholder="Filter by name..."
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                />
                {nameFilter && (
                  <button
                    className="layer-panel__filter-clear"
                    onClick={() => setNameFilter('')}
                    title="Clear filter"
                  >
                    ×
                  </button>
                )}
                {nameFilter && (
                  <span className="layer-panel__filter-count">
                    {filteredChartLayers.length}/{chartLayers.length}
                  </span>
                )}
              </div>

              {/* Bulk actions toolbar */}
              <div className="layer-panel__bulk-actions">
                <label className="layer-panel__select-all">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                  />
                  <span>Select All</span>
                </label>
                {someSelected && (
                  <>
                    <button
                      className="layer-panel__visibility-btn layer-panel__visibility-btn--show"
                      onClick={showSelectedCharts}
                      title="Show selected charts"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      Show
                    </button>
                    <button
                      className="layer-panel__visibility-btn layer-panel__visibility-btn--hide"
                      onClick={hideSelectedCharts}
                      title="Hide selected charts"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                      Hide
                    </button>
                    <button
                      className="layer-panel__delete-btn"
                      onClick={deleteSelectedCharts}
                      title={`Delete ${selectedForDeletion.size} selected chart(s)`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                      Delete ({selectedForDeletion.size})
                    </button>
                  </>
                )}
              </div>

              {/* Global opacity slider */}
              {selectedChart && (
                <div className="layer-panel__global-opacity">
                  <span className="layer-panel__global-opacity-label">
                    Opacity: {selectedChart.name}
                  </span>
                  <input
                    type="range"
                    className="layer-panel__global-opacity-slider"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedChart.opacity}
                    onChange={(e) => onChartOpacity(selectedChart.chartId, parseFloat(e.target.value))}
                  />
                  <span className="layer-panel__global-opacity-value">
                    {Math.round(selectedChart.opacity * 100)}%
                  </span>
                </div>
              )}

              <div className="layer-panel__chart-list">
                {filteredChartLayers.map((layer) => (
                  <div key={layer.id} className="layer-panel__chart-item-wrapper">
                    <label className="layer-panel__chart-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedForDeletion.has(layer.chartId)}
                        onChange={() => toggleChartSelection(layer.chartId)}
                      />
                    </label>
                    <ChartLayerItem
                      layer={layer}
                      theme={theme}
                      isSelected={selectedForOpacity === layer.chartId}
                      onToggle={() => onToggleChart(layer.chartId)}
                      onSelect={() => setSelectedForOpacity(
                        selectedForOpacity === layer.chartId ? null : layer.chartId
                      )}
                      onZoomTo={() => onZoomToChart(layer.chartId)}
                      onRemove={() => onRemoveChart(layer.chartId)}
                    />
                  </div>
                ))}
              </div>

              {/* Show message when filter has no results */}
              {filteredChartLayers.length === 0 && nameFilter && (
                <div className="layer-panel__empty">
                  No charts match "{nameFilter}"
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
