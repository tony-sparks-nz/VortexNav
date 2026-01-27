import type { ThemeMode, Vessel } from '../types';
import type { Waypoint } from '../hooks/useTauri';
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

interface NavigationModalProps {
  theme: ThemeMode;
  vessel: Vessel;
  activeWaypoint: Waypoint;
  onCancel: () => void;
}

export function NavigationModal({
  theme,
  vessel,
  activeWaypoint,
  onCancel,
}: NavigationModalProps) {
  // Calculate navigation data
  const hasPosition = vessel.position !== null;
  const hasSog = vessel.sog !== null && vessel.sog > 0;
  const hasCog = vessel.cog !== null;

  // Bearing and distance
  const bearing = hasPosition
    ? calculateBearing(
        vessel.position!.lat,
        vessel.position!.lon,
        activeWaypoint.lat,
        activeWaypoint.lon
      )
    : null;

  const distance = hasPosition
    ? calculateDistance(
        vessel.position!.lat,
        vessel.position!.lon,
        activeWaypoint.lat,
        activeWaypoint.lon
      )
    : null;

  // VMG and ETA (only if we have SOG and COG)
  const vmg =
    hasSog && hasCog && bearing !== null
      ? calculateVMG(vessel.sog!, vessel.cog!, bearing)
      : null;

  const eta =
    distance !== null && vmg !== null ? calculateETA(distance, vmg) : null;

  return (
    <div className={`navigation-modal navigation-modal--${theme}`}>
      <div className="navigation-modal__header">
        <div className="navigation-modal__waypoint-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </div>
        <div className="navigation-modal__waypoint-name">
          {activeWaypoint.name}
        </div>
        <button
          className="navigation-modal__cancel"
          onClick={onCancel}
          title="Cancel navigation"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="navigation-modal__data">
        <div className="navigation-modal__item navigation-modal__item--bearing">
          <span className="navigation-modal__label">BRG</span>
          <span className="navigation-modal__value">
            {bearing !== null ? `${formatBearing(bearing)}T` : '---°'}
          </span>
        </div>

        <div className="navigation-modal__item navigation-modal__item--distance">
          <span className="navigation-modal__label">DTG</span>
          <span className="navigation-modal__value">
            {distance !== null ? formatDistance(distance) : '-- nm'}
          </span>
        </div>

        <div className="navigation-modal__item navigation-modal__item--vmg">
          <span className="navigation-modal__label">VMG</span>
          <span
            className={`navigation-modal__value ${vmg !== null && vmg < 0 ? 'navigation-modal__value--warning' : ''}`}
          >
            {vmg !== null ? formatVMG(vmg) : '-- kn'}
          </span>
        </div>

        <div className="navigation-modal__item navigation-modal__item--eta">
          <span className="navigation-modal__label">ETA</span>
          <span className="navigation-modal__value">{formatETA(eta)}</span>
        </div>

        <div className="navigation-modal__item navigation-modal__item--ttg">
          <span className="navigation-modal__label">TTG</span>
          <span className="navigation-modal__value">
            {distance !== null && vmg !== null
              ? formatTTG(distance, vmg)
              : '-- h -- m'}
          </span>
        </div>
      </div>
    </div>
  );
}
