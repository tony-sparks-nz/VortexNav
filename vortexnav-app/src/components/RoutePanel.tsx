import { useState, useMemo, useCallback } from 'react';
import type { ThemeMode, RouteSortOption, GpxImportResult, RouteWithWaypoints } from '../types';
import type { Position } from '../types';
import { ROUTE_COLORS, DEFAULT_ROUTE_COLOR } from '../types';
import type { useRouteManager } from '../hooks/useRouteManager';
import type { Waypoint } from '../hooks/useTauri';
import { importGpx, isTauri } from '../hooks/useTauri';
import { open } from '@tauri-apps/plugin-dialog';
import { ShareRouteModal } from './ShareRouteModal';

// Get the return type of useRouteManager
type RouteManagerType = ReturnType<typeof useRouteManager>;

interface RoutePanelProps {
  theme: ThemeMode;
  routeManager: RouteManagerType;
  waypoints: Waypoint[];
  vesselPosition: Position | null;
  onCenterOnRoute: (routeId: number) => void;
  onStartMapCreation: (name: string) => void;
  onRouteDeleted?: (deletedWaypointIds: boolean) => void;
  onClose: () => void;
}

export function RoutePanel({
  theme,
  routeManager,
  waypoints,
  vesselPosition: _vesselPosition,
  onCenterOnRoute,
  onStartMapCreation,
  onRouteDeleted,
  onClose,
}: RoutePanelProps) {
  const {
    state,
    selectedRoute,
    filteredRoutes,
    isEditing: _isEditing,
    isSaving,
    startCreate,
    startEdit,
    updateForm,
    updateSelectedWaypoints,
    updateSelectedTags,
    saveRoute,
    cancelEdit,
    deleteRoute,
    getExclusiveWaypointCount,
    duplicateRoute,
    reverseRoute,
    toggleActiveRoute,
    toggleRouteHidden,
    setSelectedRoute,
    updateFilter,
  } = routeManager;

  const { editState, activeRouteId, tags, filter } = state;

  // View mode: 'list' | 'edit' | 'select-waypoints'
  const [viewMode, setViewMode] = useState<'list' | 'edit' | 'select-waypoints'>('list');

  // Waypoint selection search
  const [wpSearchQuery, setWpSearchQuery] = useState('');

  // Delete confirmation dialog state
  const [deleteDialogState, setDeleteDialogState] = useState<{
    isOpen: boolean;
    routeId: number | null;
    routeName: string;
    exclusiveWaypointCount: number;
  }>({
    isOpen: false,
    routeId: null,
    routeName: '',
    exclusiveWaypointCount: 0,
  });

  // Share modal state
  const [shareModalRoute, setShareModalRoute] = useState<RouteWithWaypoints | null>(null);

  // Handle creating new route
  const handleCreateNew = () => {
    startCreate();
    setViewMode('edit');
  };

  // Handle draw on map
  const handleDrawOnMap = () => {
    const name = `Route ${state.routes.length + 1}`;
    onStartMapCreation(name);
    onClose();
  };

  // Handle edit route
  const handleEditRoute = (routeId: number) => {
    startEdit(routeId);
    setViewMode('edit');
  };

  // Handle save
  const handleSave = async () => {
    await saveRoute();
    setViewMode('list');
  };

  // Handle cancel
  const handleCancel = () => {
    cancelEdit();
    setViewMode('list');
  };

  // Handle delete - show confirmation dialog with waypoint deletion option
  const handleDelete = async (routeId: number, routeName: string) => {
    // Get the count of exclusive waypoints
    const exclusiveCount = await getExclusiveWaypointCount(routeId);

    setDeleteDialogState({
      isOpen: true,
      routeId,
      routeName,
      exclusiveWaypointCount: exclusiveCount,
    });
  };

  // Handle confirming route deletion
  const handleConfirmDelete = async (deleteWaypoints: boolean) => {
    if (deleteDialogState.routeId) {
      await deleteRoute(deleteDialogState.routeId, deleteWaypoints);
      // Notify parent that route was deleted (and whether waypoints were deleted)
      onRouteDeleted?.(deleteWaypoints);
    }
    setDeleteDialogState({
      isOpen: false,
      routeId: null,
      routeName: '',
      exclusiveWaypointCount: 0,
    });
  };

  // Handle canceling route deletion
  const handleCancelDelete = () => {
    setDeleteDialogState({
      isOpen: false,
      routeId: null,
      routeName: '',
      exclusiveWaypointCount: 0,
    });
  };

  // Handle duplicate
  const handleDuplicate = async (routeId: number, currentName: string) => {
    const newName = `${currentName} (Copy)`;
    await duplicateRoute(routeId, newName);
  };

  // Handle reverse
  const handleReverse = async (routeId: number) => {
    await reverseRoute(routeId);
  };

  // GPX Import state
  const [_gpxImportResult, setGpxImportResult] = useState<GpxImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Handle GPX import
  const handleImportGpx = useCallback(async () => {
    if (!isTauri()) {
      alert('GPX import is only available in the desktop app');
      return;
    }

    try {
      setIsImporting(true);
      const selected = await open({
        title: 'Import GPX File',
        filters: [{ name: 'GPX Files', extensions: ['gpx'] }],
        multiple: false,
      });

      if (selected) {
        const filePath = typeof selected === 'string' ? selected : selected;
        const result = await importGpx(filePath);
        setGpxImportResult(result);

        // Reload routes after import
        await routeManager.loadRoutes();

        // Show success message
        if (result.errors.length === 0) {
          alert(`Import complete!\n\nRoutes: ${result.routes_imported}\nWaypoints: ${result.waypoints_imported}\nTracks: ${result.tracks_imported}`);
        } else {
          alert(`Import complete with warnings:\n\nRoutes: ${result.routes_imported}\nWaypoints: ${result.waypoints_imported}\nTracks: ${result.tracks_imported}\n\nWarnings:\n${result.errors.join('\n')}`);
        }
      }
    } catch (error) {
      console.error('GPX import error:', error);
      alert(`Failed to import GPX: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsImporting(false);
    }
  }, [routeManager]);

  // Handle waypoint selection toggle
  const handleWaypointToggle = (waypointId: number) => {
    const currentIds = editState.selectedWaypointIds;
    if (currentIds.includes(waypointId)) {
      updateSelectedWaypoints(currentIds.filter(id => id !== waypointId));
    } else {
      updateSelectedWaypoints([...currentIds, waypointId]);
    }
  };

  // Handle waypoint reorder (move up)
  const handleMoveWaypointUp = (index: number) => {
    if (index === 0) return;
    const newIds = [...editState.selectedWaypointIds];
    [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
    updateSelectedWaypoints(newIds);
  };

  // Handle waypoint reorder (move down)
  const handleMoveWaypointDown = (index: number) => {
    if (index >= editState.selectedWaypointIds.length - 1) return;
    const newIds = [...editState.selectedWaypointIds];
    [newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
    updateSelectedWaypoints(newIds);
  };

  // Handle tag toggle
  const handleTagToggle = (tagId: number) => {
    const currentIds = editState.selectedTagIds;
    if (currentIds.includes(tagId)) {
      updateSelectedTags(currentIds.filter(id => id !== tagId));
    } else {
      updateSelectedTags([...currentIds, tagId]);
    }
  };

  // Format time (hours to h m string)
  const formatTime = (hours: number): string => {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    }
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  // Filter available waypoints for selection
  const availableWaypoints = useMemo(() => {
    let filtered = waypoints.filter(wp => !wp.hidden && wp.id !== null);
    if (wpSearchQuery.trim()) {
      const query = wpSearchQuery.toLowerCase();
      filtered = filtered.filter(wp =>
        wp.name.toLowerCase().includes(query) ||
        wp.description?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [waypoints, wpSearchQuery]);

  // Get selected waypoints in order
  // When editing an existing route, also check the route's embedded waypoints
  // (they might not be in the waypoints prop yet if just created)
  const selectedWaypoints = useMemo(() => {
    const routeWaypoints = selectedRoute?.waypoints || [];
    return editState.selectedWaypointIds
      .map(id => {
        // First try route waypoints (for newly created waypoints during route creation)
        const fromRoute = routeWaypoints.find(wp => wp.id === id);
        if (fromRoute) return fromRoute;
        // Fall back to waypoints prop
        return waypoints.find(wp => wp.id === id);
      })
      .filter((wp): wp is Waypoint => wp !== undefined);
  }, [editState.selectedWaypointIds, waypoints, selectedRoute]);

  // Calculate distance for selected waypoints
  const totalDistance = useMemo(() => {
    let total = 0;
    for (let i = 0; i < selectedWaypoints.length - 1; i++) {
      const from = selectedWaypoints[i];
      const to = selectedWaypoints[i + 1];
      const R = 3440.065; // Earth radius in nm
      const dLat = (to.lat - from.lat) * Math.PI / 180;
      const dLon = (to.lon - from.lon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return total;
  }, [selectedWaypoints]);

  // Render list view
  const renderListView = () => (
    <>
      {/* Toolbar */}
      <div className="route-panel__toolbar">
        <button
          className="route-panel__btn route-panel__btn--primary"
          onClick={handleCreateNew}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add
        </button>
        <button
          className="route-panel__btn"
          onClick={handleDrawOnMap}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          Draw
        </button>
        <button
          className="route-panel__btn"
          onClick={handleImportGpx}
          disabled={isImporting}
          title="Import GPX file"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {isImporting ? 'Importing...' : 'Import'}
        </button>
      </div>

      {/* Search */}
      <div className="route-panel__search">
        <input
          type="text"
          placeholder="Search routes..."
          value={filter.searchQuery}
          onChange={(e) => updateFilter({ searchQuery: e.target.value })}
          className="route-panel__search-input"
        />
      </div>

      {/* Sort controls */}
      <div className="route-panel__sort">
        <span className="route-panel__sort-label">Sort:</span>
        {(['name', 'date', 'distance', 'waypoints'] as RouteSortOption[]).map((option) => (
          <button
            key={option}
            className={`route-panel__sort-btn ${filter.sortBy === option ? 'route-panel__sort-btn--active' : ''}`}
            onClick={() => {
              if (filter.sortBy === option) {
                updateFilter({ sortDirection: filter.sortDirection === 'asc' ? 'desc' : 'asc' });
              } else {
                updateFilter({ sortBy: option, sortDirection: 'asc' });
              }
            }}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
            {filter.sortBy === option && (
              <span className="route-panel__sort-arrow">
                {filter.sortDirection === 'asc' ? '↑' : '↓'}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tag filter */}
      {tags.length > 0 && (
        <div className="route-panel__tag-filter">
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={`route-panel__tag-chip ${
                filter.selectedTagIds.includes(tag.id!) ? 'route-panel__tag-chip--active' : ''
              }`}
              style={{ '--tag-color': tag.color || '#888' } as React.CSSProperties}
              onClick={() => {
                const ids = filter.selectedTagIds;
                if (ids.includes(tag.id!)) {
                  updateFilter({ selectedTagIds: ids.filter(id => id !== tag.id) });
                } else {
                  updateFilter({ selectedTagIds: [...ids, tag.id!] });
                }
              }}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Route list */}
      <div className="route-panel__list">
        {filteredRoutes.length === 0 ? (
          <div className="route-panel__empty">
            {state.routes.length === 0
              ? 'No routes yet. Create one to get started!'
              : 'No routes match your search.'}
          </div>
        ) : (
          filteredRoutes.map((routeWithWaypoints) => {
            const route = routeWithWaypoints.route;
            const isActive = route.id === activeRouteId;
            const isSelected = route.id === state.selectedRouteId;
            const isHidden = route.hidden;

            return (
              <div
                key={route.id}
                className={`route-panel__row ${isSelected ? 'route-panel__row--selected' : ''} ${isActive ? 'route-panel__row--active' : ''} ${isHidden ? 'route-panel__row--hidden' : ''}`}
                onClick={() => setSelectedRoute(route.id)}
                onDoubleClick={() => route.id && onCenterOnRoute(route.id)}
              >
                <div
                  className="route-panel__row-color"
                  style={{ backgroundColor: route.color || DEFAULT_ROUTE_COLOR }}
                />
                <div className="route-panel__row-content">
                  <div className="route-panel__row-header">
                    <span className="route-panel__row-name">{route.name}</span>
                    {isActive && (
                      <span className="route-panel__row-badge route-panel__row-badge--active">
                        Navigating
                      </span>
                    )}
                    {isHidden && !isActive && (
                      <span className="route-panel__row-badge route-panel__row-badge--hidden">
                        Hidden
                      </span>
                    )}
                  </div>
                  <div className="route-panel__row-stats">
                    {routeWithWaypoints.waypoints.length} waypoints
                    {route.total_distance_nm && (
                      <> &bull; {route.total_distance_nm.toFixed(1)} nm</>
                    )}
                    {route.total_distance_nm && route.estimated_speed_kn > 0 && (
                      <> &bull; ~{formatTime(route.total_distance_nm / route.estimated_speed_kn)}</>
                    )}
                  </div>
                  {routeWithWaypoints.tags.length > 0 && (
                    <div className="route-panel__row-tags">
                      {routeWithWaypoints.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="route-panel__row-tag"
                          style={{ backgroundColor: tag.color || '#888' }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="route-panel__row-actions">
                  {/* Visibility toggle */}
                  <button
                    className={`route-panel__row-action ${isHidden ? 'route-panel__row-action--dimmed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      route.id && toggleRouteHidden(route.id, !isHidden);
                    }}
                    title={isHidden ? 'Show route' : 'Hide route'}
                  >
                    {isHidden ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                  {/* Navigate button */}
                  <button
                    className={`route-panel__row-action ${isActive ? 'route-panel__row-action--active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      route.id && toggleActiveRoute(route.id);
                    }}
                    title={isActive ? 'Stop navigating' : 'Navigate'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Selected route actions */}
      {selectedRoute && (
        <div className="route-panel__actions">
          <button
            className="route-panel__action-btn"
            onClick={() => selectedRoute.route.id && handleEditRoute(selectedRoute.route.id)}
          >
            Edit
          </button>
          <button
            className="route-panel__action-btn"
            onClick={() => selectedRoute.route.id && handleDuplicate(selectedRoute.route.id, selectedRoute.route.name)}
          >
            Duplicate
          </button>
          <button
            className="route-panel__action-btn"
            onClick={() => selectedRoute.route.id && handleReverse(selectedRoute.route.id)}
          >
            Reverse
          </button>
          <button
            className="route-panel__action-btn"
            onClick={() => setShareModalRoute(selectedRoute)}
            title="Share route or export GPX"
          >
            Share
          </button>
          <button
            className="route-panel__action-btn route-panel__action-btn--danger"
            onClick={() => selectedRoute.route.id && handleDelete(selectedRoute.route.id, selectedRoute.route.name)}
          >
            Delete
          </button>
        </div>
      )}
    </>
  );

  // Render edit view
  const renderEditView = () => (
    <>
      <div className="route-panel__form">
        <h3 className="route-panel__form-title">
          {editState.routeId ? 'Edit Route' : 'New Route'}
        </h3>

        {/* Name */}
        <div className="route-panel__field">
          <label className="route-panel__label">Name</label>
          <input
            type="text"
            className="route-panel__input"
            value={editState.formData?.name || ''}
            onChange={(e) => updateForm({ name: e.target.value })}
            placeholder="Route name"
          />
        </div>

        {/* Description */}
        <div className="route-panel__field">
          <label className="route-panel__label">Description</label>
          <textarea
            className="route-panel__textarea"
            value={editState.formData?.description || ''}
            onChange={(e) => updateForm({ description: e.target.value })}
            placeholder="Optional description"
            rows={2}
          />
        </div>

        {/* Color */}
        <div className="route-panel__field">
          <label className="route-panel__label">Color</label>
          <div className="route-panel__colors">
            {ROUTE_COLORS.map((color) => (
              <button
                key={color.id}
                className={`route-panel__color ${editState.formData?.color === color.id ? 'route-panel__color--selected' : ''}`}
                style={{ backgroundColor: color.id }}
                title={color.name}
                onClick={() => updateForm({ color: color.id })}
              />
            ))}
          </div>
        </div>

        {/* Speed */}
        <div className="route-panel__field">
          <label className="route-panel__label">Estimated Speed (kn)</label>
          <input
            type="number"
            className="route-panel__input route-panel__input--short"
            value={editState.formData?.estimated_speed_kn || '5.0'}
            onChange={(e) => updateForm({ estimated_speed_kn: e.target.value })}
            step="0.5"
            min="0.1"
          />
        </div>

        {/* Tags */}
        <div className="route-panel__field">
          <label className="route-panel__label">Tags</label>
          <div className="route-panel__tag-selector">
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={`route-panel__tag-chip ${editState.selectedTagIds.includes(tag.id!) ? 'route-panel__tag-chip--active' : ''}`}
                style={{ '--tag-color': tag.color || '#888' } as React.CSSProperties}
                onClick={() => tag.id && handleTagToggle(tag.id)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>

        {/* Waypoints */}
        <div className="route-panel__field">
          <label className="route-panel__label">
            Waypoints ({selectedWaypoints.length})
            {totalDistance > 0 && (
              <span className="route-panel__distance"> &bull; {totalDistance.toFixed(1)} nm</span>
            )}
          </label>

          {/* Selected waypoints list */}
          <div className="route-panel__waypoint-list">
            {selectedWaypoints.length === 0 ? (
              <div className="route-panel__waypoint-empty">
                No waypoints selected. Add waypoints below.
              </div>
            ) : (
              selectedWaypoints.map((wp, index) => (
                <div key={wp.id} className="route-panel__waypoint-item">
                  <span className="route-panel__waypoint-num">{index + 1}</span>
                  <span className="route-panel__waypoint-name">{wp.name}</span>
                  <div className="route-panel__waypoint-controls">
                    <button
                      className="route-panel__waypoint-btn"
                      onClick={() => handleMoveWaypointUp(index)}
                      disabled={index === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="route-panel__waypoint-btn"
                      onClick={() => handleMoveWaypointDown(index)}
                      disabled={index === selectedWaypoints.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="route-panel__waypoint-btn route-panel__waypoint-btn--remove"
                      onClick={() => wp.id && handleWaypointToggle(wp.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Available waypoints */}
          <div className="route-panel__waypoint-picker">
            <input
              type="text"
              className="route-panel__input"
              placeholder="Search waypoints..."
              value={wpSearchQuery}
              onChange={(e) => setWpSearchQuery(e.target.value)}
            />
            <div className="route-panel__waypoint-available">
              {availableWaypoints
                .filter(wp => !editState.selectedWaypointIds.includes(wp.id!))
                .map((wp) => (
                  <button
                    key={wp.id}
                    className="route-panel__waypoint-add"
                    onClick={() => wp.id && handleWaypointToggle(wp.id)}
                  >
                    <span>+ {wp.name}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Error */}
        {editState.error && (
          <div className="route-panel__error">{editState.error}</div>
        )}

        {/* Buttons */}
        <div className="route-panel__form-buttons">
          <button
            className="route-panel__btn"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="route-panel__btn route-panel__btn--primary"
            onClick={handleSave}
            disabled={isSaving || !editState.formData?.name.trim() || selectedWaypoints.length < 2}
          >
            {isSaving ? 'Saving...' : 'Save Route'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className={`route-panel route-panel--${theme}`}>
      {/* Header */}
      <div className="route-panel__header">
        <h2 className="route-panel__title">
          Routes
          <span className="route-panel__count">{state.routes.length}</span>
        </h2>
        <button className="route-panel__close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="route-panel__content">
        {viewMode === 'list' ? renderListView() : renderEditView()}
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteDialogState.isOpen && (
        <div className="route-panel__delete-dialog-overlay">
          <div className={`route-panel__delete-dialog route-panel__delete-dialog--${theme}`}>
            <h3 className="route-panel__delete-dialog-title">Delete Route</h3>
            <p className="route-panel__delete-dialog-text">
              Are you sure you want to delete "{deleteDialogState.routeName}"?
            </p>

            {deleteDialogState.exclusiveWaypointCount > 0 && (
              <p className="route-panel__delete-dialog-waypoint-info">
                This route has {deleteDialogState.exclusiveWaypointCount} waypoint{deleteDialogState.exclusiveWaypointCount !== 1 ? 's' : ''} not used by other routes.
                You can choose to delete them as well.
              </p>
            )}

            <div className="route-panel__delete-dialog-actions">
              <button
                className="route-panel__btn"
                onClick={handleCancelDelete}
              >
                Cancel
              </button>
              <button
                className="route-panel__btn route-panel__btn--danger"
                onClick={() => handleConfirmDelete(false)}
              >
                Delete Route Only
              </button>
              {deleteDialogState.exclusiveWaypointCount > 0 && (
                <button
                  className="route-panel__btn route-panel__btn--danger"
                  onClick={() => handleConfirmDelete(true)}
                >
                  Delete Route & Waypoints
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Route Modal */}
      {shareModalRoute && (
        <ShareRouteModal
          theme={theme}
          route={shareModalRoute}
          onClose={() => setShareModalRoute(null)}
        />
      )}
    </div>
  );
}
