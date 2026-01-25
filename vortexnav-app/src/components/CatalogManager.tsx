// Catalog Manager component for importing and managing chart catalogs

import { useState } from 'react';
import { useCatalogs } from '../hooks/useCatalogs';
import { CatalogBrowser } from './CatalogBrowser';
import { ChartImportDialog } from './ChartImportDialog';
import type { FolderImportResult, ThemeMode } from '../types';

interface CatalogManagerProps {
  theme: ThemeMode;
  onChartReady?: () => void;  // Called when a chart is ready for display
}

export function CatalogManager({ theme, onChartReady }: CatalogManagerProps) {
  const {
    catalogs,
    loading,
    error,
    gdalInfo,
    importProgress,
    importCatalogFromFile,
    importCatalogFromUrl,
    deleteCatalog,
    refreshCatalog,
    importChartsFromFolder,
    scanFolderForCharts,
    importSelectedCharts,
    tagChartsFromBsb,
    fixChartBounds,
  } = useCatalogs();

  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState<number | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importResult, setImportResult] = useState<{ message: string; isError: boolean } | null>(null);

  const handleImportFromFile = async () => {
    await importCatalogFromFile();
  };

  const handleOpenImportDialog = () => {
    setImportResult(null);
    setShowImportDialog(true);
  };

  const handleImportComplete = (result: FolderImportResult) => {
    setShowImportDialog(false);
    if (result.total_found === 0) {
      setImportResult({ message: 'No chart files converted.', isError: true });
    } else {
      const message = `Import complete: ${result.converted} converted, ${result.skipped} skipped, ${result.failed} failed.`;
      setImportResult({ message, isError: result.failed > 0 });
      if (result.converted > 0 && onChartReady) {
        onChartReady();
      }
    }
  };

  // Legacy function for importing all charts from folder (kept for compatibility)
  const handleImportFromFolder = async () => {
    setImportResult(null);
    const result = await importChartsFromFolder();
    if (result) {
      if (result.total_found === 0) {
        setImportResult({ message: 'No chart files (.kap, .bsb, .000) found in the selected folder.', isError: true });
      } else {
        const message = `Found ${result.total_found} charts: ${result.converted} converted, ${result.skipped} skipped, ${result.failed} failed.`;
        setImportResult({ message, isError: result.failed > 0 });
        if (result.converted > 0 && onChartReady) {
          onChartReady();
        }
      }
    }
  };

  const handleTagCharts = async () => {
    setImportResult(null);
    const result = await tagChartsFromBsb();
    if (result) {
      if (result.total_bsb_files === 0) {
        setImportResult({ message: 'No BSB catalog files found in the selected folder.', isError: true });
      } else {
        const message = `Processed ${result.total_bsb_files} BSB files with ${result.total_mappings} chart mappings. Tagged ${result.charts_updated} charts, ${result.charts_not_found} not found.`;
        setImportResult({ message, isError: result.errors.length > 0 });
        if (result.charts_updated > 0 && onChartReady) {
          onChartReady();
        }
      }
    }
  };

  const handleFixBounds = async () => {
    setImportResult(null);
    const result = await fixChartBounds();
    if (result) {
      if (result.charts_checked === 0) {
        setImportResult({ message: 'No MBTiles charts found to fix.', isError: true });
      } else {
        const message = `Checked ${result.charts_checked} charts: ${result.charts_already_had_bounds} already had bounds, ${result.charts_updated} updated, ${result.charts_kap_not_found} KAP not found.`;
        setImportResult({ message, isError: result.charts_bounds_failed > 0 });
        if (result.charts_updated > 0 && onChartReady) {
          onChartReady();
        }
      }
    }
  };

  const handleImportFromUrl = async () => {
    if (!urlInput.trim()) return;
    await importCatalogFromUrl(urlInput.trim());
    setUrlInput('');
    setShowUrlInput(false);
  };

  const handleDeleteCatalog = async (id: number) => {
    if (confirm('Are you sure you want to delete this catalog?')) {
      await deleteCatalog(id);
      if (selectedCatalogId === id) {
        setSelectedCatalogId(null);
        setShowBrowser(false);
      }
    }
  };

  const handleOpenBrowser = (catalogId: number) => {
    setSelectedCatalogId(catalogId);
    setShowBrowser(true);
  };

  const handleCloseBrowser = () => {
    setShowBrowser(false);
    setSelectedCatalogId(null);
  };

  if (showBrowser && selectedCatalogId !== null) {
    const catalog = catalogs.find(c => c.id === selectedCatalogId);
    return (
      <CatalogBrowser
        catalogId={selectedCatalogId}
        catalogName={catalog?.name || 'Catalog'}
        catalogType={catalog?.catalog_type || 'RNC'}
        gdalInfo={gdalInfo}
        onBack={handleCloseBrowser}
        onChartReady={onChartReady}
      />
    );
  }

  return (
    <div className="catalog-manager">
      <div className="catalog-manager-header">
        <h3>Chart Catalogs</h3>
        {gdalInfo && (
          <div className={`gdal-status ${gdalInfo.available ? 'available' : 'unavailable'}`}>
            {gdalInfo.available ? (
              <span title={gdalInfo.version || 'GDAL available'}>GDAL Ready</span>
            ) : (
              <span title="Install GDAL to enable chart conversion">GDAL Not Found</span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="catalog-error">{error}</div>
      )}

      <div className="catalog-import-buttons">
        <button
          className="import-btn"
          onClick={handleImportFromFile}
          disabled={loading}
          title="Import XML catalog file"
        >
          + Catalog File
        </button>
        <button
          className="import-btn"
          onClick={() => setShowUrlInput(!showUrlInput)}
          disabled={loading}
          title="Import catalog from URL"
        >
          + Catalog URL
        </button>
        <button
          className="import-btn import-folder-btn"
          onClick={handleOpenImportDialog}
          disabled={loading || !gdalInfo?.available}
          title={gdalInfo?.available ? "Select chart files from folder to import" : "GDAL required for folder import"}
        >
          + Import Folder
        </button>
        <button
          className="import-btn import-folder-btn"
          onClick={handleImportFromFolder}
          disabled={loading || !gdalInfo?.available}
          title={gdalInfo?.available ? "Import all charts from folder (no selection)" : "GDAL required for folder import"}
        >
          + Import All
        </button>
        <button
          className="import-btn tag-charts-btn"
          onClick={handleTagCharts}
          disabled={loading}
          title="Tag imported charts with names from BSB catalog files"
        >
          Tag Charts
        </button>
        <button
          className="import-btn fix-bounds-btn"
          onClick={handleFixBounds}
          disabled={loading || !gdalInfo?.available}
          title={gdalInfo?.available ? "Fix bounds metadata for imported charts using original KAP files" : "GDAL required to extract bounds from KAP files"}
        >
          Fix Bounds
        </button>
      </div>

      {importResult && (
        <div className={`import-result ${importResult.isError ? 'error' : 'success'}`}>
          {importResult.message}
          <button onClick={() => setImportResult(null)} className="dismiss-btn">×</button>
        </div>
      )}

      {showUrlInput && (
        <div className="url-input-container">
          <input
            type="text"
            placeholder="Enter catalog URL..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImportFromUrl()}
          />
          <button onClick={handleImportFromUrl} disabled={loading || !urlInput.trim()}>
            Import
          </button>
          <button onClick={() => setShowUrlInput(false)}>Cancel</button>
        </div>
      )}

      {loading && !importProgress && <div className="catalog-loading">Loading...</div>}

      {importProgress && (
        <div className="import-progress">
          <div className="import-progress-header">
            {importProgress.phase === 'scanning' && 'Scanning for chart files...'}
            {importProgress.phase === 'converting' && (
              <>Converting charts: {importProgress.current} of {importProgress.total}</>
            )}
            {importProgress.phase === 'complete' && 'Import complete!'}
          </div>
          {importProgress.phase === 'converting' && importProgress.total > 0 && (
            <>
              <div className="import-progress-bar">
                <div
                  className="import-progress-fill"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
              <div className="import-progress-file" title={importProgress.current_file}>
                {importProgress.current_file.length > 50
                  ? '...' + importProgress.current_file.slice(-47)
                  : importProgress.current_file}
              </div>
              <div className="import-progress-stats">
                <span className="stat success">{importProgress.converted} converted</span>
                <span className="stat skipped">{importProgress.skipped} skipped</span>
                {importProgress.failed > 0 && (
                  <span className="stat failed">{importProgress.failed} failed</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="catalog-list">
        {catalogs.length === 0 && !loading && (
          <div className="no-catalogs">
            No catalogs imported. Import an RNC or ENC catalog to browse available charts.
          </div>
        )}

        {catalogs.map(catalog => (
          <div key={catalog.id} className="catalog-item">
            <div className="catalog-info">
              <div className="catalog-name">{catalog.name}</div>
              <div className="catalog-meta">
                <span className={`catalog-type ${catalog.catalog_type.toLowerCase()}`}>
                  {catalog.catalog_type}
                </span>
                <span className="catalog-count">
                  {catalog.chart_count || 0} charts
                </span>
                <span className={`source-type ${catalog.source_type}`}>
                  {catalog.source_type === 'url' ? 'Remote' : 'Local'}
                </span>
              </div>
            </div>
            <div className="catalog-actions">
              <button
                className="browse-btn"
                onClick={() => handleOpenBrowser(catalog.id!)}
              >
                Browse
              </button>
              {catalog.source_type === 'url' && (
                <button
                  className="refresh-btn"
                  onClick={() => refreshCatalog(catalog.id!)}
                  disabled={loading}
                  title="Refresh catalog from URL"
                >
                  ↻
                </button>
              )}
              <button
                className="delete-btn"
                onClick={() => handleDeleteCatalog(catalog.id!)}
                title="Delete catalog"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Chart Import Dialog */}
      {showImportDialog && (
        <ChartImportDialog
          theme={theme}
          onScanFolder={scanFolderForCharts}
          onImportSelected={importSelectedCharts}
          importProgress={importProgress}
          onClose={() => setShowImportDialog(false)}
          onImportComplete={handleImportComplete}
        />
      )}
    </div>
  );
}
