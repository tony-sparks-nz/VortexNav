import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ThemeMode, Position, BasemapProvider, ApiKeys, Vessel, ChartLayer, WaypointDraggingState, GebcoSettings, GebcoStatus, Cm93Status, Cm93Settings, GeoJsonTile, RouteWithWaypoints, TempWaypoint, TrackWithPoints } from '../types';
import {
  calculateBearing,
  calculateDistance,
  formatBearing,
  formatDistance,
  type Waypoint,
} from '../hooks/useTauri';
import { registerMBTilesProtocol } from '../utils/mbtilesProtocol';

export type { LngLatBounds };

/**
 * Convert tile coordinates to Bing Maps quadkey format
 * Bing uses a quadkey system where each zoom level adds a digit (0-3)
 */
function tileToQuadkey(x: number, y: number, z: number): string {
  let quadkey = '';
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    quadkey += digit.toString();
  }
  return quadkey;
}

// Track if Bing protocol is registered
let bingProtocolRegistered = false;

/**
 * Register custom protocol for Bing satellite tiles
 * Converts bing://{z}/{x}/{y} to actual Bing quadkey URLs
 */
function registerBingProtocol() {
  if (bingProtocolRegistered) return;

  maplibregl.addProtocol('bing', async (params) => {
    // Parse z/x/y from URL: bing://{z}/{x}/{y}
    const match = params.url.match(/bing:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) {
      throw new Error('Invalid Bing tile URL');
    }

    const z = parseInt(match[1], 10);
    const x = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);
    const quadkey = tileToQuadkey(x, y, z);
    const subdomain = ['t0', 't1', 't2', 't3'][(x + y) % 4];
    const url = `https://ecn.${subdomain}.tiles.virtualearth.net/tiles/a${quadkey}.jpeg?g=14237`;

    // Fetch the tile
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.arrayBuffer();
    return { data };
  });

  bingProtocolRegistered = true;
}

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
  waypointId: number | null;
}

interface RouteContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  routeId: number | null;
  lat: number;
  lon: number;
  // Index where to insert waypoint (between waypoint at index-1 and index)
  insertAtIndex: number;
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
  editingWaypointId?: number | null;
  showAllLabels?: boolean;
  showAllMarkers?: boolean;
  editingPreview?: { id: number; name: string; symbol: string; description: string } | null;
  draggingWaypoint?: WaypointDraggingState | null;
  pendingWaypoint?: { lat: number; lon: number } | null;
  orientationMode?: 'north-up' | 'heading-up';
  chartLayers?: ChartLayer[];
  allChartsHidden?: boolean;  // Global toggle to hide all chart layers
  showChartOutlines?: boolean;  // Show chart boundary outlines on map
  highlightedChartId?: string | null;  // Chart to highlight (for outline mode)
  onChartToggle?: (chartId: string) => void;  // Toggle chart visibility from map button
  // GEBCO bathymetry
  gebcoSettings?: GebcoSettings;
  gebcoStatus?: GebcoStatus;
  // Nautical chart (internal CM93 format)
  cm93Settings?: Cm93Settings;
  cm93Status?: Cm93Status;
  onCm93FeaturesRequest?: (minLat: number, minLon: number, maxLat: number, maxLon: number, zoom: number) => Promise<GeoJsonTile | null>;
  onOrientationModeChange?: (mode: 'north-up' | 'heading-up') => void;
  onMapReady?: (map: maplibregl.Map) => void;
  onMapRightClick?: (lat: number, lon: number) => void;
  onWaypointClick?: (waypointId: number) => void;
  onWaypointDragStart?: (waypointId: number, lat: number, lon: number) => void;
  onWaypointDrag?: (waypointId: number, lat: number, lon: number) => void;
  onWaypointDragEnd?: (waypointId: number, newLat: number, newLon: number) => void;
  onWaypointDelete?: (waypointId: number) => void;
  onWaypointEdit?: (waypointId: number) => void;
  onWaypointNavigate?: (waypointId: number) => void;
  onWaypointToggleHidden?: (waypointId: number) => void;
  onQuickWaypointCreate?: (lat: number, lon: number) => void;
  onStartRouteCreation?: (lat: number, lon: number) => void;
  onCursorMove?: (lat: number, lon: number) => void;
  onCursorLeave?: () => void;
  onBoundsChange?: (bounds: LngLatBounds, zoom: number) => void;
  // Route display
  routes?: RouteWithWaypoints[];
  activeRouteId?: number | null;
  selectedRouteId?: number | null;  // Route being viewed/edited in panel
  // Route creation mode
  routeCreationModeActive?: boolean;
  routeCreationWaypoints?: TempWaypoint[];
  onRouteCreationClick?: (lat: number, lon: number) => void;
  onRouteClick?: (routeId: number) => void;
  // Route editing callbacks
  onInsertWaypointInRoute?: (routeId: number, lat: number, lon: number, insertAtIndex: number) => void;
  onRemoveWaypointFromRoute?: (routeId: number, waypointId: number) => void;
  onExtendRoute?: (routeId: number, fromEnd: 'start' | 'end') => void;
  // Current waypoint index for active route navigation
  currentRouteWaypointIndex?: number;
  // Track display
  tracks?: TrackWithPoints[];
  recordingTrackId?: number | null;
  // Entitlement-based zoom limit
  entitlementMaxZoom?: number | null;
  // Download area drawing mode
  downloadAreaModeActive?: boolean;  // Show polygon visual (drawing or configuring)
  downloadAreaDrawingActive?: boolean;  // Enable click handlers (drawing only)
  downloadAreaPoints?: { lat: number; lon: number }[];
  onDownloadAreaClick?: (lat: number, lon: number) => void;
  onDownloadAreaDoubleClick?: () => void;
  // Offline pack tile display
  activeDownloadedPackId?: string | null;
  offlinePacks?: { id: string; bounds?: { min_lon: number; min_lat: number; max_lon: number; max_lat: number }; zoom_levels?: number[] }[];
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

// Extract short display name for waypoint markers
// "Reef Route - WP1" -> "WP1", "Anchorage" -> "Anchorage"
function getShortDisplayName(name: string): string {
  // Check for route waypoint pattern: "Route Name - WP1"
  const wpMatch = name.match(/ - (WP\d+)$/i);
  if (wpMatch) {
    return wpMatch[1];
  }
  // For regular waypoints, truncate if too long
  return name.length > 12 ? name.substring(0, 10) + '...' : name;
}

// Generate a hash of waypoint data that affects marker appearance
// When this hash changes, the marker needs to be recreated
function getWaypointHash(wp: Waypoint, showAllLabels: boolean, showAllMarkers: boolean, isActive: boolean): string {
  // Include visibility factors in hash so marker is recreated when visibility changes
  const isVisible = (showAllMarkers || isActive) && (!wp.hidden || isActive);
  return `${wp.id}-${wp.name}-${wp.symbol || 'default'}-${wp.description || ''}-${wp.show_label}-${showAllLabels}-${wp.hidden}-${showAllMarkers}-${isVisible}`;
}

// Create waypoint marker element
function createWaypointMarkerElement(
  waypoint: Waypoint,
  isActive: boolean,
  showLabel: boolean
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = `waypoint-marker ${isActive ? 'waypoint-marker--active' : ''}`;
  container.dataset.waypointId = String(waypoint.id);

  const icon = WAYPOINT_SYMBOL_ICONS[waypoint.symbol || 'default'] || '📍';

  // Set tooltip with full name (and description if available)
  const tooltip = waypoint.description
    ? `${waypoint.name}\n${waypoint.description}`
    : waypoint.name;
  container.title = tooltip;

  // Use short display name for label (e.g., "WP1" instead of "Reef Route - WP1")
  const displayName = getShortDisplayName(waypoint.name);

  // Only show label if both global toggle is on AND waypoint's individual show_label is true
  const labelHtml = showLabel
    ? `<div class="waypoint-marker__label">${displayName}</div>`
    : '';

  container.innerHTML = `
    <div class="waypoint-marker__icon">${icon}</div>
    ${labelHtml}
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
    case 'none':
      // No basemap - useful for seeing only chart layers
      break;

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

    case 'sentinel-2':
      sources['basemap'] = {
        type: 'raster',
        tiles: [
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution: '&copy; <a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX - Contains modified Copernicus Sentinel data 2021',
      };
      break;

    case 'bing-satellite':
      // Bing uses quadkey format - custom protocol handles conversion
      registerBingProtocol();
      sources['basemap'] = {
        type: 'raster',
        tiles: [
          'bing://{z}/{x}/{y}'
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; Microsoft Bing Maps',
      };
      break;

    case 'mapbox-satellite':
      if (apiKeys.mapbox) {
        sources['basemap'] = {
          type: 'raster',
          tiles: [
            `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${apiKeys.mapbox}`
          ],
          tileSize: 512,
          maxzoom: 22,
          attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a>',
        };
      } else {
        // Fallback to OSM if no API key
        sources['basemap'] = {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; OpenStreetMap (Mapbox API key required for satellite)',
        };
      }
      break;

    case 'here-satellite':
      if (apiKeys.here) {
        sources['basemap'] = {
          type: 'raster',
          tiles: [
            `https://1.aerial.maps.ls.hereapi.com/maptile/2.1/maptile/newest/satellite.day/{z}/{x}/{y}/256/jpg?apiKey=${apiKeys.here}`,
            `https://2.aerial.maps.ls.hereapi.com/maptile/2.1/maptile/newest/satellite.day/{z}/{x}/{y}/256/jpg?apiKey=${apiKeys.here}`,
            `https://3.aerial.maps.ls.hereapi.com/maptile/2.1/maptile/newest/satellite.day/{z}/{x}/{y}/256/jpg?apiKey=${apiKeys.here}`,
            `https://4.aerial.maps.ls.hereapi.com/maptile/2.1/maptile/newest/satellite.day/{z}/{x}/{y}/256/jpg?apiKey=${apiKeys.here}`,
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution: '&copy; HERE',
        };
      } else {
        // Fallback to OSM if no API key
        sources['basemap'] = {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; OpenStreetMap (HERE API key required for satellite)',
        };
      }
      break;
  }

  // Add basemap layer (only if not 'none')
  if (basemap !== 'none') {
    layers.push({
      id: 'basemap-layer',
      type: 'raster',
      source: 'basemap',
      minzoom: 0,
      maxzoom: 22,
    });
  }

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
  editingWaypointId: _editingWaypointId,
  editingPreview,
  draggingWaypoint: _draggingWaypoint,
  pendingWaypoint,
  orientationMode = 'north-up',
  chartLayers = [],
  allChartsHidden = false,
  showChartOutlines = false,
  highlightedChartId = null,
  onChartToggle,
  gebcoSettings,
  gebcoStatus,
  cm93Settings,
  cm93Status,
  onCm93FeaturesRequest,
  showAllLabels = true,
  showAllMarkers = true,
  onOrientationModeChange,
  onMapReady,
  onMapRightClick,
  onWaypointClick,
  onWaypointDragStart,
  onWaypointDrag,
  onWaypointDragEnd,
  onWaypointDelete,
  onWaypointEdit,
  onWaypointNavigate,
  onWaypointToggleHidden,
  onQuickWaypointCreate,
  onStartRouteCreation,
  onCursorMove,
  onCursorLeave,
  onBoundsChange,
  // Route props
  routes = [],
  activeRouteId,
  selectedRouteId,
  routeCreationModeActive = false,
  routeCreationWaypoints = [],
  onRouteCreationClick,
  onRouteClick: _onRouteClick,
  onInsertWaypointInRoute,
  onRemoveWaypointFromRoute,
  onExtendRoute,
  currentRouteWaypointIndex = 0,
  // Track props
  tracks = [],
  recordingTrackId,
  // Entitlement-based zoom limit
  entitlementMaxZoom,
  // Download area drawing mode
  downloadAreaModeActive = false,
  downloadAreaDrawingActive = false,
  downloadAreaPoints = [],
  onDownloadAreaClick,
  onDownloadAreaDoubleClick,
  // Offline pack tile display
  activeDownloadedPackId,
  offlinePacks = [],
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vesselMarkerRef = useRef<maplibregl.Marker | null>(null);
  const waypointMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [is3DMode, setIs3DMode] = useState(false);
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
    waypointId: null,
  });

  // Route context menu state (for right-click on route line)
  const [routeContextMenu, setRouteContextMenu] = useState<RouteContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    routeId: null,
    lat: 0,
    lon: 0,
    insertAtIndex: 0,
  });

  // Track waypoint being dragged for real-time route updates
  const [draggingWaypointState, setDraggingWaypointState] = useState<{
    id: number;
    lat: number;
    lon: number;
  } | null>(null);

  // Track marker hashes to detect when data changes and marker needs recreation
  const markerHashesRef = useRef<Map<number, string>>(new Map());

  // Store callbacks in refs to avoid stale closures and map reinitialization
  const onCursorMoveRef = useRef(onCursorMove);
  const onCursorLeaveRef = useRef(onCursorLeave);
  const onMapRightClickRef = useRef(onMapRightClick);
  const onWaypointDragStartRef = useRef(onWaypointDragStart);
  const onWaypointDragRef = useRef(onWaypointDrag);
  const onWaypointDragEndRef = useRef(onWaypointDragEnd);
  const onQuickWaypointCreateRef = useRef(onQuickWaypointCreate);
  const onStartRouteCreationRef = useRef(onStartRouteCreation);
  const onWaypointClickRef = useRef(onWaypointClick);
  const onWaypointDeleteRef = useRef(onWaypointDelete);
  const onWaypointEditRef = useRef(onWaypointEdit);
  const onWaypointNavigateRef = useRef(onWaypointNavigate);
  const onOrientationModeChangeRef = useRef(onOrientationModeChange);
  const onBoundsChangeRef = useRef(onBoundsChange);

  // Update refs on every render
  onCursorMoveRef.current = onCursorMove;
  onCursorLeaveRef.current = onCursorLeave;
  onBoundsChangeRef.current = onBoundsChange;
  onMapRightClickRef.current = onMapRightClick;
  onWaypointDragStartRef.current = onWaypointDragStart;
  onWaypointDragRef.current = onWaypointDrag;
  onWaypointDragEndRef.current = onWaypointDragEnd;
  onQuickWaypointCreateRef.current = onQuickWaypointCreate;
  onStartRouteCreationRef.current = onStartRouteCreation;
  onWaypointClickRef.current = onWaypointClick;
  onWaypointDeleteRef.current = onWaypointDelete;
  onWaypointEditRef.current = onWaypointEdit;
  onWaypointNavigateRef.current = onWaypointNavigate;
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

  // Enforce entitlement-based max zoom level
  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;
    const effectiveMaxZoom = entitlementMaxZoom ?? 20; // Default to 20 if no restriction

    // Update map's max zoom
    map.setMaxZoom(effectiveMaxZoom);

    // If current zoom exceeds the new limit, zoom out to the limit
    const currentZoom = map.getZoom();
    if (currentZoom > effectiveMaxZoom) {
      map.easeTo({
        zoom: effectiveMaxZoom,
        duration: 300,
      });
    }

    console.info(`[MapView] Max zoom set to ${effectiveMaxZoom} (entitlement-based)`);
  }, [entitlementMaxZoom]);

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

    // Verify basemap layer exists - if not, and basemap isn't 'none', the style may have been corrupted
    if (basemap !== 'none' && !map.getLayer('basemap-layer')) {
      console.warn('MapView: Basemap layer missing! Style may need to be rebuilt.');
      return;
    }

    const enabledCharts = chartLayers.filter(l => l.enabled);
    console.info('MapView: Processing chart layers', {
      count: chartLayers.length,
      styleVersion,
      enabledCount: enabledCharts.length,
      enabledLayers: enabledCharts.map(l => l.chartId),
      allChartsHidden,
    });

    // SINGLE-SELECT SAFETY: If multiple charts are enabled, log a warning
    // (This should not happen if useChartLayers is working correctly)
    if (enabledCharts.length > 1) {
      console.warn('MapView: Multiple charts enabled! Single-select may not be working.',
        enabledCharts.map(l => l.chartId));
    }

    const currentLayerIds = activeChartLayerIdsRef.current;
    const newLayerIds = new Set<string>();

    // Process each chart layer
    chartLayers.forEach((layer) => {
      const sourceId = `mbtiles-${layer.chartId}`;
      const layerId = `mbtiles-layer-${layer.chartId}`;

      // Skip charts without ANY bounds metadata - they can block other charts and cause rendering issues
      // Note: Antimeridian-crossing charts have bounds=undefined but DO have zoomBounds
      if (!layer.bounds && !layer.zoomBounds) {
        console.debug(`MapView: Skipping chart ${layer.chartId} - no bounds metadata`);
        return;
      }

      // Only show layer if it's enabled AND global charts are not hidden
      if (layer.enabled && !allChartsHidden) {
        newLayerIds.add(layer.chartId);

        try {
          // Add source if not exists
          if (!map.getSource(sourceId)) {
            // Determine if this is an antimeridian-crossing chart (bounds is undefined but zoomBounds exists)
            const isAntimeridianChart = !layer.bounds && layer.zoomBounds;

            // Source zoom levels from chart metadata
            const sourceMinZoom = layer.minZoom ?? 0;
            const sourceMaxZoom = layer.maxZoom ?? 22;

            // Log ALL chart source configs for debugging
            console.info(`MapView: Adding source ${sourceId} with minzoom=${sourceMinZoom}, maxzoom=${sourceMaxZoom}`);

            if (isAntimeridianChart) {
              console.warn(`MapView: Chart ${layer.chartId} crosses antimeridian`);
              console.info(`MapView DIAG: ${layer.chartId} layer data:`, {
                bounds: layer.bounds,
                zoomBounds: layer.zoomBounds,
                minZoom: layer.minZoom,
                maxZoom: layer.maxZoom,
                sourceMinZoom,
                sourceMaxZoom
              });
            }

            // Build source config - ALWAYS set bounds to constrain tile requests
            const sourceConfig: maplibregl.RasterSourceSpecification = {
              type: 'raster',
              tiles: [`mbtiles://${layer.chartId}/{z}/{x}/{y}`],
              tileSize: 256,
              minzoom: sourceMinZoom,
              maxzoom: sourceMaxZoom,
            };

            // Set bounds on ALL sources to constrain tile requests to the chart's geographic extent
            // This prevents MapLibre from requesting tiles outside the chart area
            if (isAntimeridianChart && layer.zoomBounds) {
              // For antimeridian charts, use special bounds that span the dateline
              const [, south, , north] = layer.zoomBounds;
              sourceConfig.bounds = [170, south, 190, north];
              console.info(`MapView: Antimeridian bounds for ${layer.chartId}:`, sourceConfig.bounds);
            } else if (layer.bounds) {
              // For normal charts, use their geographic bounds
              sourceConfig.bounds = layer.bounds;
              console.info(`MapView: Setting bounds for ${layer.chartId}:`, sourceConfig.bounds);
            } else if (layer.zoomBounds) {
              // Fallback to zoomBounds if bounds not available
              sourceConfig.bounds = layer.zoomBounds;
              console.info(`MapView: Using zoomBounds for ${layer.chartId}:`, sourceConfig.bounds);
            }

            console.info(`MapView: Source config for ${layer.chartId}:`, JSON.stringify(sourceConfig));

            map.addSource(sourceId, sourceConfig);
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
              opacity: layer.opacity,
              minZoom: layer.minZoom,
              maxZoom: layer.maxZoom
            });
            // No minzoom/maxzoom constraints on the layer - allow visibility at all zoom levels
            // The source minzoom/maxzoom handles tile fetching behavior (over/underzooming)
            map.addLayer({
              id: layerId,
              type: 'raster',
              source: sourceId,
              // No zoom constraints - chart is visible at all zoom levels
              // Will be scaled (overzoomed/underzoomed) when outside native tile range
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
  }, [chartLayers, mapLoaded, styleVersion, allChartsHidden]);

  // ============ Chart Outlines Layer ============
  // Shows boundaries of all chart layers as rectangles when enabled
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const OUTLINE_SOURCE = 'chart-outlines';
    const OUTLINE_LABELS_SOURCE = 'chart-outline-labels';
    const OUTLINE_LAYER = 'chart-outlines-layer';
    const OUTLINE_HIGHLIGHT_LAYER = 'chart-outlines-highlight-layer';
    const OUTLINE_FILL_LAYER = 'chart-outlines-fill-layer';
    const OUTLINE_LABELS_LAYER = 'chart-outline-labels-layer';
    const OUTLINE_BUTTONS_SOURCE = 'chart-outline-buttons';
    const OUTLINE_BUTTONS_LAYER = 'chart-outline-buttons-layer';
    const OUTLINE_BUTTONS_GLOW_LAYER = 'chart-outline-buttons-glow-layer';

    // Remove existing layers and sources first
    if (map.getLayer(OUTLINE_BUTTONS_LAYER)) {
      map.removeLayer(OUTLINE_BUTTONS_LAYER);
    }
    if (map.getLayer(OUTLINE_BUTTONS_GLOW_LAYER)) {
      map.removeLayer(OUTLINE_BUTTONS_GLOW_LAYER);
    }
    if (map.getLayer(OUTLINE_LABELS_LAYER)) {
      map.removeLayer(OUTLINE_LABELS_LAYER);
    }
    if (map.getLayer(OUTLINE_HIGHLIGHT_LAYER)) {
      map.removeLayer(OUTLINE_HIGHLIGHT_LAYER);
    }
    if (map.getLayer(OUTLINE_LAYER)) {
      map.removeLayer(OUTLINE_LAYER);
    }
    if (map.getLayer(OUTLINE_FILL_LAYER)) {
      map.removeLayer(OUTLINE_FILL_LAYER);
    }
    if (map.getSource(OUTLINE_BUTTONS_SOURCE)) {
      map.removeSource(OUTLINE_BUTTONS_SOURCE);
    }
    if (map.getSource(OUTLINE_LABELS_SOURCE)) {
      map.removeSource(OUTLINE_LABELS_SOURCE);
    }
    if (map.getSource(OUTLINE_SOURCE)) {
      map.removeSource(OUTLINE_SOURCE);
    }

    // If outlines are disabled AND no chart is highlighted, we're done
    // (We still show the outline for a highlighted chart even when outlines are off)
    if (!showChartOutlines && !highlightedChartId) return;

    /**
     * Analyze bounds and determine how to handle them for rendering
     *
     * Antimeridian crossing patterns:
     * Type A: minLon > 0 && maxLon < 0 (e.g., 175 to -175) - east to west crossing
     * Type B: minLon < 0 && maxLon > 0 && span > 180 (e.g., -175 to 175) - west to east "long way"
     *
     * For Type B, the bounds mean: from minLon westward to -180, then from 180 eastward to maxLon
     */
    const analyzeBounds = (minLon: number, minLat: number, maxLon: number, maxLat: number): {
      type: 'normal' | 'antimeridian-east-to-west' | 'antimeridian-west-to-east' | 'inverted';
      west: number;
      south: number;
      east: number;
      north: number;
    } => {
      const span = maxLon - minLon;

      // Case 1: Antimeridian crossing Type A - minLon positive, maxLon negative
      // Example: chart from 175°E to 175°W = minLon=175, maxLon=-175
      // The chart crosses going EAST from 175 -> 180/-180 -> -175
      if (minLon > 0 && maxLon < 0) {
        return { type: 'antimeridian-east-to-west', west: minLon, south: minLat, east: maxLon, north: maxLat };
      }

      // Case 2: Antimeridian crossing Type B - minLon negative, maxLon positive, span > 180°
      // Example: "-174.55,-30,175.53,-15" - mathematically 350° span but actually ~10° crossing antimeridian
      // The chart crosses going WEST from minLon -> -180/180 -> maxLon
      if (minLon < 0 && maxLon > 0 && span > 180) {
        return { type: 'antimeridian-west-to-east', west: minLon, south: minLat, east: maxLon, north: maxLat };
      }

      // Case 3: Inverted bounds in same hemisphere - minLon > maxLon but same sign
      // Example: "179,-40,170,-35" - both positive, just inverted data
      if (minLon > maxLon) {
        return { type: 'inverted', west: maxLon, south: minLat, east: minLon, north: maxLat };
      }

      // Case 4: Normal bounds
      return { type: 'normal', west: minLon, south: minLat, east: maxLon, north: maxLat };
    };

    // Build GeoJSON features from chart bounds
    const features: Array<{
      type: 'Feature';
      properties: { chartId: string; name: string; enabled: boolean; minZoom: number; maxZoom: number };
      geometry: { type: 'Polygon'; coordinates: number[][][] };
    }> = [];

    // Label points for zoom level display (positioned at bottom-right of each chart)
    const labelFeatures: Array<{
      type: 'Feature';
      properties: { chartId: string; zoomLabel: string; minZoom: number; maxZoom: number };
      geometry: { type: 'Point'; coordinates: [number, number] };
    }> = [];

    // Toggle button points (positioned at top-right of each chart)
    const buttonFeatures: Array<{
      type: 'Feature';
      properties: { chartId: string; enabled: boolean; minZoom: number; maxZoom: number };
      geometry: { type: 'Point'; coordinates: [number, number] };
    }> = [];

    for (const layer of chartLayers) {
      // When outlines are disabled, only render the highlighted chart's outline
      if (!showChartOutlines && layer.chartId !== highlightedChartId) continue;

      // Use rawBoundsString to get original bounds for outline rendering
      const boundsStr = layer.rawBoundsString;
      if (!boundsStr) continue;

      const parts = boundsStr.split(',').map(Number);
      if (parts.length !== 4 || parts.some(n => isNaN(n))) continue;

      const [minLon, minLat, maxLon, maxLat] = parts;
      const chartMinZoom = layer.minZoom ?? 0;
      const chartMaxZoom = layer.maxZoom ?? 22;
      // Extend zoom range by 2 levels for display (same as tile layers)
      const extendedMinZoom = Math.max(0, chartMinZoom - 2);
      const extendedMaxZoom = Math.min(22, chartMaxZoom + 2);
      const props = {
        chartId: layer.chartId,
        name: layer.name,
        enabled: layer.enabled,
        minZoom: extendedMinZoom,  // Use extended range for outline visibility
        maxZoom: extendedMaxZoom,
      };

      // Create label text with chart name and zoom range (e.g., "Chart Name z8–12")
      const zoomLabel = `${layer.name} z${chartMinZoom}–${chartMaxZoom}`;

      const analysis = analyzeBounds(minLon, minLat, maxLon, maxLat);

      if (analysis.type === 'antimeridian-east-to-west') {
        // Type A: Chart goes from positive lon (east) to negative lon (west)
        // e.g., 175°E to 175°W - crosses going EAST through 180°
        // Eastern polygon: from minLon (positive) to 180°
        features.push({
          type: 'Feature' as const,
          properties: props,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [analysis.west, analysis.south],
              [180, analysis.south],
              [180, analysis.north],
              [analysis.west, analysis.north],
              [analysis.west, analysis.south],
            ]],
          },
        });
        // Western polygon: from -180° to maxLon (negative)
        features.push({
          type: 'Feature' as const,
          properties: props,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [-180, analysis.south],
              [analysis.east, analysis.south],
              [analysis.east, analysis.north],
              [-180, analysis.north],
              [-180, analysis.south],
            ]],
          },
        });
        // Label at bottom-right of western polygon (the main visible part)
        labelFeatures.push({
          type: 'Feature' as const,
          properties: { chartId: layer.chartId, zoomLabel, minZoom: extendedMinZoom, maxZoom: extendedMaxZoom },
          geometry: {
            type: 'Point' as const,
            coordinates: [analysis.east, analysis.south],
          },
        });
        // Toggle button at top-right of western polygon
        buttonFeatures.push({
          type: 'Feature' as const,
          properties: { chartId: layer.chartId, enabled: layer.enabled, minZoom: extendedMinZoom, maxZoom: extendedMaxZoom },
          geometry: {
            type: 'Point' as const,
            coordinates: [analysis.east, analysis.north],
          },
        });
      } else if (analysis.type === 'antimeridian-west-to-east') {
        // Type B: Chart goes from negative lon (west) to positive lon (east) the "long way"
        // e.g., -175°W to 175°E - actually crosses going WEST through -180°/180°
        // Western polygon: from minLon (negative) to -180°
        features.push({
          type: 'Feature' as const,
          properties: props,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [analysis.west, analysis.south],
              [-180, analysis.south],
              [-180, analysis.north],
              [analysis.west, analysis.north],
              [analysis.west, analysis.south],
            ]],
          },
        });
        // Eastern polygon: from 180° to maxLon (positive)
        features.push({
          type: 'Feature' as const,
          properties: props,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [180, analysis.south],
              [analysis.east, analysis.south],
              [analysis.east, analysis.north],
              [180, analysis.north],
              [180, analysis.south],
            ]],
          },
        });
        // Label at bottom-right of eastern polygon (the main visible part)
        labelFeatures.push({
          type: 'Feature' as const,
          properties: { chartId: layer.chartId, zoomLabel, minZoom: extendedMinZoom, maxZoom: extendedMaxZoom },
          geometry: {
            type: 'Point' as const,
            coordinates: [analysis.east, analysis.south],
          },
        });
        // Toggle button at top-right of eastern polygon
        buttonFeatures.push({
          type: 'Feature' as const,
          properties: { chartId: layer.chartId, enabled: layer.enabled, minZoom: extendedMinZoom, maxZoom: extendedMaxZoom },
          geometry: {
            type: 'Point' as const,
            coordinates: [analysis.east, analysis.north],
          },
        });
      } else {
        // Normal or inverted (now corrected) - single polygon
        features.push({
          type: 'Feature' as const,
          properties: props,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [analysis.west, analysis.south],
              [analysis.east, analysis.south],
              [analysis.east, analysis.north],
              [analysis.west, analysis.north],
              [analysis.west, analysis.south],
            ]],
          },
        });
        // Label at bottom-right corner (east, south)
        labelFeatures.push({
          type: 'Feature' as const,
          properties: { chartId: layer.chartId, zoomLabel, minZoom: extendedMinZoom, maxZoom: extendedMaxZoom },
          geometry: {
            type: 'Point' as const,
            coordinates: [analysis.east, analysis.south],
          },
        });
        // Toggle button at top-right corner (east, north)
        buttonFeatures.push({
          type: 'Feature' as const,
          properties: { chartId: layer.chartId, enabled: layer.enabled, minZoom: extendedMinZoom, maxZoom: extendedMaxZoom },
          geometry: {
            type: 'Point' as const,
            coordinates: [analysis.east, analysis.north],
          },
        });
      }
    }

    if (features.length === 0) return;

    // Add the source
    map.addSource(OUTLINE_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    });

    // Add semi-transparent fill for non-highlighted charts
    // Only show when current zoom is within the chart's zoom range
    map.addLayer({
      id: OUTLINE_FILL_LAYER,
      type: 'fill',
      source: OUTLINE_SOURCE,
      filter: [
        'all',
        ['<=', ['get', 'minZoom'], ['zoom']],
        ['>=', ['get', 'maxZoom'], ['zoom']],
      ],
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'chartId'], highlightedChartId || ''],
          'rgba(34, 197, 94, 0.15)', // Green fill for highlighted
          'rgba(59, 130, 246, 0.08)', // Very light blue for others
        ],
        'fill-outline-color': 'transparent',
      },
    });

    // Add outline layer for all charts (thin line)
    // Only show when current zoom is within the chart's zoom range
    map.addLayer({
      id: OUTLINE_LAYER,
      type: 'line',
      source: OUTLINE_SOURCE,
      filter: [
        'all',
        ['<=', ['get', 'minZoom'], ['zoom']],
        ['>=', ['get', 'maxZoom'], ['zoom']],
      ],
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'chartId'], highlightedChartId || ''],
          '#22c55e', // Green for highlighted
          '#3b82f6', // Blue for others
        ],
        'line-width': [
          'case',
          ['==', ['get', 'chartId'], highlightedChartId || ''],
          3,
          1.5,
        ],
        'line-opacity': [
          'case',
          ['==', ['get', 'chartId'], highlightedChartId || ''],
          1,
          0.6,
        ],
      },
    });

    // Add dashed highlight layer for the highlighted chart
    // Only show when current zoom is within the chart's zoom range
    if (highlightedChartId) {
      map.addLayer({
        id: OUTLINE_HIGHLIGHT_LAYER,
        type: 'line',
        source: OUTLINE_SOURCE,
        filter: [
          'all',
          ['==', ['get', 'chartId'], highlightedChartId],
          ['<=', ['get', 'minZoom'], ['zoom']],
          ['>=', ['get', 'maxZoom'], ['zoom']],
        ],
        paint: {
          'line-color': '#22c55e',
          'line-width': 3,
          'line-dasharray': [0, 0], // Solid line
        },
      });
    }

    // Add zoom level labels at bottom-right of each chart frame
    // Only show labels when full outlines mode is enabled (not just on hover)
    if (showChartOutlines && labelFeatures.length > 0) {
      map.addSource(OUTLINE_LABELS_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: labelFeatures,
        },
      });

      map.addLayer({
        id: OUTLINE_LABELS_LAYER,
        type: 'symbol',
        source: OUTLINE_LABELS_SOURCE,
        // Only show when current zoom is within the chart's extended zoom range
        filter: [
          'all',
          ['<=', ['get', 'minZoom'], ['zoom']],
          ['>=', ['get', 'maxZoom'], ['zoom']],
        ],
        layout: {
          'text-field': ['get', 'zoomLabel'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-anchor': 'bottom-right',
          'text-offset': [-0.5, -0.5], // Offset slightly inside the corner
          'text-allow-overlap': true,  // Allow overlapping labels so all charts are labeled
          'text-ignore-placement': true, // Don't hide based on collision
          'text-padding': 2,
          'text-max-width': 20, // Allow longer labels to wrap if needed
        },
        paint: {
          'text-color': '#3b82f6', // Blue to match outline
          'text-halo-color': 'rgba(255, 255, 255, 0.9)',
          'text-halo-width': 1.5,
          'text-halo-blur': 0.5,
        },
      });
    }

    // Add toggle buttons at top-right of each chart frame
    // Only show buttons when full outlines mode is enabled (not just on hover)
    if (showChartOutlines && buttonFeatures.length > 0) {
      map.addSource(OUTLINE_BUTTONS_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: buttonFeatures,
        },
      });

      // Glow layer (larger, blurred circle behind the button)
      map.addLayer({
        id: OUTLINE_BUTTONS_GLOW_LAYER,
        type: 'circle',
        source: OUTLINE_BUTTONS_SOURCE,
        filter: [
          'all',
          ['<=', ['get', 'minZoom'], ['zoom']],
          ['>=', ['get', 'maxZoom'], ['zoom']],
        ],
        paint: {
          'circle-radius': 12,
          'circle-color': [
            'case',
            ['get', 'enabled'],
            'rgba(34, 197, 94, 0.4)', // Green glow when enabled
            'rgba(59, 130, 246, 0.4)', // Blue glow when disabled
          ],
          'circle-blur': 0.8,
        },
      });

      // Button layer (smaller, solid circle)
      map.addLayer({
        id: OUTLINE_BUTTONS_LAYER,
        type: 'circle',
        source: OUTLINE_BUTTONS_SOURCE,
        filter: [
          'all',
          ['<=', ['get', 'minZoom'], ['zoom']],
          ['>=', ['get', 'maxZoom'], ['zoom']],
        ],
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['get', 'enabled'],
            '#22c55e', // Green when enabled
            '#3b82f6', // Blue when disabled
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.9)',
        },
      });

      // Add click handler for toggle buttons
      map.on('click', OUTLINE_BUTTONS_LAYER, (e) => {
        if (e.features && e.features.length > 0) {
          const chartId = e.features[0].properties?.chartId;
          if (chartId && onChartToggle) {
            onChartToggle(chartId);
          }
        }
      });

      // Change cursor on hover
      map.on('mouseenter', OUTLINE_BUTTONS_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', OUTLINE_BUTTONS_LAYER, () => {
        map.getCanvas().style.cursor = '';
      });
    }
  }, [chartLayers, mapLoaded, showChartOutlines, highlightedChartId, onChartToggle]);

  // ============ Nautical Chart Vector Layer ============
  // Renders vector nautical chart data with S52-style symbology
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!cm93Status?.initialized || !cm93Settings?.enabled || !onCm93FeaturesRequest) return;

    const NAUTICAL_SOURCE = 'nautical-vector';

    // Define layer IDs for different feature types
    const NAUTICAL_LAYERS = {
      land: 'nautical-land',
      coastline: 'nautical-coastline',
      depthAreas: 'nautical-depth-areas',
      depthContours: 'nautical-depth-contours',
      soundings: 'nautical-soundings',
      lights: 'nautical-lights',
      buoys: 'nautical-buoys',
      obstructions: 'nautical-obstructions',
      shoreline: 'nautical-shoreline',
      intertidal: 'nautical-intertidal',
      trafficSeparation: 'nautical-traffic-separation',
      anchorage: 'nautical-anchorage',
      cautionArea: 'nautical-caution-area',
    };

    let isCancelled = false;

    console.log('Nautical: Effect running', {
      initialized: cm93Status?.initialized,
      enabled: cm93Settings?.enabled,
      hasCallback: !!onCm93FeaturesRequest,
      styleVersion,
    });

    // Helper to safely add a layer if it doesn't exist
    const addLayerIfNotExists = (
      layerId: string,
      layerConfig: maplibregl.LayerSpecification,
      beforeLayer?: string
    ) => {
      if (!map.getLayer(layerId)) {
        try {
          map.addLayer(layerConfig, beforeLayer);
          console.debug(`Nautical: Added layer ${layerId}`);
        } catch (err) {
          console.error(`Nautical: Failed to add layer ${layerId}:`, err);
        }
      }
    };

    // Helper to remove a layer if it exists
    const removeLayerIfExists = (layerId: string) => {
      if (map.getLayer(layerId)) {
        try {
          map.removeLayer(layerId);
          console.debug(`Nautical: Removed layer ${layerId}`);
        } catch (err) {
          console.error(`Nautical: Failed to remove layer ${layerId}:`, err);
        }
      }
    };

    // Ensure layers are created based on current settings
    const ensureLayers = () => {
      if (!map.getSource(NAUTICAL_SOURCE)) {
        console.debug('Nautical: Source not ready, skipping layer creation');
        return;
      }

      // Find insertion point - above basemap but below GEBCO and user charts
      const beforeLayer = ['gebco-color-layer', 'gebco-hillshade-layer', 'gebco-hillshade-pre-layer']
        .find(id => map.getLayer(id));

      console.debug('Nautical: Ensuring layers exist, beforeLayer:', beforeLayer);

      // Land areas - tan/beige fill
      if (cm93Settings.showLand) {
        addLayerIfNotExists(NAUTICAL_LAYERS.land, {
          id: NAUTICAL_LAYERS.land,
          type: 'fill',
          source: NAUTICAL_SOURCE,
          filter: ['==', ['get', 'layer'], 'land'],
          paint: {
            'fill-color': theme === 'night' ? '#2d2d2d' : '#f5deb3',
            'fill-opacity': cm93Settings.opacity * 0.8,
          },
        }, beforeLayer);
      } else {
        removeLayerIfExists(NAUTICAL_LAYERS.land);
      }

      // Depth areas - blue shading based on depth (always shown when nautical enabled)
      addLayerIfNotExists(NAUTICAL_LAYERS.depthAreas, {
        id: NAUTICAL_LAYERS.depthAreas,
        type: 'fill',
        source: NAUTICAL_SOURCE,
        filter: ['==', ['get', 'layer'], 'depth_areas'],
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'depth'], 0],
            0, theme === 'night' ? '#1a3a5c' : '#add8e6',
            10, theme === 'night' ? '#0d2840' : '#87ceeb',
            50, theme === 'night' ? '#061a2e' : '#4682b4',
            200, theme === 'night' ? '#030d17' : '#000080',
          ],
          'fill-opacity': cm93Settings.opacity * 0.5,
        },
      }, beforeLayer);

      // Coastline - dark line (always shown when nautical enabled)
      addLayerIfNotExists(NAUTICAL_LAYERS.coastline, {
        id: NAUTICAL_LAYERS.coastline,
        type: 'line',
        source: NAUTICAL_SOURCE,
        filter: ['==', ['get', 'layer'], 'coastline'],
        paint: {
          'line-color': theme === 'night' ? '#666' : '#333',
          'line-width': 1.5,
          'line-opacity': cm93Settings.opacity,
        },
      }, beforeLayer);

      // Depth contours - blue lines
      if (cm93Settings.showDepthContours) {
        addLayerIfNotExists(NAUTICAL_LAYERS.depthContours, {
          id: NAUTICAL_LAYERS.depthContours,
          type: 'line',
          source: NAUTICAL_SOURCE,
          filter: ['==', ['get', 'layer'], 'depth_contours'],
          paint: {
            'line-color': theme === 'night' ? '#4a90d9' : '#4169e1',
            'line-width': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'depth'], 0],
              0, 2,
              10, 1.5,
              50, 1,
              200, 0.5,
            ],
            'line-opacity': cm93Settings.opacity * 0.7,
          },
        }, beforeLayer);
      } else {
        removeLayerIfExists(NAUTICAL_LAYERS.depthContours);
      }

      // Soundings - depth numbers
      if (cm93Settings.showSoundings) {
        addLayerIfNotExists(NAUTICAL_LAYERS.soundings, {
          id: NAUTICAL_LAYERS.soundings,
          type: 'symbol',
          source: NAUTICAL_SOURCE,
          filter: ['==', ['get', 'layer'], 'soundings'],
          layout: {
            'text-field': ['to-string', ['round', ['get', 'depth']]],
            'text-size': 10,
            'text-anchor': 'center',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': theme === 'night' ? '#7ec8e3' : '#000080',
            'text-halo-color': theme === 'night' ? '#1a1a2e' : '#ffffff',
            'text-halo-width': 1,
            'text-opacity': cm93Settings.opacity,
          },
        });
      } else {
        removeLayerIfExists(NAUTICAL_LAYERS.soundings);
      }

      // Lights - yellow/amber circles
      if (cm93Settings.showLights) {
        addLayerIfNotExists(NAUTICAL_LAYERS.lights, {
          id: NAUTICAL_LAYERS.lights,
          type: 'circle',
          source: NAUTICAL_SOURCE,
          filter: ['==', ['get', 'layer'], 'lights'],
          paint: {
            'circle-radius': 6,
            'circle-color': '#ffd700',
            'circle-stroke-color': '#ff8c00',
            'circle-stroke-width': 2,
            'circle-opacity': cm93Settings.opacity,
          },
        });
      } else {
        removeLayerIfExists(NAUTICAL_LAYERS.lights);
      }

      // Buoys - colored circles based on type
      if (cm93Settings.showBuoys) {
        addLayerIfNotExists(NAUTICAL_LAYERS.buoys, {
          id: NAUTICAL_LAYERS.buoys,
          type: 'circle',
          source: NAUTICAL_SOURCE,
          filter: ['any',
            ['==', ['get', 'layer'], 'buoys'],
            ['==', ['get', 'layer'], 'beacons']
          ],
          paint: {
            'circle-radius': 5,
            'circle-color': [
              'match',
              ['get', 'color'],
              'red', '#ff0000',
              'green', '#00ff00',
              'yellow', '#ffff00',
              'white', '#ffffff',
              '#888888' // default gray
            ],
            'circle-stroke-color': '#333',
            'circle-stroke-width': 1,
            'circle-opacity': cm93Settings.opacity,
          },
        });
      } else {
        removeLayerIfExists(NAUTICAL_LAYERS.buoys);
      }

      // Obstructions, wrecks, rocks - warning symbols
      if (cm93Settings.showObstructions) {
        addLayerIfNotExists(NAUTICAL_LAYERS.obstructions, {
          id: NAUTICAL_LAYERS.obstructions,
          type: 'circle',
          source: NAUTICAL_SOURCE,
          filter: ['any',
            ['==', ['get', 'layer'], 'obstructions'],
            ['==', ['get', 'layer'], 'wrecks'],
            ['==', ['get', 'layer'], 'rocks']
          ],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ff4444',
            'circle-stroke-color': '#cc0000',
            'circle-stroke-width': 1,
            'circle-opacity': cm93Settings.opacity,
          },
        });
      } else {
        removeLayerIfExists(NAUTICAL_LAYERS.obstructions);
      }

      // Shoreline construction (piers, seawalls, etc.) - dark brown lines
      addLayerIfNotExists(NAUTICAL_LAYERS.shoreline, {
        id: NAUTICAL_LAYERS.shoreline,
        type: 'line',
        source: NAUTICAL_SOURCE,
        filter: ['==', ['get', 'layer'], 'shoreline'],
        paint: {
          'line-color': theme === 'night' ? '#8b7355' : '#654321',
          'line-width': 2,
          'line-opacity': cm93Settings.opacity,
        },
      }, beforeLayer);

      // Intertidal areas (tidal flats) - subtle light brown fill
      addLayerIfNotExists(NAUTICAL_LAYERS.intertidal, {
        id: NAUTICAL_LAYERS.intertidal,
        type: 'fill',
        source: NAUTICAL_SOURCE,
        filter: ['any',
          ['==', ['get', 'layer'], 'intertidal'],
          ['==', ['get', 'layer'], 'seabed']
        ],
        paint: {
          'fill-color': theme === 'night' ? '#3d3d2d' : '#d2b48c',
          'fill-opacity': cm93Settings.opacity * 0.2,
        },
      }, beforeLayer);

      // Traffic separation zones - magenta outline only
      addLayerIfNotExists(NAUTICAL_LAYERS.trafficSeparation, {
        id: NAUTICAL_LAYERS.trafficSeparation,
        type: 'line',
        source: NAUTICAL_SOURCE,
        filter: ['==', ['get', 'layer'], 'traffic_separation'],
        paint: {
          'line-color': theme === 'night' ? '#8a6ada' : '#9370db',
          'line-width': 2,
          'line-opacity': cm93Settings.opacity * 0.7,
        },
      }, beforeLayer);

      // Anchorage areas - very subtle blue fill
      addLayerIfNotExists(NAUTICAL_LAYERS.anchorage, {
        id: NAUTICAL_LAYERS.anchorage,
        type: 'fill',
        source: NAUTICAL_SOURCE,
        filter: ['==', ['get', 'layer'], 'anchorage'],
        paint: {
          'fill-color': theme === 'night' ? '#2a4a6a' : '#87ceeb',
          'fill-opacity': cm93Settings.opacity * 0.15,
          'fill-outline-color': theme === 'night' ? '#4a8aba' : '#4682b4',
        },
      }, beforeLayer);

      // Caution areas - just outline, no fill (too visually dominant otherwise)
      addLayerIfNotExists(NAUTICAL_LAYERS.cautionArea, {
        id: NAUTICAL_LAYERS.cautionArea,
        type: 'line',
        source: NAUTICAL_SOURCE,
        filter: ['==', ['get', 'layer'], 'caution_area'],
        paint: {
          'line-color': theme === 'night' ? '#ba8a4a' : '#ff8c00',
          'line-width': 1.5,
          'line-dasharray': [4, 2],
          'line-opacity': cm93Settings.opacity * 0.6,
        },
      }, beforeLayer);

      // Update opacity on standard layers (skip special layers with custom opacity)
      const specialFillLayers = [NAUTICAL_LAYERS.anchorage, NAUTICAL_LAYERS.intertidal];
      const specialLineLayers = [NAUTICAL_LAYERS.trafficSeparation, NAUTICAL_LAYERS.cautionArea];

      Object.values(NAUTICAL_LAYERS).forEach(layerId => {
        if (map.getLayer(layerId)) {
          try {
            const layer = map.getLayer(layerId);
            if (layer?.type === 'fill' && !specialFillLayers.includes(layerId)) {
              map.setPaintProperty(layerId, 'fill-opacity',
                layerId === NAUTICAL_LAYERS.depthAreas ? cm93Settings.opacity * 0.5 : cm93Settings.opacity * 0.8);
            } else if (layer?.type === 'line' && !specialLineLayers.includes(layerId)) {
              map.setPaintProperty(layerId, 'line-opacity',
                layerId === NAUTICAL_LAYERS.depthContours ? cm93Settings.opacity * 0.7 : cm93Settings.opacity);
            } else if (layer?.type === 'circle') {
              map.setPaintProperty(layerId, 'circle-opacity', cm93Settings.opacity);
            } else if (layer?.type === 'symbol') {
              map.setPaintProperty(layerId, 'text-opacity', cm93Settings.opacity);
            }
          } catch {
            // Ignore errors
          }
        }
      });

      console.debug('Nautical: Layers ensured, current layers:',
        Object.values(NAUTICAL_LAYERS).filter(id => map.getLayer(id)));
    };

    // Load features for current view
    const loadFeatures = async () => {
      const bounds = map.getBounds();
      const zoom = Math.floor(map.getZoom());

      console.log('Nautical: Loading features for zoom', zoom, 'bounds:', {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });

      try {
        const geojson = await onCm93FeaturesRequest(
          bounds.getSouth(),
          bounds.getWest(),
          bounds.getNorth(),
          bounds.getEast(),
          zoom
        );

        if (isCancelled) return;

        if (!geojson) {
          console.debug('Nautical: No GeoJSON returned');
          return;
        }

        console.log('Nautical: Received', geojson.features.length, 'features');

        // Log a sample of the features to understand the data
        if (geojson.features.length > 0) {
          const layerTypes = new Set(geojson.features.map(f => f.properties?.layer));
          console.log('Nautical: Feature layer types:', Array.from(layerTypes));

          // Log first few features for debugging
          console.log('Nautical: Sample features:', geojson.features.slice(0, 3));
        } else {
          console.warn('Nautical: No features returned from backend!');
        }

        // Convert to GeoJSON FeatureCollection
        const featureCollection: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: geojson.features.map(f => ({
            type: 'Feature' as const,
            geometry: f.geometry as GeoJSON.Geometry,
            properties: f.properties as GeoJSON.GeoJsonProperties,
          })),
        };

        // Update or create source
        const source = map.getSource(NAUTICAL_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (source) {
          console.debug('Nautical: Updating existing source with', featureCollection.features.length, 'features');
          source.setData(featureCollection);
        } else {
          console.debug('Nautical: Creating new source with', featureCollection.features.length, 'features');
          map.addSource(NAUTICAL_SOURCE, {
            type: 'geojson',
            data: featureCollection,
          });
        }

        // Ensure layers exist after source is ready
        ensureLayers();
      } catch (err) {
        console.error('Nautical: Failed to load features:', err);
        console.error('Nautical: Error details:', {
          initialized: cm93Status?.initialized,
          enabled: cm93Settings?.enabled,
        });
      }
    };

    // Track in-flight request to avoid concurrent loads
    let isLoading = false;
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const debouncedLoadFeatures = () => {
      // Clear any pending debounce
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      // Skip if already loading
      if (isLoading) {
        console.debug('Nautical: Skipping load, already in progress');
        return;
      }

      // Debounce: wait 300ms after last move before loading
      debounceTimeout = setTimeout(async () => {
        if (isCancelled || isLoading) return;

        isLoading = true;
        try {
          await loadFeatures();
        } finally {
          isLoading = false;
        }
      }, 300);
    };

    // Initial load (immediate, no debounce)
    loadFeatures();

    // Reload on map move (debounced)
    map.on('moveend', debouncedLoadFeatures);

    return () => {
      isCancelled = true;
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      map.off('moveend', debouncedLoadFeatures);

      // Clean up layers and source
      console.debug('Nautical: Cleaning up layers and source');
      try {
        Object.values(NAUTICAL_LAYERS).forEach(layerId => {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
        });
        if (map.getSource(NAUTICAL_SOURCE)) {
          map.removeSource(NAUTICAL_SOURCE);
        }
      } catch {
        // Ignore errors during cleanup
      }
    };
  }, [
    cm93Status?.initialized,
    cm93Settings?.enabled,
    cm93Settings?.opacity,
    cm93Settings?.showSoundings,
    cm93Settings?.showDepthContours,
    cm93Settings?.showLights,
    cm93Settings?.showBuoys,
    cm93Settings?.showLand,
    cm93Settings?.showObstructions,
    onCm93FeaturesRequest,
    mapLoaded,
    styleVersion,
    theme,
  ]);

  // ============ GEBCO Bathymetry Layers ============
  // Manage GEBCO layers: hillshade, color shading, and contours
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Define GEBCO layer IDs
    const GEBCO_COLOR_SOURCE = 'gebco-color';
    const GEBCO_COLOR_LAYER = 'gebco-color-layer';
    const GEBCO_HILLSHADE_SOURCE = 'gebco-dem';  // For dynamic hillshade (raster-dem)
    const GEBCO_HILLSHADE_LAYER = 'gebco-hillshade-layer';
    const GEBCO_PRERENDERED_SOURCE = 'gebco-hillshade-pre';  // For pre-rendered hillshade
    const GEBCO_PRERENDERED_LAYER = 'gebco-hillshade-pre-layer';
    const GEBCO_CONTOURS_SOURCE = 'gebco-contours';
    const GEBCO_CONTOURS_LAYER = 'gebco-contours-layer';
    const GEBCO_CONTOUR_LABELS_LAYER = 'gebco-contour-labels-layer';

    // Helper to get theme-aware hillshade colors
    const getHillshadeColors = () => {
      switch (theme) {
        case 'night':
          return {
            shadow: '#0d1b2a',
            highlight: '#1b263b',
            accent: '#415a77',
          };
        case 'dusk':
          return {
            shadow: '#1a237e',
            highlight: '#e8eaf6',
            accent: '#3949ab',
          };
        default: // day
          return {
            shadow: '#1a237e',
            highlight: '#ffffff',
            accent: '#0d47a1',
          };
      }
    };

    // Helper to get theme-aware contour color
    const getContourColor = () => {
      switch (theme) {
        case 'night': return '#7986cb';
        case 'dusk': return '#5c6bc0';
        default: return '#1565c0';
      }
    };

    // Check if GEBCO tiles are available
    const colorAvailable = gebcoStatus?.color_available ?? false;
    const demAvailable = gebcoStatus?.dem_available ?? false;
    const hillshadeAvailable = gebcoStatus?.hillshade_available ?? false;
    const contoursAvailable = gebcoStatus?.contours_available ?? false;
    // Use DEM for dynamic hillshade, fall back to pre-rendered
    const useDynamicHillshade = demAvailable;
    const usePrerenderedHillshade = hillshadeAvailable && !demAvailable;

    // Helper to safely add source
    const addSourceSafely = (sourceId: string, config: maplibregl.SourceSpecification) => {
      if (!map.getSource(sourceId)) {
        try {
          map.addSource(sourceId, config);
        } catch (err) {
          console.error(`GEBCO: Failed to add source ${sourceId}:`, err);
        }
      }
    };

    // Helper to safely remove layer and source
    const removeLayerSafely = (layerId: string, sourceId?: string) => {
      try {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        if (sourceId && map.getSource(sourceId)) {
          // Only remove source if no other layers use it
          const style = map.getStyle();
          const layersUsingSource = style?.layers?.filter(
            (l) => 'source' in l && l.source === sourceId
          ) ?? [];
          if (layersUsingSource.length === 0) {
            map.removeSource(sourceId);
          }
        }
      } catch (err) {
        console.error(`GEBCO: Failed to remove layer ${layerId}:`, err);
      }
    };

    // Get layer to insert before (after basemap, before charts)
    const getInsertBeforeLayer = () => {
      // Find first MBTiles layer (chart layer)
      const style = map.getStyle();
      const chartLayer = style?.layers?.find((l) => l.id.startsWith('mbtiles-layer-'));
      if (chartLayer) return chartLayer.id;
      // Otherwise, insert before OpenSeaMap if it exists
      if (map.getLayer('openseamap-overlay')) return 'openseamap-overlay';
      return undefined; // Add to top
    };

    // ---- GEBCO Color Layer (depth shading) ----
    if (colorAvailable && gebcoSettings?.show_color) {
      addSourceSafely(GEBCO_COLOR_SOURCE, {
        type: 'raster',
        tiles: ['mbtiles://_gebco_color/{z}/{x}/{y}'],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });

      if (!map.getLayer(GEBCO_COLOR_LAYER)) {
        try {
          map.addLayer(
            {
              id: GEBCO_COLOR_LAYER,
              type: 'raster',
              source: GEBCO_COLOR_SOURCE,
              paint: {
                'raster-opacity': gebcoSettings.color_opacity,
              },
            },
            getInsertBeforeLayer()
          );
        } catch (err) {
          console.error('GEBCO: Failed to add color layer:', err);
        }
      } else {
        // Update opacity
        map.setPaintProperty(GEBCO_COLOR_LAYER, 'raster-opacity', gebcoSettings.color_opacity);
      }
    } else {
      removeLayerSafely(GEBCO_COLOR_LAYER, GEBCO_COLOR_SOURCE);
    }

    // ---- GEBCO Hillshade Layer ----
    // Option 1: Dynamic hillshade from Terrain-RGB DEM
    if (useDynamicHillshade && gebcoSettings?.show_hillshade) {
      // Remove pre-rendered if switching
      removeLayerSafely(GEBCO_PRERENDERED_LAYER, GEBCO_PRERENDERED_SOURCE);

      addSourceSafely(GEBCO_HILLSHADE_SOURCE, {
        type: 'raster-dem',
        tiles: ['mbtiles://_gebco_dem/{z}/{x}/{y}'],
        tileSize: 256,
        encoding: 'terrarium',
      });

      const hillshadeColors = getHillshadeColors();
      if (!map.getLayer(GEBCO_HILLSHADE_LAYER)) {
        try {
          const beforeLayer = getInsertBeforeLayer();
          map.addLayer(
            {
              id: GEBCO_HILLSHADE_LAYER,
              type: 'hillshade',
              source: GEBCO_HILLSHADE_SOURCE,
              paint: {
                'hillshade-exaggeration': 0.5,
                'hillshade-shadow-color': hillshadeColors.shadow,
                'hillshade-highlight-color': hillshadeColors.highlight,
                'hillshade-accent-color': hillshadeColors.accent,
                'hillshade-illumination-direction': 315,
              },
            },
            beforeLayer
          );
        } catch (err) {
          console.error('GEBCO: Failed to add dynamic hillshade layer:', err);
        }
      } else {
        // Update hillshade colors for theme
        map.setPaintProperty(GEBCO_HILLSHADE_LAYER, 'hillshade-shadow-color', hillshadeColors.shadow);
        map.setPaintProperty(GEBCO_HILLSHADE_LAYER, 'hillshade-highlight-color', hillshadeColors.highlight);
        map.setPaintProperty(GEBCO_HILLSHADE_LAYER, 'hillshade-accent-color', hillshadeColors.accent);
      }
    } else {
      removeLayerSafely(GEBCO_HILLSHADE_LAYER, GEBCO_HILLSHADE_SOURCE);
    }

    // Option 2: Pre-rendered hillshade (simpler, no DEM encoding required)
    if (usePrerenderedHillshade && gebcoSettings?.show_hillshade) {
      addSourceSafely(GEBCO_PRERENDERED_SOURCE, {
        type: 'raster',
        tiles: ['mbtiles://_gebco_hillshade/{z}/{x}/{y}'],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });

      if (!map.getLayer(GEBCO_PRERENDERED_LAYER)) {
        try {
          const beforeLayer = getInsertBeforeLayer();
          map.addLayer(
            {
              id: GEBCO_PRERENDERED_LAYER,
              type: 'raster',
              source: GEBCO_PRERENDERED_SOURCE,
              paint: {
                'raster-opacity': gebcoSettings.hillshade_opacity,
              },
            },
            beforeLayer
          );
        } catch (err) {
          console.error('GEBCO: Failed to add pre-rendered hillshade layer:', err);
        }
      } else {
        // Update opacity
        map.setPaintProperty(GEBCO_PRERENDERED_LAYER, 'raster-opacity', gebcoSettings.hillshade_opacity);
      }
    } else if (!useDynamicHillshade) {
      // Only remove if we're not using dynamic hillshade either
      removeLayerSafely(GEBCO_PRERENDERED_LAYER, GEBCO_PRERENDERED_SOURCE);
    }

    // ---- GEBCO Contours Layer ----
    if (contoursAvailable && gebcoSettings?.show_contours) {
      addSourceSafely(GEBCO_CONTOURS_SOURCE, {
        type: 'vector',
        tiles: ['mbtiles://_gebco_contours/{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: 9,
      });

      const contourColor = getContourColor();
      const contourInterval = gebcoSettings.contour_interval;

      if (!map.getLayer(GEBCO_CONTOURS_LAYER)) {
        try {
          map.addLayer(
            {
              id: GEBCO_CONTOURS_LAYER,
              type: 'line',
              source: GEBCO_CONTOURS_SOURCE,
              'source-layer': 'contours',
              paint: {
                'line-color': contourColor,
                'line-width': [
                  'case',
                  ['==', ['%', ['get', 'depth'], 1000], 0], 2,
                  ['==', ['%', ['get', 'depth'], 500], 0], 1.5,
                  ['==', ['%', ['get', 'depth'], 100], 0], 1,
                  0.5,
                ],
                'line-opacity': [
                  'interpolate', ['linear'], ['zoom'],
                  4, 0.3,
                  8, 0.7,
                  12, 1.0,
                ],
              },
              filter: ['==', ['%', ['get', 'depth'], contourInterval], 0],
            },
            getInsertBeforeLayer()
          );

          // Add contour labels
          map.addLayer(
            {
              id: GEBCO_CONTOUR_LABELS_LAYER,
              type: 'symbol',
              source: GEBCO_CONTOURS_SOURCE,
              'source-layer': 'contours',
              layout: {
                'symbol-placement': 'line',
                'text-field': ['concat', ['get', 'depth'], 'm'],
                'text-size': 10,
                'text-max-angle': 30,
                'text-padding': 10,
              },
              paint: {
                'text-color': contourColor,
                'text-halo-color': theme === 'night' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
                'text-halo-width': 1.5,
              },
              filter: [
                'all',
                ['==', ['%', ['get', 'depth'], contourInterval], 0],
                ['==', ['%', ['get', 'depth'], 100], 0],
              ],
            },
            getInsertBeforeLayer()
          );
        } catch (err) {
          console.error('GEBCO: Failed to add contour layers:', err);
        }
      } else {
        // Update contour color and filter
        map.setPaintProperty(GEBCO_CONTOURS_LAYER, 'line-color', contourColor);
        map.setFilter(GEBCO_CONTOURS_LAYER, ['==', ['%', ['get', 'depth'], contourInterval], 0]);
        if (map.getLayer(GEBCO_CONTOUR_LABELS_LAYER)) {
          map.setPaintProperty(GEBCO_CONTOUR_LABELS_LAYER, 'text-color', contourColor);
          map.setPaintProperty(
            GEBCO_CONTOUR_LABELS_LAYER,
            'text-halo-color',
            theme === 'night' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'
          );
          map.setFilter(GEBCO_CONTOUR_LABELS_LAYER, [
            'all',
            ['==', ['%', ['get', 'depth'], contourInterval], 0],
            ['==', ['%', ['get', 'depth'], 100], 0],
          ]);
        }
      }
    } else {
      removeLayerSafely(GEBCO_CONTOUR_LABELS_LAYER);
      removeLayerSafely(GEBCO_CONTOURS_LAYER, GEBCO_CONTOURS_SOURCE);
    }

    console.debug('GEBCO: Layer update complete', {
      colorAvailable,
      demAvailable,
      contoursAvailable,
      settings: gebcoSettings,
    });
  }, [
    gebcoSettings?.show_color,
    gebcoSettings?.show_hillshade,
    gebcoSettings?.show_contours,
    gebcoSettings?.color_opacity,
    gebcoSettings?.hillshade_opacity,
    gebcoSettings?.contour_interval,
    gebcoStatus?.color_available,
    gebcoStatus?.dem_available,
    gebcoStatus?.contours_available,
    theme,
    mapLoaded,
    styleVersion,
  ]);

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

  // ============ WAYPOINT MARKERS WITH HASH-BASED RECREATION ============
  // This is the key fix: markers are recreated when waypoint data (name/symbol) changes
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const currentMarkers = waypointMarkersRef.current;
    const currentHashes = markerHashesRef.current;
    const waypointIds = new Set(waypoints.map((w) => w.id).filter((id): id is number => id !== null));

    // Remove markers for waypoints that no longer exist
    currentMarkers.forEach((marker, id) => {
      if (!waypointIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
        currentHashes.delete(id);
      }
    });

    // Get waypoint IDs from the selected route (if any)
    const selectedRouteWaypointIds = new Set<number>();
    const selectedRoute = routes.find(r => r.route.id === selectedRouteId);
    if (selectedRoute) {
      selectedRoute.waypoints.forEach(wp => {
        if (wp.id !== null) selectedRouteWaypointIds.add(wp.id);
      });
    }

    // Get waypoint IDs that belong to hidden routes (but not active route)
    const hiddenRouteWaypointIds = new Set<number>();
    routes.forEach(r => {
      // If route is hidden and not active, add its waypoints to the hidden set
      if (r.route.hidden && r.route.id !== activeRouteId) {
        r.waypoints.forEach(wp => {
          if (wp.id !== null) hiddenRouteWaypointIds.add(wp.id);
        });
      }
    });

    // Add or update markers for each waypoint
    waypoints.forEach((waypoint) => {
      if (waypoint.id === null) return;

      const waypointId = waypoint.id;
      const isActive = waypointId === activeWaypointId;
      const isInSelectedRoute = selectedRouteWaypointIds.has(waypointId);
      const isInHiddenRoute = hiddenRouteWaypointIds.has(waypointId);
      const selectedRouteIsHidden = selectedRoute?.route.hidden ?? false;

      // Determine if marker should be visible:
      // - Active waypoint is ALWAYS visible (for navigation)
      // - Waypoints in selected route are visible ONLY if the route itself is not hidden
      // - Waypoints in hidden routes should be hidden (unless active)
      // - Otherwise, both showAllMarkers must be true AND waypoint.hidden must be false
      const isInVisibleSelectedRoute = isInSelectedRoute && !selectedRouteIsHidden;
      const shouldBeVisible = isActive || isInVisibleSelectedRoute || (!isInHiddenRoute && showAllMarkers && !waypoint.hidden);

      // Show label if global toggle is on AND waypoint's individual show_label is true
      const shouldShowLabel = showAllLabels && waypoint.show_label;
      const currentHash = getWaypointHash(waypoint, showAllLabels, showAllMarkers, isActive);
      const existingHash = currentHashes.get(waypointId);
      const existingMarker = currentMarkers.get(waypointId);

      // If marker shouldn't be visible, remove it if it exists
      if (!shouldBeVisible) {
        if (existingMarker) {
          existingMarker.remove();
          currentMarkers.delete(waypointId);
          currentHashes.delete(waypointId);
        }
        return;
      }

      // Check if marker exists and data hasn't changed
      if (existingMarker && existingHash === currentHash) {
        // Just update position and active state
        existingMarker.setLngLat([waypoint.lon, waypoint.lat]);

        const el = existingMarker.getElement();
        if (isActive && !el.classList.contains('waypoint-marker--active')) {
          el.classList.add('waypoint-marker--active');
        } else if (!isActive && el.classList.contains('waypoint-marker--active')) {
          el.classList.remove('waypoint-marker--active');
        }
        return;
      }

      // Data changed or new waypoint - recreate marker entirely
      if (existingMarker) {
        existingMarker.remove();
        currentMarkers.delete(waypointId);
      }

      // Create new marker with fresh event handlers
      const el = createWaypointMarkerElement(waypoint, isActive, shouldShowLabel);

      // Drag state - uses ONLY waypointId, never captures waypoint data
      let isDragging = false;
      let dragTimeout: number | null = null;
      let startPos: { x: number; y: number } | null = null;

      // Start drag after hold
      const startDragMode = () => {
        isDragging = true;
        el.classList.add('waypoint-marker--dragging');
        el.style.cursor = 'grabbing';
        // Notify parent that drag started
        const lngLat = marker.getLngLat();
        onWaypointDragStartRef.current?.(waypointId, lngLat.lat, lngLat.lng);
        // Track dragging position for route updates
        setDraggingWaypointState({ id: waypointId, lat: lngLat.lat, lon: lngLat.lng });
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
              // Report current drag position - use ID only!
              onWaypointDragRef.current?.(waypointId, lngLat.lat, lngLat.lng);
              // Update dragging position for route updates
              setDraggingWaypointState({ id: waypointId, lat: lngLat.lat, lon: lngLat.lng });
            }
          }
        };

        const handleMouseUp = () => {
          if (dragTimeout) {
            clearTimeout(dragTimeout);
            dragTimeout = null;
          }

          if (isDragging && mapRef.current) {
            // Finish drag - use ID only!
            const lngLat = marker.getLngLat();
            el.classList.remove('waypoint-marker--dragging');
            el.style.cursor = '';
            isDragging = false;
            onWaypointDragEndRef.current?.(waypointId, lngLat.lat, lngLat.lng);
            // Clear dragging state
            setDraggingWaypointState(null);
          } else if (startPos) {
            // It was a click, not a drag - use ID only!
            onWaypointClickRef.current?.(waypointId);
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
              waypointId,
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
              // Report current drag position - use ID only!
              onWaypointDragRef.current?.(waypointId, lngLat.lat, lngLat.lng);
              // Update dragging position for route updates
              setDraggingWaypointState({ id: waypointId, lat: lngLat.lat, lon: lngLat.lng });
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
            onWaypointDragEndRef.current?.(waypointId, lngLat.lat, lngLat.lng);
            // Clear dragging state
            setDraggingWaypointState(null);
          } else if (startPos) {
            // It was a tap, not a drag (only if context menu wasn't shown)
            if (!waypointContextMenu.visible) {
              onWaypointClickRef.current?.(waypointId);
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
            waypointId,
          });
        }
      });

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
      })
        .setLngLat([waypoint.lon, waypoint.lat])
        .addTo(mapRef.current!);

      currentMarkers.set(waypointId, marker);
      currentHashes.set(waypointId, currentHash);
    });
  }, [waypoints, activeWaypointId, mapLoaded, theme, showAllLabels, showAllMarkers, selectedRouteId, routes, activeRouteId]);

  // Update waypoint marker in real-time when editing (name, symbol, and description)
  useEffect(() => {
    if (!editingPreview) return;

    const marker = waypointMarkersRef.current.get(editingPreview.id);
    if (marker) {
      const el = marker.getElement();
      // Update the label with short display name
      const labelEl = el.querySelector('.waypoint-marker__label');
      if (labelEl) {
        const displayName = getShortDisplayName(editingPreview.name || 'Waypoint');
        labelEl.textContent = displayName;
      }
      // Update the icon/symbol
      const iconEl = el.querySelector('.waypoint-marker__icon');
      if (iconEl) {
        const icon = WAYPOINT_SYMBOL_ICONS[editingPreview.symbol] || WAYPOINT_SYMBOL_ICONS['default'];
        iconEl.textContent = icon;
      }
      // Update the tooltip with full name and description
      const tooltip = editingPreview.description
        ? `${editingPreview.name}\n${editingPreview.description}`
        : editingPreview.name || '';
      el.title = tooltip;
    }
  }, [editingPreview]);

  // Draw enhanced navigation line from vessel to active waypoint with bearing/distance label
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const sourceId = 'nav-line-source';
    const lineLayerId = 'nav-line-layer';
    const labelLayerId = 'nav-line-label';

    // Remove existing layers and source
    [labelLayerId, lineLayerId].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    // Only draw line if we have vessel position and active waypoint
    if (!vessel?.position || !activeWaypointId) return;

    const activeWaypoint = waypoints.find((w) => w.id === activeWaypointId);
    if (!activeWaypoint) return;

    const vesselCoords: [number, number] = [vessel.position.lon, vessel.position.lat];
    const waypointCoords: [number, number] = [activeWaypoint.lon, activeWaypoint.lat];

    // Calculate midpoint for label placement
    const midLat = (vessel.position.lat + activeWaypoint.lat) / 2;
    const midLon = (vessel.position.lon + activeWaypoint.lon) / 2;

    // Calculate bearing and distance for labels
    const bearing = calculateBearing(
      vessel.position.lat,
      vessel.position.lon,
      activeWaypoint.lat,
      activeWaypoint.lon
    );
    const distance = calculateDistance(
      vessel.position.lat,
      vessel.position.lon,
      activeWaypoint.lat,
      activeWaypoint.lon
    );

    const labelText = `${formatBearing(bearing)}T  ${formatDistance(distance)}`;

    // Add GeoJSON source with line and label point
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { type: 'line' },
            geometry: {
              type: 'LineString',
              coordinates: [vesselCoords, waypointCoords],
            },
          },
          {
            type: 'Feature',
            properties: { type: 'label', text: labelText },
            geometry: {
              type: 'Point',
              coordinates: [midLon, midLat],
            },
          },
        ],
      },
    });

    // Navigation course line - marine standard magenta/fuchsia
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      filter: ['==', ['get', 'type'], 'line'],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': theme === 'night' ? '#ff6b9d' : '#c026d3',
        'line-width': 3,
        'line-opacity': 0.9,
      },
    });

    // Course label at midpoint
    map.addLayer({
      id: labelLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['get', 'type'], 'label'],
      layout: {
        'text-field': ['get', 'text'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-offset': [0, -1.2],
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': theme === 'night' ? '#ffffff' : '#1a1a2e',
        'text-halo-color': theme === 'night' ? '#1a1a2e' : '#ffffff',
        'text-halo-width': 2,
      },
    });
  }, [vessel?.position, activeWaypointId, waypoints, mapLoaded, theme]);

  // Draw navigation line from vessel to current waypoint when navigating a route
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const sourceId = 'route-nav-line-source';
    const lineLayerId = 'route-nav-line-layer';
    const labelLayerId = 'route-nav-line-label';

    // Remove existing layers and source
    [labelLayerId, lineLayerId].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    // Only draw line if we have vessel position and an active route
    if (!vessel?.position || !activeRouteId) return;

    // Find the active route
    const activeRoute = routes.find(r => r.route.id === activeRouteId);
    if (!activeRoute || activeRoute.waypoints.length === 0) return;

    // Get the current target waypoint from the route
    const targetWaypoint = activeRoute.waypoints[currentRouteWaypointIndex];
    if (!targetWaypoint) return;

    // Get the actual waypoint data (with current position if dragging)
    const waypointData = waypoints.find(w => w.id === targetWaypoint.id);
    if (!waypointData) return;

    const vesselCoords: [number, number] = [vessel.position.lon, vessel.position.lat];
    const waypointCoords: [number, number] = [waypointData.lon, waypointData.lat];

    // Calculate midpoint for label placement
    const midLat = (vessel.position.lat + waypointData.lat) / 2;
    const midLon = (vessel.position.lon + waypointData.lon) / 2;

    // Calculate bearing and distance for labels
    const bearing = calculateBearing(
      vessel.position.lat,
      vessel.position.lon,
      waypointData.lat,
      waypointData.lon
    );
    const distance = calculateDistance(
      vessel.position.lat,
      vessel.position.lon,
      waypointData.lat,
      waypointData.lon
    );

    const labelText = `${formatBearing(bearing)}T  ${formatDistance(distance)}`;

    // Add GeoJSON source with line and label point
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { type: 'line' },
            geometry: {
              type: 'LineString',
              coordinates: [vesselCoords, waypointCoords],
            },
          },
          {
            type: 'Feature',
            properties: { type: 'label', text: labelText },
            geometry: {
              type: 'Point',
              coordinates: [midLon, midLat],
            },
          },
        ],
      },
    });

    // Navigation course line - marine standard magenta/fuchsia
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      filter: ['==', ['get', 'type'], 'line'],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': theme === 'night' ? '#ff6b9d' : '#c026d3',
        'line-width': 3,
        'line-opacity': 0.9,
      },
    });

    // Course label at midpoint
    map.addLayer({
      id: labelLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['get', 'type'], 'label'],
      layout: {
        'text-field': ['get', 'text'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-offset': [0, -1.2],
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': theme === 'night' ? '#ffffff' : '#1a1a2e',
        'text-halo-color': theme === 'night' ? '#1a1a2e' : '#ffffff',
        'text-halo-width': 2,
      },
    });
  }, [vessel?.position, activeRouteId, routes, waypoints, currentRouteWaypointIndex, mapLoaded, theme]);

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

  // ============ ROUTE POLYLINES ============
  // Render routes as polylines on the map
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const routeSourceId = 'routes-source';
    const routeLayerId = 'routes-layer';
    const activeRouteLayerId = 'active-route-layer';

    // Remove existing layers
    [activeRouteLayerId, routeLayerId].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(routeSourceId)) {
      map.removeSource(routeSourceId);
    }

    // Build a map of waypoint positions from the waypoints prop for fallback
    const waypointPositionMap = new Map<number, { lat: number; lon: number }>();
    waypoints.forEach(wp => {
      if (wp.id !== null) {
        waypointPositionMap.set(wp.id, { lat: wp.lat, lon: wp.lon });
      }
    });

    // Build GeoJSON features for all routes
    // Filter out hidden routes (unless they are active)
    const features: GeoJSON.Feature[] = [];

    routes.forEach((routeWithWaypoints) => {
      const route = routeWithWaypoints.route;
      const routeWaypoints = routeWithWaypoints.waypoints;

      // Skip hidden routes (but always show active routes)
      const isActive = route.id === activeRouteId;
      if (route.hidden && !isActive) return;

      if (routeWaypoints.length < 2) return;

      // Build coordinates, using dragging position if waypoint is being dragged
      // Also check waypoints prop for latest positions as fallback
      const coordinates: [number, number][] = routeWaypoints.map(wp => {
        const wpId = wp.id;

        // First check if this waypoint is being dragged
        if (draggingWaypointState && wpId !== null && wpId === draggingWaypointState.id) {
          return [draggingWaypointState.lon, draggingWaypointState.lat];
        }

        // Fallback: check waypoints prop for current position (in case route waypoints are stale)
        if (wpId !== null) {
          const currentPos = waypointPositionMap.get(wpId);
          if (currentPos) {
            return [currentPos.lon, currentPos.lat];
          }
        }

        // Final fallback: use the route's embedded waypoint position
        return [wp.lon, wp.lat];
      });

      features.push({
        type: 'Feature',
        properties: {
          routeId: route.id,
          name: route.name,
          color: route.color || '#c026d3',
          isActive,
        },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      });
    });

    if (features.length === 0) return;

    // Add GeoJSON source
    map.addSource(routeSourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    });

    // Add inactive routes layer (dashed)
    map.addLayer({
      id: routeLayerId,
      type: 'line',
      source: routeSourceId,
      filter: ['==', ['get', 'isActive'], false],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    });

    // Add active route layer (solid, thicker)
    map.addLayer({
      id: activeRouteLayerId,
      type: 'line',
      source: routeSourceId,
      filter: ['==', ['get', 'isActive'], true],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 1,
      },
    });
  }, [routes, activeRouteId, mapLoaded, draggingWaypointState, waypoints]);

  // ============ ROUTE LINE CLICK HANDLERS ============
  // Handle right-click on route lines to show context menu
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const routeLayerId = 'routes-layer';
    const activeRouteLayerId = 'active-route-layer';

    // Find which segment of a route was clicked (returns index where to insert)
    const findSegmentIndex = (routeId: number, clickLngLat: maplibregl.LngLat): number => {
      const routeWithWaypoints = routes.find(r => r.route.id === routeId);
      if (!routeWithWaypoints || routeWithWaypoints.waypoints.length < 2) return 1;

      const routeWaypoints = routeWithWaypoints.waypoints;
      let minDist = Infinity;
      let bestIndex = 1;

      // Check distance to each segment
      for (let i = 0; i < routeWaypoints.length - 1; i++) {
        const wp1 = routeWaypoints[i];
        const wp2 = routeWaypoints[i + 1];

        // Calculate distance from point to line segment
        const dist = pointToSegmentDistance(
          clickLngLat.lat, clickLngLat.lng,
          wp1.lat, wp1.lon,
          wp2.lat, wp2.lon
        );

        if (dist < minDist) {
          minDist = dist;
          bestIndex = i + 1; // Insert after waypoint at index i
        }
      }

      return bestIndex;
    };

    // Simple point-to-segment distance calculation
    const pointToSegmentDistance = (
      pLat: number, pLon: number,
      aLat: number, aLon: number,
      bLat: number, bLon: number
    ): number => {
      const dx = bLon - aLon;
      const dy = bLat - aLat;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) {
        // Segment is a point
        return Math.sqrt((pLon - aLon) ** 2 + (pLat - aLat) ** 2);
      }

      // Project point onto line
      const t = Math.max(0, Math.min(1, ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq));
      const projLon = aLon + t * dx;
      const projLat = aLat + t * dy;

      return Math.sqrt((pLon - projLon) ** 2 + (pLat - projLat) ** 2);
    };

    // Right-click handler for route lines
    const handleRouteContextMenu = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      // Don't show route context menu during route creation
      if (routeCreationModeActive) return;

      const features = e.features;
      if (!features || features.length === 0) return;

      const feature = features[0];
      const routeId = feature.properties?.routeId as number | undefined;
      if (routeId === undefined) return;

      e.preventDefault();

      const rect = mapContainer.current?.getBoundingClientRect();
      if (!rect) return;

      const insertAtIndex = findSegmentIndex(routeId, e.lngLat);

      setRouteContextMenu({
        visible: true,
        x: e.point.x,
        y: e.point.y,
        routeId,
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
        insertAtIndex,
      });

      // Close other context menus
      setContextMenu(prev => ({ ...prev, visible: false }));
      setWaypointContextMenu(prev => ({ ...prev, visible: false }));
    };

    // Change cursor on hover over route lines
    const handleRouteMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const handleRouteMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    // Add event listeners for both route layers
    [routeLayerId, activeRouteLayerId].forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.on('contextmenu', layerId, handleRouteContextMenu);
        map.on('mouseenter', layerId, handleRouteMouseEnter);
        map.on('mouseleave', layerId, handleRouteMouseLeave);
      }
    });

    return () => {
      [routeLayerId, activeRouteLayerId].forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.off('contextmenu', layerId, handleRouteContextMenu);
          map.off('mouseenter', layerId, handleRouteMouseEnter);
          map.off('mouseleave', layerId, handleRouteMouseLeave);
        }
      });
    };
  }, [mapLoaded, routes, routeCreationModeActive]);

  // ============ TRACK POLYLINES ============
  // Render recorded tracks as polylines on the map
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const trackSourceId = 'tracks-source';
    const trackLayerId = 'tracks-layer';
    const recordingTrackLayerId = 'recording-track-layer';

    // Remove existing layers
    [recordingTrackLayerId, trackLayerId].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(trackSourceId)) {
      map.removeSource(trackSourceId);
    }

    // Build GeoJSON features for all tracks
    // Filter out hidden tracks (unless they are recording)
    const features: GeoJSON.Feature[] = [];

    tracks.forEach((trackWithPoints) => {
      const track = trackWithPoints.track;
      const points = trackWithPoints.points;

      // Skip hidden tracks (but always show recording tracks)
      const isRecording = track.id === recordingTrackId;
      if (track.hidden && !isRecording) return;

      if (points.length < 2) return;

      // Build coordinates from track points
      const coordinates: [number, number][] = points.map(pt => [pt.lon, pt.lat]);

      features.push({
        type: 'Feature',
        properties: {
          trackId: track.id,
          name: track.name,
          color: track.color || '#06b6d4', // Cyan default for tracks
          isRecording,
        },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      });
    });

    if (features.length === 0) return;

    // Add GeoJSON source
    map.addSource(trackSourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    });

    // Add completed tracks layer (solid line)
    map.addLayer({
      id: trackLayerId,
      type: 'line',
      source: trackSourceId,
      filter: ['==', ['get', 'isRecording'], false],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.8,
      },
    });

    // Add recording track layer (thicker, red, pulsing effect via CSS)
    map.addLayer({
      id: recordingTrackLayerId,
      type: 'line',
      source: trackSourceId,
      filter: ['==', ['get', 'isRecording'], true],
      paint: {
        'line-color': '#ef4444', // Red for recording
        'line-width': 3,
        'line-opacity': 1,
      },
    });
  }, [tracks, recordingTrackId, mapLoaded]);

  // ============ ACTIVE ROUTE WAYPOINT MARKERS ============
  // Show colored markers for waypoints of the active route
  // Green for current/next waypoint, blue for remaining waypoints
  const activeRouteMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;

    // Remove existing active route markers
    activeRouteMarkersRef.current.forEach(marker => marker.remove());
    activeRouteMarkersRef.current = [];

    // Find the active route
    const activeRoute = routes.find(r => r.route.id === activeRouteId);
    if (!activeRoute || activeRoute.waypoints.length === 0) return;

    // Create a map of waypoint IDs to current positions
    const waypointPositions = new Map<number, { lat: number; lon: number; name: string }>();
    waypoints.forEach(wp => {
      if (wp.id !== null) {
        waypointPositions.set(wp.id, { lat: wp.lat, lon: wp.lon, name: wp.name });
      }
    });

    // Create colored markers for each waypoint in the active route
    activeRoute.waypoints.forEach((routeWp, index) => {
      if (routeWp.id === null) return;

      // Get current position
      let currentPos = waypointPositions.get(routeWp.id);
      if (!currentPos) return;

      // Use dragging position if being dragged
      if (draggingWaypointState && routeWp.id === draggingWaypointState.id) {
        currentPos = { ...currentPos, lat: draggingWaypointState.lat, lon: draggingWaypointState.lon };
      }

      // Determine marker color: green for current waypoint, blue for rest
      const isCurrentWaypoint = index === currentRouteWaypointIndex;
      const markerColor = isCurrentWaypoint ? '#22c55e' : '#3b82f6'; // green-500 / blue-500

      const el = document.createElement('div');
      el.className = `active-route-waypoint-marker ${isCurrentWaypoint ? 'active-route-waypoint-marker--current' : ''}`;
      el.style.setProperty('--marker-color', markerColor);
      el.innerHTML = `<span class="active-route-waypoint-marker__num">${index + 1}</span>`;
      el.title = `${currentPos.name} (${isCurrentWaypoint ? 'Next waypoint' : `Waypoint ${index + 1}`})`;

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([currentPos.lon, currentPos.lat])
        .addTo(map);

      activeRouteMarkersRef.current.push(marker);
    });

    return () => {
      activeRouteMarkersRef.current.forEach(marker => marker.remove());
      activeRouteMarkersRef.current = [];
    };
  }, [activeRouteId, routes, waypoints, mapLoaded, currentRouteWaypointIndex, draggingWaypointState]);

  // ============ ROUTE CREATION MODE ============
  // Handle clicks during route creation to add waypoints
  // Also render temporary waypoints and preview line
  const routeCreationMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const creationSourceId = 'route-creation-source';
    const creationLineLayerId = 'route-creation-line';

    // Remove existing creation layers
    if (map.getLayer(creationLineLayerId)) map.removeLayer(creationLineLayerId);
    if (map.getSource(creationSourceId)) map.removeSource(creationSourceId);

    // Remove existing temp markers
    routeCreationMarkersRef.current.forEach(marker => marker.remove());
    routeCreationMarkersRef.current = [];

    if (!routeCreationModeActive || routeCreationWaypoints.length === 0) return;

    // Add temp waypoint markers
    routeCreationWaypoints.forEach((wp, index) => {
      const el = document.createElement('div');
      el.className = 'route-creation-marker';
      el.innerHTML = `<span class="route-creation-marker__num">${index + 1}</span>`;

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([wp.lon, wp.lat])
        .addTo(map);

      routeCreationMarkersRef.current.push(marker);
    });

    // Draw preview line if we have at least 2 points
    if (routeCreationWaypoints.length >= 2) {
      const coordinates: [number, number][] = routeCreationWaypoints.map(wp => [wp.lon, wp.lat]);

      map.addSource(creationSourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates,
          },
        },
      });

      map.addLayer({
        id: creationLineLayerId,
        type: 'line',
        source: creationSourceId,
        paint: {
          'line-color': '#c026d3',
          'line-width': 3,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        },
      });
    }

    // Cleanup on unmount
    return () => {
      routeCreationMarkersRef.current.forEach(marker => marker.remove());
      routeCreationMarkersRef.current = [];
    };
  }, [routeCreationModeActive, routeCreationWaypoints, mapLoaded]);

  // Handle map click during route creation mode
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !routeCreationModeActive) return;

    const map = mapRef.current;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      onRouteCreationClick?.(e.lngLat.lat, e.lngLat.lng);
    };

    map.on('click', handleClick);

    // Change cursor to crosshair during creation mode
    map.getCanvas().style.cursor = 'crosshair';

    return () => {
      map.off('click', handleClick);
      map.getCanvas().style.cursor = '';
    };
  }, [routeCreationModeActive, mapLoaded, onRouteCreationClick]);

  // ============ DOWNLOAD AREA POLYGON DRAWING ============
  // Handle clicks during download area mode to add polygon vertices
  const downloadAreaMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const sourceId = 'download-area-source';
    const fillLayerId = 'download-area-fill';
    const outlineLayerId = 'download-area-outline';

    // Remove existing layers
    if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
    if (map.getLayer(outlineLayerId)) map.removeLayer(outlineLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    // Remove existing markers
    downloadAreaMarkersRef.current.forEach(marker => marker.remove());
    downloadAreaMarkersRef.current = [];

    if (!downloadAreaModeActive || downloadAreaPoints.length === 0) return;

    // Add vertex markers
    downloadAreaPoints.forEach((pt, index) => {
      const el = document.createElement('div');
      el.className = 'download-area-marker';
      el.innerHTML = `<span class="download-area-marker__num">${index + 1}</span>`;

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pt.lon, pt.lat])
        .addTo(map);

      downloadAreaMarkersRef.current.push(marker);
    });

    // Draw polygon if we have at least 2 points
    if (downloadAreaPoints.length >= 2) {
      const coordinates: [number, number][] = downloadAreaPoints.map(pt => [pt.lon, pt.lat]);
      // Close the polygon by adding first point at the end
      const closedCoords = [...coordinates, coordinates[0]];

      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [closedCoords],
          },
        },
      });

      // Semi-transparent fill
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.15,
        },
      });

      // Dashed outline
      map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#3b82f6',
          'line-width': 2,
          'line-dasharray': [4, 2],
          'line-opacity': 0.8,
        },
      });
    }

    // Cleanup on unmount
    return () => {
      if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
      if (map.getLayer(outlineLayerId)) map.removeLayer(outlineLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      downloadAreaMarkersRef.current.forEach(marker => marker.remove());
      downloadAreaMarkersRef.current = [];
    };
  }, [downloadAreaModeActive, downloadAreaPoints, mapLoaded]);

  // Handle map click during download area DRAWING mode only (not configuring)
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !downloadAreaDrawingActive) return;

    const map = mapRef.current;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      onDownloadAreaClick?.(e.lngLat.lat, e.lngLat.lng);
    };

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      onDownloadAreaDoubleClick?.();
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);

    // Change cursor to crosshair during drawing mode
    map.getCanvas().style.cursor = 'crosshair';

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
      map.getCanvas().style.cursor = '';
    };
  }, [downloadAreaDrawingActive, mapLoaded, onDownloadAreaClick, onDownloadAreaDoubleClick]);

  // ============ OFFLINE PACK TILE LAYER ============
  // Display tiles from downloaded offline packs via the LA tile server
  useEffect(() => {
    console.log('[MapView] Offline pack useEffect triggered:', { activeDownloadedPackId, mapLoaded, offlinePacksCount: offlinePacks.length });

    if (!mapRef.current || !mapLoaded) {
      console.log('[MapView] Early return: mapRef or mapLoaded not ready');
      return;
    }

    const map = mapRef.current;
    const sourceId = 'offline-pack-tiles';
    const layerId = 'offline-pack-layer';

    // Remove existing layer and source
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    // If no pack is active, we're done
    if (!activeDownloadedPackId) {
      console.log('[MapView] No active pack, layer removed');
      return;
    }

    // Find the active pack to get its bounds and zoom levels
    const activePack = offlinePacks.find(p => p.id === activeDownloadedPackId);
    console.log('[MapView] Found active pack:', activePack ? { id: activePack.id, bounds: activePack.bounds, zoom_levels: activePack.zoom_levels } : 'NOT FOUND');
    console.log('[MapView] Available packs:', offlinePacks.map(p => ({ id: p.id, hasBounds: !!p.bounds })));
    if (!activePack) {
      console.log('[MapView] Active pack not found in offlinePacks');
      return;
    }

    const minZoom = activePack.zoom_levels ? Math.min(...activePack.zoom_levels) : 0;
    const maxZoom = activePack.zoom_levels ? Math.max(...activePack.zoom_levels) : 22;

    // Add the tile source from the LA tile server
    // Using pack-specific endpoint for better performance
    try {
      const tileUrl = `http://127.0.0.1:47924/tiles/${activeDownloadedPackId}/{z}/{x}/{y}.png`;
      console.log('[MapView] Adding source with URL:', tileUrl);
      console.log('[MapView] Source config:', { minZoom, maxZoom, bounds: activePack.bounds });

      // Note: Not specifying bounds - let MapLibre request tiles for the whole viewport
      // and the tile server will return 404 for tiles outside the pack
      map.addSource(sourceId, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: minZoom,
        maxzoom: maxZoom,
        // bounds removed to allow MapLibre to request all tiles
      });
      console.log('[MapView] Source added successfully');
    } catch (e) {
      console.error('[MapView] Error adding source:', e);
      return;
    }

    // Add the layer ON TOP of everything (no beforeLayer = add last = on top)
    try {
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 1,
        },
      });
      console.log('[MapView] Layer added on top of all layers');

      // Force MapLibre to re-render
      map.triggerRepaint();

      // Log all layers to see the order
      const layers = map.getStyle()?.layers;
      console.log('[MapView] Layer order:', layers?.map(l => l.id).slice(-5));
    } catch (e) {
      console.error('[MapView] Error adding layer:', e);
      return;
    }

    console.log('[MapView] Added offline pack layer:', activeDownloadedPackId, { minZoom, maxZoom, bounds: activePack.bounds });

    // Test fetch to verify the layer setup is working - use z=13 tiles that exist in the pack
    fetch(`http://127.0.0.1:47924/tiles/${activeDownloadedPackId}/13/8125/4505.png`)
      .then(r => console.log('[MapView] Test tile fetch status:', r.status, 'bytes:', r.headers.get('content-length')))
      .catch(e => console.error('[MapView] Test tile fetch error:', e));

    // Debug: Check if source and layer were added
    console.log('[MapView] Source exists:', !!map.getSource(sourceId));
    console.log('[MapView] Layer exists:', !!map.getLayer(layerId));
    console.log('[MapView] All layers:', map.getStyle()?.layers?.map(l => l.id));

    return () => {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    };
  }, [activeDownloadedPackId, offlinePacks, mapLoaded]);

  // ============ SELECTED ROUTE WAYPOINT MARKERS ============
  // Show numbered markers for waypoints when a route is selected/being edited
  const selectedRouteMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;

    // Remove existing selected route markers
    selectedRouteMarkersRef.current.forEach(marker => marker.remove());
    selectedRouteMarkersRef.current = [];

    // Find the selected route
    const selectedRoute = routes.find(r => r.route.id === selectedRouteId);
    if (!selectedRoute || selectedRoute.waypoints.length === 0) return;

    // Don't show markers for hidden routes
    if (selectedRoute.route.hidden) return;

    // Don't show during creation mode (to avoid confusion)
    if (routeCreationModeActive) return;

    const routeColor = selectedRoute.route.color || '#c026d3';

    // Create a map of waypoint IDs to current positions from waypoints prop
    // This ensures markers update when waypoints are dragged
    const waypointPositions = new Map<number, { lat: number; lon: number; name: string }>();
    waypoints.forEach(wp => {
      if (wp.id !== null) {
        waypointPositions.set(wp.id, { lat: wp.lat, lon: wp.lon, name: wp.name });
      }
    });

    // Create numbered markers for each waypoint in the route
    // Use order from route, but positions from waypoints prop or dragging state
    selectedRoute.waypoints.forEach((routeWp, index) => {
      if (routeWp.id === null) return;

      // Get current position - prefer dragging state for real-time updates
      let currentPos = waypointPositions.get(routeWp.id);
      if (!currentPos) return;

      // Use dragging position if this waypoint is being dragged
      if (draggingWaypointState && routeWp.id === draggingWaypointState.id) {
        currentPos = { ...currentPos, lat: draggingWaypointState.lat, lon: draggingWaypointState.lon };
      }

      const el = document.createElement('div');
      el.className = 'route-waypoint-marker';
      el.style.setProperty('--route-color', routeColor);
      el.innerHTML = `<span class="route-waypoint-marker__num">${index + 1}</span>`;
      el.title = `${currentPos.name} (Route waypoint ${index + 1})`;

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([currentPos.lon, currentPos.lat])
        .addTo(map);

      selectedRouteMarkersRef.current.push(marker);
    });

    // Cleanup
    return () => {
      selectedRouteMarkersRef.current.forEach(marker => marker.remove());
      selectedRouteMarkersRef.current = [];
    };
  }, [selectedRouteId, routes, waypoints, mapLoaded, routeCreationModeActive, draggingWaypointState]);

  // Close context menus when clicking elsewhere
  const handleCloseContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    setWaypointContextMenu((prev) => ({ ...prev, visible: false }));
    setRouteContextMenu((prev) => ({ ...prev, visible: false }));
  };

  // Close waypoint context menu
  const handleCloseWaypointContextMenu = () => {
    setWaypointContextMenu((prev) => ({ ...prev, visible: false }));
  };

  // Close route context menu
  const handleCloseRouteContextMenu = () => {
    setRouteContextMenu((prev) => ({ ...prev, visible: false }));
  };

  // Helper: Find routes that contain a specific waypoint
  const getRoutesForWaypoint = useCallback((waypointId: number) => {
    return routes.filter(r => r.waypoints.some(wp => wp.id === waypointId));
  }, [routes]);

  // Helper: Check if waypoint is at the start or end of a route
  const getWaypointPositionInRoute = useCallback((routeWithWaypoints: RouteWithWaypoints, waypointId: number): 'start' | 'end' | 'middle' | null => {
    const { waypoints: routeWaypoints } = routeWithWaypoints;
    if (routeWaypoints.length === 0) return null;

    const firstWp = routeWaypoints[0];
    const lastWp = routeWaypoints[routeWaypoints.length - 1];

    if (firstWp.id === waypointId) return 'start';
    if (lastWp.id === waypointId) return 'end';
    if (routeWaypoints.some(wp => wp.id === waypointId)) return 'middle';
    return null;
  }, []);

  // Handle waypoint delete from context menu
  const handleWaypointDelete = () => {
    if (waypointContextMenu.waypointId !== null) {
      onWaypointDeleteRef.current?.(waypointContextMenu.waypointId);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle navigate to waypoint from context menu
  const handleWaypointNavigate = () => {
    if (waypointContextMenu.waypointId !== null) {
      onWaypointNavigateRef.current?.(waypointContextMenu.waypointId);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle edit waypoint from context menu
  const handleWaypointEdit = () => {
    if (waypointContextMenu.waypointId !== null) {
      onWaypointEditRef.current?.(waypointContextMenu.waypointId);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle toggle hidden from context menu
  const handleWaypointToggleHidden = () => {
    if (waypointContextMenu.waypointId !== null) {
      onWaypointToggleHidden?.(waypointContextMenu.waypointId);
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

  // Handle "Add Route" option - starts route creation with first waypoint at clicked location
  const handleStartRouteCreation = () => {
    onStartRouteCreationRef.current?.(contextMenu.lat, contextMenu.lon);
    handleCloseContextMenu();
  };

  // Toggle orientation mode
  const handleOrientationToggle = () => {
    const newMode = orientationMode === 'north-up' ? 'heading-up' : 'north-up';
    onOrientationModeChangeRef.current?.(newMode);
  };

  // Toggle 3D mode (pitch)
  const handle3DToggle = () => {
    const map = mapRef.current;
    if (!map) return;

    const newIs3D = !is3DMode;
    setIs3DMode(newIs3D);

    map.easeTo({
      pitch: newIs3D ? 60 : 0, // Max pitch is 60 degrees
      duration: 500,
    });
  };

  // Handle removing waypoint from a route
  const handleRemoveWaypointFromRoute = (routeId: number) => {
    if (waypointContextMenu.waypointId !== null && onRemoveWaypointFromRoute) {
      onRemoveWaypointFromRoute(routeId, waypointContextMenu.waypointId);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle extending a route from an end waypoint
  const handleExtendRoute = (routeId: number, fromEnd: 'start' | 'end') => {
    if (onExtendRoute) {
      onExtendRoute(routeId, fromEnd);
    }
    handleCloseWaypointContextMenu();
  };

  // Handle inserting waypoint on route line
  const handleInsertWaypointOnRoute = () => {
    if (routeContextMenu.routeId !== null && onInsertWaypointInRoute) {
      onInsertWaypointInRoute(
        routeContextMenu.routeId,
        routeContextMenu.lat,
        routeContextMenu.lon,
        routeContextMenu.insertAtIndex
      );
    }
    handleCloseRouteContextMenu();
  };

  // Get waypoint name for context menu header
  const contextMenuWaypoint = waypointContextMenu.waypointId !== null
    ? waypoints.find(w => w.id === waypointContextMenu.waypointId)
    : null;

  // Get routes containing the context menu waypoint
  const contextMenuWaypointRoutes = waypointContextMenu.waypointId !== null
    ? getRoutesForWaypoint(waypointContextMenu.waypointId)
    : [];

  // Get route info for route context menu
  const contextMenuRoute = routeContextMenu.routeId !== null
    ? routes.find(r => r.route.id === routeContextMenu.routeId)
    : null;

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

      {/* 3D Mode Toggle Button */}
      <button
        className={`map-3d-toggle ${is3DMode ? 'map-3d-toggle--active' : ''}`}
        onClick={handle3DToggle}
        title={is3DMode ? 'Switch to 2D view' : 'Switch to 3D view'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {is3DMode ? (
            // 3D active icon - tilted cube perspective
            <>
              <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z" fill="none" />
              <path d="M12 2 L12 12 L2 7" fill="none" />
              <path d="M12 12 L22 7" fill="none" />
              <path d="M12 12 L12 22" fill="none" />
              <text x="12" y="16" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold">3D</text>
            </>
          ) : (
            // 2D icon - flat square
            <>
              <rect x="4" y="4" width="16" height="16" rx="2" fill="none" />
              <text x="12" y="15" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold">2D</text>
            </>
          )}
        </svg>
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
          <div className="map-context-menu__divider" />
          <button
            className="map-context-menu__item"
            onClick={handleStartRouteCreation}
          >
            <span className="map-context-menu__icon">🗺️</span>
            <span>Add Route</span>
          </button>
        </div>
      )}

      {/* Waypoint Context Menu */}
      {waypointContextMenu.visible && waypointContextMenu.waypointId !== null && (
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
            {contextMenuWaypoint?.name || 'Waypoint'}
          </div>
          <button
            className="map-context-menu__item"
            onClick={handleWaypointNavigate}
          >
            <span className="map-context-menu__icon">🧭</span>
            <span>Navigate to</span>
          </button>
          <button
            className="map-context-menu__item"
            onClick={handleWaypointEdit}
          >
            <span className="map-context-menu__icon">✏️</span>
            <span>Edit waypoint</span>
          </button>
          <button
            className="map-context-menu__item"
            onClick={handleWaypointToggleHidden}
          >
            <span className="map-context-menu__icon">{contextMenuWaypoint?.hidden ? '👁️' : '👁️‍🗨️'}</span>
            <span>{contextMenuWaypoint?.hidden ? 'Show on map' : 'Hide from map'}</span>
          </button>

          {/* Route-specific options for this waypoint */}
          {contextMenuWaypointRoutes.length > 0 && onRemoveWaypointFromRoute && (
            <>
              <div className="map-context-menu__divider" />
              <div className="map-context-menu__subheader">Routes</div>
              {contextMenuWaypointRoutes.map((routeWithWaypoints: RouteWithWaypoints) => {
                const route = routeWithWaypoints.route;
                const position = getWaypointPositionInRoute(routeWithWaypoints, waypointContextMenu.waypointId!);
                const isEndWaypoint = position === 'start' || position === 'end';
                const canDelete = routeWithWaypoints.waypoints.length > 2; // Keep at least 2 waypoints

                return (
                  <div key={route.id} className="map-context-menu__route-group">
                    <div className="map-context-menu__route-name" style={{ borderLeftColor: route.color || '#c026d3' }}>
                      {route.name}
                    </div>
                    {isEndWaypoint && onExtendRoute && (
                      <button
                        className="map-context-menu__item"
                        onClick={() => handleExtendRoute(route.id!, position as 'start' | 'end')}
                      >
                        <span className="map-context-menu__icon">➕</span>
                        <span>Extend route</span>
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="map-context-menu__item map-context-menu__item--warning"
                        onClick={() => handleRemoveWaypointFromRoute(route.id!)}
                      >
                        <span className="map-context-menu__icon">✂️</span>
                        <span>Remove from route</span>
                      </button>
                    )}
                    {!canDelete && (
                      <div className="map-context-menu__item map-context-menu__item--disabled">
                        <span className="map-context-menu__icon">⚠️</span>
                        <span>Min 2 waypoints</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          <div className="map-context-menu__divider" />
          <button
            className="map-context-menu__item map-context-menu__item--danger"
            onClick={handleWaypointDelete}
          >
            <span className="map-context-menu__icon">🗑️</span>
            <span>Delete waypoint</span>
          </button>
        </div>
      )}

      {/* Route Line Context Menu */}
      {routeContextMenu.visible && routeContextMenu.routeId !== null && contextMenuRoute && (
        <div
          className={`map-context-menu map-context-menu--${theme}`}
          style={{
            position: 'absolute',
            left: routeContextMenu.x,
            top: routeContextMenu.y,
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="map-context-menu__header" style={{ borderLeftColor: contextMenuRoute.route.color || '#c026d3' }}>
            {contextMenuRoute.route.name}
          </div>
          {onInsertWaypointInRoute && (
            <button
              className="map-context-menu__item"
              onClick={handleInsertWaypointOnRoute}
            >
              <span className="map-context-menu__icon">📍</span>
              <span>Insert waypoint here</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
