import { useState } from 'react';
import type { BasemapProvider, ApiKeys, ThemeMode, ChartLayer } from '../types';
import { BASEMAP_OPTIONS } from '../types';
import { ChartLayerItem } from './ChartLayerItem';

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
  onToggleChart: (chartId: string) => void;
  onChartOpacity: (chartId: string, opacity: number) => void;
  onZoomToChart: (chartId: string) => void;
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
  onToggleChart,
  onChartOpacity,
  onZoomToChart,
  onClose,
}: LayerSwitcherProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [tempEsriKey, setTempEsriKey] = useState(apiKeys.esri || '');

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

        {/* Offline Charts Section */}
        <div className="layer-panel__section layer-panel__charts">
          <div className="layer-panel__section-header">
            <h3>Offline Charts</h3>
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
            <div className="layer-panel__chart-list">
              {chartLayers.map((layer) => (
                <ChartLayerItem
                  key={layer.id}
                  layer={layer}
                  theme={theme}
                  onToggle={() => onToggleChart(layer.chartId)}
                  onOpacityChange={(opacity) => onChartOpacity(layer.chartId, opacity)}
                  onZoomTo={() => onZoomToChart(layer.chartId)}
                  onRemove={() => onRemoveChart(layer.chartId)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
