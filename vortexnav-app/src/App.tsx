import { useState, useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { MapView, StatusBar, LayerSwitcher, GpsSettings, GpsStatusModal, WaypointPanel } from './components';
import type { ThemeMode, Vessel, BasemapProvider, ApiKeys } from './types';
import {
  getSettings,
  saveSettings,
  toBackendSettings,
  fromBackendSettings,
  getGpsData,
  getGpsStatus,
  getWaypoints,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  startGps,
  isTauri,
  type GpsSourceStatus,
  type Waypoint,
} from './hooks/useTauri';
import './App.css';

function App() {
  // Theme and display settings
  const [theme, setTheme] = useState<ThemeMode>('day');
  const [basemap, setBasemap] = useState<BasemapProvider>('osm');
  const [showOpenSeaMap, setShowOpenSeaMap] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Map state for persistence
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hasInitialCentered = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // Vessel state
  const [vessel, setVessel] = useState<Vessel>({
    position: null,
    heading: null,
    cog: null,
    sog: null,
  });
  const [connected, setConnected] = useState(false);

  // GPS settings panel
  const [showGpsSettings, setShowGpsSettings] = useState(false);
  const [showGpsStatus, setShowGpsStatus] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<GpsSourceStatus | null>(null);

  // Waypoints state
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [activeWaypointId, setActiveWaypointId] = useState<number | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<number | null>(null);
  const [showWaypointPanel, setShowWaypointPanel] = useState(false);
  const [pendingWaypoint, setPendingWaypoint] = useState<{ lat: number; lon: number } | null>(null);

  // Dragging waypoint state - tracks position during drag for real-time distance updates
  const [draggingWaypoint, setDraggingWaypoint] = useState<{ id: number; lat: number; lon: number } | null>(null);

  // Cursor position state
  const [cursorPosition, setCursorPosition] = useState<{ lat: number; lon: number } | null>(null);

  // Load settings from backend on startup
  useEffect(() => {
    async function loadSettings() {
      if (!isTauri()) {
        // Running in browser, use defaults
        setSettingsLoaded(true);
        return;
      }

      try {
        const backendSettings = await getSettings();
        const settings = fromBackendSettings(backendSettings);

        setTheme(settings.theme);
        setBasemap(settings.basemap);
        setShowOpenSeaMap(settings.showOpenSeaMap);
        setApiKeys(settings.apiKeys);

        console.log('Settings loaded from backend');

        // Auto-start GPS if sources are configured
        try {
          await startGps();
          console.log('GPS auto-started');
        } catch {
          // No sources configured, that's OK
          console.log('No GPS sources configured');
        }
      } catch (error) {
        console.warn('Failed to load settings, using defaults:', error);
      } finally {
        setSettingsLoaded(true);
      }
    }

    loadSettings();
  }, []);

  // Save settings whenever they change
  useEffect(() => {
    if (!settingsLoaded || !isTauri()) return;

    // Debounce settings save
    const timeoutId = setTimeout(async () => {
      try {
        const map = mapRef.current;
        const center = map?.getCenter();
        const zoom = map?.getZoom();

        const backendSettings = toBackendSettings(
          theme,
          basemap,
          showOpenSeaMap,
          apiKeys,
          center?.lat,
          center?.lng,
          zoom
        );

        await saveSettings(backendSettings);
        console.log('Settings saved to backend');
      } catch (error) {
        console.warn('Failed to save settings:', error);
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [theme, basemap, showOpenSeaMap, apiKeys, settingsLoaded]);

  // Poll GPS data and status from backend
  useEffect(() => {
    if (!isTauri()) {
      // Running in browser, simulate GPS for demo
      return;
    }

    const pollGps = async () => {
      try {
        const [gpsData, status] = await Promise.all([
          getGpsData(),
          getGpsStatus(),
        ]);

        setGpsStatus(status);

        if (gpsData.latitude != null && gpsData.longitude != null) {
          setVessel({
            position: { lat: gpsData.latitude, lon: gpsData.longitude },
            heading: gpsData.heading,
            cog: gpsData.course,
            sog: gpsData.speed_knots,
          });
          setConnected(status.status === 'receiving_data' || status.status === 'connected');
        } else {
          setConnected(false);
        }
      } catch (error) {
        // GPS not available or error
        console.debug('GPS poll:', error);
        setConnected(false);
      }
    };

    // Poll every second
    const intervalId = setInterval(pollGps, 1000);
    pollGps(); // Initial poll

    return () => clearInterval(intervalId);
  }, []);

  // Auto-center map on GPS position at startup (once)
  useEffect(() => {
    if (
      !hasInitialCentered.current &&
      mapReady &&
      mapRef.current &&
      vessel.position &&
      settingsLoaded
    ) {
      hasInitialCentered.current = true;
      console.log('Auto-centering on GPS position:', vessel.position);
      mapRef.current.flyTo({
        center: [vessel.position.lon, vessel.position.lat],
        zoom: 14,
        duration: 1500,
      });
    }
  }, [vessel.position, settingsLoaded, mapReady]);

  const handleThemeChange = useCallback((newTheme: ThemeMode) => {
    setTheme(newTheme);
  }, []);

  const handleBasemapChange = useCallback((newBasemap: BasemapProvider) => {
    setBasemap(newBasemap);
  }, []);

  const handleApiKeysChange = useCallback((newKeys: ApiKeys) => {
    setApiKeys(newKeys);
  }, []);

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    console.log('Map initialized successfully');
    mapRef.current = map;
    setMapReady(true);

    // If running in browser (not Tauri), simulate GPS for demo
    if (!isTauri()) {
      setTimeout(() => {
        setVessel({
          position: { lat: 37.8044, lon: -122.4194 },
          heading: 45,
          cog: 47,
          sog: 6.2,
        });
        setConnected(true);
      }, 2000);
    }
  }, []);

  const handleGpsSettingsClose = useCallback(() => {
    setShowGpsSettings(false);
    // Restart GPS after settings change
    if (isTauri()) {
      startGps().catch(() => {});
    }
  }, []);

  // Load waypoints
  const loadWaypoints = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const data = await getWaypoints();
      setWaypoints(data);
    } catch (error) {
      console.error('Failed to load waypoints:', error);
    }
  }, []);

  // Load waypoints on startup
  useEffect(() => {
    if (settingsLoaded) {
      loadWaypoints();
    }
  }, [settingsLoaded, loadWaypoints]);

  // Handle right-click on map to create waypoint
  const handleMapRightClick = useCallback((lat: number, lon: number) => {
    setPendingWaypoint({ lat, lon });
    setShowWaypointPanel(true);
  }, []);

  // Handle cursor movement on map
  const handleCursorMove = useCallback((lat: number, lon: number) => {
    setCursorPosition({ lat, lon });
  }, []);

  const handleCursorLeave = useCallback(() => {
    setCursorPosition(null);
  }, []);

  // Handle waypoint selection (for navigation)
  const handleNavigateToWaypoint = useCallback((waypoint: Waypoint) => {
    if (activeWaypointId === waypoint.id) {
      // Toggle off if already active
      setActiveWaypointId(null);
    } else {
      setActiveWaypointId(waypoint.id);
    }
  }, [activeWaypointId]);

  // Center map on a waypoint
  const handleCenterOnWaypoint = useCallback((waypoint: Waypoint) => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [waypoint.lon, waypoint.lat],
        zoom: 14,
        duration: 1000,
      });
    }
  }, []);

  // Handle waypoint click on map - select it in panel if panel is open
  const handleWaypointMapClick = useCallback((waypoint: Waypoint) => {
    // Always select the waypoint when clicked on map
    setSelectedWaypointId(waypoint.id);
    // Center on the waypoint
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [waypoint.lon, waypoint.lat],
        zoom: 14,
        duration: 1000,
      });
    }
  }, []);

  // Handle waypoint panel close (refresh waypoints)
  const handleWaypointPanelClose = useCallback(() => {
    setShowWaypointPanel(false);
    loadWaypoints();
  }, [loadWaypoints]);

  // Center map on current vessel position
  const handleCenterOnLocation = useCallback(() => {
    if (mapRef.current && vessel.position) {
      mapRef.current.flyTo({
        center: [vessel.position.lon, vessel.position.lat],
        zoom: 14,
        duration: 1000,
      });
    }
  }, [vessel.position]);

  // Handle waypoint drag (real-time updates during drag)
  const handleWaypointDrag = useCallback((waypoint: Waypoint, lat: number, lon: number) => {
    if (!waypoint.id) return;
    setDraggingWaypoint({ id: waypoint.id, lat, lon });
  }, []);

  // Handle waypoint drag end - update position in database
  const handleWaypointDragEnd = useCallback(async (waypoint: Waypoint, newLat: number, newLon: number) => {
    // Clear dragging state
    setDraggingWaypoint(null);

    if (!isTauri() || !waypoint.id) return;

    try {
      await updateWaypoint({
        ...waypoint,
        lat: newLat,
        lon: newLon,
      });
      await loadWaypoints();
      console.log(`Waypoint "${waypoint.name}" moved to ${newLat.toFixed(6)}, ${newLon.toFixed(6)}`);
    } catch (error) {
      console.error('Failed to update waypoint position:', error);
      // Reload to reset marker to original position
      await loadWaypoints();
    }
  }, [loadWaypoints]);

  // Handle waypoint delete from context menu
  const handleWaypointDelete = useCallback(async (waypoint: Waypoint) => {
    if (!isTauri() || !waypoint.id) return;

    try {
      await deleteWaypoint(waypoint.id);
      // Clear selection if deleted waypoint was selected
      if (selectedWaypointId === waypoint.id) {
        setSelectedWaypointId(null);
      }
      if (activeWaypointId === waypoint.id) {
        setActiveWaypointId(null);
      }
      await loadWaypoints();
      console.log(`Waypoint "${waypoint.name}" deleted`);
    } catch (error) {
      console.error('Failed to delete waypoint:', error);
    }
  }, [loadWaypoints, selectedWaypointId, activeWaypointId]);

  // Handle quick waypoint creation with auto-generated name
  const waypointCounter = useRef(1);
  const handleQuickWaypointCreate = useCallback(async (lat: number, lon: number) => {
    if (!isTauri()) return;

    try {
      // Generate a unique name
      const name = `Waypoint ${waypointCounter.current++}`;

      await createWaypoint({
        name,
        lat,
        lon,
        description: null,
        symbol: 'default',
      });
      await loadWaypoints();
      console.log(`Quick waypoint "${name}" created at ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    } catch (error) {
      console.error('Failed to create quick waypoint:', error);
    }
  }, [loadWaypoints]);

  // Don't render until settings are loaded
  if (!settingsLoaded) {
    return (
      <div className="app app--day">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`app app--${theme}`}>
      <header className="app__header">
        <h1 className="app__title">VortexNav</h1>
        <span className="app__version">v0.1.0</span>
      </header>

      <main className="app__main">
        <MapView
          theme={theme}
          basemap={basemap}
          showOpenSeaMap={showOpenSeaMap}
          apiKeys={apiKeys}
          zoom={12}
          vessel={vessel}
          waypoints={waypoints}
          activeWaypointId={activeWaypointId}
          pendingWaypoint={pendingWaypoint}
          onMapReady={handleMapReady}
          onMapRightClick={handleMapRightClick}
          onWaypointClick={handleWaypointMapClick}
          onWaypointDrag={handleWaypointDrag}
          onWaypointDragEnd={handleWaypointDragEnd}
          onWaypointDelete={handleWaypointDelete}
          onQuickWaypointCreate={handleQuickWaypointCreate}
          onCursorMove={handleCursorMove}
          onCursorLeave={handleCursorLeave}
        />

        <LayerSwitcher
          theme={theme}
          currentBasemap={basemap}
          showOpenSeaMap={showOpenSeaMap}
          apiKeys={apiKeys}
          onBasemapChange={handleBasemapChange}
          onOpenSeaMapToggle={setShowOpenSeaMap}
          onApiKeysChange={handleApiKeysChange}
        />

        {/* My Location Button - standard crosshairs/GPS icon */}
        <button
          className="my-location-btn"
          onClick={handleCenterOnLocation}
          disabled={!vessel.position}
          title={vessel.position ? 'Center on my location' : 'No GPS position available'}
          style={{ top: '120px' }} // Below navigation controls with spacing
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="8" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
          </svg>
        </button>

        {/* Waypoints Button - top left, icon only */}
        <button
          className="waypoints-btn"
          onClick={() => setShowWaypointPanel(true)}
          title="Waypoints"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </button>

        {/* Settings Button - top left, below waypoints */}
        <button
          className="settings-btn"
          onClick={() => setShowGpsSettings(true)}
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </main>

      <footer className="app__footer">
        <StatusBar
          vessel={vessel}
          theme={theme}
          connected={connected}
          gpsStatus={gpsStatus}
          cursorPosition={cursorPosition}
          activeWaypoint={waypoints.find(w => w.id === activeWaypointId) || null}
          onThemeChange={handleThemeChange}
          onGpsStatusClick={() => setShowGpsStatus(true)}
        />
      </footer>

      {showGpsSettings && (
        <GpsSettings theme={theme} onClose={handleGpsSettingsClose} />
      )}

      {showGpsStatus && (
        <>
          <div className="modal-backdrop" onClick={() => setShowGpsStatus(false)} />
          <GpsStatusModal theme={theme} onClose={() => setShowGpsStatus(false)} />
        </>
      )}

      {showWaypointPanel && (
        <WaypointPanel
          theme={theme}
          waypoints={waypoints}
          vesselPosition={vessel.position}
          draggingWaypoint={draggingWaypoint}
          activeWaypointId={activeWaypointId}
          selectedWaypointId={selectedWaypointId}
          onSelectionChange={setSelectedWaypointId}
          onClose={handleWaypointPanelClose}
          onWaypointSelect={(wp) => setActiveWaypointId(wp?.id ?? null)}
          onNavigateTo={handleNavigateToWaypoint}
          onCenterOnWaypoint={handleCenterOnWaypoint}
          onWaypointsChange={loadWaypoints}
          pendingWaypoint={pendingWaypoint}
          onPendingWaypointClear={() => setPendingWaypoint(null)}
        />
      )}
    </div>
  );
}

export default App;
