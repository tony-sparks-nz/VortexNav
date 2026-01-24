import { useState, useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { MapView, StatusBar, LayerSwitcher, GpsSettings } from './components';
import type { ThemeMode, Vessel, BasemapProvider, ApiKeys } from './types';
import {
  getSettings,
  saveSettings,
  toBackendSettings,
  fromBackendSettings,
  getGpsData,
  getGpsStatus,
  startGps,
  isTauri,
  type GpsSourceStatus,
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
  const [gpsStatus, setGpsStatus] = useState<GpsSourceStatus | null>(null);

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
          onMapReady={handleMapReady}
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
      </main>

      <footer className="app__footer">
        <StatusBar
          vessel={vessel}
          theme={theme}
          connected={connected}
          gpsStatus={gpsStatus}
          onThemeChange={handleThemeChange}
          onGpsSettingsClick={() => setShowGpsSettings(true)}
        />
      </footer>

      {showGpsSettings && (
        <GpsSettings theme={theme} onClose={handleGpsSettingsClose} />
      )}
    </div>
  );
}

export default App;
