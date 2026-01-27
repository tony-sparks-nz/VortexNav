import { useMemo } from 'react';
import type { ThemeMode, TempWaypoint } from '../types';

interface RouteCreationOverlayProps {
  theme: ThemeMode;
  routeName: string;
  tempWaypoints: TempWaypoint[];
  onNameChange: (name: string) => void;
  onUndo: () => void;
  onCancel: () => void;
  onFinish: () => void;
}

export function RouteCreationOverlay({
  theme,
  routeName,
  tempWaypoints,
  onNameChange,
  onUndo,
  onCancel,
  onFinish,
}: RouteCreationOverlayProps) {
  // Calculate total distance
  const totalDistance = useMemo(() => {
    let total = 0;
    for (let i = 0; i < tempWaypoints.length - 1; i++) {
      const from = tempWaypoints[i];
      const to = tempWaypoints[i + 1];
      const R = 3440.065; // Earth radius in nm
      const dLat = (to.lat - from.lat) * Math.PI / 180;
      const dLon = (to.lon - from.lon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return total;
  }, [tempWaypoints]);

  const canFinish = tempWaypoints.length >= 2;

  return (
    <div className={`route-creation-overlay route-creation-overlay--${theme}`}>
      {/* Route name input */}
      <div className="route-creation-overlay__name">
        <input
          type="text"
          className="route-creation-overlay__name-input"
          value={routeName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Route name..."
        />
      </div>

      {/* Stats */}
      <div className="route-creation-overlay__stats">
        <div className="route-creation-overlay__stat">
          <span className="route-creation-overlay__stat-value">{tempWaypoints.length}</span>
          <span className="route-creation-overlay__stat-label">Waypoints</span>
        </div>
        <div className="route-creation-overlay__stat">
          <span className="route-creation-overlay__stat-value">
            {totalDistance > 0 ? totalDistance.toFixed(1) : '0.0'}
          </span>
          <span className="route-creation-overlay__stat-label">nm</span>
        </div>
      </div>

      {/* Instructions */}
      <div className="route-creation-overlay__hint">
        Click on the map to add waypoints
      </div>

      {/* Actions */}
      <div className="route-creation-overlay__actions">
        <button
          className="route-creation-overlay__btn route-creation-overlay__btn--secondary"
          onClick={onUndo}
          disabled={tempWaypoints.length === 0}
          title="Remove last waypoint"
        >
          Undo
        </button>
        <button
          className="route-creation-overlay__btn route-creation-overlay__btn--secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="route-creation-overlay__btn route-creation-overlay__btn--primary"
          onClick={onFinish}
          disabled={!canFinish}
          title={canFinish ? 'Save route' : 'Add at least 2 waypoints'}
        >
          Finish
        </button>
      </div>
    </div>
  );
}
