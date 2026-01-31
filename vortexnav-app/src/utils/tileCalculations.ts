/**
 * Tile Calculations for Offline Downloads
 *
 * Utility functions for calculating tile coordinates, counts, and sizes
 * for Web Mercator (EPSG:3857) tile pyramids.
 */

import type { AOIBounds, PolygonPoint } from '../types';
import { TILE_SIZE_ESTIMATES } from '../types';

const PI = Math.PI;

// ============ Coordinate Conversion ============

/**
 * Convert latitude to Web Mercator tile Y coordinate at given zoom.
 * Uses the standard Web Mercator projection formula.
 */
export function latToTileY(lat: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  const latRad = (lat * PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / PI) / 2) * n
  );
}

/**
 * Convert longitude to Web Mercator tile X coordinate at given zoom.
 */
export function lonToTileX(lon: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  return Math.floor(((lon + 180) / 360) * n);
}

/**
 * Convert tile Y to TMS Y (vertical flip).
 * TMS uses y=0 at the bottom, while XYZ uses y=0 at the top.
 */
export function xyzToTmsY(y: number, zoom: number): number {
  return (1 << zoom) - 1 - y;
}

// ============ Tile Range Calculation ============

export interface TileRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Convert bounding box to tile range at given zoom level.
 * Returns the range of tiles that cover the bounds.
 */
export function boundsToTileRange(bounds: AOIBounds, zoom: number): TileRange {
  const n = Math.pow(2, zoom);

  // Clamp latitude to Web Mercator limits
  const maxLat = Math.min(bounds.maxLat, 85.0511);
  const minLat = Math.max(bounds.minLat, -85.0511);

  return {
    minX: Math.floor(((bounds.minLon + 180) / 360) * n),
    maxX: Math.floor(((bounds.maxLon + 180) / 360) * n),
    minY: Math.floor(
      ((1 - Math.log(Math.tan((maxLat * PI) / 180) + 1 / Math.cos((maxLat * PI) / 180)) / PI) /
        2) *
        n
    ),
    maxY: Math.floor(
      ((1 - Math.log(Math.tan((minLat * PI) / 180) + 1 / Math.cos((minLat * PI) / 180)) / PI) /
        2) *
        n
    ),
  };
}

// ============ Tile Count Calculation ============

/**
 * Calculate the total number of tiles for a bounding box across zoom levels.
 */
export function calculateTileCount(
  bounds: AOIBounds,
  minZoom: number,
  maxZoom: number
): number {
  let totalTiles = 0;

  for (let z = minZoom; z <= maxZoom; z++) {
    const range = boundsToTileRange(bounds, z);
    const width = range.maxX - range.minX + 1;
    const height = range.maxY - range.minY + 1;
    totalTiles += width * height;
  }

  return totalTiles;
}

/**
 * Calculate tile count for each zoom level (for detailed display).
 */
export function calculateTileCountByZoom(
  bounds: AOIBounds,
  minZoom: number,
  maxZoom: number
): Map<number, number> {
  const tileCounts = new Map<number, number>();

  for (let z = minZoom; z <= maxZoom; z++) {
    const range = boundsToTileRange(bounds, z);
    const width = range.maxX - range.minX + 1;
    const height = range.maxY - range.minY + 1;
    tileCounts.set(z, width * height);
  }

  return tileCounts;
}

// ============ Size Estimation ============

/**
 * Estimate download size in bytes based on tile count and provider.
 */
export function estimateDownloadSize(
  tileCount: number,
  provider: string = 'default'
): number {
  const avgTileSize = TILE_SIZE_ESTIMATES[provider] || TILE_SIZE_ESTIMATES.default;
  return tileCount * avgTileSize;
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============ Area Calculation ============

/**
 * Calculate area in square nautical miles using the Haversine formula.
 * This approximates the area of a bounding box on a sphere.
 */
export function calculateAreaSquareNm(bounds: AOIBounds): number {
  const R_NM = 3440.065; // Earth radius in nautical miles

  const latDiff = ((bounds.maxLat - bounds.minLat) * PI) / 180;
  const lonDiff = ((bounds.maxLon - bounds.minLon) * PI) / 180;

  // Average latitude for width calculation
  const avgLat = ((bounds.maxLat + bounds.minLat) / 2) * (PI / 180);

  // Height in nm
  const height = latDiff * R_NM;

  // Width in nm (adjusted for latitude)
  const width = lonDiff * R_NM * Math.cos(avgLat);

  return Math.abs(width * height);
}

/**
 * Calculate area in square miles.
 */
export function calculateSquareMiles(bounds: AOIBounds): number {
  const sqNm = calculateAreaSquareNm(bounds);
  return sqNm * 1.32324; // 1 sq nm = 1.32324 sq mi
}

/**
 * Format area for display.
 */
export function formatArea(sqMiles: number): string {
  if (sqMiles < 1) {
    return `${(sqMiles * 640).toFixed(0)} acres`;
  }
  if (sqMiles < 100) {
    return `${sqMiles.toFixed(1)} sq mi`;
  }
  return `${sqMiles.toFixed(0)} sq mi`;
}

// ============ Polygon Utilities ============

/**
 * Calculate bounding box from polygon points.
 */
export function polygonToBounds(points: PolygonPoint[]): AOIBounds | null {
  if (points.length < 3) return null;

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const point of points) {
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
  }

  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Calculate polygon area using the Shoelace formula (in square degrees).
 * For accurate area, use calculateAreaSquareNm after converting to bounds.
 */
export function polygonAreaDegrees(points: PolygonPoint[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].lon * points[j].lat;
    area -= points[j].lon * points[i].lat;
  }

  return Math.abs(area / 2);
}

/**
 * Check if polygon is valid (at least 3 points, non-zero area).
 */
export function isValidPolygon(points: PolygonPoint[]): boolean {
  if (points.length < 3) return false;

  const bounds = polygonToBounds(points);
  if (!bounds) return false;

  // Check minimum size
  const latDiff = bounds.maxLat - bounds.minLat;
  const lonDiff = bounds.maxLon - bounds.minLon;

  return latDiff > 0.0001 && lonDiff > 0.0001;
}

/**
 * Convert polygon points to GeoJSON format for MapLibre.
 */
export function polygonToGeoJSON(
  points: PolygonPoint[],
  closed: boolean = false
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString> {
  const coordinates = points.map((p) => [p.lon, p.lat]);

  if (closed && points.length >= 3) {
    // Close the polygon by repeating the first point
    const closedCoords = [...coordinates, coordinates[0]];
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [closedCoords],
      },
    };
  }

  // Return as LineString if not closed
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

/**
 * Convert polygon points to vertex markers GeoJSON (for displaying point markers).
 */
export function polygonVerticesToGeoJSON(
  points: PolygonPoint[]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p, index) => ({
      type: 'Feature',
      properties: { index },
      geometry: {
        type: 'Point',
        coordinates: [p.lon, p.lat],
      },
    })),
  };
}
