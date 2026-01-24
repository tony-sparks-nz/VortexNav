import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ThemeMode, Position, BasemapProvider, ApiKeys } from '../types';

interface MapViewProps {
  theme: ThemeMode;
  basemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
  center?: Position;
  zoom?: number;
  onMapReady?: (map: maplibregl.Map) => void;
}

// Google tile servers (mt0-mt3 for load balancing)
const GOOGLE_TILE_SERVERS = ['mt0', 'mt1', 'mt2', 'mt3'];

function getGoogleTileUrls(layerType: 's' | 'y'): string[] {
  // lyrs=s is satellite only, lyrs=y is satellite with labels (hybrid)
  return GOOGLE_TILE_SERVERS.map(
    server => `https://${server}.google.com/vt/lyrs=${layerType}&x={x}&y={y}&z={z}`
  );
}

// Build the map style based on selected basemap and overlays
function buildMapStyle(
  basemap: BasemapProvider,
  theme: ThemeMode,
  showOpenSeaMap: boolean,
  apiKeys: ApiKeys
): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification['sources'] = {};
  const layers: maplibregl.LayerSpecification[] = [];

  // Add basemap source and layer based on provider
  switch (basemap) {
    case 'osm':
      sources['basemap'] = {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      };
      break;

    case 'opentopomap':
      sources['basemap'] = {
        type: 'raster',
        tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      };
      break;

    case 'google-satellite-free':
      sources['basemap'] = {
        type: 'raster',
        tiles: getGoogleTileUrls('s'),
        tileSize: 256,
        maxzoom: 20,
        attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
      };
      break;

    case 'google-hybrid-free':
      sources['basemap'] = {
        type: 'raster',
        tiles: getGoogleTileUrls('y'),
        tileSize: 256,
        maxzoom: 20,
        attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
      };
      break;

    case 'esri-satellite':
      if (apiKeys.esri) {
        sources['basemap'] = {
          type: 'raster',
          tiles: [
            `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${apiKeys.esri}`
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Powered by <a href="https://www.esri.com">Esri</a> | Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community',
        };
      } else {
        // Fallback to Google satellite if no API key
        sources['basemap'] = {
          type: 'raster',
          tiles: getGoogleTileUrls('s'),
          tileSize: 256,
          maxzoom: 20,
          attribution: '&copy; Google (Esri API key required for Esri imagery)',
        };
      }
      break;

    case 'esri-ocean':
      if (apiKeys.esri) {
        sources['basemap'] = {
          type: 'raster',
          tiles: [
            `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}?token=${apiKeys.esri}`
          ],
          tileSize: 256,
          maxzoom: 16,
          attribution: 'Powered by <a href="https://www.esri.com">Esri</a> | Esri, GEBCO, NOAA, National Geographic, Garmin, HERE, Geonames.org, and other contributors',
        };
      } else {
        // Fallback to OSM if no API key
        sources['basemap'] = {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap (Esri API key required for ocean basemap)',
        };
      }
      break;
  }

  // Add basemap layer
  layers.push({
    id: 'basemap-layer',
    type: 'raster',
    source: 'basemap',
    minzoom: 0,
    maxzoom: 22,
  });

  // Add OpenSeaMap overlay if enabled
  if (showOpenSeaMap) {
    sources['openseamap'] = {
      type: 'raster',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="http://www.openseamap.org">OpenSeaMap</a> contributors',
    };

    layers.push({
      id: 'openseamap-overlay',
      type: 'raster',
      source: 'openseamap',
      minzoom: 9,
      maxzoom: 18,
      paint: {
        'raster-opacity': theme === 'night' ? 0.7 : 1,
      },
    });
  }

  return {
    version: 8,
    name: `vortexnav-${basemap}-${theme}`,
    sources,
    layers,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  };
}

export function MapView({
  theme,
  basemap,
  showOpenSeaMap,
  apiKeys,
  center,
  zoom = 10,
  onMapReady,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: buildMapStyle(basemap, theme, showOpenSeaMap, apiKeys),
      center: center ? [center.lon, center.lat] : [-122.4, 37.8], // Default to San Francisco Bay
      zoom: zoom,
      attributionControl: {},
      maxZoom: 20,
      minZoom: 2,
    });

    // Add navigation controls
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true,
      }),
      'top-right'
    );

    // Add scale control (nautical miles for marine nav)
    map.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 200,
        unit: 'nautical',
      }),
      'bottom-left'
    );

    map.on('load', () => {
      setMapLoaded(true);
      onMapReady?.(map);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update style when basemap, theme, overlays, or API keys change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    mapRef.current.setStyle(buildMapStyle(basemap, theme, showOpenSeaMap, apiKeys));
  }, [basemap, theme, showOpenSeaMap, apiKeys.esri, mapLoaded]);

  // Update center when it changes
  useEffect(() => {
    if (!mapRef.current || !center) return;
    mapRef.current.setCenter([center.lon, center.lat]);
  }, [center?.lat, center?.lon]);

  return (
    <div
      ref={mapContainer}
      className="map-container"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
