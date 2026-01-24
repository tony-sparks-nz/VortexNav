import type { Vessel, ThemeMode } from '../types';
import type { GpsSourceStatus, Waypoint } from '../hooks/useTauri';
import { calculateDistance, calculateBearing, formatDistance, formatBearing } from '../hooks/useTauri';

interface StatusBarProps {
  vessel: Vessel;
  theme: ThemeMode;
  connected: boolean;
  gpsStatus?: GpsSourceStatus | null;
  cursorPosition?: { lat: number; lon: number } | null;
  activeWaypoint?: Waypoint | null;
  onThemeChange: (theme: ThemeMode) => void;
  onGpsStatusClick?: () => void;
}

function formatCoordinate(value: number | null, type: 'lat' | 'lon'): string {
  if (value === null) return '---.----°';

  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;

  const direction = type === 'lat'
    ? (value >= 0 ? 'N' : 'S')
    : (value >= 0 ? 'E' : 'W');

  return `${degrees}°${minutes.toFixed(3)}'${direction}`;
}

function formatSpeed(knots: number | null): string {
  if (knots === null) return '-.- kn';
  return `${knots.toFixed(1)} kn`;
}

function formatHeading(degrees: number | null): string {
  if (degrees === null) return '---°';
  return `${Math.round(degrees).toString().padStart(3, '0')}°`;
}

function getStatusLabel(status: GpsSourceStatus | null | undefined, connected: boolean): string {
  if (!status) {
    return connected ? 'Connected' : 'No GPS';
  }
  switch (status.status) {
    case 'receiving_data':
      return status.source_name || 'GPS Active';
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'error':
      return 'GPS Error';
    default:
      return 'No GPS';
  }
}

// Calculate signal strength (0-5 bars) based on GPS status and data reception
function getSignalStrength(status: GpsSourceStatus | null | undefined, connected: boolean): number {
  if (!status || !connected) return 0;

  switch (status.status) {
    case 'receiving_data': {
      // Use sentences received as a proxy for signal quality
      const sentences = status.sentences_received ?? 0;
      if (sentences >= 100) return 5;
      if (sentences >= 50) return 4;
      if (sentences >= 20) return 3;
      if (sentences >= 5) return 2;
      return 1; // At least 1 bar if receiving data
    }
    case 'connected':
      return 1;
    case 'connecting':
      return 0;
    case 'error':
      return 0;
    default:
      return 0;
  }
}

// Signal strength bars component
function SignalBars({ strength, maxBars = 5 }: { strength: number; maxBars?: number }) {
  return (
    <div className="signal-bars" aria-label={`Signal strength: ${strength} of ${maxBars}`}>
      {Array.from({ length: maxBars }, (_, i) => (
        <div
          key={i}
          className={`signal-bar ${i < strength ? 'signal-bar--active' : ''}`}
          style={{ height: `${((i + 1) / maxBars) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function StatusBar({
  vessel,
  theme,
  connected,
  gpsStatus,
  cursorPosition,
  activeWaypoint,
  onThemeChange,
  onGpsStatusClick,
}: StatusBarProps) {
  const themeOptions: ThemeMode[] = ['day', 'dusk', 'night'];

  // Calculate distance and bearing to active waypoint
  const navToWaypoint = activeWaypoint && vessel.position
    ? {
        distance: formatDistance(
          calculateDistance(
            vessel.position.lat,
            vessel.position.lon,
            activeWaypoint.lat,
            activeWaypoint.lon
          )
        ),
        bearing: formatBearing(
          calculateBearing(
            vessel.position.lat,
            vessel.position.lon,
            activeWaypoint.lat,
            activeWaypoint.lon
          )
        ),
      }
    : null;

  // Calculate distance from vessel to cursor
  const cursorDistance = cursorPosition && vessel.position
    ? formatDistance(
        calculateDistance(
          vessel.position.lat,
          vessel.position.lon,
          cursorPosition.lat,
          cursorPosition.lon
        )
      )
    : null;

  return (
    <div className={`status-bar status-bar--${theme}`}>
      <div className="status-bar__section status-bar__position">
        <div className="status-bar__label">Position</div>
        <div className="status-bar__value">
          {formatCoordinate(vessel.position?.lat ?? null, 'lat')}
          {' '}
          {formatCoordinate(vessel.position?.lon ?? null, 'lon')}
        </div>
      </div>

      <div className="status-bar__section status-bar__cursor">
        <div className="status-bar__label">Cursor</div>
        <div className="status-bar__value">
          {cursorPosition ? (
            <>
              {formatCoordinate(cursorPosition.lat, 'lat')}
              {' '}
              {formatCoordinate(cursorPosition.lon, 'lon')}
            </>
          ) : (
            '---.----° ---.----°'
          )}
        </div>
        {cursorDistance && (
          <div className="status-bar__cursor-distance">
            {cursorDistance}
          </div>
        )}
      </div>

      <div className="status-bar__section status-bar__navigation">
        <div className="status-bar__item">
          <span className="status-bar__label">COG</span>
          <span className="status-bar__value">{formatHeading(vessel.cog)}</span>
        </div>
        <div className="status-bar__item">
          <span className="status-bar__label">SOG</span>
          <span className="status-bar__value">{formatSpeed(vessel.sog)}</span>
        </div>
        <div className="status-bar__item">
          <span className="status-bar__label">HDG</span>
          <span className="status-bar__value">{formatHeading(vessel.heading)}</span>
        </div>
      </div>

      {/* Active Waypoint Navigation Display */}
      {activeWaypoint && (
        <div className="status-bar__section status-bar__waypoint">
          <div className="status-bar__waypoint-display">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="status-bar__waypoint-info">
              <span className="status-bar__waypoint-name">{activeWaypoint.name}</span>
              {navToWaypoint && (
                <span className="status-bar__waypoint-nav">
                  {navToWaypoint.distance} / {navToWaypoint.bearing}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <div className="status-bar__section status-bar__controls">
        <button
          className="status-bar__gps-btn status-bar__gps-btn--icon"
          onClick={onGpsStatusClick}
          title={getStatusLabel(gpsStatus, connected)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
          <SignalBars strength={getSignalStrength(gpsStatus, connected)} />
        </button>

        <div className="theme-switcher">
          {themeOptions.map((t) => (
            <button
              key={t}
              className={`theme-btn ${theme === t ? 'active' : ''}`}
              onClick={() => onThemeChange(t)}
              title={`${t.charAt(0).toUpperCase() + t.slice(1)} mode`}
            >
              {t === 'day' ? '☀' : t === 'dusk' ? '🌅' : '🌙'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
