import { useMemo } from 'react';
import type { Vessel, ThemeMode } from '../types';
import type { GpsSourceStatus, Waypoint } from '../hooks/useTauri';
import { calculateDistance, calculateBearing, formatDistance, formatBearing } from '../hooks/useTauri';
import { DeviceStatusIndicator } from './DeviceStatusIndicator';

interface LaStatus {
  isConnected: boolean;
  isRegistered: boolean;
  packsCount?: number;
}

interface StatusBarProps {
  vessel: Vessel;
  theme: ThemeMode;
  connected: boolean;
  gpsStatus?: GpsSourceStatus | null;
  cursorPosition?: { lat: number; lon: number } | null;
  activeWaypoint?: Waypoint | null;
  currentZoom?: number;
  entitlementMaxZoom?: number | null;
  laStatus?: LaStatus;
  onThemeChange: (theme: ThemeMode) => void;
  onGpsStatusClick?: () => void;
  onLaStatusClick?: () => void;
  onPacksClick?: () => void;
}

// Compact coordinate format: 36°40.942'S
function formatCoord(value: number | null, type: 'lat' | 'lon'): string {
  if (value === null) return '---°--.-\'';
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const dir = type === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  return `${degrees}°${minutes.toFixed(3)}'${dir}`;
}

function formatSpeed(knots: number | null): string {
  if (knots === null) return '--.-';
  return knots.toFixed(1);
}

function formatHeading(degrees: number | null): string {
  if (degrees === null) return '---';
  return Math.round(degrees).toString().padStart(3, '0');
}

// Get next tier name for marketing
function getNextTier(currentMaxZoom: number): string {
  if (currentMaxZoom <= 14) return 'Pro';
  if (currentMaxZoom <= 18) return 'Enterprise';
  return '';
}

// Signal strength calculation
function getSignalStrength(status: GpsSourceStatus | null | undefined, connected: boolean): number {
  if (!status || !connected) return 0;
  switch (status.status) {
    case 'receiving_data': {
      const sentences = status.sentences_received ?? 0;
      if (sentences >= 100) return 5;
      if (sentences >= 50) return 4;
      if (sentences >= 20) return 3;
      if (sentences >= 5) return 2;
      return 1;
    }
    case 'connected': return 1;
    default: return 0;
  }
}

// Compact signal bars
function SignalBars({ strength }: { strength: number }) {
  return (
    <div className="signal-bars" aria-label={`Signal: ${strength}/5`}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className={`signal-bar ${i < strength ? 'signal-bar--active' : ''}`}
             style={{ height: `${(i + 1) * 20}%` }} />
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
  currentZoom,
  entitlementMaxZoom,
  laStatus: _laStatus,
  onThemeChange,
  onGpsStatusClick,
  onLaStatusClick: _onLaStatusClick,
  onPacksClick: _onPacksClick,
}: StatusBarProps) {
  const themeIcons = { day: '☀', dusk: '🌅', night: '🌙' };

  // Navigation to active waypoint
  const navInfo = useMemo(() => {
    if (!activeWaypoint || !vessel.position) return null;
    return {
      dist: formatDistance(calculateDistance(
        vessel.position.lat, vessel.position.lon,
        activeWaypoint.lat, activeWaypoint.lon
      )),
      brg: formatBearing(calculateBearing(
        vessel.position.lat, vessel.position.lon,
        activeWaypoint.lat, activeWaypoint.lon
      )),
    };
  }, [activeWaypoint, vessel.position]);

  // Cursor distance from vessel
  const cursorDist = useMemo(() => {
    if (!cursorPosition || !vessel.position) return null;
    return formatDistance(calculateDistance(
      vessel.position.lat, vessel.position.lon,
      cursorPosition.lat, cursorPosition.lon
    ));
  }, [cursorPosition, vessel.position]);

  // Check if at max zoom
  const atMaxZoom = currentZoom !== undefined && entitlementMaxZoom !== null &&
    entitlementMaxZoom !== undefined && currentZoom >= entitlementMaxZoom - 0.1;
  const nextTier = entitlementMaxZoom ? getNextTier(entitlementMaxZoom) : '';

  return (
    <div className={`status-bar status-bar--${theme}`}>
      {/* Left: Position */}
      <div className="sb-group sb-position">
        <span className="sb-label">POSITION</span>
        <span className="sb-coords">
          {formatCoord(vessel.position?.lat ?? null, 'lat')} {formatCoord(vessel.position?.lon ?? null, 'lon')}
        </span>
      </div>

      {/* Divider */}
      <div className="sb-divider" />

      {/* Cursor with distance */}
      <div className="sb-group sb-cursor">
        <span className="sb-label">CURSOR</span>
        <span className="sb-coords">
          {cursorPosition
            ? `${formatCoord(cursorPosition.lat, 'lat')} ${formatCoord(cursorPosition.lon, 'lon')}`
            : '---°--.-\' ---°--.-\''
          }
        </span>
        {cursorDist && <span className="sb-distance">{cursorDist}</span>}
      </div>

      {/* Divider */}
      <div className="sb-divider" />

      {/* Navigation data row */}
      <div className="sb-group sb-nav">
        <div className="sb-nav-item">
          <span className="sb-nav-label">COG</span>
          <span className="sb-nav-value">{formatHeading(vessel.cog)}°</span>
        </div>
        <div className="sb-nav-item">
          <span className="sb-nav-label">SOG</span>
          <span className="sb-nav-value">{formatSpeed(vessel.sog)} kn</span>
        </div>
        <div className="sb-nav-item">
          <span className="sb-nav-label">HDG</span>
          <span className="sb-nav-value">{formatHeading(vessel.heading)}°</span>
        </div>
      </div>

      {/* Active waypoint (if navigating) */}
      {activeWaypoint && navInfo && (
        <>
          <div className="sb-divider" />
          <div className="sb-group sb-waypoint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="sb-wp-name">{activeWaypoint.name}</span>
            <span className="sb-wp-nav">{navInfo.dist} / {navInfo.brg}</span>
          </div>
        </>
      )}

      {/* Spacer to push right side */}
      <div className="sb-spacer" />

      {/* Zoom with upgrade hint */}
      <div className={`sb-group sb-zoom ${atMaxZoom ? 'sb-zoom--max' : ''}`}>
        <span className="sb-zoom-label">ZOOM</span>
        <span className="sb-zoom-value">{currentZoom?.toFixed(1) ?? '--'}</span>
        {atMaxZoom && nextTier && (
          <span className="sb-zoom-hint" title={`Upgrade to ${nextTier} for higher zoom`}>
            {nextTier} unlocks more
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="sb-divider" />

      {/* Right: Controls */}
      <div className="sb-group sb-controls">
        <DeviceStatusIndicator theme={theme} />

        <button className="sb-btn" onClick={onGpsStatusClick} title="GPS Status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
          <SignalBars strength={getSignalStrength(gpsStatus, connected)} />
        </button>

        <div className="sb-theme">
          {(['day', 'dusk', 'night'] as ThemeMode[]).map(t => (
            <button
              key={t}
              className={`sb-theme-btn ${theme === t ? 'active' : ''}`}
              onClick={() => onThemeChange(t)}
              title={`${t.charAt(0).toUpperCase() + t.slice(1)} mode`}
            >
              {themeIcons[t]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
