import { useState, useCallback, useMemo } from 'react';
import type { BasemapProvider, ApiKeys, ThemeMode, ChartLayer, GebcoSettings, GebcoStatus, NauticalChartSettings, NauticalChartStatus, FolderImportResult } from '../types';
import { BASEMAP_OPTIONS, CONTOUR_INTERVALS, DEFAULT_NAUTICAL_SETTINGS } from '../types';
import { ChartLayerItem } from './ChartLayerItem';
import { ChartEditModal } from './ChartEditModal';
import { CatalogManager } from './CatalogManager';
import { ChartImportDialog } from './ChartImportDialog';
import { useCatalogs } from '../hooks/useCatalogs';

// ============ LayerGroup Component ============
interface LayerGroupProps {
  title: string;
  badge?: string;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  opacity?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function LayerGroup({
  title,
  badge,
  enabled,
  onToggle,
  opacity,
  defaultExpanded = false,
  children,
}: LayerGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`layer-group ${expanded ? 'layer-group--expanded' : ''}`}>
      <div className="layer-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="layer-group__chevron">{expanded ? '▼' : '▶'}</span>
        <span className="layer-group__title">{title}</span>
        {badge && <span className="layer-group__badge">{badge}</span>}
        <div className="layer-group__controls" onClick={e => e.stopPropagation()}>
          {opacity !== undefined && enabled && (
            <span className="layer-group__opacity">{Math.round(opacity * 100)}%</span>
          )}
          {onToggle && (
            <button
              className={`layer-group__toggle ${enabled ? 'active' : ''}`}
              onClick={() => onToggle(!enabled)}
              title={enabled ? 'Disable layer' : 'Enable layer'}
            />
          )}
        </div>
      </div>
      {expanded && (
        <div className="layer-group__content">
          {children}
        </div>
      )}
    </div>
  );
}

// Map LA basemap entitlement keys to BASEMAP_OPTIONS ids
// LA grants keys like 'osm', 'sentinel', 'esri' which map to multiple basemap options
const LA_BASEMAP_TO_OPTIONS: Record<string, BasemapProvider[]> = {
  'osm': ['osm', 'opentopomap'],
  'sentinel': ['sentinel-2'],
  'esri': ['esri-satellite', 'esri-ocean'],
  // These are "free" options that are typically allowed for all plans:
  'google': ['google-satellite-free', 'google-hybrid-free'],
  'bing': ['bing-satellite'],
  'mapbox': ['mapbox-satellite'],
  'here': ['here-satellite'],
};

// Get list of allowed basemap IDs from LA entitlement keys
function getAllowedBasemapIds(laKeys: string[] | null): Set<BasemapProvider> {
  const allowed = new Set<BasemapProvider>();

  // 'none' is always allowed
  allowed.add('none');

  if (!laKeys || laKeys.length === 0) {
    // No restrictions - allow all
    BASEMAP_OPTIONS.forEach(opt => allowed.add(opt.id));
    return allowed;
  }

  for (const key of laKeys) {
    const mappedOptions = LA_BASEMAP_TO_OPTIONS[key];
    if (mappedOptions) {
      mappedOptions.forEach(opt => allowed.add(opt));
    }
  }

  return allowed;
}

// ============ LayerSwitcher Props ============
interface LayerSwitcherProps {
  theme: ThemeMode;
  currentBasemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
  chartLayers: ChartLayer[];
  chartLayersLoading: boolean;
  // Entitlement-based restrictions
  allowedBasemaps?: string[] | null;  // LA basemap keys like ['osm', 'sentinel', 'esri']
  // GEBCO bathymetry
  gebcoSettings?: GebcoSettings;
  gebcoStatus?: GebcoStatus;
  // Nautical Chart (consolidated CM93)
  nauticalSettings?: NauticalChartSettings;
  nauticalStatus?: NauticalChartStatus;
  onGebcoSettingsChange?: (settings: GebcoSettings) => void;
  onNauticalSettingsChange?: (settings: NauticalChartSettings) => void;
  onNauticalInitialize?: (path: string) => void;
  onBasemapChange: (basemap: BasemapProvider) => void;
  onOpenSeaMapToggle: (show: boolean) => void;
  onApiKeysChange: (keys: ApiKeys) => void;
  onAddChart: () => void;
  onRemoveChart: (chartId: string) => void;
  onRemoveMultipleCharts?: (chartIds: string[]) => void;
  onToggleChart: (chartId: string) => void;
  onChartOpacity: (chartId: string, opacity: number) => void;
  onZoomToChart: (chartId: string) => void;
  onUpdateChartMetadata?: (chartId: string, metadata: {
    customName: string | null;
    customDescription: string | null;
    customMinZoom: number | null;
    customMaxZoom: number | null;
  }) => void;
  onRefreshCharts: () => void;
  onClose: () => void;
}

// ============ Main Component ============
export function LayerSwitcher({
  theme,
  currentBasemap,
  showOpenSeaMap,
  apiKeys,
  chartLayers,
  chartLayersLoading,
  allowedBasemaps,
  gebcoSettings,
  gebcoStatus,
  nauticalSettings = DEFAULT_NAUTICAL_SETTINGS,
  nauticalStatus,
  onGebcoSettingsChange,
  onNauticalSettingsChange,
  onNauticalInitialize,
  onBasemapChange,
  onOpenSeaMapToggle,
  onApiKeysChange,
  onAddChart,
  onRemoveChart,
  onRemoveMultipleCharts,
  onToggleChart,
  onChartOpacity,
  onZoomToChart,
  onUpdateChartMetadata,
  onRefreshCharts,
  onClose,
}: LayerSwitcherProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [tempEsriKey, setTempEsriKey] = useState(apiKeys.esri || '');
  const [showCatalogManager, setShowCatalogManager] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const [selectedForOpacity, setSelectedForOpacity] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [chartToEdit, setChartToEdit] = useState<ChartLayer | null>(null);
  const [nauticalPathInput, setNauticalPathInput] = useState(nauticalSettings?.dataPath ?? '');
  const [folderImportResult, setFolderImportResult] = useState<{ message: string; isError: boolean } | null>(null);

  // Hook for folder import functionality
  const {
    scanFolderForCharts,
    importSelectedCharts,
    gdalInfo,
    importProgress,
  } = useCatalogs();

  // Handle folder import complete
  const handleFolderImportComplete = useCallback((result: FolderImportResult) => {
    if (result.converted > 0) {
      setFolderImportResult({
        message: `Successfully imported ${result.converted} chart(s)`,
        isError: false,
      });
      onRefreshCharts();
    } else if (result.failed > 0) {
      setFolderImportResult({
        message: `Import failed for ${result.failed} chart(s)`,
        isError: true,
      });
    }
    setShowImportDialog(false);
    // Clear message after 5 seconds
    setTimeout(() => setFolderImportResult(null), 5000);
  }, [onRefreshCharts]);

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

  // Get current basemap name for badge
  const currentBasemapName = useMemo(() => {
    const opt = BASEMAP_OPTIONS.find(o => o.id === currentBasemap);
    return opt?.name || currentBasemap;
  }, [currentBasemap]);

  // Check if bathymetry has any data available
  const hasBathymetryData = gebcoStatus?.dem_available ||
    gebcoStatus?.hillshade_available ||
    gebcoStatus?.color_available ||
    gebcoStatus?.contours_available;

  // Check if any bathymetry feature is enabled
  const isBathymetryEnabled = gebcoSettings?.show_hillshade ||
    gebcoSettings?.show_color ||
    gebcoSettings?.show_contours;

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
      setSelectedForDeletion(prev => {
        const newSet = new Set(prev);
        filteredIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    } else {
      setSelectedForDeletion(prev => new Set([...prev, ...filteredIds]));
    }
  }, [filteredChartLayers, selectedForDeletion]);

  // Show all selected charts
  const showSelectedCharts = useCallback(() => {
    selectedForDeletion.forEach(chartId => {
      const layer = chartLayers.find(l => l.chartId === chartId);
      if (layer && !layer.enabled) {
        onToggleChart(chartId);
      }
    });
  }, [selectedForDeletion, chartLayers, onToggleChart]);

  // Hide all selected charts
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
    onApiKeysChange({ esri: tempEsriKey || undefined });
    setShowSettings(false);
  };

  // Get set of entitlement-allowed basemap IDs
  const allowedBasemapIds = useMemo(
    () => getAllowedBasemapIds(allowedBasemaps ?? null),
    [allowedBasemaps]
  );

  // Check if basemap is available (both API key and entitlement)
  const isBasemapAvailable = (option: typeof BASEMAP_OPTIONS[0]): boolean => {
    // Check API key requirement
    if (option.requiresApiKey === 'esri' && !apiKeys.esri) return false;

    // Check entitlement - if allowedBasemaps is provided, enforce it
    if (allowedBasemaps && allowedBasemaps.length > 0) {
      return allowedBasemapIds.has(option.id);
    }

    return true;
  };

  // Check if basemap is blocked by entitlement (different from missing API key)
  const isBlockedByEntitlement = (option: typeof BASEMAP_OPTIONS[0]): boolean => {
    if (!allowedBasemaps || allowedBasemaps.length === 0) return false;
    return !allowedBasemapIds.has(option.id);
  };

  const hasApiKeyOptions = BASEMAP_OPTIONS.some(opt => opt.requiresApiKey);

  // Count enabled offline charts
  const enabledChartsCount = chartLayers.filter(l => l.enabled).length;

  return (
    <div className={`layer-panel layer-panel--${theme}`}>
      <div className="layer-panel__header">
        <h2>Layers</h2>
        <button className="layer-panel__close" onClick={onClose}>×</button>
      </div>

      <div className="layer-panel__content">
        {/* ============ BASEMAP GROUP ============ */}
        <LayerGroup
          title="Basemap"
          badge={currentBasemapName}
          defaultExpanded={false}
        >
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
                  Required for Esri imagery.{' '}
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
                  const blockedByEntitlement = isBlockedByEntitlement(option);
                  const needsKey = option.requiresApiKey && !blockedByEntitlement && !apiKeys[option.requiresApiKey as keyof ApiKeys];

                  // Skip blocked basemaps entirely to hide them from the UI
                  if (blockedByEntitlement) {
                    return null;
                  }

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

              {hasApiKeyOptions && (
                <button
                  className="layer-panel__api-settings-link"
                  onClick={() => setShowSettings(true)}
                >
                  Configure API Keys
                </button>
              )}

              <div className="layer-panel__overlays">
                <label className="overlay-toggle">
                  <input
                    type="checkbox"
                    checked={showOpenSeaMap}
                    onChange={(e) => onOpenSeaMapToggle(e.target.checked)}
                  />
                  <span>OpenSeaMap overlay</span>
                </label>
              </div>
            </>
          )}
        </LayerGroup>

        {/* ============ NAUTICAL CHART GROUP ============ */}
        <LayerGroup
          title="Nautical Chart"
          enabled={nauticalStatus?.initialized && nauticalSettings?.enabled}
          onToggle={nauticalStatus?.initialized ? (enabled) => {
            onNauticalSettingsChange?.({ ...nauticalSettings!, enabled });
          } : undefined}
          opacity={nauticalSettings?.opacity}
          defaultExpanded={false}
        >
          {!nauticalStatus?.initialized ? (
            <div className="layer-group__unavailable">
              <p>Nautical chart data not loaded.</p>
              <div className="layer-group__path-input">
                <input
                  type="text"
                  placeholder="Enter chart data folder path..."
                  value={nauticalPathInput}
                  onChange={(e) => setNauticalPathInput(e.target.value)}
                />
                <button
                  className="layer-group__load-btn"
                  onClick={() => {
                    if (nauticalPathInput.trim()) {
                      onNauticalInitialize?.(nauticalPathInput.trim());
                    }
                  }}
                  disabled={!nauticalPathInput.trim()}
                >
                  Load
                </button>
              </div>
              <small>Point to your nautical chart database folder</small>
            </div>
          ) : (
            <>
              <div className="layer-group__status">
                <small>Scales: {nauticalStatus.availableScales.join(', ') || 'None'}</small>
              </div>

              {nauticalSettings?.enabled && (
                <>
                  <div className="feature-grid">
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={nauticalSettings.showSoundings}
                        onChange={(e) =>
                          onNauticalSettingsChange?.({ ...nauticalSettings, showSoundings: e.target.checked })
                        }
                      />
                      <span>Soundings</span>
                    </label>
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={nauticalSettings.showDepthContours}
                        onChange={(e) =>
                          onNauticalSettingsChange?.({ ...nauticalSettings, showDepthContours: e.target.checked })
                        }
                      />
                      <span>Contours</span>
                    </label>
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={nauticalSettings.showLights}
                        onChange={(e) =>
                          onNauticalSettingsChange?.({ ...nauticalSettings, showLights: e.target.checked })
                        }
                      />
                      <span>Lights</span>
                    </label>
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={nauticalSettings.showBuoys}
                        onChange={(e) =>
                          onNauticalSettingsChange?.({ ...nauticalSettings, showBuoys: e.target.checked })
                        }
                      />
                      <span>Buoys</span>
                    </label>
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={nauticalSettings.showLand}
                        onChange={(e) =>
                          onNauticalSettingsChange?.({ ...nauticalSettings, showLand: e.target.checked })
                        }
                      />
                      <span>Land</span>
                    </label>
                    <label className="feature-toggle">
                      <input
                        type="checkbox"
                        checked={nauticalSettings.showObstructions}
                        onChange={(e) =>
                          onNauticalSettingsChange?.({ ...nauticalSettings, showObstructions: e.target.checked })
                        }
                      />
                      <span>Hazards</span>
                    </label>
                  </div>

                  <div className="layer-group__slider">
                    <label>Opacity</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={nauticalSettings.opacity}
                      onChange={(e) =>
                        onNauticalSettingsChange?.({ ...nauticalSettings, opacity: parseFloat(e.target.value) })
                      }
                    />
                    <span>{Math.round(nauticalSettings.opacity * 100)}%</span>
                  </div>
                </>
              )}
            </>
          )}
        </LayerGroup>

        {/* ============ BATHYMETRY GROUP ============ */}
        <LayerGroup
          title="Bathymetry"
          enabled={isBathymetryEnabled}
          onToggle={hasBathymetryData ? (enabled) => {
            // Toggle all bathymetry features
            onGebcoSettingsChange?.({
              ...gebcoSettings!,
              show_hillshade: enabled && (gebcoStatus?.dem_available || gebcoStatus?.hillshade_available || false),
              show_color: enabled && (gebcoStatus?.color_available || false),
              show_contours: false, // Keep contours off by default
            });
          } : undefined}
          defaultExpanded={false}
        >
          {!hasBathymetryData ? (
            <div className="layer-group__unavailable">
              <p>Bathymetry data not installed.</p>
              <small>
                Place GEBCO MBTiles files in the charts folder:
                <br />• _gebco_color.mbtiles (depth colors)
                <br />• _gebco_hillshade.mbtiles (shaded relief)
                <br />• _gebco_contours.mbtiles (contour lines)
              </small>
            </div>
          ) : (
            <>
              {/* Hillshade */}
              {(gebcoStatus?.dem_available || gebcoStatus?.hillshade_available) && (
                <div className="layer-group__control">
                  <label className="feature-toggle">
                    <input
                      type="checkbox"
                      checked={gebcoSettings?.show_hillshade ?? false}
                      onChange={(e) =>
                        onGebcoSettingsChange?.({ ...gebcoSettings!, show_hillshade: e.target.checked })
                      }
                    />
                    <span>Hillshade (relief)</span>
                  </label>
                  {gebcoSettings?.show_hillshade && (
                    <div className="layer-group__inline-slider">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={gebcoSettings?.hillshade_opacity ?? 0.3}
                        onChange={(e) =>
                          onGebcoSettingsChange?.({ ...gebcoSettings!, hillshade_opacity: parseFloat(e.target.value) })
                        }
                      />
                      <span>{Math.round((gebcoSettings?.hillshade_opacity ?? 0.3) * 100)}%</span>
                    </div>
                  )}
                </div>
              )}

              {/* Depth Colors */}
              {gebcoStatus?.color_available && (
                <div className="layer-group__control">
                  <label className="feature-toggle">
                    <input
                      type="checkbox"
                      checked={gebcoSettings?.show_color ?? false}
                      onChange={(e) =>
                        onGebcoSettingsChange?.({ ...gebcoSettings!, show_color: e.target.checked })
                      }
                    />
                    <span>Depth colors</span>
                  </label>
                  {gebcoSettings?.show_color && (
                    <div className="layer-group__inline-slider">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={gebcoSettings?.color_opacity ?? 0.5}
                        onChange={(e) =>
                          onGebcoSettingsChange?.({ ...gebcoSettings!, color_opacity: parseFloat(e.target.value) })
                        }
                      />
                      <span>{Math.round((gebcoSettings?.color_opacity ?? 0.5) * 100)}%</span>
                    </div>
                  )}
                </div>
              )}

              {/* Contours */}
              {gebcoStatus?.contours_available && (
                <div className="layer-group__control">
                  <label className="feature-toggle">
                    <input
                      type="checkbox"
                      checked={gebcoSettings?.show_contours ?? false}
                      onChange={(e) =>
                        onGebcoSettingsChange?.({ ...gebcoSettings!, show_contours: e.target.checked })
                      }
                    />
                    <span>Depth contours</span>
                  </label>
                  {gebcoSettings?.show_contours && (
                    <div className="layer-group__interval">
                      <select
                        value={gebcoSettings?.contour_interval ?? 100}
                        onChange={(e) =>
                          onGebcoSettingsChange?.({ ...gebcoSettings!, contour_interval: parseInt(e.target.value, 10) })
                        }
                      >
                        {CONTOUR_INTERVALS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </LayerGroup>

        {/* ============ OFFLINE CHARTS GROUP ============ */}
        <LayerGroup
          title="Offline Charts"
          badge={chartLayers.length > 0 ? `(${enabledChartsCount}/${chartLayers.length})` : undefined}
          defaultExpanded={false}
        >
          <div className="layer-group__charts-header">
            <button
              className="layer-group__add-btn"
              onClick={onAddChart}
              title="Import MBTiles chart"
            >
              + Add Chart
            </button>
            <button
              className="layer-group__add-btn layer-group__add-btn--folder"
              onClick={() => setShowImportDialog(true)}
              disabled={!gdalInfo?.available}
              title={gdalInfo?.available ? "Import charts from folder (BSB, KAP files)" : "GDAL required for folder import"}
            >
              + Import Folder
            </button>
            <button
              className="layer-group__catalog-btn"
              onClick={() => setShowCatalogManager(!showCatalogManager)}
            >
              {showCatalogManager ? 'Hide Catalogs' : 'Chart Catalogs'}
            </button>
          </div>

          {/* Folder import result message */}
          {folderImportResult && (
            <div className={`layer-group__import-result ${folderImportResult.isError ? 'layer-group__import-result--error' : 'layer-group__import-result--success'}`}>
              {folderImportResult.message}
            </div>
          )}

          {showCatalogManager && (
            <div className="layer-group__catalog-manager">
              <CatalogManager theme={theme} onChartReady={onRefreshCharts} />
            </div>
          )}

          {chartLayersLoading ? (
            <div className="layer-group__loading">Loading charts...</div>
          ) : chartLayers.length === 0 ? (
            <div className="layer-group__empty">
              No charts loaded. Click "Add Chart" to import MBTiles files.
            </div>
          ) : (
            <>
              {/* Name filter */}
              <div className="layer-group__filter">
                <input
                  type="text"
                  placeholder="Filter by name..."
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                />
                {nameFilter && (
                  <>
                    <button className="layer-group__filter-clear" onClick={() => setNameFilter('')}>×</button>
                    <span className="layer-group__filter-count">{filteredChartLayers.length}/{chartLayers.length}</span>
                  </>
                )}
              </div>

              {/* Bulk actions */}
              <div className="layer-group__bulk-actions">
                <label className="layer-group__select-all">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                  />
                  <span>All</span>
                </label>
                {someSelected && (
                  <>
                    <button className="layer-group__action-btn" onClick={showSelectedCharts} title="Show selected">
                      Show
                    </button>
                    <button className="layer-group__action-btn" onClick={hideSelectedCharts} title="Hide selected">
                      Hide
                    </button>
                    <button className="layer-group__action-btn layer-group__action-btn--danger" onClick={deleteSelectedCharts}>
                      Delete ({selectedForDeletion.size})
                    </button>
                  </>
                )}
              </div>

              {/* Selected chart opacity */}
              {selectedChart && (
                <div className="layer-group__selected-opacity">
                  <span>{selectedChart.name}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedChart.opacity}
                    onChange={(e) => onChartOpacity(selectedChart.chartId, parseFloat(e.target.value))}
                  />
                  <span>{Math.round(selectedChart.opacity * 100)}%</span>
                </div>
              )}

              {/* Chart list */}
              <div className="layer-group__chart-list">
                {filteredChartLayers.map((layer) => (
                  <div key={layer.id} className="layer-group__chart-item">
                    <label className="layer-group__chart-checkbox">
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
                      onEdit={onUpdateChartMetadata ? () => setChartToEdit(layer) : undefined}
                    />
                  </div>
                ))}
              </div>

              {filteredChartLayers.length === 0 && nameFilter && (
                <div className="layer-group__empty">No charts match "{nameFilter}"</div>
              )}
            </>
          )}
        </LayerGroup>
      </div>

      {/* Chart Import Dialog for folder import */}
      {showImportDialog && (
        <ChartImportDialog
          theme={theme}
          onClose={() => setShowImportDialog(false)}
          onScanFolder={scanFolderForCharts}
          onImportSelected={importSelectedCharts}
          importProgress={importProgress}
          onImportComplete={handleFolderImportComplete}
        />
      )}

      {/* Chart Edit Modal */}
      {chartToEdit && onUpdateChartMetadata && (
        <ChartEditModal
          chart={chartToEdit}
          theme={theme}
          onSave={(chartId, metadata) => {
            onUpdateChartMetadata(chartId, metadata);
            setChartToEdit(null);
          }}
          onClose={() => setChartToEdit(null)}
        />
      )}
    </div>
  );
}
