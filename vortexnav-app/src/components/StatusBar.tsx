import type { Vessel, ThemeMode } from '../types';
import type { GpsSourceStatus } from '../hooks/useTauri';

interface StatusBarProps {
  vessel: Vessel;
  theme: ThemeMode;
  connected: boolean;
  gpsStatus?: GpsSourceStatus | null;
  onThemeChange: (theme: ThemeMode) => void;
  onGpsSettingsClick?: () => void;
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

export function StatusBar({
  vessel,
  theme,
  connected,
  gpsStatus,
  onThemeChange,
  onGpsSettingsClick,
}: StatusBarProps) {
  const themeOptions: ThemeMode[] = ['day', 'dusk', 'night'];

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

      <div className="status-bar__section status-bar__controls">
        <button
          className="status-bar__gps-btn"
          onClick={onGpsSettingsClick}
          title="GPS Settings"
        >
          <span className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`} />
          <span className="status-bar__label">{getStatusLabel(gpsStatus, connected)}</span>
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
