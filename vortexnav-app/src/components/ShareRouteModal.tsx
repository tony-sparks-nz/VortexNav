import { useState, useCallback } from 'react';
import type { ThemeMode, RouteWithWaypoints } from '../types';
import { getRouteGpxString, getRouteSummaryText, exportRouteGpx } from '../hooks/useTauri';

interface ShareRouteModalProps {
  theme: ThemeMode;
  route: RouteWithWaypoints;
  onClose: () => void;
}

type ShareStatus = 'idle' | 'loading' | 'success' | 'error';

export function ShareRouteModal({ theme, route, onClose }: ShareRouteModalProps) {
  const [status, setStatus] = useState<ShareStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const showStatus = useCallback((message: string, isSuccess: boolean) => {
    setStatus(isSuccess ? 'success' : 'error');
    setStatusMessage(message);
    setTimeout(() => {
      setStatus('idle');
      setStatusMessage('');
    }, 3000);
  }, []);

  // Copy route summary text to clipboard
  const handleCopySummary = useCallback(async () => {
    if (!route.route.id) return;

    setStatus('loading');
    try {
      const summary = await getRouteSummaryText(route.route.id);
      await navigator.clipboard.writeText(summary);
      showStatus('Route summary copied to clipboard!', true);
    } catch (error) {
      console.error('Failed to copy summary:', error);
      showStatus('Failed to copy summary', false);
    }
  }, [route.route.id, showStatus]);

  // Copy GPX XML to clipboard
  const handleCopyGpx = useCallback(async () => {
    if (!route.route.id) return;

    setStatus('loading');
    try {
      const gpx = await getRouteGpxString(route.route.id);
      await navigator.clipboard.writeText(gpx);
      showStatus('GPX copied to clipboard!', true);
    } catch (error) {
      console.error('Failed to copy GPX:', error);
      showStatus('Failed to copy GPX', false);
    }
  }, [route.route.id, showStatus]);

  // Download GPX file
  const handleDownloadGpx = useCallback(async () => {
    if (!route.route.id) return;

    setStatus('loading');
    try {
      // Use Tauri's save dialog
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: `${route.route.name.replace(/[^a-zA-Z0-9]/g, '_')}.gpx`,
        filters: [{ name: 'GPX Files', extensions: ['gpx'] }],
      });

      if (filePath) {
        await exportRouteGpx(route.route.id, filePath);
        showStatus('GPX file saved!', true);
      } else {
        setStatus('idle');
      }
    } catch (error) {
      console.error('Failed to download GPX:', error);
      showStatus('Failed to save GPX file', false);
    }
  }, [route.route.id, route.route.name, showStatus]);

  // Copy waypoint list as formatted text
  const handleCopyWaypoints = useCallback(async () => {
    const waypointText = route.waypoints.map((wp, idx) => {
      const lat = wp.lat.toFixed(6);
      const lon = wp.lon.toFixed(6);
      return `${idx + 1}. ${wp.name}\n   ${lat}, ${lon}`;
    }).join('\n\n');

    const text = `Route: ${route.route.name}\nWaypoints:\n\n${waypointText}`;

    try {
      await navigator.clipboard.writeText(text);
      showStatus('Waypoint list copied!', true);
    } catch (error) {
      console.error('Failed to copy waypoints:', error);
      showStatus('Failed to copy waypoints', false);
    }
  }, [route, showStatus]);

  // Copy coordinates in various formats
  const handleCopyCoordinates = useCallback(async (format: 'decimal' | 'dms' | 'dmm') => {
    const formatCoord = (lat: number, lon: number) => {
      if (format === 'decimal') {
        return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      } else if (format === 'dms') {
        // Degrees Minutes Seconds
        const toDMS = (coord: number, isLat: boolean) => {
          const dir = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
          const abs = Math.abs(coord);
          const deg = Math.floor(abs);
          const minFloat = (abs - deg) * 60;
          const min = Math.floor(minFloat);
          const sec = ((minFloat - min) * 60).toFixed(1);
          return `${deg}°${min}'${sec}"${dir}`;
        };
        return `${toDMS(lat, true)} ${toDMS(lon, false)}`;
      } else {
        // Degrees Decimal Minutes
        const toDMM = (coord: number, isLat: boolean) => {
          const dir = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
          const abs = Math.abs(coord);
          const deg = Math.floor(abs);
          const min = ((abs - deg) * 60).toFixed(4);
          return `${deg}°${min}'${dir}`;
        };
        return `${toDMM(lat, true)} ${toDMM(lon, false)}`;
      }
    };

    const coords = route.waypoints.map((wp, idx) =>
      `${idx + 1}. ${wp.name}: ${formatCoord(wp.lat, wp.lon)}`
    ).join('\n');

    const formatNames = { decimal: 'Decimal Degrees', dms: 'DMS', dmm: 'DMM' };
    const text = `Route: ${route.route.name}\nFormat: ${formatNames[format]}\n\n${coords}`;

    try {
      await navigator.clipboard.writeText(text);
      showStatus(`Coordinates (${formatNames[format]}) copied!`, true);
    } catch (error) {
      console.error('Failed to copy coordinates:', error);
      showStatus('Failed to copy coordinates', false);
    }
  }, [route, showStatus]);

  // Use system share if available
  const handleSystemShare = useCallback(async () => {
    if (!route.route.id) return;

    try {
      const summary = await getRouteSummaryText(route.route.id);

      if (navigator.share) {
        await navigator.share({
          title: route.route.name,
          text: summary,
        });
        showStatus('Shared successfully!', true);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(summary);
        showStatus('Share not available - copied to clipboard', true);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to share:', error);
        showStatus('Failed to share', false);
      }
    }
  }, [route, showStatus]);

  // Generate mailto link
  const handleEmailShare = useCallback(async () => {
    if (!route.route.id) return;

    try {
      const summary = await getRouteSummaryText(route.route.id);
      const subject = encodeURIComponent(`Route: ${route.route.name}`);
      const body = encodeURIComponent(summary);
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    } catch (error) {
      console.error('Failed to create email:', error);
      showStatus('Failed to create email', false);
    }
  }, [route, showStatus]);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className={`share-modal share-modal--${theme}`}>
        <div className="share-modal__header">
          <h3 className="share-modal__title">Share Route</h3>
          <span className="share-modal__route-name">{route.route.name}</span>
          <button className="share-modal__close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Status message */}
        {status !== 'idle' && (
          <div className={`share-modal__status share-modal__status--${status}`}>
            {status === 'loading' && (
              <svg className="share-modal__spinner" width="16" height="16" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
            )}
            {status === 'success' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {status === 'error' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        <div className="share-modal__content">
          {/* Text Sharing Section */}
          <div className="share-modal__section">
            <h4 className="share-modal__section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Text & Summary
            </h4>
            <div className="share-modal__buttons">
              <button className="share-modal__btn" onClick={handleCopySummary}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy Summary</span>
                <small>Full route details as text</small>
              </button>
              <button className="share-modal__btn" onClick={handleCopyWaypoints}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                <span>Copy Waypoint List</span>
                <small>Names and coordinates</small>
              </button>
            </div>
          </div>

          {/* Coordinate Formats Section */}
          <div className="share-modal__section">
            <h4 className="share-modal__section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Coordinate Formats
            </h4>
            <div className="share-modal__buttons share-modal__buttons--row">
              <button className="share-modal__btn share-modal__btn--compact" onClick={() => handleCopyCoordinates('decimal')}>
                <span>DD</span>
                <small>-36.849461</small>
              </button>
              <button className="share-modal__btn share-modal__btn--compact" onClick={() => handleCopyCoordinates('dmm')}>
                <span>DMM</span>
                <small>36°50.97'S</small>
              </button>
              <button className="share-modal__btn share-modal__btn--compact" onClick={() => handleCopyCoordinates('dms')}>
                <span>DMS</span>
                <small>36°50'58"S</small>
              </button>
            </div>
          </div>

          {/* GPX Section */}
          <div className="share-modal__section">
            <h4 className="share-modal__section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M12 18v-6" />
                <path d="M9 15l3 3 3-3" />
              </svg>
              GPX File
            </h4>
            <div className="share-modal__buttons">
              <button className="share-modal__btn" onClick={handleCopyGpx}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy GPX to Clipboard</span>
                <small>Paste into messages or files</small>
              </button>
              <button className="share-modal__btn" onClick={handleDownloadGpx}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Save GPX File</span>
                <small>Download to your device</small>
              </button>
            </div>
          </div>

          {/* Quick Share Section */}
          <div className="share-modal__section">
            <h4 className="share-modal__section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Quick Share
            </h4>
            <div className="share-modal__buttons share-modal__buttons--row">
              <button className="share-modal__btn share-modal__btn--icon" onClick={handleEmailShare} title="Share via Email">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </button>
              <button className="share-modal__btn share-modal__btn--icon" onClick={handleSystemShare} title="System Share">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="share-modal__footer">
          <span className="share-modal__hint">
            Tip: GPX files work with most navigation apps and chart plotters
          </span>
        </div>
      </div>
    </>
  );
}
