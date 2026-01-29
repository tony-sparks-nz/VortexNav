import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import { MapView, StatusBar, LayerSwitcher, GpsSettings, GpsStatusModal, WaypointPanel, RoutePanel, RouteCreationOverlay, ChartBar, ImportProgressIndicator, NavigationModal, RouteNavigationModal, TrackPanel, DeviceRegistration, PackManager } from './components';
import type { ThemeMode, Vessel, BasemapProvider, ApiKeys, ImportProgress, GebcoSettings, GebcoStatus, Cm93Settings, Cm93Status, GeoJsonTile, NauticalChartSettings, NauticalChartStatus } from './types';
import { DEFAULT_GEBCO_SETTINGS, DEFAULT_CM93_SETTINGS, TRACK_RECORDING_INTERVAL, TRACK_MIN_MOVEMENT_METERS } from './types';
import {
  getSettings,
  saveSettings,
  toBackendSettings,
  fromBackendSettings,
  getGpsData,
  getGpsStatus,
  startGps,
  isTauri,
  getGebcoStatus,
  getGebcoSettings,
  saveGebcoSettings,
  getCm93Status,
  getCm93Settings,
  saveCm93Settings,
  initCm93Server,
  getCm93Features,
  type GpsSourceStatus,
} from './hooks/useTauri';
import { useWaypointManager } from './hooks/useWaypointManager';
import { useRouteManager } from './hooks/useRouteManager';
import { useTrackManager } from './hooks/useTrackManager';
import { useChartLayers } from './hooks/useChartLayers';
import { useLicensingAgent } from './hooks/useLicensingAgent';
import { registerVortexProtocol } from './utils/vortexProtocol';
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

  // Panels
  const [showGpsSettings, setShowGpsSettings] = useState(false);
  const [showGpsStatus, setShowGpsStatus] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<GpsSourceStatus | null>(null);

  // Licensing Agent panels
  const [showDeviceRegistration, setShowDeviceRegistration] = useState(false);
  const [showPackManager, setShowPackManager] = useState(false);

  // Map orientation mode: 'north-up' or 'heading-up'
  const [orientationMode, setOrientationMode] = useState<'north-up' | 'heading-up'>('north-up');

  // ============ CENTRALIZED WAYPOINT STATE ============
  // All waypoint state is managed by useWaypointManager
  const waypointManager = useWaypointManager();
  const {
    state: waypointState,
    stateRef: waypointStateRef,
    activeWaypoint,
    editingPreview,
    loadWaypoints,
    startEdit,
    closeEdit,
    deleteWaypoint,
    setSelectedWaypoint,
    toggleActiveWaypoint,
    toggleWaypointHidden,
    startDrag,
    moveDrag,
    endDrag,
  } = waypointManager;

  // ============ CENTRALIZED ROUTE STATE ============
  // All route state is managed by useRouteManager
  const routeManager = useRouteManager();

  // ============ CENTRALIZED TRACK STATE ============
  // All track state is managed by useTrackManager
  const trackManager = useTrackManager();

  // ============ LICENSING AGENT STATE ============
  // Device registration, entitlements, and offline packs
  const licensingAgent = useLicensingAgent();

  // Extract entitlement values for UI enforcement
  const entitlementMaxZoom = useMemo(() => {
    const ent = licensingAgent.entitlements.find(e => e.key === 'max_zoom_level');
    if (ent && typeof ent.value === 'number') {
      return ent.value;
    }
    return null; // No restriction (default to map's default maxZoom)
  }, [licensingAgent.entitlements]);

  const allowedBasemaps = useMemo(() => {
    const ent = licensingAgent.entitlements.find(e => e.key === 'allowed_basemaps');
    if (ent && Array.isArray(ent.value)) {
      return ent.value as string[];
    }
    return null; // No restriction
  }, [licensingAgent.entitlements]);

  // Route navigation state - tracks current waypoint when navigating a route
  const [currentRouteWaypointIndex, setCurrentRouteWaypointIndex] = useState(0);

  // Reset waypoint index when active route changes
  useEffect(() => {
    setCurrentRouteWaypointIndex(0);
  }, [routeManager.state.activeRouteId]);

  // Panel visibility
  const [showWaypointPanel, setShowWaypointPanel] = useState(false);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [showTrackPanel, setShowTrackPanel] = useState(false);
  // Pending waypoint position from right-click
  const [pendingWaypoint, setPendingWaypoint] = useState<{ lat: number; lon: number } | null>(null);

  // Cursor position state
  const [cursorPosition, setCursorPosition] = useState<{ lat: number; lon: number } | null>(null);

  // Viewport bounds and zoom for chart bar
  const [viewportBounds, setViewportBounds] = useState<LngLatBounds | null>(null);
  const [currentZoom, setCurrentZoom] = useState(12);

  // Background import progress state
  const [backgroundImportProgress, setBackgroundImportProgress] = useState<ImportProgress | null>(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // GEBCO bathymetry state
  const [gebcoSettings, setGebcoSettings] = useState<GebcoSettings>(DEFAULT_GEBCO_SETTINGS);
  const [gebcoStatus, setGebcoStatus] = useState<GebcoStatus | null>(null);

  // Nautical chart state (CM93 internally)
  const [cm93Settings, setCm93Settings] = useState<Cm93Settings>(DEFAULT_CM93_SETTINGS);
  const [cm93Status, setCm93Status] = useState<Cm93Status | null>(null);

  // Convert CM93 internal state to frontend-facing NauticalChart types
  const nauticalSettings: NauticalChartSettings = {
    enabled: cm93Settings.enabled,
    opacity: cm93Settings.opacity,
    showSoundings: cm93Settings.showSoundings,
    showDepthContours: cm93Settings.showDepthContours,
    showLights: cm93Settings.showLights,
    showBuoys: cm93Settings.showBuoys,
    showLand: cm93Settings.showLand,
    showObstructions: cm93Settings.showObstructions,
    dataPath: cm93Settings.cm93Path,
  };

  const nauticalStatus: NauticalChartStatus | undefined = cm93Status ? {
    initialized: cm93Status.initialized,
    availableScales: cm93Status.available_scales,
    dataPath: cm93Status.path,
  } : undefined;

  // Chart layers
  const {
    layers: chartLayers,
    isLoading: chartLayersLoading,
    addChartFromFile,
    removeLayer: removeChartLayer,
    removeMultipleLayers: removeMultipleChartLayers,
    toggleLayer: toggleChartLayer,
    setLayerOpacity: setChartLayerOpacity,
    zoomToLayer: getChartLayerBounds,
    refreshLayers: refreshChartLayers,
    updateChartMetadata,
  } = useChartLayers();

  // Global chart visibility toggle
  const [allChartsHidden, setAllChartsHidden] = useState(false);

  // Chart outline display state
  const [showChartOutlines, setShowChartOutlines] = useState(false);
  const [highlightedChartId, setHighlightedChartId] = useState<string | null>(null);

  // Register vortex:// protocol for LA tile serving
  useEffect(() => {
    registerVortexProtocol();
  }, []);

  // Show device registration modal on first run if not registered
  useEffect(() => {
    if (settingsLoaded && licensingAgent.isConnected && !licensingAgent.isRegistered && !licensingAgent.isLoading) {
      // Device is connected to LA but not registered - show registration modal
      setShowDeviceRegistration(true);
    }
  }, [settingsLoaded, licensingAgent.isConnected, licensingAgent.isRegistered, licensingAgent.isLoading]);

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

  // Load GEBCO bathymetry settings and status
  useEffect(() => {
    async function loadGebco() {
      if (!isTauri()) return;

      try {
        // Load GEBCO status (which files are available)
        const status = await getGebcoStatus();
        setGebcoStatus(status);
        console.log('GEBCO status:', status);

        // Load GEBCO settings
        const settings = await getGebcoSettings();
        setGebcoSettings(settings);
        console.log('GEBCO settings loaded');
      } catch (error) {
        console.warn('Failed to load GEBCO data:', error);
      }
    }

    loadGebco();
  }, []);

  // Handle GEBCO settings change
  const handleGebcoSettingsChange = useCallback(async (newSettings: GebcoSettings) => {
    setGebcoSettings(newSettings);

    if (isTauri()) {
      try {
        await saveGebcoSettings(newSettings);
      } catch (error) {
        console.error('Failed to save GEBCO settings:', error);
      }
    }
  }, []);

  // Load nautical chart (CM93) settings and status
  useEffect(() => {
    async function loadCm93() {
      if (!isTauri()) return;

      try {
        // Load CM93 settings
        const settings = await getCm93Settings();
        setCm93Settings(settings);
        console.log('CM93 settings loaded:', settings);

        // If a CM93 path is configured, initialize the server
        if (settings.cm93Path) {
          try {
            const status = await initCm93Server(settings.cm93Path);
            setCm93Status(status);
            console.log('CM93 server initialized:', status);
          } catch (err) {
            console.warn('Failed to initialize CM93 server:', err);
          }
        } else {
          // Check if server is already initialized
          const status = await getCm93Status();
          setCm93Status(status);
        }
      } catch (error) {
        console.warn('Failed to load CM93 data:', error);
      }
    }

    loadCm93();
  }, []);

  // Handle CM93 settings change (internal)
  const handleCm93SettingsChange = useCallback(async (newSettings: Cm93Settings) => {
    setCm93Settings(newSettings);

    if (isTauri()) {
      try {
        await saveCm93Settings(newSettings);
      } catch (error) {
        console.error('Failed to save nautical chart settings:', error);
      }
    }
  }, []);

  // Handle nautical settings change (frontend-facing, converts to CM93)
  const handleNauticalSettingsChange = useCallback(async (newSettings: NauticalChartSettings) => {
    const cm93NewSettings: Cm93Settings = {
      enabled: newSettings.enabled,
      opacity: newSettings.opacity,
      showSoundings: newSettings.showSoundings,
      showDepthContours: newSettings.showDepthContours,
      showLights: newSettings.showLights,
      showBuoys: newSettings.showBuoys,
      showLand: newSettings.showLand,
      showObstructions: newSettings.showObstructions,
      cm93Path: newSettings.dataPath,
    };
    await handleCm93SettingsChange(cm93NewSettings);
  }, [handleCm93SettingsChange]);

  // Initialize CM93 server with a path
  const handleCm93Initialize = useCallback(async (path: string) => {
    if (!isTauri()) return;

    try {
      const status = await initCm93Server(path);
      setCm93Status(status);

      // Update settings with the path
      const newSettings = { ...cm93Settings, cm93Path: path };
      setCm93Settings(newSettings);
      await saveCm93Settings(newSettings);

      console.log('CM93 server initialized:', status);
    } catch (error) {
      console.error('Failed to initialize CM93 server:', error);
    }
  }, [cm93Settings]);

  // Fetch CM93 features for map view
  const handleCm93FeaturesRequest = useCallback(async (
    minLat: number,
    minLon: number,
    maxLat: number,
    maxLon: number,
    zoom: number
  ): Promise<GeoJsonTile | null> => {
    if (!isTauri() || !cm93Status?.initialized) return null;

    try {
      return await getCm93Features(minLat, minLon, maxLat, maxLon, zoom);
    } catch (error) {
      console.warn('Failed to fetch CM93 features:', error);
      return null;
    }
  }, [cm93Status?.initialized]);

  // Listen for background import progress events from Tauri
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    async function setupListener() {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<ImportProgress>('import-progress', (event) => {
          setBackgroundImportProgress(event.payload);
          // Auto-refresh chart layers when import completes
          if (event.payload.phase === 'complete' && event.payload.converted > 0) {
            refreshChartLayers();
          }
        });
      } catch (error) {
        console.warn('Failed to setup import progress listener:', error);
      }
    }

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshChartLayers]);

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

  // Track recording - add points at intervals when recording is active
  const lastTrackPointRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!isTauri() || !trackManager.isRecording || !vessel.position) return;

    // Helper to calculate distance in meters using Haversine formula
    const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000; // Earth radius in meters
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const interval = setInterval(async () => {
      if (!vessel.position) return;

      const { lat, lon } = vessel.position;

      // Skip if position hasn't moved enough
      if (lastTrackPointRef.current) {
        const distance = distanceMeters(
          lastTrackPointRef.current.lat,
          lastTrackPointRef.current.lon,
          lat,
          lon
        );
        if (distance < TRACK_MIN_MOVEMENT_METERS) {
          return;
        }
      }

      // Add the track point
      await trackManager.addTrackPoint(lat, lon, vessel.heading, vessel.cog, vessel.sog);
      lastTrackPointRef.current = { lat, lon };
    }, TRACK_RECORDING_INTERVAL);

    return () => clearInterval(interval);
  }, [trackManager.isRecording, vessel.position, vessel.heading, vessel.cog, vessel.sog, trackManager]);

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

  // Handle viewport bounds change from map
  const handleBoundsChange = useCallback((bounds: LngLatBounds, zoom: number) => {
    setViewportBounds(bounds);
    setCurrentZoom(zoom);
  }, []);

  // Center map on a waypoint
  const handleCenterOnWaypoint = useCallback((waypointId: number) => {
    const waypoint = waypointStateRef.current.waypoints.find(w => w.id === waypointId);
    if (mapRef.current && waypoint) {
      mapRef.current.flyTo({
        center: [waypoint.lon, waypoint.lat],
        zoom: 14,
        duration: 1000,
      });
    }
  }, [waypointStateRef]);

  // Handle waypoint click on map - select it in panel if panel is open
  const handleWaypointMapClick = useCallback((waypointId: number) => {
    // Always select the waypoint when clicked on map
    setSelectedWaypoint(waypointId);
    // Center on the waypoint
    handleCenterOnWaypoint(waypointId);
  }, [setSelectedWaypoint, handleCenterOnWaypoint]);

  // Handle waypoint panel close
  const handleWaypointPanelClose = useCallback(() => {
    setShowWaypointPanel(false);
    closeEdit();
    setPendingWaypoint(null);
  }, [closeEdit]);

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

  // Handle waypoint drag start
  const handleWaypointDragStart = useCallback((waypointId: number, lat: number, lon: number) => {
    startDrag(waypointId, lat, lon);
  }, [startDrag]);

  // Handle waypoint drag (real-time updates during drag)
  const handleWaypointDrag = useCallback((_waypointId: number, lat: number, lon: number) => {
    moveDrag(lat, lon);
  }, [moveDrag]);

  // Handle waypoint drag end - this is now handled by useWaypointManager
  const handleWaypointDragEnd = useCallback(async (waypointId: number, newLat: number, newLon: number) => {
    await endDrag(waypointId, newLat, newLon);
  }, [endDrag]);

  // Handle waypoint delete from context menu
  const handleWaypointDelete = useCallback(async (waypointId: number) => {
    await deleteWaypoint(waypointId);
  }, [deleteWaypoint]);

  // Handle waypoint edit from context menu
  const handleWaypointEdit = useCallback((waypointId: number) => {
    startEdit(waypointId);
    setShowWaypointPanel(true);
  }, [startEdit]);

  // Handle waypoint navigate from context menu
  const handleWaypointNavigate = useCallback((waypointId: number) => {
    toggleActiveWaypoint(waypointId);
  }, [toggleActiveWaypoint]);

  // Handle zoom to chart layer bounds
  const handleZoomToChart = useCallback((chartId: string) => {
    const bounds = getChartLayerBounds(chartId);
    if (bounds && mapRef.current) {
      mapRef.current.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: 50, duration: 1000 }
      );
    }
  }, [getChartLayerBounds]);

  // Handle quick waypoint creation with auto-generated name
  const waypointCounter = useRef(1);
  const handleQuickWaypointCreate = useCallback(async (lat: number, lon: number) => {
    if (!isTauri()) return;

    // Start create with position, but we need to save immediately
    // For quick create, we bypass the form and save directly
    const { createWaypoint } = await import('./hooks/useTauri');
    try {
      const name = `Waypoint ${waypointCounter.current++}`;
      await createWaypoint({
        name,
        lat,
        lon,
        description: null,
        symbol: 'default',
        show_label: true,
        hidden: false,
      });
      await loadWaypoints();
      console.log(`Quick waypoint "${name}" created at ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    } catch (error) {
      console.error('Failed to create quick waypoint:', error);
    }
  }, [loadWaypoints]);

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(async () => {
    if (!isTauri()) {
      // Browser fallback using Fullscreen API
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      const fullscreen = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!fullscreen);
      setIsFullscreen(!fullscreen);
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
    }
  }, []);

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
        <div className="app__header-controls">
          <button
            className="app__fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
          <span className="app__version">v0.1.0</span>
        </div>
      </header>

      <main className="app__main">
        <MapView
          theme={theme}
          basemap={basemap}
          showOpenSeaMap={showOpenSeaMap}
          apiKeys={apiKeys}
          zoom={12}
          vessel={vessel}
          waypoints={waypointState.waypoints}
          activeWaypointId={waypointState.activeWaypointId}
          editingWaypointId={waypointState.editState.waypointId}
          editingPreview={editingPreview}
          draggingWaypoint={waypointState.dragging}
          pendingWaypoint={pendingWaypoint}
          orientationMode={orientationMode}
          chartLayers={chartLayers}
          allChartsHidden={allChartsHidden}
          showChartOutlines={showChartOutlines}
          highlightedChartId={highlightedChartId}
          onChartToggle={(chartId) => {
            toggleChartLayer(chartId);
            // Highlight the toggled chart when outlines are shown
            if (showChartOutlines) {
              setHighlightedChartId(chartId === highlightedChartId ? null : chartId);
            }
          }}
          gebcoSettings={gebcoSettings}
          gebcoStatus={gebcoStatus ?? undefined}
          cm93Settings={cm93Settings}
          cm93Status={cm93Status ?? undefined}
          onCm93FeaturesRequest={handleCm93FeaturesRequest}
          showAllLabels={waypointState.showAllLabels}
          showAllMarkers={waypointState.showAllMarkers}
          onOrientationModeChange={setOrientationMode}
          onMapReady={handleMapReady}
          onMapRightClick={handleMapRightClick}
          onWaypointClick={handleWaypointMapClick}
          onWaypointDragStart={handleWaypointDragStart}
          onWaypointDrag={handleWaypointDrag}
          onWaypointDragEnd={handleWaypointDragEnd}
          onWaypointDelete={handleWaypointDelete}
          onWaypointEdit={handleWaypointEdit}
          onWaypointNavigate={handleWaypointNavigate}
          onWaypointToggleHidden={toggleWaypointHidden}
          onQuickWaypointCreate={handleQuickWaypointCreate}
          onCursorMove={handleCursorMove}
          onCursorLeave={handleCursorLeave}
          // Route props
          routes={routeManager.state.routes}
          activeRouteId={routeManager.state.activeRouteId}
          selectedRouteId={showRoutePanel ? (routeManager.state.editState.routeId ?? routeManager.state.selectedRouteId) : null}
          routeCreationModeActive={routeManager.isCreatingOnMap}
          routeCreationWaypoints={routeManager.state.creationMode.tempWaypoints}
          onRouteCreationClick={(lat, lon) => routeManager.addCreationWaypoint(lat, lon)}
          onStartRouteCreation={(lat, lon) => {
            // Start route creation mode with a default name
            routeManager.startCreateOnMap('New Route');
            // Add the first waypoint at the clicked location
            // Use setTimeout to ensure state is updated first
            setTimeout(() => {
              routeManager.addCreationWaypoint(lat, lon);
            }, 0);
            // Open the route panel so user can see the overlay
            setShowRoutePanel(true);
          }}
          onInsertWaypointInRoute={async (routeId, lat, lon, insertAtIndex) => {
            await routeManager.insertWaypointInRoute(routeId, lat, lon, insertAtIndex);
            // Refresh waypoints list to show the new waypoint
            await loadWaypoints();
          }}
          onRemoveWaypointFromRoute={(routeId, waypointId) => {
            routeManager.removeWaypointFromRoute(routeId, waypointId);
          }}
          onExtendRoute={(routeId, fromEnd) => {
            routeManager.startExtendRoute(routeId, fromEnd);
            // Open the route panel so user can see the creation overlay
            setShowRoutePanel(true);
          }}
          onBoundsChange={handleBoundsChange}
          currentRouteWaypointIndex={currentRouteWaypointIndex}
          // Track props
          tracks={trackManager.visibleTracksWithPoints}
          recordingTrackId={trackManager.state.recording.trackId}
          // Entitlement-based restrictions
          entitlementMaxZoom={entitlementMaxZoom}
        />

        {/* Layers Button - top left, second in stack */}
        <button
          className="layers-btn"
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          title="Layers"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </button>

        {/* My Location Button - top left, first in stack */}
        <button
          className="my-location-btn"
          onClick={handleCenterOnLocation}
          disabled={!vessel.position}
          title={vessel.position ? 'Center on my location' : 'No GPS position available'}
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

        {/* Waypoints Button - top left, third in stack */}
        <button
          className="waypoints-btn"
          onClick={() => setShowWaypointPanel(!showWaypointPanel)}
          title="Waypoints"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </button>

        {/* Routes Button - top left, fourth in stack */}
        <button
          className="routes-btn"
          onClick={() => setShowRoutePanel(!showRoutePanel)}
          title="Routes"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {/* Route icon: connected path with waypoint dots */}
            <circle cx="5" cy="6" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="18" r="2" />
            <path d="M7 6.5L10 10.5" />
            <path d="M14 13.5L17 16.5" />
          </svg>
        </button>

        {/* Tracks Button - top left, fifth in stack */}
        <button
          className={`tracks-btn ${trackManager.isRecording ? 'tracks-btn--recording' : ''}`}
          onClick={() => setShowTrackPanel(!showTrackPanel)}
          title={trackManager.isRecording ? 'Tracks (Recording)' : 'Tracks'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {/* Track/trail icon: curved path with position dot */}
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            {trackManager.isRecording && (
              <circle cx="12" cy="12" r="3" fill="#ef4444" stroke="#ef4444" />
            )}
          </svg>
        </button>

        {/* Settings Button - top left, first in stack */}
        <button
          className="settings-btn"
          onClick={() => setShowGpsSettings(!showGpsSettings)}
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Chart Selection Bar - shows charts overlapping current viewport */}
        {chartLayers.length > 0 && (
          <ChartBar
            chartLayers={chartLayers}
            viewportBounds={viewportBounds}
            currentZoom={currentZoom}
            onToggleChart={(chartId) => {
              toggleChartLayer(chartId);
              // Highlight the clicked chart when outlines are shown
              if (showChartOutlines) {
                setHighlightedChartId(chartId === highlightedChartId ? null : chartId);
              }
            }}
            allChartsHidden={allChartsHidden}
            onToggleAllCharts={() => setAllChartsHidden(!allChartsHidden)}
            showChartOutlines={showChartOutlines}
            onToggleChartOutlines={() => {
              setShowChartOutlines(!showChartOutlines);
              if (showChartOutlines) {
                setHighlightedChartId(null); // Clear highlight when turning off
              }
            }}
            highlightedChartId={highlightedChartId}
            onChartHover={(chartId) => {
              // Always set highlighted chart on hover (shows outline on map)
              setHighlightedChartId(chartId);
            }}
          />
        )}
      </main>

      <footer className="app__footer">
        <StatusBar
          vessel={vessel}
          theme={theme}
          connected={connected}
          gpsStatus={gpsStatus}
          cursorPosition={cursorPosition}
          activeWaypoint={activeWaypoint}
          currentZoom={currentZoom}
          entitlementMaxZoom={entitlementMaxZoom}
          laStatus={{
            isConnected: licensingAgent.isConnected,
            isRegistered: licensingAgent.isRegistered,
            packsCount: licensingAgent.packs.filter(p => p.status === 'ready').length,
          }}
          onThemeChange={handleThemeChange}
          onGpsStatusClick={() => setShowGpsStatus(true)}
          onLaStatusClick={() => setShowDeviceRegistration(true)}
          onPacksClick={() => setShowPackManager(true)}
        />
      </footer>

      {/* Navigation Modal - shows when navigating to a waypoint */}
      {activeWaypoint && (
        <NavigationModal
          theme={theme}
          vessel={vessel}
          activeWaypoint={activeWaypoint}
          onCancel={() => waypointManager.setActiveWaypoint(null)}
        />
      )}

      {/* Route Navigation Modal - shows when navigating a route */}
      {routeManager.activeRoute && (
        <RouteNavigationModal
          theme={theme}
          vessel={vessel}
          activeRoute={routeManager.activeRoute}
          currentWaypointIndex={currentRouteWaypointIndex}
          onNextWaypoint={() => {
            const maxIndex = routeManager.activeRoute!.waypoints.length - 1;
            setCurrentRouteWaypointIndex(prev => Math.min(prev + 1, maxIndex));
          }}
          onPreviousWaypoint={() => {
            setCurrentRouteWaypointIndex(prev => Math.max(prev - 1, 0));
          }}
          onCancel={() => routeManager.setActiveRoute(null)}
        />
      )}

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
          waypointManager={waypointManager}
          vesselPosition={vessel.position}
          pendingWaypoint={pendingWaypoint}
          onPendingWaypointClear={() => setPendingWaypoint(null)}
          onCenterOnWaypoint={handleCenterOnWaypoint}
          onClose={handleWaypointPanelClose}
        />
      )}

      {showRoutePanel && (
        <RoutePanel
          theme={theme}
          routeManager={routeManager}
          waypoints={waypointState.waypoints}
          vesselPosition={vessel.position}
          onCenterOnRoute={(routeId) => {
            const route = routeManager.state.routes.find(r => r.route.id === routeId);
            if (route && route.waypoints.length > 0 && mapRef.current) {
              // Zoom to fit all waypoints in the route
              const bounds = new LngLatBounds();
              route.waypoints.forEach(wp => bounds.extend([wp.lon, wp.lat]));
              mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000 });
            }
          }}
          onStartMapCreation={(name) => {
            routeManager.startCreateOnMap(name);
          }}
          onRouteDeleted={async (waypointsDeleted) => {
            // Refresh waypoints if any were deleted with the route
            if (waypointsDeleted) {
              await loadWaypoints();
            }
          }}
          onClose={() => setShowRoutePanel(false)}
        />
      )}

      {showTrackPanel && (
        <TrackPanel
          theme={theme}
          trackManager={trackManager}
          onCenterOnTrack={(trackId) => {
            const track = trackManager.state.tracksWithPoints.find(t => t.track.id === trackId);
            if (track && track.points.length > 0 && mapRef.current) {
              // Zoom to fit all track points
              const bounds = new LngLatBounds();
              track.points.forEach(pt => bounds.extend([pt.lon, pt.lat]));
              mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000 });
            }
          }}
          onConvertToRoute={async (_routeId) => {
            // Refresh routes and waypoints after track conversion
            await routeManager.loadRoutes();
            await loadWaypoints();
            // Open route panel to show the new route
            setShowRoutePanel(true);
            setShowTrackPanel(false);
          }}
          onClose={() => setShowTrackPanel(false)}
        />
      )}

      {/* Route Creation Overlay - shows when drawing route on map */}
      {routeManager.isCreatingOnMap && (
        <RouteCreationOverlay
          theme={theme}
          routeName={routeManager.state.creationMode.routeName}
          tempWaypoints={routeManager.state.creationMode.tempWaypoints}
          rightPanelOpen={showWaypointPanel || showRoutePanel || showTrackPanel}
          onNameChange={(name) => routeManager.updateCreationName(name)}
          onUndo={() => routeManager.removeLastCreationWaypoint()}
          onCancel={() => routeManager.cancelCreationMode()}
          onFinish={async () => {
            await routeManager.finishCreationMode();
            // Refresh waypoints so the new route waypoints appear in the waypoint list
            await loadWaypoints();
          }}
        />
      )}

      {showLayerPanel && (
        <LayerSwitcher
          theme={theme}
          currentBasemap={basemap}
          showOpenSeaMap={showOpenSeaMap}
          apiKeys={apiKeys}
          chartLayers={chartLayers}
          chartLayersLoading={chartLayersLoading}
          allowedBasemaps={allowedBasemaps}
          gebcoSettings={gebcoSettings}
          gebcoStatus={gebcoStatus ?? undefined}
          nauticalSettings={nauticalSettings}
          nauticalStatus={nauticalStatus}
          onGebcoSettingsChange={handleGebcoSettingsChange}
          onNauticalSettingsChange={handleNauticalSettingsChange}
          onNauticalInitialize={handleCm93Initialize}
          onBasemapChange={handleBasemapChange}
          onOpenSeaMapToggle={setShowOpenSeaMap}
          onApiKeysChange={handleApiKeysChange}
          onAddChart={addChartFromFile}
          onRemoveChart={removeChartLayer}
          onRemoveMultipleCharts={removeMultipleChartLayers}
          onToggleChart={toggleChartLayer}
          onChartOpacity={setChartLayerOpacity}
          onZoomToChart={handleZoomToChart}
          onUpdateChartMetadata={updateChartMetadata}
          onRefreshCharts={refreshChartLayers}
          onClose={() => setShowLayerPanel(false)}
        />
      )}

      {/* Background import progress indicator */}
      {backgroundImportProgress && !showLayerPanel && (
        <ImportProgressIndicator
          progress={backgroundImportProgress}
          theme={theme}
          onExpand={() => setShowLayerPanel(true)}
          onDismiss={() => setBackgroundImportProgress(null)}
        />
      )}

      {/* Device Registration Modal */}
      {showDeviceRegistration && (
        <DeviceRegistration
          theme={theme}
          onClose={() => setShowDeviceRegistration(false)}
          onRegistered={() => {
            setShowDeviceRegistration(false);
            // Optionally show pack manager after registration
          }}
        />
      )}

      {/* Offline Pack Manager */}
      {showPackManager && (
        <PackManager
          theme={theme}
          onClose={() => setShowPackManager(false)}
        />
      )}
    </div>
  );
}

export default App;
