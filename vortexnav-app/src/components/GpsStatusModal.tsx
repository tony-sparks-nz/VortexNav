import { useState, useEffect, useRef, useCallback } from 'react';
import type { ThemeMode } from '../types';
import {
  getGpsData,
  getGpsStatus,
  getNmeaBuffer,
  clearNmeaBuffer,
  isTauri,
  type GpsData,
  type GpsSourceStatus,
  type SatelliteInfo,
} from '../hooks/useTauri';

interface GpsStatusModalProps {
  theme: ThemeMode;
  onClose: () => void;
}

export function GpsStatusModal({ theme, onClose }: GpsStatusModalProps) {
  const [gpsData, setGpsData] = useState<GpsData | null>(null);
  const [status, setStatus] = useState<GpsSourceStatus | null>(null);
  const [nmeaBuffer, setNmeaBuffer] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const trafficRef = useRef<HTMLDivElement>(null);

  // Poll GPS data and NMEA buffer
  useEffect(() => {
    if (!isTauri()) return;

    const pollData = async () => {
      if (paused) return;

      try {
        const [data, statusData, buffer] = await Promise.all([
          getGpsData(),
          getGpsStatus(),
          getNmeaBuffer(),
        ]);
        setGpsData(data);
        setStatus(statusData);
        setNmeaBuffer(buffer);
      } catch (error) {
        console.debug('GPS poll error:', error);
      }
    };

    pollData();
    const interval = setInterval(pollData, 500);
    return () => clearInterval(interval);
  }, [paused]);

  // Auto-scroll NMEA traffic
  useEffect(() => {
    if (autoScroll && trafficRef.current) {
      trafficRef.current.scrollTop = trafficRef.current.scrollHeight;
    }
  }, [nmeaBuffer, autoScroll]);

  const handleClearBuffer = useCallback(async () => {
    try {
      await clearNmeaBuffer();
      setNmeaBuffer([]);
    } catch (error) {
      console.error('Failed to clear buffer:', error);
    }
  }, []);

  // Get signal strength color
  const getSnrColor = (snr: number | null): string => {
    if (snr === null) return 'var(--text-secondary)';
    if (snr >= 40) return 'var(--success)';
    if (snr >= 30) return 'var(--accent)';
    if (snr >= 20) return 'var(--warning)';
    return 'var(--danger)';
  };

  // Get fix quality text
  const getFixQualityText = (quality: number | null): string => {
    if (quality === null) return 'Unknown';
    switch (quality) {
      case 0: return 'No Fix';
      case 1: return 'GPS Fix';
      case 2: return 'DGPS Fix';
      case 3: return 'PPS Fix';
      case 4: return 'RTK Fixed';
      case 5: return 'RTK Float';
      case 6: return 'Estimated';
      case 7: return 'Manual';
      case 8: return 'Simulation';
      default: return `Unknown (${quality})`;
    }
  };

  // Group satellites by constellation
  const groupedSatellites = (gpsData?.satellites_info || []).reduce<Record<string, SatelliteInfo[]>>(
    (acc, sat) => {
      const key = sat.constellation || 'Unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(sat);
      return acc;
    },
    {}
  );

  if (!isTauri()) {
    return (
      <div className={`gps-status-modal gps-status-modal--${theme}`}>
        <div className="gps-status-modal__header">
          <h2>GPS Status</h2>
          <button className="gps-status-modal__close" onClick={onClose}>x</button>
        </div>
        <div className="gps-status-modal__content">
          <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            GPS status is only available in the desktop application.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`gps-status-modal gps-status-modal--${theme}`}>
      <div className="gps-status-modal__header">
        <h2>GPS Status</h2>
        <button className="gps-status-modal__close" onClick={onClose}>x</button>
      </div>

      <div className="gps-status-modal__content">
        {/* Summary Section */}
        <section className="gps-status-modal__section">
          <h3>Position & Fix</h3>
          <div className="gps-status-modal__grid">
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">Fix Type</span>
              <span className="gps-status-modal__stat-value">
                {gpsData?.fix_type || getFixQualityText(gpsData?.fix_quality ?? null)}
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">Satellites</span>
              <span className="gps-status-modal__stat-value">
                {gpsData?.satellites ?? '-'} in use
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">HDOP</span>
              <span className="gps-status-modal__stat-value">
                {gpsData?.hdop?.toFixed(1) ?? '-'}
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">VDOP</span>
              <span className="gps-status-modal__stat-value">
                {gpsData?.vdop?.toFixed(1) ?? '-'}
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">PDOP</span>
              <span className="gps-status-modal__stat-value">
                {gpsData?.pdop?.toFixed(1) ?? '-'}
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">Altitude</span>
              <span className="gps-status-modal__stat-value">
                {gpsData?.altitude != null ? `${gpsData.altitude.toFixed(1)}m` : '-'}
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">Source</span>
              <span className="gps-status-modal__stat-value">
                {status?.source_name || 'None'}
              </span>
            </div>
            <div className="gps-status-modal__stat">
              <span className="gps-status-modal__stat-label">Sentences</span>
              <span className="gps-status-modal__stat-value">
                {status?.sentences_received ?? 0}
              </span>
            </div>
          </div>
        </section>

        {/* Constellation Summary */}
        {Object.keys(groupedSatellites).length > 0 && (
          <section className="gps-status-modal__section">
            <h3>Constellations</h3>
            <div className="gps-status-modal__constellation-summary">
              {Object.entries(groupedSatellites)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([constellation, satellites]) => (
                  <div key={constellation} className="gps-status-modal__constellation-badge">
                    <span className="gps-status-modal__constellation-name">{constellation}</span>
                    <span className="gps-status-modal__constellation-count">{satellites.length}</span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Satellite Signal Section */}
        <section className="gps-status-modal__section">
          <h3>Satellite Signals</h3>
          {Object.keys(groupedSatellites).length === 0 ? (
            <p className="gps-status-modal__empty">No satellite data available</p>
          ) : (
            Object.entries(groupedSatellites).map(([constellation, satellites]) => (
              <div key={constellation} className="gps-status-modal__constellation">
                <h4>{constellation} ({satellites.length})</h4>
                <div className="gps-status-modal__satellites">
                  {satellites
                    .sort((a, b) => (b.snr ?? 0) - (a.snr ?? 0))
                    .map((sat) => (
                      <div key={`${constellation}-${sat.prn}`} className="gps-status-modal__satellite">
                        <div className="gps-status-modal__satellite-info">
                          <span className="gps-status-modal__satellite-prn">PRN {sat.prn}</span>
                          <span className="gps-status-modal__satellite-details">
                            El: {sat.elevation?.toFixed(0) ?? '-'}° Az: {sat.azimuth?.toFixed(0) ?? '-'}°
                          </span>
                        </div>
                        <div className="gps-status-modal__signal-bar-container">
                          <div
                            className="gps-status-modal__signal-bar"
                            style={{
                              width: `${Math.min((sat.snr ?? 0) / 50 * 100, 100)}%`,
                              backgroundColor: getSnrColor(sat.snr),
                            }}
                          />
                        </div>
                        <span className="gps-status-modal__snr">
                          {sat.snr?.toFixed(0) ?? '-'} dB
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </section>

        {/* NMEA Traffic Section */}
        <section className="gps-status-modal__section gps-status-modal__section--traffic">
          <div className="gps-status-modal__section-header">
            <h3>NMEA Traffic</h3>
            <div className="gps-status-modal__traffic-controls">
              <label className="gps-status-modal__checkbox">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Auto-scroll
              </label>
              <button
                className={`gps-status-modal__btn ${paused ? 'gps-status-modal__btn--active' : ''}`}
                onClick={() => setPaused(!paused)}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button className="gps-status-modal__btn" onClick={handleClearBuffer}>
                Clear
              </button>
            </div>
          </div>
          <div ref={trafficRef} className="gps-status-modal__traffic">
            {nmeaBuffer.length === 0 ? (
              <span className="gps-status-modal__empty">Waiting for NMEA data...</span>
            ) : (
              nmeaBuffer.map((sentence, index) => (
                <div key={index} className="gps-status-modal__sentence">
                  {sentence}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
