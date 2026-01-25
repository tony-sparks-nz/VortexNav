// Hook for managing chart catalogs

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { ChartCatalog, GdalInfo, CommandResult, FolderImportResult, ImportProgress, TagResult, FixBoundsResult, ScanFolderResult } from '../types';

export function useCatalogs() {
  const [catalogs, setCatalogs] = useState<ChartCatalog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gdalInfo, setGdalInfo] = useState<GdalInfo | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Load catalogs from backend
  const refreshCatalogs = useCallback(async () => {
    console.log('[useCatalogs] refreshCatalogs called, setting loading=true');
    setLoading(true);
    setError(null);
    try {
      console.log('[useCatalogs] Invoking list_catalogs...');
      const result = await invoke<CommandResult<ChartCatalog[]>>('list_catalogs');
      console.log('[useCatalogs] list_catalogs result:', result);
      if (result.success && result.data) {
        setCatalogs(result.data);
      } else {
        setError(result.error || 'Failed to load catalogs');
      }
    } catch (err) {
      console.error('[useCatalogs] list_catalogs error:', err);
      setError(String(err));
    } finally {
      console.log('[useCatalogs] Setting loading=false');
      setLoading(false);
    }
  }, []);

  // Check GDAL availability
  const checkGdal = useCallback(async () => {
    try {
      const result = await invoke<CommandResult<GdalInfo>>('check_gdal');
      if (result.success && result.data) {
        setGdalInfo(result.data);
      }
    } catch (err) {
      console.error('Failed to check GDAL:', err);
    }
  }, []);

  // Load catalogs and check GDAL on mount
  useEffect(() => {
    refreshCatalogs();
    checkGdal();
  }, [refreshCatalogs, checkGdal]);

  // Import catalog from file
  const importCatalogFromFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'XML Catalog', extensions: ['xml'] }
        ]
      });

      if (!selected) return null;

      // Handle both string and array (though we set multiple: false)
      const filePath = Array.isArray(selected) ? selected[0] : selected;

      setLoading(true);
      setError(null);

      const result = await invoke<CommandResult<ChartCatalog>>('import_catalog_file', {
        filePath
      });

      if (result.success && result.data) {
        await refreshCatalogs();
        return result.data;
      } else {
        setError(result.error || 'Failed to import catalog');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshCatalogs]);

  // Import catalog from URL
  const importCatalogFromUrl = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CommandResult<ChartCatalog>>('import_catalog_url', {
        url
      });

      if (result.success && result.data) {
        await refreshCatalogs();
        return result.data;
      } else {
        setError(result.error || 'Failed to import catalog');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshCatalogs]);

  // Delete a catalog
  const deleteCatalog = useCallback(async (catalogId: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CommandResult<void>>('delete_catalog', {
        catalogId
      });

      if (result.success) {
        await refreshCatalogs();
        return true;
      } else {
        setError(result.error || 'Failed to delete catalog');
        return false;
      }
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshCatalogs]);

  // Refresh a URL catalog
  const refreshCatalog = useCallback(async (catalogId: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CommandResult<ChartCatalog>>('refresh_catalog', {
        catalogId
      });

      if (result.success && result.data) {
        await refreshCatalogs();
        return result.data;
      } else {
        setError(result.error || 'Failed to refresh catalog');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshCatalogs]);

  // Import charts from a local folder (scans for .kap, .bsb, .000 files and converts to MBTiles)
  const importChartsFromFolder = useCallback(async (): Promise<FolderImportResult | null> => {
    try {
      // Open folder picker
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select folder containing chart files (.kap, .bsb, .000)'
      });

      if (!selected) return null;

      const folderPath = Array.isArray(selected) ? selected[0] : selected;

      setLoading(true);
      setError(null);
      setImportProgress(null);

      // Set up event listener for progress updates
      unlistenRef.current = await listen<ImportProgress>('import-progress', (event) => {
        console.log('[useCatalogs] Import progress:', event.payload);
        setImportProgress(event.payload);
      });

      const result = await invoke<CommandResult<FolderImportResult>>('import_charts_from_folder', {
        folderPath
      });

      // Clean up listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      if (result.success && result.data) {
        return result.data;
      } else {
        setError(result.error || 'Failed to import charts from folder');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      // Ensure listener is cleaned up
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setLoading(false);
      // Clear progress after a short delay so user can see the final state
      setTimeout(() => setImportProgress(null), 2000);
    }
  }, []);

  // Scan a folder for chart files without importing (for selective import UI)
  const scanFolderForCharts = useCallback(async (folderPath: string): Promise<ScanFolderResult | null> => {
    try {
      setLoading(true);
      setError(null);

      const result = await invoke<CommandResult<ScanFolderResult>>('scan_folder_for_import', {
        folderPath
      });

      if (result.success && result.data) {
        return result.data;
      } else {
        setError(result.error || 'Failed to scan folder');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Import selected chart files by path
  const importSelectedCharts = useCallback(async (filePaths: string[]): Promise<FolderImportResult | null> => {
    if (filePaths.length === 0) {
      setError('No files selected');
      return null;
    }

    try {
      setLoading(true);
      setError(null);
      setImportProgress(null);

      // Set up event listener for progress updates
      unlistenRef.current = await listen<ImportProgress>('import-progress', (event) => {
        console.log('[useCatalogs] Import progress:', event.payload);
        setImportProgress(event.payload);
      });

      const result = await invoke<CommandResult<FolderImportResult>>('import_selected_charts', {
        filePaths
      });

      // Clean up listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      if (result.success && result.data) {
        return result.data;
      } else {
        setError(result.error || 'Failed to import selected charts');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setLoading(false);
      setTimeout(() => setImportProgress(null), 2000);
    }
  }, []);

  // Tag imported charts with human-readable names from BSB catalog files
  const tagChartsFromBsb = useCallback(async (): Promise<TagResult | null> => {
    try {
      // Open folder picker to select BSB folder
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select folder containing BSB catalog files'
      });

      if (!selected) return null;

      const bsbFolder = Array.isArray(selected) ? selected[0] : selected;

      setLoading(true);
      setError(null);

      const result = await invoke<CommandResult<TagResult>>('tag_charts_from_bsb', {
        bsbFolder
      });

      if (result.success && result.data) {
        return result.data;
      } else {
        setError(result.error || 'Failed to tag charts');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fix bounds for imported charts by reading from original KAP files
  const fixChartBounds = useCallback(async (): Promise<FixBoundsResult | null> => {
    try {
      // Open folder picker to select KAP files folder
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select folder containing original KAP chart files'
      });

      if (!selected) return null;

      const kapFolder = Array.isArray(selected) ? selected[0] : selected;

      setLoading(true);
      setError(null);

      const result = await invoke<CommandResult<FixBoundsResult>>('fix_chart_bounds', {
        kapFolder
      });

      if (result.success && result.data) {
        return result.data;
      } else {
        setError(result.error || 'Failed to fix chart bounds');
        return null;
      }
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    catalogs,
    loading,
    error,
    gdalInfo,
    importProgress,
    refreshCatalogs,
    importCatalogFromFile,
    importCatalogFromUrl,
    deleteCatalog,
    refreshCatalog,
    checkGdal,
    importChartsFromFolder,
    scanFolderForCharts,
    importSelectedCharts,
    tagChartsFromBsb,
    fixChartBounds,
  };
}
