import { useEffect, useRef, useState } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ThemeMode, Position, BasemapProvider, ApiKeys, Vessel, ChartLayer } from '../types';
import type { Waypoint } from '../hooks/useTauri';
import { registerMBTilesProtocol } from '../utils/mbtilesProtocol';

export type { LngLatBounds };

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  lat: number;
  lon: number;
}

interface WaypointContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  waypoint: Waypoint | null;
}

interface MapViewProps {
  theme: ThemeMode;
  basemap: BasemapProvider;
  showOpenSeaMap: boolean;
  apiKeys: ApiKeys;
  center?: Position;
  zoom?: number;
  vessel?: Vessel;
  waypoints?: Waypoint[];
  activeWaypointId?: number | null;
  pendingWaypoint?: { lat: number; lon: number } | null;
  orientationMode?: 'north-up' | 'heading-up';
  chartLayers?: ChartLayer[];
  onOrientationModeChange?: (mode: 'north-up' | 'heading-up') => void;
  onMapReady?: (map: maplibregl.Map) => void;
  onMapRightClick?: (lat: number, lon: number) => void;
  onWaypointClick?: (waypoint: Waypoint) => void;
  onWaypointDragEnd?: (waypoint: Waypoint, newLat: number, newLon: number) => void;
  onWaypointDrag?: (waypoint: Waypoint, lat: number, lon: number) => void;
  onWaypointDelete?: (waypoint: Waypoint) => void;
  onQuickWaypointCreate?: (lat: number, lon: number) => void;
  onCursorMove?: (lat: number, lon: number) => void;
  onCursorLeave?: () => void;
  onBoundsChange?: (bounds: LngLatBounds, zoom: number) => void;
}

// Waypoint symbol icons mapping
const WAYPOINT_SYMBOL_ICONS: Record<string, string> = {
  default: '📍',
  anchor: '⚓',
  harbor: '🏠',
  fuel: '⛽',
  danger: '⚠️',
  fishing: '🎣',
  dive: '🤿',
  beach: '🏖️',
};

// Create waypoint marker element
function createWaypointMarkerElement(
  waypoint: Waypoint,
  isActive: boolean
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = `waypoint-marker ${isActive ? 'waypoint-marker--active' : ''}`;
  container.dataset.waypointId = String(waypoint.id);

  const icon = WAYPOINT_SYMBOL_ICONS[waypoint.symbol || 'default'] || '📍';

  container.innerHTML = `
    <div class="waypoint-marker__icon">${icon}</div>
    <div class="waypoint-marker__label">${waypoint.name}</div>
  `;

  return container;
}

// Create boat marker SVG element
function createBoatMarkerElement(theme: ThemeMode): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'vessel-marker';

  // Top-down boat SVG - pointed bow at top
  container.innerHTML = `
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Boat hull - top-down view -->
      <path
        d="M16 2 L26 14 L26 32 Q26 38 16 38 Q6 38 6 32 L6 14 Z"
        fill="${theme === 'night' ? '#ff6b6b' : '#3182ce'}"
        stroke="${theme === 'night' ? '#cc5555' : '#1a365d'}"
        stroke-width="1.5"
      />
      <!-- Cabin/wheelhouse -->
      <rect
        x="10" y="16" width="12" height="10" rx="2"
        fill="${theme === 'night' ? '#cc5555' : '#2c5282'}"
      />
      <!-- Bow point indicator -->
      <path
        d="M16 4 L19 10 L13 10 Z"
        fill="${theme === 'night' ? '#ffffff' : '#ffffff'}"
        opacity="0.8"
      />
    </svg>
  `;

  return container;
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
  vessel,
  waypoints = [],
  activeWaypointId,
  pendingWaypoint,
  orientationMode = 'north-up',
  chartLayers = [],
  onOrientationModeChange,
  onMapReady,
  onMapRightClick,
  onWaypointClick,
  onWaypointDragEnd,
  onWaypointDrag,
  onWaypointDelete,
  onQuickWaypointCreate,
  onCursorMove,
  onCursorLeave,
  onBoundsChange,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vesselMarkerRef = useRef<maplibregl.Marker | null>(null);
  const waypointMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  // Track style version to re-add chart layers after style changes
  const [styleVersion, setStyleVersion] = useState(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    lat: 0,
    lon: 0,
  });

  // Waypoint context menu state (for right-click on waypoint)
  const [waypointContextMenu, setWaypointContextMenu] = useState<WaypointContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    waypoint: null,
  });

  // Track which waypoint is being dragged
  const draggingWaypointRef = useRef<Waypoint | null>(null);

  // Store callbacks in refs to avoid map reinitialization
  const onCursorMoveRef = useRef(onCursorMove);
  const onCursorLeaveRef = useRef(onCursorLeave);
  const onMapRightClickRef = useRef(onMapRightClick);
  const onWaypointDragEndRef = useRef(onWaypointDragEnd);
  const onQuickWaypointCreateRef = useRef(onQuickWaypointCreate);
  const onWaypointClickRef = useRef(onWaypointClick);
  const onWaypointDeleteRef = useRef(onWaypointDelete);
  const onWaypointDragRef = useRef(onWaypointDrag);
  const onOrientationModeChangeRef = useRef(onOrientationModeChange);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onCursorMoveRef.current = onCursorMove;
  onCursorLeaveRef.current = onCursorLeave;
  onBoundsChangeRef.current = onBoundsChange;
  onMapRightClickRef.current = onMapRightClick;
  onWaypointDragEndRef.current = onWaypointDragEnd;
  onQuickWaypointCreateRef.current = onQuickWaypointCreate;
  onWaypointClickRef.current = onWaypointClick;
  onWaypointDeleteRef.current = onWaypointDelete;
  onWaypointDragRef.current = onWaypointDrag;
  onOrientationModeChangeRef.current = onOrientationModeChange;

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
      // Enable all interaction handlers for touchpad/mouse support
      scrollZoom: true,
      boxZoom: true,
      dragRotate: true,
      dragPan: true,
      keyboard: true,
      doubleClickZoom: true,
      touchZoomRotate: true,
      touchPitch: true,
    });

    // Configure scroll zoom for better touchpad pinch-to-zoom support
    // Touchpad pinch gestures are sent as wheel events with ctrlKey
    map.scrollZoom.setWheelZoomRate(1 / 100); // Smoother zoom
    map.scrollZoom.setZoomRate(1 / 100);

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

    // Register custom mbtiles:// protocol for local tile serving
    registerMBTilesProtocol();

    map.on('load', () => {
      setMapLoaded(true);
      onMapReady?.(map);
    });

    // Add context menu (right-click) handler - show dropdown menu
    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      const point = e.point;
      setContextMenu({
        visible: true,
        x: point.x,
        y: point.y,
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
      });
    };
    map.on('contextmenu', handleContextMenu);

    // Long press handler for touch devices
    let longPressTimer: number | null = null;
    let touchStartPos: { x: number; y: number } | null = null;

    const handleTouchStart = (e: maplibregl.MapTouchEvent) => {
      if (e.originalEvent.touches.length !== 1) return;

      const touch = e.originalEvent.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };

      longPressTimer = window.setTimeout(() => {
        if (touchStartPos) {
          const rect = mapContainer.current?.getBoundingClientRect();
          if (rect) {
            setContextMenu({
              visible: true,
              x: touchStartPos.x - rect.left,
              y: touchStartPos.y - rect.top,
              lat: e.lngLat.lat,
              lon: e.lngLat.lng,
            });
          }
        }
        longPressTimer = null;
      }, 500); // 500ms long press
    };

    const handleTouchMove = (e: maplibregl.MapTouchEvent) => {
      if (longPressTimer && touchStartPos) {
        const touch = e.originalEvent.touches[0];
        const dx = touch.clientX - touchStartPos.x;
        const dy = touch.clientY - touchStartPos.y;
        // Cancel if moved more than 10px
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    };

    const handleTouchEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      touchStartPos = null;
    };

    map.on('touchstart', handleTouchStart);
    map.on('touchmove', handleTouchMove);
    map.on('touchend', handleTouchEnd);
    map.on('touchcancel', handleTouchEnd);

    // Add mouse move handler for cursor position tracking
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      onCursorMoveRef.current?.(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('mousemove', handleMouseMove);

    // Add mouse leave handler
    const handleMouseLeave = () => {
      onCursorLeaveRef.current?.();
    };
    map.on('mouseleave', handleMouseLeave);

    // Add bounds change handler (fires on moveend for both pan and zoom)
    const handleMoveEnd = () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      onBoundsChangeRef.current?.(bounds, zoom);
    };
    map.on('moveend', handleMoveEnd);

    // Emit initial bounds after map loads
    map.once('load', () => {
      handleMoveEnd();
    });

    mapRef.current = map;

    return () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      map.off('contextmenu', handleContextMenu);
      map.off('mousemove', handleMouseMove);
      map.off('mouseleave', handleMouseLeave);
      map.off('touchstart', handleTouchStart);
      map.off('touchmove', handleTouchMove);
      map.off('touchend', handleTouchEnd);
      map.off('touchcancel', handleTouchEnd);
      map.off('moveend', handleMoveEnd);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update style when basemap, theme, overlays, or API keys change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;

    // Listen for style.load to re-add chart layers after style change
    const handleStyleLoad = () => {
      // Clear tracked layer IDs since they were removed with the style change
      activeChartLayerIdsRef.current = new Set();
      // Increment style version to trigger chart layers re-add
      setStyleVersion(v => v + 1);
    };

    map.once('style.load', handleStyleLoad);
    map.setStyle(buildMapStyle(basemap, theme, showOpenSeaMap, apiKeys));

    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [basemap, theme, showOpenSeaMap, apiKeys.esri, mapLoaded]);

  // Track active chart layer IDs for cleanup
  const activeChartLayerIdsRef = useRef<Set<string>>(new Set());

  // Manage MBTiles chart layers
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;

    // Ensure style is loaded before adding layers
    if (!map.isStyleLoaded()) {
      console.debug('MapView: Style not loaded, skipping chart layer update');
      return;
    }

    // Verify basemap layer exists - if not, the style may have been corrupted
    if (!map.getLayer('basemap-layer')) {
      console.warn('MapView: Basemap layer missing! Style may need to be rebuilt.');
      return;
    }

    console.debug('MapView: Processing chart layers', {
      count: chartLayers.length,
      styleVersion,
      enabledLayers: chartLayers.filter(l => l.enabled).map(l => l.chartId)
    });

    const currentLayerIds = activeChartLayerIdsRef.current;
    const newLayerIds = new Set<string>();

    // Process each chart layer
    chartLayers.forEach((layer) => {
      const sourceId = `mbtiles-${layer.chartId}`;
      const layerId = `mbtiles-layer-${layer.chartId}`;

      // Skip charts without bounds - they can block other charts and cause rendering issues
      if (!layer.bounds) {
        console.debug(`MapView: Skipping chart ${layer.chartId} - no bounds metadata`);
        return;
      }

      if (layer.enabled) {
        newLayerIds.add(layer.chartId);

        try {
          // Add source if not exists
          if (!map.getSource(sourceId)) {
            console.debug(`MapView: Adding source ${sourceId}`, {
              tiles: `mbtiles://${layer.chartId}/{z}/{x}/{y}`,
              minZoom: layer.minZoom,
              maxZoom: layer.maxZoom,
              bounds: layer.bounds
            });
            map.addSource(sourceId, {
              type: 'raster',
              tiles: [`mbtiles://${layer.chartId}/{z}/{x}/{y}`],
              tileSize: 256,
              minzoom: layer.minZoom ?? 0,
              maxzoom: layer.maxZoom ?? 22,
              // Set bounds to limit tile requests to the chart's coverage area
              bounds: layer.bounds,
            });
          }

          // Add layer if not exists
          if (!map.getLayer(layerId)) {
            // Insert before OpenSeaMap overlay if it exists, otherwise before basemap's end
            // This ensures chart layers are ABOVE the basemap
            let beforeLayerId: string | undefined;
            if (map.getLayer('openseamap-overlay')) {
              beforeLayerId = 'openseamap-overlay';
            }
            // If no specific layer to insert before, addLayer adds to top (which is correct)

            console.debug(`MapView: Adding layer ${layerId}`, {
              beforeLayerId,
              opacity: layer.opacity
            });
            map.addLayer({
              id: layerId,
              type: 'raster',
              source: sourceId,
              paint: {
                'raster-opacity': layer.opacity,
              },
            }, beforeLayerId);
          } else {
            // Update opacity if layer already exists
            map.setPaintProperty(layerId, 'raster-opacity', layer.opacity);
          }
        } catch (err) {
          console.error(`MapView: Error adding chart layer ${layerId}:`, err);
        }
      }
    });

    // Remove layers that are no longer enabled
    currentLayerIds.forEach((chartId) => {
      if (!newLayerIds.has(chartId)) {
        const layerId = `mbtiles-layer-${chartId}`;
        const sourceId = `mbtiles-${chartId}`;

        try {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
          if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        } catch (err) {
          console.error(`MapView: Error removing chart layer ${layerId}:`, err);
        }
      }
    });

    // Update ref with current layer IDs
    activeChartLayerIdsRef.current = newLayerIds;

    // Debug: Log final layer order
    const allLayers = map.getStyle()?.layers?.map(l => l.id) || [];
    console.debug('MapView: Layer order after update:', allLayers);

    // Safety check: Ensure basemap layer is visible
    const basemapLayer = map.getLayer('basemap-layer');
    if (basemapLayer) {
      const visibility = map.getLayoutProperty('basemap-layer', 'visibility');
      if (visibility === 'none') {
        console.warn('MapView: Basemap was hidden! Making it visible again.');
        map.setLayoutProperty('basemap-layer', 'visibility', 'visible');
      }
    }
  }, [chartLayers, mapLoaded, styleVersion]);

  // Update center when it changes
  useEffect(() => {
    if (!mapRef.current || !center) return;
    mapRef.current.setCenter([center.lon, center.lat]);
  }, [center?.lat, center?.lon]);

  // Update vessel marker position and rotation
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    // Remove existing marker if vessel position is null
    if (!vessel?.position) {
      if (vesselMarkerRef.current) {
        vesselMarkerRef.current.remove();
        vesselMarkerRef.current = null;
      }
      return;
    }

    // Create marker if it doesn't exist
    if (!vesselMarkerRef.current) {
      const el = createBoatMarkerElement(theme);
      vesselMarkerRef.current = new maplibregl.Marker({
        element: el,
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      })
        .setLngLat([vessel.position.lon, vessel.position.lat])
        .addTo(mapRef.current);
    } else {
      // Update existing marker position
      vesselMarkerRef.current.setLngLat([vessel.position.lon, vessel.position.lat]);
    }

    // Update rotation based on heading or COG
    const rotation = vessel.heading ?? vessel.cog ?? 0;
    vesselMarkerRef.current.setRotation(rotation);
  }, [vessel?.position?.lat, vessel?.position?.lon, vessel?.heading, vessel?.cog, mapLoaded, theme]);

  // Update marker style when theme changes
  useEffect(() => {
    if (!vesselMarkerRef.current || !vessel?.position) return;

    // Recreate marker with new theme colors
    const oldMarker = vesselMarkerRef.current;
    const lngLat = oldMarker.getLngLat();
    const rotation = oldMarker.getRotation();

    oldMarker.remove();

    const el = createBoatMarkerElement(theme);
    vesselMarkerRef.current = new maplibregl.Marker({
      element: el,
      rotationAlignment: 'map',
      pitchAlignment: 'map',
    })
      .setLngLat(lngLat)
      .setRotation(rotation)
      .addTo(mapRef.current!);
  }, [theme]);

  // Rotate map in heading-up mode based on vessel heading/COG
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    if (orientationMode === 'heading-up') {
      // Use heading if available, otherwise COG
      const heading = vessel?.heading ?? vessel?.cog;
      if (heading !== null && heading !== undefined) {
        // In heading-up mode, rotate map so vessel heading points up
        // MapLibre bearing is clockwise from north, so we negate the heading
        mapRef.current.setBearing(-heading);
      }
    } else {
      // North-up mode: reset bearing to 0
      mapRef.current.setBearing(0);
    }
  }, [orientationMode, vessel?.heading, vessel?.cog, mapLoaded]);

  // Manage waypoint markers
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const currentMarkers = waypointMarkersRef.current;
    const waypointIds = new Set(waypoints.map((w) => w.id).filter((id): id is number => id !== null));

    // Remove markers for waypoints that no longer exist
    currentMarkers.forEach((marker, id) => {
      if (!waypointIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });

    // Add or update markers for each waypoint
    waypoints.forEach((waypoint) => {
      if (waypoint.id === null) return;

      const isActive = waypoint.id === activeWaypointId;
      const existingMarker = currentMarkers.get(waypoint.id);

      if (existingMarker) {
        // Update position if needed
        existingMarker.setLngLat([waypoint.lon, waypoint.lat]);

        // Update active state by recreating element
        const el = existingMarker.getElement();
        if (isActive && !el.classList.contains('waypoint-marker--active')) {
          el.classList.add('waypoint-marker--active');
        } else if (!isActive && el.classList.contains('waypoint-marker--active')) {
          el.classList.remove('waypoint-marker--active');
        }
      } else {
        // Create new marker with drag support
        const el = createWaypointMarkerElement(waypoint, isActive);

        // Drag state
        let isDragging = false;
        let dragTimeout: number | null = null;
        let startPos: { x: number; y: number } | null = null;

        // Start drag after hold
        const startDragMode = () => {
          isDragging = true;
          draggingWaypointRef.current = waypoint;
          el.classList.add('waypoint-marker--dragging');
          el.style.cursor = 'grabbing';
        };

        // Mouse events for drag
        const handleMouseDown = (e: MouseEvent) => {
          if (e.button !== 0) return; // Only left click
          e.stopPropagation();
          startPos = { x: e.clientX, y: e.clientY };

          // Start drag after 300ms hold
          dragTimeout = window.setTimeout(() => {
            startDragMode();
          }, 300);

          const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!startPos) return;

            const dx = moveEvent.clientX - startPos.x;
            const dy = moveEvent.clientY - startPos.y;

            // Cancel drag timeout if moved before hold time
            if (dragTimeout && Math.sqrt(dx * dx + dy * dy) > 5) {
              clearTimeout(dragTimeout);
              dragTimeout = null;
            }

            if (isDragging && mapRef.current) {
              // Update marker position during drag
              const rect = mapContainer.current?.getBoundingClientRect();
              if (rect) {
                const point = new maplibregl.Point(
                  moveEvent.clientX - rect.left,
                  moveEvent.clientY - rect.top
                );
                const lngLat = mapRef.current.unproject(point);
                marker.setLngLat(lngLat);
                // Report current drag position for real-time updates
                onWaypointDragRef.current?.(waypoint, lngLat.lat, lngLat.lng);
              }
            }
          };

          const handleMouseUp = (upEvent: MouseEvent) => {
            if (dragTimeout) {
              clearTimeout(dragTimeout);
              dragTimeout = null;
            }

            if (isDragging && mapRef.current) {
              // Finish drag - update waypoint position
              const lngLat = marker.getLngLat();
              el.classList.remove('waypoint-marker--dragging');
              el.style.cursor = '';
              isDragging = false;
              draggingWaypointRef.current = null;

              onWaypointDragEndRef.current?.(waypoint, lngLat.lat, lngLat.lng);
            } else if (startPos) {
              // It was a click, not a drag
              const dx = upEvent.clientX - startPos.x;
              const dy = upEvent.clientY - startPos.y;
              if (Math.sqrt(dx * dx + dy * dy) < 5) {
                onWaypointClickRef.current?.(waypoint);
              }
            }

            startPos = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        };

        // Touch events for drag and context menu
        let contextMenuTimeout: number | null = null;
        const handleTouchStart = (e: TouchEvent) => {
          if (e.touches.length !== 1) return;
          e.stopPropagation();

          const touch = e.touches[0];
          startPos = { x: touch.clientX, y: touch.clientY };

          // Show context menu after 500ms hold (before drag starts)
          contextMenuTimeout = window.setTimeout(() => {
            const rect = mapContainer.current?.getBoundingClientRect();
            if (rect && startPos) {
              // Vibrate on mobile if supported
              if (navigator.vibrate) navigator.vibrate(50);
              setWaypointContextMenu({
                visible: true,
                x: startPos.x - rect.left,
                y: startPos.y - rect.top,
                waypoint,
              });
            }
            contextMenuTimeout = null;
          }, 500);

          const handleTouchMove = (moveEvent: TouchEvent) => {
            if (!startPos || moveEvent.touches.length !== 1) return;

            const touch = moveEvent.touches[0];
            const dx = touch.clientX - startPos.x;
            const dy = touch.clientY - startPos.y;

            // Cancel context menu timeout if moved before hold time
            if (contextMenuTimeout && Math.sqrt(dx * dx + dy * dy) > 10) {
              clearTimeout(contextMenuTimeout);
              contextMenuTimeout = null;
            }

            if (isDragging && mapRef.current) {
              moveEvent.preventDefault(); // Prevent scroll during drag
              const rect = mapContainer.current?.getBoundingClientRect();
              if (rect) {
                const point = new maplibregl.Point(
                  touch.clientX - rect.left,
                  touch.clientY - rect.top
                );
                const lngLat = mapRef.current.unproject(point);
                marker.setLngLat(lngLat);
                // Report current drag position for real-time updates
                onWaypointDragRef.current?.(waypoint, lngLat.lat, lngLat.lng);
              }
            }
          };

          const handleTouchEnd = () => {
            if (contextMenuTimeout) {
              clearTimeout(contextMenuTimeout);
              contextMenuTimeout = null;
            }

            if (isDragging && mapRef.current) {
              const lngLat = marker.getLngLat();
              el.classList.remove('waypoint-marker--dragging');
              el.style.cursor = '';
              isDragging = false;
              draggingWaypointRef.current = null;

              onWaypointDragEndRef.current?.(waypoint, lngLat.lat, lngLat.lng);
            } else if (startPos) {
              // It was a tap, not a drag (only if context menu wasn't shown)
              if (!waypointContextMenu.visible) {
                onWaypointClickRef.current?.(waypoint);
              }
            }

            startPos = null;
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
            el.removeEventListener('touchcancel', handleTouchEnd);
          };

          el.addEventListener('touchmove', handleTouchMove, { passive: false });
          el.addEventListener('touchend', handleTouchEnd);
          el.addEventListener('touchcancel', handleTouchEnd);
        };

        el.addEventListener('mousedown', handleMouseDown);
        el.addEventListener('touchstart', handleTouchStart, { passive: false });

        // Prevent default click since we handle it in mouseup
        el.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        // Right-click context menu for waypoint
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = mapContainer.current?.getBoundingClientRect();
          if (rect) {
            setWaypointContextMenu({
              visible: true,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              waypoint,
            });
          }
        });

        const marker = new maplibregl.Marker({
          element: el,
          anchor: 'bottom',
        })
          .setLngLat([waypoint.lon, waypoint.lat])
          .addTo(mapRef.current!);

        currentMarkers.set(waypoint.id, marker);
      }
    });
  }, [waypoints, activeWaypointId, mapLoaded, theme]);

  // Draw navigation line from vessel to active waypoint
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const sourceId = 'nav-line-source';
    const layerId = 'nav-line-layer';

    // Remove existing layer and source
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    // Only draw line if we have vessel position and active waypoint
    if (!vessel?.position || !activeWaypointId) return;

    const activeWaypoint = waypoints.find((w) => w.id === activeWaypointId);
    if (!activeWaypoint) return;

    // Add source with line coordinates
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [vessel.position.lon, vessel.position.lat],
            [activeWaypoint.lon, activeWaypoint.lat],
          ],
        },
      },
    });

    // Add line layer
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': theme === 'night' ? '#ff6b6b' : '#e53e3e',
        'line-width': 2,
        'line-dasharray': [4, 4],
      },
    });
  }, [vessel?.position, activeWaypointId, waypoints, mapLoaded, theme]);

  // Manage pending waypoint marker (shown immediately on right-click)
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    // Remove existing pending marker if no pending waypoint
    if (!pendingWaypoint) {
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.remove();
        pendingMarkerRef.current = null;
      }
      return;
    }

    // Create pending marker element
    const createPendingMarkerElement = (): HTMLDivElement => {
      const container = document.createElement('div');
      container.className = 'waypoint-marker waypoint-marker--pending';
      container.innerHTML = `
        <div class="waypoint-marker__icon">📍</div>
        <div class="waypoint-marker__label">New waypoint</div>
      `;
      return container;
    };

    // Create or update pending marker
    if (!pendingMarkerRef.current) {
      const el = createPendingMarkerElement();
      pendingMarkerRef.current = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
      })
        .setLngLat([pendingWaypoint.lon, pendingWaypoint.lat])
        .addTo(mapRef.current);
    } else {
      pendingMarkerRef.current.setLngLat([pendingWaypoint.lon, pendingWaypoint.lat]);
    }
  }, [pendingWaypoint, mapLoaded]);

  // Close context menus when clicking elsewhere
  const handleCloseContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    setWaypointContextMenu((prev) => ({ ...prev, visible: false }));
  };

  // Close waypoint context menu
  const handleCloseWaypointContextMenu = () => {
    setWaypointContextMenu((prev) => ({ ...prev, visible: false }));
  };

  // Handle waypoint delete from context menu
  const handleWaypointDelete = () => {
    if (waypointContextMenu.waypoint) {
      onWaypointDeleteRef.current?.(waypointContextMenu.waypoint);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle navigate to waypoint from context menu
  const handleWaypointNavigate = () => {
    if (waypointContextMenu.waypoint) {
      onWaypointClickRef.current?.(waypointContextMenu.waypoint);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle quick waypoint creation
  const handleQuickWaypointCreate = () => {
    onQuickWaypointCreateRef.current?.(contextMenu.lat, contextMenu.lon);
    handleCloseContextMenu();
  };

  // Handle "Add waypoint with details" option
  const handleAddWaypointWithDetails = () => {
    onMapRightClickRef.current?.(contextMenu.lat, contextMenu.lon);
    handleCloseContextMenu();
  };

  // Toggle orientation mode
  const handleOrientationToggle = () => {
    const newMode = orientationMode === 'north-up' ? 'heading-up' : 'north-up';
    onOrientationModeChangeRef.current?.(newMode);
  };

  return (
    <div
      ref={mapContainer}
      className="map-container"
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onClick={handleCloseContextMenu}
    >
      {/* Orientation Mode Toggle Button */}
      <button
        className={`orientation-toggle orientation-toggle--${orientationMode}`}
        onClick={handleOrientationToggle}
        title={orientationMode === 'north-up' ? 'Switch to Heading Up' : 'Switch to North Up'}
      >
        {orientationMode === 'north-up' ? (
          // North Up icon - compass pointing north
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polygon points="12,2 14,10 12,8 10,10" fill="currentColor" stroke="none" />
            <text x="12" y="17" textAnchor="middle" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold">N</text>
          </svg>
        ) : (
          // Heading Up icon - boat/arrow pointing up
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6 L16 14 L12 12 L8 14 Z" fill="currentColor" stroke="none" />
            <text x="12" y="20" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none" fontWeight="bold">HDG</text>
          </svg>
        )}
      </button>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className={`map-context-menu map-context-menu--${theme}`}
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="map-context-menu__item"
            onClick={handleQuickWaypointCreate}
          >
            <span className="map-context-menu__icon">📍</span>
            <span>New Waypoint</span>
          </button>
          <button
            className="map-context-menu__item"
            onClick={handleAddWaypointWithDetails}
          >
            <span className="map-context-menu__icon">✏️</span>
            <span>Add with details...</span>
          </button>
        </div>
      )}

      {/* Waypoint Context Menu */}
      {waypointContextMenu.visible && waypointContextMenu.waypoint && (
        <div
          className={`map-context-menu map-context-menu--${theme}`}
          style={{
            position: 'absolute',
            left: waypointContextMenu.x,
            top: waypointContextMenu.y,
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="map-context-menu__header">
            {waypointContextMenu.waypoint.name}
          </div>
          <button
            className="map-context-menu__item"
            onClick={handleWaypointNavigate}
          >
            <span className="map-context-menu__icon">🧭</span>
            <span>Navigate to</span>
          </button>
          <button
            className="map-context-menu__item map-context-menu__item--danger"
            onClick={handleWaypointDelete}
          >
            <span className="map-context-menu__icon">🗑️</span>
            <span>Delete waypoint</span>
          </button>
        </div>
      )}
    </div>
  );
}
