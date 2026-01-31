// Downloaded Pack Selection Bar
// Shows buttons for downloaded offline packs - similar to ChartBar but for
// custom downloaded areas. One pack can be active at a time.

import { useMemo } from 'react';
import type { PackInfo } from '../services/laClient';
import { LngLatBounds } from 'maplibre-gl';

interface DownloadedPackBarProps {
  packs: PackInfo[];
  viewportBounds: LngLatBounds | null;
  currentZoom: number;
  activePackId: string | null;
  onSelectPack: (packId: string | null) => void;
  onZoomToPack: (packId: string) => void;
}

/**
 * Check if pack bounds overlap with viewport bounds
 */
function boundsOverlap(
  packBounds: { min_lon: number; min_lat: number; max_lon: number; max_lat: number } | undefined,
  viewportBounds: LngLatBounds | null
): boolean {
  if (!packBounds || !viewportBounds) return false;

  const viewMinLon = viewportBounds.getWest();
  const viewMaxLon = viewportBounds.getEast();
  const viewMinLat = viewportBounds.getSouth();
  const viewMaxLat = viewportBounds.getNorth();

  // Standard bounding box overlap check
  return !(
    packBounds.max_lon < viewMinLon ||
    packBounds.min_lon > viewMaxLon ||
    packBounds.max_lat < viewMinLat ||
    packBounds.min_lat > viewMaxLat
  );
}

/**
 * Get abbreviated display name for pack
 */
function getDisplayName(pack: PackInfo): string {
  if (pack.name.length <= 12) {
    return pack.name;
  }
  return pack.name.slice(0, 10) + '...';
}

export function DownloadedPackBar({
  packs,
  viewportBounds,
  currentZoom,
  activePackId,
  onSelectPack,
  onZoomToPack,
}: DownloadedPackBarProps) {
  // Filter to ready packs that overlap viewport
  const visiblePacks = useMemo(() => {
    const readyPacks = packs.filter(p => p.status === 'ready');

    // If no viewport bounds yet, show all ready packs
    if (!viewportBounds) return readyPacks;

    // Filter to packs that overlap viewport and are in zoom range
    return readyPacks.filter((pack) => {
      // Check bounds overlap
      if (!boundsOverlap(pack.bounds, viewportBounds)) {
        return false;
      }

      // Check if current zoom is within pack's zoom levels
      if (pack.zoom_levels && pack.zoom_levels.length > 0) {
        const minZoom = Math.min(...pack.zoom_levels);
        const maxZoom = Math.max(...pack.zoom_levels);
        const zoomBuffer = 2;
        if (currentZoom < minZoom - zoomBuffer || currentZoom > maxZoom + zoomBuffer) {
          return false;
        }
      }

      return true;
    });
  }, [packs, viewportBounds, currentZoom]);

  // Don't render if no packs
  if (visiblePacks.length === 0) {
    return null;
  }

  return (
    <div className="downloaded-pack-bar">
      {/* Label */}
      <span className="downloaded-pack-bar__label">Offline:</span>

      {visiblePacks.map((pack) => {
        const displayName = getDisplayName(pack);
        const isActive = activePackId === pack.id;

        return (
          <button
            key={pack.id}
            className={`downloaded-pack-bar__item ${isActive ? 'downloaded-pack-bar__item--active' : ''}`}
            onClick={() => onSelectPack(isActive ? null : pack.id)}
            onDoubleClick={() => onZoomToPack(pack.id)}
            title={`${pack.name} (${pack.provider || 'osm'}) - Double-click to zoom`}
            aria-label={`${pack.name} - ${isActive ? 'active' : 'inactive'}`}
            aria-pressed={isActive}
          >
            <span className="downloaded-pack-bar__item-label">{displayName}</span>
            {pack.provider && pack.provider !== 'osm' && (
              <span className="downloaded-pack-bar__item-provider">
                {pack.provider === 'esri-satellite' ? '🛰' : ''}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
