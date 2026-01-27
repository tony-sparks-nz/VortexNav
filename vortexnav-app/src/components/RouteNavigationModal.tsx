import { useMemo } from 'react';
import type { ThemeMode, Vessel, RouteWithWaypoints } from '../types';
import {
  calculateDistance,
  calculateBearing,
  calculateVMG,
  calculateETA,
  formatDistance,
  formatBearing,
  formatVMG,
  formatETA,
  formatTTG,
} from '../hooks/useTauri';

interface RouteNavigationModalProps {
  theme: ThemeMode;
  vessel: Vessel;
  activeRoute: RouteWithWaypoints;
  currentWaypointIndex: number;
  onNextWaypoint: () => void;
  onPreviousWaypoint: () => void;
  onCancel: () => void;
}

export function RouteNavigationModal({
  theme,
  vessel,
  activeRoute,
  currentWaypointIndex,
  onNextWaypoint,
  onPreviousWaypoint,
  onCancel,
}: RouteNavigationModalProps) {
  const waypoints = activeRoute.waypoints;
  const currentWaypoint = waypoints[currentWaypointIndex];
  const totalWaypoints = waypoints.length;

  // Navigation data calculations
  const hasPosition = vessel.position !== null;
  const hasSog = vessel.sog !== null && vessel.sog > 0;
  const hasCog = vessel.cog !== null;

  // Bearing and distance to current waypoint
  const bearing = useMemo(() => {
    if (!hasPosition || !currentWaypoint) return null;
    return calculateBearing(
      vessel.position!.lat,
      vessel.position!.lon,
      currentWaypoint.lat,
      currentWaypoint.lon
    );
  }, [hasPosition, vessel.position, currentWaypoint]);

  const distanceToNext = useMemo(() => {
    if (!hasPosition || !currentWaypoint) return null;
    return calculateDistance(
      vessel.position!.lat,
      vessel.position!.lon,
      currentWaypoint.lat,
      currentWaypoint.lon
    );
  }, [hasPosition, vessel.position, currentWaypoint]);

  // VMG and TTG to current waypoint
  const vmg = useMemo(() => {
    if (!hasSog || !hasCog || bearing === null) return null;
    return calculateVMG(vessel.sog!, vessel.cog!, bearing);
  }, [hasSog, hasCog, vessel.sog, vessel.cog, bearing]);

  const etaToNext = useMemo(() => {
    if (distanceToNext === null || vmg === null) return null;
    return calculateETA(distanceToNext, vmg);
  }, [distanceToNext, vmg]);

  // Calculate remaining route distance (from current waypoint to end)
  const remainingRouteDistance = useMemo(() => {
    if (!hasPosition || currentWaypointIndex >= waypoints.length) return null;

    let total = distanceToNext || 0;

    // Add distances between remaining waypoints
    for (let i = currentWaypointIndex; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];
      total += calculateDistance(from.lat, from.lon, to.lat, to.lon);
    }

    return total;
  }, [hasPosition, distanceToNext, waypoints, currentWaypointIndex]);

  // Estimate remaining time based on current VMG or SOG
  const remainingTime = useMemo(() => {
    if (remainingRouteDistance === null) return null;

    // Use VMG if positive, otherwise use SOG as fallback
    const speed = vmg !== null && vmg > 0 ? vmg : (vessel.sog || 0);
    if (speed <= 0) return null;

    return remainingRouteDistance / speed; // hours
  }, [remainingRouteDistance, vmg, vessel.sog]);

  // Format remaining time as hours and minutes
  const formatRemainingTime = (hours: number | null): string => {
    if (hours === null || hours <= 0) return '--:--';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  };

  const waypointsRemaining = totalWaypoints - currentWaypointIndex;
  const isFirstWaypoint = currentWaypointIndex === 0;
  const isLastWaypoint = currentWaypointIndex >= totalWaypoints - 1;

  return (
    <div className={`route-nav-modal route-nav-modal--${theme}`}>
      {/* Left section: Route info and waypoint nav */}
      <div className="route-nav-modal__left">
        <div className="route-nav-modal__route-info">
          <svg
            className="route-nav-modal__route-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span className="route-nav-modal__route-name">{activeRoute.route.name}</span>
        </div>

        <div className="route-nav-modal__waypoint-nav">
          <button
            className="route-nav-modal__nav-btn"
            onClick={onPreviousWaypoint}
            disabled={isFirstWaypoint}
            title="Previous waypoint"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="route-nav-modal__waypoint-counter">
            {currentWaypointIndex + 1}/{totalWaypoints}
          </span>
          <button
            className="route-nav-modal__nav-btn"
            onClick={onNextWaypoint}
            disabled={isLastWaypoint}
            title="Next waypoint"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="route-nav-modal__divider" />

        <div className="route-nav-modal__current-wp">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span className="route-nav-modal__wp-name">
            {currentWaypoint?.name || 'Unknown'}
          </span>
        </div>
      </div>

      {/* Center section: Navigation data */}
      <div className="route-nav-modal__data">
        <div className="route-nav-modal__item route-nav-modal__item--bearing">
          <span className="route-nav-modal__label">BRG</span>
          <span className="route-nav-modal__value">
            {bearing !== null ? `${formatBearing(bearing)}T` : '---°'}
          </span>
        </div>

        <div className="route-nav-modal__item">
          <span className="route-nav-modal__label">DTG</span>
          <span className="route-nav-modal__value">
            {distanceToNext !== null ? formatDistance(distanceToNext) : '--'}
          </span>
        </div>

        <div className="route-nav-modal__item">
          <span className="route-nav-modal__label">VMG</span>
          <span className={`route-nav-modal__value ${vmg !== null && vmg < 0 ? 'route-nav-modal__value--warning' : ''}`}>
            {vmg !== null ? formatVMG(vmg) : '--'}
          </span>
        </div>

        <div className="route-nav-modal__item">
          <span className="route-nav-modal__label">ETA</span>
          <span className="route-nav-modal__value">{formatETA(etaToNext)}</span>
        </div>

        <div className="route-nav-modal__item">
          <span className="route-nav-modal__label">TTG</span>
          <span className="route-nav-modal__value">
            {distanceToNext !== null && vmg !== null
              ? formatTTG(distanceToNext, vmg)
              : '--:--'}
          </span>
        </div>
      </div>

      {/* Right section: Route summary */}
      <div className="route-nav-modal__summary">
        <div className="route-nav-modal__summary-item">
          <span className="route-nav-modal__summary-label">REM</span>
          <span className="route-nav-modal__summary-value">
            {remainingRouteDistance !== null
              ? `${remainingRouteDistance.toFixed(1)}nm`
              : '--'}
          </span>
        </div>
        <div className="route-nav-modal__summary-item">
          <span className="route-nav-modal__summary-label">TIME</span>
          <span className="route-nav-modal__summary-value">
            {formatRemainingTime(remainingTime)}
          </span>
        </div>
        <div className="route-nav-modal__summary-item">
          <span className="route-nav-modal__summary-label">WPT</span>
          <span className="route-nav-modal__summary-value">
            {waypointsRemaining}
          </span>
        </div>
      </div>

      {/* Close button */}
      <button
        className="route-nav-modal__cancel"
        onClick={onCancel}
        title="Stop navigation"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
