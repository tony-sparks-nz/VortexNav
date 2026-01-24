import { useState } from 'react';
import type { BasemapProvider, ApiKeys, ThemeMode } from '../types';
import { BASEMAP_OPTIONS } from '../types';

interface LayerSwitcherProps {
  theme: ThemeMode;
  currentBasemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
  onBasemapChange: (basemap: BasemapProvider) => void;
  onOpenSeaMapToggle: (show: boolean) => void;
  onApiKeysChange: (keys: ApiKeys) => void;
}

export function LayerSwitcher({
  theme,
  currentBasemap,
  showOpenSeaMap,
  apiKeys,
  onBasemapChange,
  onOpenSeaMapToggle,
  onApiKeysChange,
}: LayerSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
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
    <div className={`layer-switcher layer-switcher--${theme}`}>
      <button
        className="layer-switcher__toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Layer options"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>

      {isOpen && (
        <div className="layer-switcher__panel">
          <div className="layer-switcher__header">
            <h3>Basemap</h3>
            {hasApiKeyOptions && (
              <button
                className="layer-switcher__settings-btn"
                onClick={() => setShowSettings(!showSettings)}
                title="API Settings"
              >
                ⚙
              </button>
            )}
          </div>

          {showSettings ? (
            <div className="layer-switcher__settings">
              <div className="settings-field">
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

              <button className="settings-save-btn" onClick={handleSaveKeys}>
                Save
              </button>
            </div>
          ) : (
            <>
              <div className="layer-switcher__basemaps">
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

              <div className="layer-switcher__overlays">
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
      )}
    </div>
  );
}
