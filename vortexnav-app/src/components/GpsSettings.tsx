import { useState, useEffect, useCallback } from 'react';
import type { ThemeMode } from '../types';
import {
  listSerialPorts,
  testGpsPort,
  getGpsSources,
  saveGpsSource,
  deleteGpsSource,
  updateGpsPriorities,
  startGps,
  stopGps,
  getGpsStatus,
  generateId,
  isTauri,
  type DetectedPort,
  type GpsSourceConfig,
  type GpsSourceStatus,
  type GpsSourceType,
} from '../hooks/useTauri';

interface GpsSettingsProps {
  theme: ThemeMode;
  onClose: () => void;
}

const BAUD_RATES = [4800, 9600, 19200, 38400, 57600, 115200];

export function GpsSettings({ theme, onClose }: GpsSettingsProps) {
  const [ports, setPorts] = useState<DetectedPort[]>([]);
  const [sources, setSources] = useState<GpsSourceConfig[]>([]);
  const [status, setStatus] = useState<GpsSourceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state for adding new source
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSource, setNewSource] = useState<Partial<GpsSourceConfig>>({
    name: '',
    source_type: 'serial_port',
    port_name: null,
    baud_rate: 4800,
    enabled: true,
    priority: 0,
  });

  // Load data
  const loadData = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const [portsData, sourcesData, statusData] = await Promise.all([
        listSerialPorts(),
        getGpsSources(),
        getGpsStatus(),
      ]);
      setPorts(portsData);
      setSources(sourcesData);
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GPS data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll status
  useEffect(() => {
    if (!isTauri()) return;

    const interval = setInterval(async () => {
      try {
        const statusData = await getGpsStatus();
        setStatus(statusData);
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Refresh ports
  const handleRefreshPorts = async () => {
    try {
      const portsData = await listSerialPorts();
      setPorts(portsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh ports');
    }
  };

  // Test a port
  const handleTestPort = async (portName: string, baudRate: number) => {
    setTesting(portName);
    try {
      const isGps = await testGpsPort(portName, baudRate);
      alert(isGps ? `${portName} appears to be a GPS device!` : `${portName} does not appear to be a GPS device.`);
    } catch (err) {
      alert(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTesting(null);
    }
  };

  // Add new source
  const handleAddSource = async () => {
    if (!newSource.name || (newSource.source_type === 'serial_port' && !newSource.port_name)) {
      setError('Please fill in all required fields');
      return;
    }

    const source: GpsSourceConfig = {
      id: generateId(),
      name: newSource.name,
      source_type: newSource.source_type as GpsSourceType,
      port_name: newSource.port_name || null,
      baud_rate: newSource.baud_rate || 4800,
      enabled: newSource.enabled ?? true,
      priority: sources.length,
    };

    try {
      await saveGpsSource(source);
      await loadData();
      setShowAddForm(false);
      setNewSource({
        name: '',
        source_type: 'serial_port',
        port_name: null,
        baud_rate: 4800,
        enabled: true,
        priority: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    }
  };

  // Delete source
  const handleDeleteSource = async (id: string) => {
    if (!confirm('Are you sure you want to delete this GPS source?')) return;

    try {
      await deleteGpsSource(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete source');
    }
  };

  // Toggle source enabled
  const handleToggleEnabled = async (source: GpsSourceConfig) => {
    try {
      await saveGpsSource({ ...source, enabled: !source.enabled });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update source');
    }
  };

  // Move source up in priority
  const handleMoveUp = async (index: number) => {
    if (index === 0) return;

    const newSources = [...sources];
    const priorities: [string, number][] = newSources.map((s, i) => {
      if (i === index) return [s.id, i - 1];
      if (i === index - 1) return [s.id, i + 1];
      return [s.id, i];
    });

    try {
      await updateGpsPriorities(priorities);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update priorities');
    }
  };

  // Move source down in priority
  const handleMoveDown = async (index: number) => {
    if (index === sources.length - 1) return;

    const newSources = [...sources];
    const priorities: [string, number][] = newSources.map((s, i) => {
      if (i === index) return [s.id, i + 1];
      if (i === index + 1) return [s.id, i - 1];
      return [s.id, i];
    });

    try {
      await updateGpsPriorities(priorities);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update priorities');
    }
  };

  // Start GPS
  const handleStartGps = async () => {
    try {
      await startGps();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start GPS');
    }
  };

  // Stop GPS
  const handleStopGps = async () => {
    try {
      await stopGps();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop GPS');
    }
  };

  // Quick add from detected port
  const handleQuickAdd = (port: DetectedPort) => {
    setNewSource({
      name: port.product || port.manufacturer || port.port_name,
      source_type: 'serial_port',
      port_name: port.port_name,
      baud_rate: 4800,
      enabled: true,
      priority: sources.length,
    });
    setShowAddForm(true);
  };

  const getStatusColor = (status: GpsSourceStatus | null) => {
    if (!status) return 'var(--text-secondary)';
    switch (status.status) {
      case 'receiving_data':
        return 'var(--success)';
      case 'connected':
        return 'var(--accent)';
      case 'connecting':
        return 'var(--warning)';
      case 'error':
        return 'var(--danger)';
      default:
        return 'var(--text-secondary)';
    }
  };

  const getStatusText = (status: GpsSourceStatus | null) => {
    if (!status) return 'Not started';
    switch (status.status) {
      case 'receiving_data':
        return `Receiving (${status.sentences_received} sentences)`;
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return status.last_error || 'Error';
      default:
        return 'Disconnected';
    }
  };

  if (!isTauri()) {
    return (
      <div className={`gps-settings gps-settings--${theme}`}>
        <div className="gps-settings__header">
          <h2>GPS Settings</h2>
          <button className="gps-settings__close" onClick={onClose}>×</button>
        </div>
        <div className="gps-settings__content">
          <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            GPS settings are only available in the desktop application.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`gps-settings gps-settings--${theme}`}>
      <div className="gps-settings__header">
        <h2>GPS Settings</h2>
        <button className="gps-settings__close" onClick={onClose}>×</button>
      </div>

      {error && (
        <div className="gps-settings__error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="gps-settings__content">
        {loading ? (
          <div className="gps-settings__loading">Loading...</div>
        ) : (
          <>
            {/* Status Section */}
            <section className="gps-settings__section">
              <h3>Connection Status</h3>
              <div className="gps-settings__status">
                <div
                  className="gps-settings__status-indicator"
                  style={{ backgroundColor: getStatusColor(status) }}
                />
                <div className="gps-settings__status-info">
                  <div className="gps-settings__status-text">{getStatusText(status)}</div>
                  {status?.source_name && (
                    <div className="gps-settings__status-source">Source: {status.source_name}</div>
                  )}
                </div>
                <div className="gps-settings__status-actions">
                  {status?.status === 'disconnected' || !status ? (
                    <button
                      className="gps-settings__btn gps-settings__btn--primary"
                      onClick={handleStartGps}
                      disabled={sources.filter(s => s.enabled).length === 0}
                    >
                      Start GPS
                    </button>
                  ) : (
                    <button
                      className="gps-settings__btn gps-settings__btn--danger"
                      onClick={handleStopGps}
                    >
                      Stop GPS
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Configured Sources */}
            <section className="gps-settings__section">
              <div className="gps-settings__section-header">
                <h3>GPS Sources</h3>
                <button
                  className="gps-settings__btn gps-settings__btn--small"
                  onClick={() => setShowAddForm(true)}
                >
                  + Add Source
                </button>
              </div>

              {sources.length === 0 ? (
                <p className="gps-settings__empty">
                  No GPS sources configured. Add a source to get started.
                </p>
              ) : (
                <div className="gps-settings__sources">
                  {sources.map((source, index) => (
                    <div
                      key={source.id}
                      className={`gps-settings__source ${!source.enabled ? 'gps-settings__source--disabled' : ''}`}
                    >
                      <div className="gps-settings__source-priority">
                        <button
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                          title="Higher priority"
                        >
                          ▲
                        </button>
                        <span>{index + 1}</span>
                        <button
                          onClick={() => handleMoveDown(index)}
                          disabled={index === sources.length - 1}
                          title="Lower priority"
                        >
                          ▼
                        </button>
                      </div>
                      <div className="gps-settings__source-info">
                        <div className="gps-settings__source-name">{source.name}</div>
                        <div className="gps-settings__source-details">
                          {source.source_type === 'serial_port' && source.port_name
                            ? `${source.port_name} @ ${source.baud_rate} baud`
                            : source.source_type === 'simulated'
                            ? 'Simulated GPS'
                            : 'TCP Stream'}
                        </div>
                      </div>
                      <div className="gps-settings__source-actions">
                        <label className="gps-settings__toggle">
                          <input
                            type="checkbox"
                            checked={source.enabled}
                            onChange={() => handleToggleEnabled(source)}
                          />
                          <span className="gps-settings__toggle-slider" />
                        </label>
                        <button
                          className="gps-settings__btn gps-settings__btn--icon"
                          onClick={() => handleDeleteSource(source.id)}
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="gps-settings__hint">
                Sources are tried in priority order. If the first source fails, the next enabled source is used.
              </p>
            </section>

            {/* Detected Ports */}
            <section className="gps-settings__section">
              <div className="gps-settings__section-header">
                <h3>Detected Serial Ports</h3>
                <button
                  className="gps-settings__btn gps-settings__btn--small"
                  onClick={handleRefreshPorts}
                >
                  Refresh
                </button>
              </div>

              {ports.length === 0 ? (
                <p className="gps-settings__empty">No serial ports detected.</p>
              ) : (
                <div className="gps-settings__ports">
                  {ports.map((port) => (
                    <div
                      key={port.port_name}
                      className={`gps-settings__port ${port.is_likely_gps ? 'gps-settings__port--likely' : ''}`}
                    >
                      <div className="gps-settings__port-info">
                        <div className="gps-settings__port-name">
                          {port.port_name}
                          {port.is_likely_gps && <span className="gps-settings__badge">Likely GPS</span>}
                        </div>
                        <div className="gps-settings__port-details">
                          {[port.manufacturer, port.product].filter(Boolean).join(' - ') || port.port_type}
                        </div>
                      </div>
                      <div className="gps-settings__port-actions">
                        <button
                          className="gps-settings__btn gps-settings__btn--small"
                          onClick={() => handleTestPort(port.port_name, 4800)}
                          disabled={testing === port.port_name}
                        >
                          {testing === port.port_name ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          className="gps-settings__btn gps-settings__btn--small gps-settings__btn--primary"
                          onClick={() => handleQuickAdd(port)}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Add Form */}
            {showAddForm && (
              <div className="gps-settings__modal">
                <div className="gps-settings__modal-content">
                  <h3>Add GPS Source</h3>

                  <div className="gps-settings__field">
                    <label>Name</label>
                    <input
                      type="text"
                      value={newSource.name || ''}
                      onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                      placeholder="e.g., USB GPS"
                    />
                  </div>

                  <div className="gps-settings__field">
                    <label>Type</label>
                    <select
                      value={newSource.source_type}
                      onChange={(e) =>
                        setNewSource({ ...newSource, source_type: e.target.value as GpsSourceType })
                      }
                    >
                      <option value="serial_port">Serial Port</option>
                      <option value="simulated">Simulated (Demo)</option>
                    </select>
                  </div>

                  {newSource.source_type === 'serial_port' && (
                    <>
                      <div className="gps-settings__field">
                        <label>Port</label>
                        <select
                          value={newSource.port_name || ''}
                          onChange={(e) => setNewSource({ ...newSource, port_name: e.target.value })}
                        >
                          <option value="">Select a port...</option>
                          {ports.map((port) => (
                            <option key={port.port_name} value={port.port_name}>
                              {port.port_name} {port.is_likely_gps ? '(Likely GPS)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="gps-settings__field">
                        <label>Baud Rate</label>
                        <select
                          value={newSource.baud_rate}
                          onChange={(e) =>
                            setNewSource({ ...newSource, baud_rate: parseInt(e.target.value) })
                          }
                        >
                          {BAUD_RATES.map((rate) => (
                            <option key={rate} value={rate}>
                              {rate} {rate === 4800 ? '(Standard NMEA)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  <div className="gps-settings__modal-actions">
                    <button
                      className="gps-settings__btn"
                      onClick={() => setShowAddForm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="gps-settings__btn gps-settings__btn--primary"
                      onClick={handleAddSource}
                    >
                      Add Source
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
