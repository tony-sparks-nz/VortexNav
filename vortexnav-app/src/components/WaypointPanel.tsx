import { useState, useEffect, useMemo } from 'react';
import type { ThemeMode, Position } from '../types';
import {
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  isTauri,
  calculateDistance,
  calculateBearing,
  formatDistance,
  formatBearing,
  type Waypoint,
} from '../hooks/useTauri';

type SortOption = 'name' | 'distance' | 'created';
type SortDirection = 'asc' | 'desc';

interface WaypointPanelProps {
  theme: ThemeMode;
  waypoints: Waypoint[];
  vesselPosition: Position | null;
  draggingWaypoint?: { id: number; lat: number; lon: number } | null;
  activeWaypointId: number | null;
  selectedWaypointId?: number | null;
  onSelectionChange?: (id: number | null) => void;
  onClose: () => void;
  onWaypointSelect: (waypoint: Waypoint | null) => void;
  onNavigateTo: (waypoint: Waypoint) => void;
  onCenterOnWaypoint: (waypoint: Waypoint) => void;
  onWaypointsChange: () => void;
  pendingWaypoint: { lat: number; lon: number } | null;
  onPendingWaypointClear: () => void;
}

// Available waypoint symbols
const WAYPOINT_SYMBOLS = [
  { id: 'default', label: 'Default', icon: '📍' },
  { id: 'anchor', label: 'Anchor', icon: '⚓' },
  { id: 'harbor', label: 'Harbor', icon: '🏠' },
  { id: 'fuel', label: 'Fuel', icon: '⛽' },
  { id: 'danger', label: 'Danger', icon: '⚠️' },
  { id: 'fishing', label: 'Fishing', icon: '🎣' },
  { id: 'dive', label: 'Dive Site', icon: '🤿' },
  { id: 'beach', label: 'Beach', icon: '🏖️' },
];

export function WaypointPanel({
  theme,
  waypoints,
  vesselPosition,
  draggingWaypoint,
  activeWaypointId,
  selectedWaypointId: externalSelectedId,
  onSelectionChange,
  onClose,
  onWaypointSelect,
  onNavigateTo,
  onCenterOnWaypoint,
  onWaypointsChange,
  pendingWaypoint,
  onPendingWaypointClear,
}: WaypointPanelProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<number | null>(null);

  // Use external selection if provided, otherwise use internal state
  const selectedWaypointId = externalSelectedId !== undefined ? externalSelectedId : internalSelectedId;

  const setSelectedWaypointId = (id: number | null) => {
    setInternalSelectedId(id);
    onSelectionChange?.(id);
  };
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingWaypoint, setEditingWaypoint] = useState<Waypoint | null>(null);

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('distance');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Form state for create/edit
  const [formName, setFormName] = useState('');
  const [formLat, setFormLat] = useState('');
  const [formLon, setFormLon] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSymbol, setFormSymbol] = useState('default');

  // Sync external selection to internal state
  useEffect(() => {
    if (externalSelectedId !== undefined && externalSelectedId !== internalSelectedId) {
      setInternalSelectedId(externalSelectedId);
    }
  }, [externalSelectedId, internalSelectedId]);

  // Get selected waypoint object
  const selectedWaypoint = useMemo(() => {
    return waypoints.find((w) => w.id === selectedWaypointId) || null;
  }, [waypoints, selectedWaypointId]);

  // Handle pending waypoint from map click
  useEffect(() => {
    if (pendingWaypoint) {
      setFormName('');
      setFormLat(pendingWaypoint.lat.toFixed(6));
      setFormLon(pendingWaypoint.lon.toFixed(6));
      setFormDescription('');
      setFormSymbol('default');
      setEditingWaypoint(null);
      setShowCreateForm(true);
    }
  }, [pendingWaypoint]);

  // Calculate distance for sorting
  const getDistance = (waypoint: Waypoint): number => {
    if (!vesselPosition) return Infinity;
    return calculateDistance(
      vesselPosition.lat,
      vesselPosition.lon,
      waypoint.lat,
      waypoint.lon
    );
  };

  // Filter and sort waypoints
  const filteredWaypoints = useMemo(() => {
    let filtered = waypoints;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (wp) =>
          wp.name.toLowerCase().includes(query) ||
          (wp.description && wp.description.toLowerCase().includes(query))
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'distance':
          comparison = getDistance(a) - getDistance(b);
          break;
        case 'created':
          comparison = (a.created_at || '').localeCompare(b.created_at || '');
          break;
      }

      return sortDir === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [waypoints, searchQuery, sortBy, sortDir, vesselPosition?.lat, vesselPosition?.lon]);

  const resetForm = () => {
    setFormName('');
    setFormLat('');
    setFormLon('');
    setFormDescription('');
    setFormSymbol('default');
    setEditingWaypoint(null);
    setShowCreateForm(false);
    onPendingWaypointClear();
  };

  const handleCreate = async () => {
    const lat = parseFloat(formLat);
    const lon = parseFloat(formLon);

    if (!formName.trim() || isNaN(lat) || isNaN(lon)) {
      return;
    }

    try {
      await createWaypoint({
        name: formName.trim(),
        lat,
        lon,
        description: formDescription.trim() || null,
        symbol: formSymbol,
      });
      onWaypointsChange();
      resetForm();
    } catch (error) {
      console.error('Failed to create waypoint:', error);
    }
  };

  const handleUpdate = async () => {
    if (!editingWaypoint?.id) return;

    const lat = parseFloat(formLat);
    const lon = parseFloat(formLon);

    if (!formName.trim() || isNaN(lat) || isNaN(lon)) {
      return;
    }

    try {
      await updateWaypoint({
        ...editingWaypoint,
        name: formName.trim(),
        lat,
        lon,
        description: formDescription.trim() || null,
        symbol: formSymbol,
      });
      onWaypointsChange();
      resetForm();
    } catch (error) {
      console.error('Failed to update waypoint:', error);
    }
  };

  const handleDelete = async () => {
    if (!selectedWaypoint?.id) return;
    if (!confirm(`Delete "${selectedWaypoint.name}"?`)) return;

    try {
      await deleteWaypoint(selectedWaypoint.id);
      if (activeWaypointId === selectedWaypoint.id) {
        onWaypointSelect(null);
      }
      setSelectedWaypointId(null);
      onWaypointsChange();
    } catch (error) {
      console.error('Failed to delete waypoint:', error);
    }
  };

  const startEdit = () => {
    if (!selectedWaypoint) return;
    setEditingWaypoint(selectedWaypoint);
    setFormName(selectedWaypoint.name);
    setFormLat(selectedWaypoint.lat.toFixed(6));
    setFormLon(selectedWaypoint.lon.toFixed(6));
    setFormDescription(selectedWaypoint.description || '');
    setFormSymbol(selectedWaypoint.symbol || 'default');
    setShowCreateForm(true);
  };

  const startCreate = () => {
    resetForm();
    setShowCreateForm(true);
  };

  const getSymbolIcon = (symbolId: string | null): string => {
    const symbol = WAYPOINT_SYMBOLS.find((s) => s.id === symbolId);
    return symbol?.icon || '📍';
  };

  // Pre-compute navigation data for all waypoints - updates when vessel, waypoints, or drag position changes
  const waypointNavData = useMemo(() => {
    const navMap = new Map<number, { distance: string; bearing: string }>();

    if (!vesselPosition) return navMap;

    for (const waypoint of waypoints) {
      if (waypoint.id === null) continue;

      // Use dragging position if this waypoint is being dragged
      const wpLat = draggingWaypoint?.id === waypoint.id ? draggingWaypoint.lat : waypoint.lat;
      const wpLon = draggingWaypoint?.id === waypoint.id ? draggingWaypoint.lon : waypoint.lon;

      const distance = calculateDistance(
        vesselPosition.lat,
        vesselPosition.lon,
        wpLat,
        wpLon
      );
      const bearing = calculateBearing(
        vesselPosition.lat,
        vesselPosition.lon,
        wpLat,
        wpLon
      );

      navMap.set(waypoint.id, {
        distance: formatDistance(distance),
        bearing: formatBearing(bearing),
      });
    }

    return navMap;
  }, [vesselPosition?.lat, vesselPosition?.lon, waypoints, draggingWaypoint]);

  // Helper to get nav data for a waypoint
  const getDistanceBearing = (waypoint: Waypoint) => {
    if (waypoint.id === null) return null;
    return waypointNavData.get(waypoint.id) || null;
  };

  const toggleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(option);
      setSortDir('asc');
    }
  };

  const handleRowClick = (waypoint: Waypoint) => {
    setSelectedWaypointId(waypoint.id);
  };

  const handleRowDoubleClick = (waypoint: Waypoint) => {
    onCenterOnWaypoint(waypoint);
  };

  if (!isTauri()) {
    return (
      <div className={`waypoint-panel waypoint-panel--${theme}`}>
        <div className="waypoint-panel__header">
          <h2>Waypoints</h2>
          <button className="waypoint-panel__close" onClick={onClose}>×</button>
        </div>
        <div className="waypoint-panel__content">
          <p className="waypoint-panel__empty">
            Waypoint management is only available in the desktop application.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`waypoint-panel waypoint-panel--${theme}`}>
      <div className="waypoint-panel__header">
        <h2>Waypoints <span className="waypoint-panel__count">({waypoints.length})</span></h2>
        <button className="waypoint-panel__close" onClick={onClose}>×</button>
      </div>

      <div className="waypoint-panel__content">
        {/* Create/Edit Form */}
        {showCreateForm ? (
          <div className="waypoint-panel__form">
            <h3>{editingWaypoint ? 'Edit Waypoint' : 'New Waypoint'}</h3>

            <div className="waypoint-panel__form-group">
              <label>Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Waypoint name"
                autoFocus
              />
            </div>

            <div className="waypoint-panel__form-row">
              <div className="waypoint-panel__form-group">
                <label>Latitude</label>
                <input
                  type="text"
                  value={formLat}
                  onChange={(e) => setFormLat(e.target.value)}
                  placeholder="37.8044"
                />
              </div>
              <div className="waypoint-panel__form-group">
                <label>Longitude</label>
                <input
                  type="text"
                  value={formLon}
                  onChange={(e) => setFormLon(e.target.value)}
                  placeholder="-122.4194"
                />
              </div>
            </div>

            <div className="waypoint-panel__form-group">
              <label>Symbol</label>
              <div className="waypoint-panel__symbols">
                {WAYPOINT_SYMBOLS.map((symbol) => (
                  <button
                    key={symbol.id}
                    className={`waypoint-panel__symbol-btn ${formSymbol === symbol.id ? 'active' : ''}`}
                    onClick={() => setFormSymbol(symbol.id)}
                    title={symbol.label}
                  >
                    {symbol.icon}
                  </button>
                ))}
              </div>
            </div>

            <div className="waypoint-panel__form-group">
              <label>Description (optional)</label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Notes about this waypoint..."
                rows={2}
              />
            </div>

            <div className="waypoint-panel__form-actions">
              <button className="waypoint-panel__btn waypoint-panel__btn--secondary" onClick={resetForm}>
                Cancel
              </button>
              <button
                className="waypoint-panel__btn waypoint-panel__btn--primary"
                onClick={editingWaypoint ? handleUpdate : handleCreate}
                disabled={!formName.trim() || !formLat || !formLon}
              >
                {editingWaypoint ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div className="waypoint-panel__search-bar">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search waypoints..."
              />
              {searchQuery && (
                <button
                  className="waypoint-panel__search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  ×
                </button>
              )}
            </div>

            {/* Action toolbar */}
            <div className="waypoint-panel__actions">
              <button
                className="waypoint-panel__action-btn waypoint-panel__action-btn--primary"
                onClick={startCreate}
                title="Add new waypoint"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
              </button>
              <div className="waypoint-panel__action-divider" />
              <button
                className="waypoint-panel__action-btn"
                onClick={() => selectedWaypoint && onCenterOnWaypoint(selectedWaypoint)}
                disabled={!selectedWaypoint}
                title="Show on map"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="12" cy="12" r="8" />
                </svg>
              </button>
              <button
                className={`waypoint-panel__action-btn ${selectedWaypoint && activeWaypointId === selectedWaypoint.id ? 'active' : ''}`}
                onClick={() => selectedWaypoint && onNavigateTo(selectedWaypoint)}
                disabled={!selectedWaypoint}
                title="Navigate to"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
              </button>
              <button
                className="waypoint-panel__action-btn"
                onClick={startEdit}
                disabled={!selectedWaypoint}
                title="Edit"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                className="waypoint-panel__action-btn waypoint-panel__action-btn--danger"
                onClick={handleDelete}
                disabled={!selectedWaypoint}
                title="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>

            {/* Sort options */}
            <div className="waypoint-panel__sort">
              <button
                className={`waypoint-panel__sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                onClick={() => toggleSort('name')}
              >
                Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                className={`waypoint-panel__sort-btn ${sortBy === 'distance' ? 'active' : ''}`}
                onClick={() => toggleSort('distance')}
              >
                Dist {sortBy === 'distance' && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                className={`waypoint-panel__sort-btn ${sortBy === 'created' ? 'active' : ''}`}
                onClick={() => toggleSort('created')}
              >
                Date {sortBy === 'created' && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
            </div>

            {/* Waypoint list */}
            {filteredWaypoints.length === 0 ? (
              <p className="waypoint-panel__empty">
                {waypoints.length === 0 ? 'No waypoints yet' : 'No matching waypoints'}
              </p>
            ) : (
              <div className="waypoint-panel__list">
                {filteredWaypoints.map((waypoint) => {
                  const nav = getDistanceBearing(waypoint);
                  const isSelected = selectedWaypointId === waypoint.id;
                  const isNavigating = activeWaypointId === waypoint.id;

                  return (
                    <div
                      key={waypoint.id}
                      className={`waypoint-panel__row ${isSelected ? 'waypoint-panel__row--selected' : ''} ${isNavigating ? 'waypoint-panel__row--navigating' : ''}`}
                      onClick={() => handleRowClick(waypoint)}
                      onDoubleClick={() => handleRowDoubleClick(waypoint)}
                    >
                      <span className="waypoint-panel__row-icon">
                        {getSymbolIcon(waypoint.symbol)}
                      </span>
                      <span className="waypoint-panel__row-name">{waypoint.name}</span>
                      {nav && (
                        <>
                          <span className="waypoint-panel__row-dist">{nav.distance}</span>
                          <span className="waypoint-panel__row-bearing">{nav.bearing}</span>
                        </>
                      )}
                      {isNavigating && (
                        <span className="waypoint-panel__row-nav-indicator" title="Navigating">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <polygon points="3 11 22 2 13 21 11 13 3 11" />
                          </svg>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
