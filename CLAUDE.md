# VortexNav Development Context

This file maintains continuity between Claude Code sessions. Read this first when resuming work.

---

## Current State (2026-01-26)

### Recent Work Completed
Layer management UI consolidation - merged "Base Nautical Chart" and "CM93 Vector Chart" into a single "Nautical Chart" section with expand/collapse UX pattern.

### Key Architecture Decisions

1. **No CM93 terminology in UI** - Users see "Nautical Chart", internal code uses CM93
2. **Frontend/Backend type separation**:
   - `NauticalChartSettings` / `NauticalChartStatus` - frontend-facing (camelCase)
   - `Cm93Settings` / `Cm93Status` - backend API (snake_case conversion in useTauri.ts)
3. **Layer naming convention**: All nautical layers use `nautical-*` prefix (e.g., `nautical-land`, `nautical-soundings`)
4. **GEBCO bathymetry OFF by default** - nautical chart provides depth data

### Layer Stacking Order (bottom to top)
```
1. basemap-layer           - Foundation (OSM, Esri, Google)
2. nautical-*              - Vector nautical data (from CM93)
3. gebco-color-layer       - Bathymetry depth colors
4. gebco-hillshade-layer   - Terrain relief
5. mbtiles-layer-*         - User-imported raster charts
6. gebco-contours-layer    - Depth contour lines
7. openseamap-overlay      - OpenSeaMap nav aids
8. nav-line-layer          - Active navigation line
```

---

## File Reference

### Frontend (TypeScript/React)
| File | Purpose |
|------|---------|
| `src/types/index.ts` | All TypeScript interfaces, includes NauticalChart* types |
| `src/components/LayerSwitcher.tsx` | Layer panel with LayerGroup expand/collapse component |
| `src/components/MapView.tsx` | Map rendering, nautical-* layers at lines 724-1080 |
| `src/App.tsx` | State management, nauticalSettings derived from cm93Settings |
| `src/hooks/useTauri.ts` | Tauri command bindings, CM93 API calls |
| `src/App.css` | All styles including .layer-group-* classes |

### Backend (Rust/Tauri)
| File | Purpose |
|------|---------|
| `src-tauri/src/commands.rs` | Tauri command handlers |
| `src-tauri/src/database.rs` | SQLite settings storage |
| `src-tauri/src/cm93/` | CM93 chart parsing and serving |
| `src-tauri/src/cm93/server.rs` | GeoJSON tile generation |
| `src-tauri/src/cm93/reader.rs` | Cell loading and caching |

---

## Known Issues / TODO

### High Priority
- [ ] CM93 layer visibility debugging - layers may not render if data path not configured
- [ ] Test nautical chart feature toggles (soundings, lights, buoys, etc.)

### Medium Priority
- [ ] Remove unused BaseNautical backend commands (kept for compatibility)
- [ ] Optimize CM93 cell caching for large datasets
- [ ] Add loading indicator when nautical chart data is fetching

### Low Priority
- [ ] Chunk size warning in build (1.3MB bundle)
- [ ] Consider code-splitting for map components

---

## Common Commands

```bash
# Development
cd vortexnav-app && npm run dev      # Frontend dev server
cd vortexnav-app && npm run tauri dev # Full Tauri app

# Build
cd vortexnav-app && npm run build    # TypeScript check + Vite build
cd vortexnav-app && npm run tauri build # Production build

# Rust only
cd vortexnav-app/src-tauri && cargo check
cd vortexnav-app/src-tauri && cargo build
```

---

## Session Notes

### 2026-01-26 - Layer Consolidation
- Completed full UI refactor for layer management
- Created LayerGroup component with expand/collapse
- Renamed cm93-* layers to nautical-*
- Removed Base Nautical Chart layer (was redundant with vector CM93)
- Added comprehensive CSS for new layer-group components
- Added "None" basemap option for debugging layer visibility
- Build passes, ready for testing

### Next Session Suggestions
1. Test the app with real CM93 data to verify layer rendering
2. Verify all feature toggles work (soundings, lights, etc.)
3. Consider adding user feedback for nautical chart loading state
