import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ThemeMode, Position } from '../types';
import type { useWaypointManager } from '../hooks/useWaypointManager';
import {
  isTauri,
  calculateDistance,
  calculateBearing,
  formatDistance,
  formatBearing,
} from '../hooks/useTauri';

type SortOption = 'name' | 'distance' | 'created';
type SortDirection = 'asc' | 'desc';

// Get the return type of useWaypointManager
type WaypointManagerType = ReturnType<typeof useWaypointManager>;

interface WaypointPanelProps {
  theme: ThemeMode;
  waypointManager: WaypointManagerType;
  vesselPosition: Position | null;
  pendingWaypoint: { lat: number; lon: number } | null;
  onPendingWaypointClear: () => void;
  onCenterOnWaypoint: (waypointId: number) => void;
  onClose: () => void;
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
  waypointManager,
  vesselPosition,
  pendingWaypoint,
  onPendingWaypointClear,
  onCenterOnWaypoint,
  onClose,
}: WaypointPanelProps) {
  // Destructure everything we need from the manager
  const {
    state,
    selectedWaypoint,
    isEditing,
    isSaving,
    startCreate,
    startEdit,
    updateForm,
    saveWaypoint,
    cancelEdit,
    deleteWaypoint,
    setSelectedWaypoint,
    toggleActiveWaypoint,
    toggleAllLabels,
    toggleAllMarkers,
    toggleWaypointHidden,
  } = waypointManager;

  const { waypoints, editState, activeWaypointId, showAllLabels, showAllMarkers } = state;

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('distance');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Handle pending waypoint from map right-click (create new)
  useEffect(() => {
    if (pendingWaypoint) {
      startCreate(pendingWaypoint);
    }
  }, [pendingWaypoint, startCreate]);

  // Get distance calculation helper
  const getDistance = useCallback((lat: number, lon: number): number => {
    if (!vesselPosition) return Infinity;
    return calculateDistance(
      vesselPosition.lat,
      vesselPosition.lon,
      lat,
      lon
    );
  }, [vesselPosition]);

  const getSymbolIcon = (symbolId: string | null): string => {
    const symbol = WAYPOINT_SYMBOLS.find((s) => s.id === symbolId);
    return symbol?.icon || '📍';
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
          comparison = getDistance(a.lat, a.lon) - getDistance(b.lat, b.lon);
          break;
        case 'created':
          comparison = (a.created_at || '').localeCompare(b.created_at || '');
          break;
      }

      return sortDir === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [waypoints, searchQuery, sortBy, sortDir, getDistance]);

  // Pre-compute navigation data for all waypoints
  const waypointNavData = useMemo(() => {
    const navMap = new Map<number, { distance: string; bearing: string }>();

    if (!vesselPosition) return navMap;

    // Use dragging position if waypoint is being dragged
    const dragging = state.dragging;

    for (const waypoint of waypoints) {
      if (waypoint.id === null) continue;

      const wpLat = dragging?.id === waypoint.id ? dragging.lat : waypoint.lat;
      const wpLon = dragging?.id === waypoint.id ? dragging.lon : waypoint.lon;

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
  }, [vesselPosition, waypoints, state.dragging]);

  const getDistanceBearing = (waypointId: number | null) => {
    if (waypointId === null) return null;
    return waypointNavData.get(waypointId) || null;
  };

  const toggleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(option);
      setSortDir('asc');
    }
  };

  const handleRowClick = (waypointId: number) => {
    setSelectedWaypoint(waypointId);
  };

  const handleRowDoubleClick = (waypointId: number) => {
    onCenterOnWaypoint(waypointId);
  };

  const handleSave = async () => {
    await saveWaypoint();
    onPendingWaypointClear();
  };

  const handleCancel = () => {
    cancelEdit();
    onPendingWaypointClear();
  };

  const handleDelete = async () => {
    if (!selectedWaypoint?.id) return;
    if (!confirm(`Delete "${selectedWaypoint.name}"?`)) return;
    await deleteWaypoint(selectedWaypoint.id);
  };

  const handleStartEdit = () => {
    if (selectedWaypoint?.id) {
      startEdit(selectedWaypoint.id);
    }
  };

  const handleStartCreate = () => {
    startCreate();
  };

  const handleNavigateTo = () => {
    if (selectedWaypoint?.id) {
      toggleActiveWaypoint(selectedWaypoint.id);
    }
  };

  const handleCenterOn = () => {
    if (selectedWaypoint?.id) {
      onCenterOnWaypoint(selectedWaypoint.id);
    }
  };

  // Don't render in browser mode
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

  const showForm = isEditing || editState.status === 'creating';
  const formData = editState.formData;
  const isCreating = editState.status === 'creating';

  return (
    <div className={`waypoint-panel waypoint-panel--${theme}`}>
      <div className="waypoint-panel__header">
        <h2>Waypoints <span className="waypoint-panel__count">({waypoints.length})</span></h2>
        <button className="waypoint-panel__close" onClick={onClose}>×</button>
      </div>

      <div className="waypoint-panel__content">
        {/* Create/Edit Form */}
        {showForm && formData ? (
          <div className="waypoint-panel__form">
            <button
              className="waypoint-panel__form-back"
              onClick={handleCancel}
              title="Back to list"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>{isCreating ? 'New Waypoint' : 'Edit Waypoint'}</span>
            </button>

            <div className="waypoint-panel__form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="Waypoint name"
                autoFocus
              />
            </div>

            <div className="waypoint-panel__form-row">
              <div className="waypoint-panel__form-group">
                <label>Latitude</label>
                <input
                  type="text"
                  value={formData.lat}
                  onChange={(e) => updateForm({ lat: e.target.value })}
                  placeholder="37.8044"
                />
              </div>
              <div className="waypoint-panel__form-group">
                <label>Longitude</label>
                <input
                  type="text"
                  value={formData.lon}
                  onChange={(e) => updateForm({ lon: e.target.value })}
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
                    className={`waypoint-panel__symbol-btn ${formData.symbol === symbol.id ? 'active' : ''}`}
                    onClick={() => updateForm({ symbol: symbol.id })}
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
                value={formData.description}
                onChange={(e) => updateForm({ description: e.target.value })}
                placeholder="Notes about this waypoint..."
                rows={2}
              />
            </div>

            <div className="waypoint-panel__form-group waypoint-panel__form-group--checkbox">
              <label className="waypoint-panel__checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.showLabel}
                  onChange={(e) => updateForm({ showLabel: e.target.checked })}
                />
                <span>Show label on map</span>
              </label>
            </div>

            {editState.error && (
              <div className="waypoint-panel__error">{editState.error}</div>
            )}

            <div className="waypoint-panel__form-actions">
              <button
                className="waypoint-panel__btn waypoint-panel__btn--secondary"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                className="waypoint-panel__btn waypoint-panel__btn--primary"
                onClick={handleSave}
                disabled={!formData.name.trim() || !formData.lat || !formData.lon || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
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
                onClick={handleStartCreate}
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
                onClick={handleCenterOn}
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
                onClick={handleNavigateTo}
                disabled={!selectedWaypoint}
                title="Navigate to"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
              </button>
              <button
                className="waypoint-panel__action-btn"
                onClick={handleStartEdit}
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
              <div className="waypoint-panel__action-divider" />
              <button
                className={`waypoint-panel__action-btn ${showAllLabels ? 'active' : ''}`}
                onClick={toggleAllLabels}
                title={showAllLabels ? 'Hide all labels' : 'Show all labels'}
              >
                {showAllLabels ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
              <button
                className={`waypoint-panel__action-btn ${showAllMarkers ? 'active' : ''}`}
                onClick={toggleAllMarkers}
                title={showAllMarkers ? 'Hide all markers' : 'Show all markers'}
              >
                {showAllMarkers ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" opacity="0.4" />
                    <circle cx="12" cy="10" r="3" opacity="0.4" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
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
                  const nav = getDistanceBearing(waypoint.id);
                  const isSelected = state.selectedWaypointId === waypoint.id;
                  const isNavigating = activeWaypointId === waypoint.id;
                  const isHidden = waypoint.hidden;

                  return (
                    <div
                      key={waypoint.id}
                      className={`waypoint-panel__row ${isSelected ? 'waypoint-panel__row--selected' : ''} ${isNavigating ? 'waypoint-panel__row--navigating' : ''} ${isHidden ? 'waypoint-panel__row--hidden' : ''}`}
                      onClick={() => waypoint.id && handleRowClick(waypoint.id)}
                      onDoubleClick={() => waypoint.id && handleRowDoubleClick(waypoint.id)}
                    >
                      <span className={`waypoint-panel__row-icon ${isHidden ? 'waypoint-panel__row-icon--hidden' : ''}`}>
                        {getSymbolIcon(waypoint.symbol)}
                      </span>
                      <span className={`waypoint-panel__row-name ${isHidden ? 'waypoint-panel__row-name--hidden' : ''}`}>{waypoint.name}</span>
                      <span className={`waypoint-panel__row-desc ${isHidden ? 'waypoint-panel__row-desc--hidden' : ''}`} title={waypoint.description || ''}>
                        {waypoint.description || ''}
                      </span>
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
                      <button
                        className="waypoint-panel__row-hide-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (waypoint.id) toggleWaypointHidden(waypoint.id);
                        }}
                        title={isHidden ? 'Show on map' : 'Hide from map'}
                      >
                        {isHidden ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
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
