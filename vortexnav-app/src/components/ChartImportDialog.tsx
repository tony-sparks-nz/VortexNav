// Chart Import Dialog - Selective chart file import with preview and filtering
import { useState, useMemo, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { ScanFolderResult, FolderImportResult, ImportProgress, ThemeMode } from '../types';

interface ChartImportDialogProps {
  theme: ThemeMode;
  onScanFolder: (folderPath: string) => Promise<ScanFolderResult | null>;
  onImportSelected: (filePaths: string[]) => Promise<FolderImportResult | null>;
  importProgress: ImportProgress | null;
  onClose: () => void;
  onImportComplete: (result: FolderImportResult) => void;
}

type SortField = 'name' | 'size' | 'folder';
type SortOrder = 'asc' | 'desc';

export function ChartImportDialog({
  onScanFolder,
  onImportSelected,
  importProgress,
  onClose,
  onImportComplete,
}: ChartImportDialogProps) {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanFolderResult | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [nameFilter, setNameFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [hideImported, setHideImported] = useState(true);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get unique parent folders for filter dropdown
  const parentFolders = useMemo(() => {
    if (!scanResult) return [];
    const folders = new Set(scanResult.files.map(f => f.parent_folder));
    return Array.from(folders).sort();
  }, [scanResult]);

  // Filter and sort files
  const filteredFiles = useMemo(() => {
    if (!scanResult) return [];

    let files = [...scanResult.files];

    // Apply filters
    if (nameFilter.trim()) {
      const filter = nameFilter.toLowerCase().trim();
      files = files.filter(f => f.name.toLowerCase().includes(filter));
    }

    if (folderFilter) {
      files = files.filter(f => f.parent_folder === folderFilter);
    }

    if (hideImported) {
      files = files.filter(f => !f.already_imported);
    }

    // Sort
    files.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.size_bytes - b.size_bytes;
          break;
        case 'folder':
          cmp = a.parent_folder.localeCompare(b.parent_folder);
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return files;
  }, [scanResult, nameFilter, folderFilter, hideImported, sortField, sortOrder]);

  // Select folder and scan
  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select folder containing chart files (.kap, .bsb, .000)'
      });

      if (!selected) return;

      const path = Array.isArray(selected) ? selected[0] : selected;
      setFolderPath(path);
      setScanning(true);
      setError(null);
      setScanResult(null);
      setSelectedFiles(new Set());

      const result = await onScanFolder(path);

      if (result) {
        setScanResult(result);
        // Auto-select all non-imported files
        const newSelected = new Set<string>();
        result.files.forEach(f => {
          if (!f.already_imported) {
            newSelected.add(f.path);
          }
        });
        setSelectedFiles(newSelected);
      } else {
        setError('Failed to scan folder');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
    }
  }, [onScanFolder]);

  // Toggle file selection
  const toggleFile = useCallback((path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Select/deselect all visible files
  const selectAllVisible = useCallback(() => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      filteredFiles.forEach(f => {
        if (!f.already_imported) {
          next.add(f.path);
        }
      });
      return next;
    });
  }, [filteredFiles]);

  const deselectAllVisible = useCallback(() => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      filteredFiles.forEach(f => next.delete(f.path));
      return next;
    });
  }, [filteredFiles]);

  // Import selected files
  const handleImport = useCallback(async () => {
    if (selectedFiles.size === 0) return;

    setImporting(true);
    setError(null);

    try {
      const result = await onImportSelected(Array.from(selectedFiles));

      if (result) {
        onImportComplete(result);
      } else {
        setError('Import failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  }, [selectedFiles, onImportSelected, onImportComplete]);

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Toggle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Count selected in current filter view
  const selectedInView = filteredFiles.filter(f => selectedFiles.has(f.path)).length;

  return (
    <div className="chart-import-dialog">
      <div className="chart-import-dialog__overlay" onClick={onClose} />

      <div className="chart-import-dialog__content">
        <div className="chart-import-dialog__header">
          <h2>Import Chart Files</h2>
          <button className="chart-import-dialog__close" onClick={onClose}>×</button>
        </div>

        {/* Folder Selection */}
        <div className="chart-import-dialog__folder-section">
          <button
            className="chart-import-dialog__folder-btn"
            onClick={handleSelectFolder}
            disabled={scanning || importing}
          >
            {scanning ? 'Scanning...' : 'Select Folder'}
          </button>
          {folderPath && (
            <span className="chart-import-dialog__folder-path" title={folderPath}>
              {folderPath}
            </span>
          )}
        </div>

        {error && (
          <div className="chart-import-dialog__error">{error}</div>
        )}

        {/* Scan Results */}
        {scanResult && (
          <>
            {/* Summary */}
            <div className="chart-import-dialog__summary">
              <span>Found: <strong>{scanResult.total_count}</strong> files</span>
              <span>Already imported: <strong>{scanResult.already_imported_count}</strong></span>
              <span>Selected: <strong>{selectedFiles.size}</strong></span>
            </div>

            {/* Filters */}
            <div className="chart-import-dialog__filters">
              <div className="chart-import-dialog__filter-row">
                <input
                  type="text"
                  className="chart-import-dialog__filter-input"
                  placeholder="Filter by name..."
                  value={nameFilter}
                  onChange={e => setNameFilter(e.target.value)}
                />
                {nameFilter && (
                  <button
                    className="chart-import-dialog__filter-clear"
                    onClick={() => setNameFilter('')}
                  >
                    ×
                  </button>
                )}
              </div>

              <select
                className="chart-import-dialog__filter-select"
                value={folderFilter}
                onChange={e => setFolderFilter(e.target.value)}
              >
                <option value="">All folders</option>
                {parentFolders.map(folder => (
                  <option key={folder} value={folder}>{folder}</option>
                ))}
              </select>

              <label className="chart-import-dialog__checkbox-label">
                <input
                  type="checkbox"
                  checked={hideImported}
                  onChange={e => setHideImported(e.target.checked)}
                />
                Hide imported
              </label>
            </div>

            {/* Selection Actions */}
            <div className="chart-import-dialog__selection-actions">
              <button onClick={selectAllVisible} disabled={importing}>
                Select All ({filteredFiles.filter(f => !f.already_imported).length})
              </button>
              <button onClick={deselectAllVisible} disabled={importing}>
                Deselect All
              </button>
              <span className="chart-import-dialog__selection-count">
                {selectedInView} of {filteredFiles.length} visible selected
              </span>
            </div>

            {/* File List Header */}
            <div className="chart-import-dialog__list-header">
              <div className="chart-import-dialog__col-check"></div>
              <div
                className={`chart-import-dialog__col-name chart-import-dialog__sortable ${sortField === 'name' ? 'active' : ''}`}
                onClick={() => handleSort('name')}
              >
                Name {sortField === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div
                className={`chart-import-dialog__col-folder chart-import-dialog__sortable ${sortField === 'folder' ? 'active' : ''}`}
                onClick={() => handleSort('folder')}
              >
                Folder {sortField === 'folder' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div
                className={`chart-import-dialog__col-size chart-import-dialog__sortable ${sortField === 'size' ? 'active' : ''}`}
                onClick={() => handleSort('size')}
              >
                Size {sortField === 'size' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div className="chart-import-dialog__col-status">Status</div>
            </div>

            {/* File List */}
            <div className="chart-import-dialog__file-list">
              {filteredFiles.length === 0 ? (
                <div className="chart-import-dialog__empty">
                  No files match the current filters
                </div>
              ) : (
                filteredFiles.map(file => (
                  <div
                    key={file.path}
                    className={`chart-import-dialog__file-row ${file.already_imported ? 'chart-import-dialog__file-row--imported' : ''} ${selectedFiles.has(file.path) ? 'chart-import-dialog__file-row--selected' : ''}`}
                    onClick={() => !file.already_imported && toggleFile(file.path)}
                  >
                    <div className="chart-import-dialog__col-check">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.path)}
                        onChange={() => toggleFile(file.path)}
                        disabled={file.already_imported || importing}
                      />
                    </div>
                    <div className="chart-import-dialog__col-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="chart-import-dialog__col-folder" title={file.parent_folder}>
                      {file.parent_folder}
                    </div>
                    <div className="chart-import-dialog__col-size">
                      {formatSize(file.size_bytes)}
                    </div>
                    <div className="chart-import-dialog__col-status">
                      {file.already_imported ? (
                        <span className="chart-import-dialog__status--imported">Imported</span>
                      ) : (
                        <span className="chart-import-dialog__status--available">Available</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Import Progress */}
            {importProgress && (
              <div className="chart-import-dialog__progress">
                <div className="chart-import-dialog__progress-text">
                  {importProgress.phase === 'scanning' && 'Scanning...'}
                  {importProgress.phase === 'converting' && `Converting: ${importProgress.current_file || ''}`}
                  {importProgress.phase === 'complete' && 'Complete!'}
                  {' '}({importProgress.current}/{importProgress.total})
                </div>
                <div className="chart-import-dialog__progress-bar">
                  <div
                    className="chart-import-dialog__progress-fill"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer Actions */}
        <div className="chart-import-dialog__footer">
          <button
            className="chart-import-dialog__cancel-btn"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </button>
          <button
            className="chart-import-dialog__import-btn"
            onClick={handleImport}
            disabled={!scanResult || selectedFiles.size === 0 || importing}
          >
            {importing ? 'Importing...' : `Import ${selectedFiles.size} Files`}
          </button>
        </div>
      </div>
    </div>
  );
}
