import { useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { MapView, StatusBar, LayerSwitcher } from './components';
import type { ThemeMode, Vessel, BasemapProvider, ApiKeys } from './types';
import './App.css';

function App() {
  // Theme and display settings
  const [theme, setTheme] = useState<ThemeMode>('day');
  const [basemap, setBasemap] = useState<BasemapProvider>('osm');
  const [showOpenSeaMap, setShowOpenSeaMap] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});

  // Vessel state
  const [vessel, setVessel] = useState<Vessel>({
    position: null,
    heading: null,
    cog: null,
    sog: null,
  });
  const [connected, setConnected] = useState(false);

  const handleThemeChange = useCallback((newTheme: ThemeMode) => {
    setTheme(newTheme);
  }, []);

  const handleBasemapChange = useCallback((newBasemap: BasemapProvider) => {
    setBasemap(newBasemap);
  }, []);

  const handleApiKeysChange = useCallback((newKeys: ApiKeys) => {
    setApiKeys(newKeys);
    // In production, persist to local storage or Tauri store
    console.log('API keys updated');
  }, []);

  const handleMapReady = useCallback((_map: maplibregl.Map) => {
    console.log('Map initialized successfully');

    // Simulate GPS connection for demo purposes
    // In production, this would connect to NMEA data via Tauri backend
    setTimeout(() => {
      setVessel({
        position: { lat: 37.8044, lon: -122.4194 },
        heading: 45,
        cog: 47,
        sog: 6.2,
      });
      setConnected(true);
    }, 2000);
  }, []);

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
          onThemeChange={handleThemeChange}
        />
      </footer>
    </div>
  );
}

export default App;
