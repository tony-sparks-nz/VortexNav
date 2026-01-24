# Esri SDK Compliance Analysis

## Esri Licensing, Offline Tiles, and Display Requirements

*Research conducted: 2026-01-24*
*Status: VERIFY IN CURRENT ESRI TERMS before implementation*

---

## Executive Summary

**Core Finding:** Esri's terms **DO require** that offline Esri-sourced basemap data be rendered through **licensed ArcGIS Runtime applications**. Converting Esri tiles to MBTiles for display in a non-Esri renderer (like VortexNav's MapLibre-based pipeline) is **likely non-compliant** under current terms.

**However:** Esri officially supports MapLibre GL JS for **online** basemap rendering via their [MapLibre ArcGIS plugin](https://developers.arcgis.com/maplibre-gl-js/). This requires active authentication and per-tile or per-session billing—not compatible with weeks-long offline operation.

**Recommendation:** Pursue a hybrid architecture where Esri is an optional premium layer for connected scenarios, with open data as the offline-first foundation. Alternatively, negotiate a custom enterprise agreement with Esri for offline redistribution rights.

---

## 1. The Core Compliance Question

### 1.1 Does Esri Require Esri Components for Display?

**YES** for offline scenarios. Key terms from [Esri's E300 Product-Specific Terms of Use](https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf) (November 2025):

> "Customer may take Online Services basemaps offline through Esri Content Packages and subsequently deliver (transfer) them to any device **for use with licensed ArcGIS Runtime applications** and ArcGIS Desktop. Customer may not otherwise scrape, download, or store Data."

**NO** for online scenarios. Esri provides an official [MapLibre ArcGIS plugin](https://github.com/Esri/maplibre-arcgis) enabling third-party renderers to consume Esri basemaps via authenticated API sessions.

### 1.2 What "Esri Components Involved in Display" Means

| Aspect | Online (Connected) | Offline (Disconnected) |
|--------|-------------------|----------------------|
| **Rendering Engine** | MapLibre permitted via official plugin | ArcGIS Runtime SDK **required** |
| **Authentication** | Access token per request/session | Embedded license in Runtime app |
| **Billing** | Per-tile or per-session charges | Included in Runtime license |
| **Attribution** | Must display "Powered by Esri" + data providers | Same requirement |
| **Data Format** | Streamed tiles via API | TPK/TPKX/VTPK packages only |

### 1.3 Explicit Prohibitions

From E300 and related terms:

1. **No programmatic tile export:** "Programmatic use of session tokens (e.g., exporting volumes of basemap tiles) is not permitted."

2. **No external database storage:** "Customer may not extract, or store results in external databases, nor create derivative works."

3. **No redistribution:** "These Terms of Use do not transfer any rights to redistribute, prepare derivative works from, or acquire ownership interest in Services."

4. **No third-party delivery:** "Customer may not act directly or authorize its customers to cobrand Data, use Data in any unauthorized service or product, or offer Data through or on behalf of any third party."

---

## 2. Compliance Checklist

### A. Data Flow and Transformation Boundaries

| Step | Permitted? | Notes | VERIFY |
|------|-----------|-------|--------|
| **Calling tile APIs to fetch imagery** | ✅ Permitted (online) | Requires valid access token, billed per tile/session | Current pricing |
| **Storing tiles in device cache** | ⚠️ Conditional | Only via ArcGIS Runtime managed cache or approved offline workflow | Cache size limits |
| **Converting tiles to MBTiles** | ❌ Prohibited | "May not extract or store in external databases" | N/A |
| **Merging Esri tiles with non-Esri layers** | ⚠️ Uncertain | Likely prohibited as "derivative work" | Custom agreement |
| **Redistributing packaged tiles to customers** | ❌ Prohibited | Explicit prohibition unless licensed as redistributor | Redistribution license |
| **Generating derived products (mosaics, etc.)** | ❌ Prohibited | "May not create derivative works" | N/A |
| **Using Esri data in non-Esri renderer (offline)** | ❌ Prohibited | Must be "licensed ArcGIS Runtime applications" | N/A |

### B. Display Path Strategies Assessment

#### Strategy 1: Esri SDK Renders Esri Layers

| Aspect | Assessment |
|--------|------------|
| **Compliance** | ✅ **COMPLIANT** |
| **Implementation** | Use ArcGIS Maps SDK for .NET, Qt, or Native |
| **Offline behavior** | TPK/TPKX packages, Runtime manages cache |
| **Complexity** | HIGH - dual rendering engines, synchronization challenges |
| **UX Impact** | Potential visual inconsistency between layers |
| **Licensing Cost** | ArcGIS Runtime deployment pack ($varies) |

#### Strategy 2: Esri Tiles → MBTiles → Non-Esri Renderer

| Aspect | Assessment |
|--------|------------|
| **Compliance** | ❌ **NON-COMPLIANT** |
| **Why** | Violates: extraction prohibition, derivative works prohibition, Runtime requirement for offline |
| **Risk** | License termination, legal action |
| **Recommendation** | Do not pursue |

#### Strategy 3: Hybrid - Esri SDK for Esri Layers, Own Engine for Open Data

| Aspect | Assessment |
|--------|------------|
| **Compliance** | ⚠️ **UNCERTAIN** - likely compliant if properly segregated |
| **Implementation** | Two map views or overlay architecture |
| **Offline behavior** | Esri layers via Runtime; open layers via MapLibre |
| **Complexity** | VERY HIGH - gesture sync, z-ordering, performance |
| **Practical for marine nav** | LOW - safety-critical context requires single deterministic view |

#### Strategy 4: Customer Direct Access Model

| Aspect | Assessment |
|--------|------------|
| **Compliance** | ⚠️ **POTENTIALLY COMPLIANT** |
| **Implementation** | Customer signs up for ArcGIS Location Platform, uses their own API key |
| **Offline behavior** | Limited - depends on customer's Runtime license |
| **Our role** | Integration support, not data redistribution |
| **Limitation** | Doesn't solve offline problem; transfers complexity to customer |

### C. Authentication and Licensing Enforcement

| Requirement | Esri Expectation | VortexNav Implications |
|-------------|------------------|----------------------|
| **Organization API key** | One key per organization, usage tracked | We pay for all customer usage OR customers provide keys |
| **Per-user login** | OAuth2 with ArcGIS account | Requires customer Esri accounts |
| **Device-bound licensing** | Runtime licenses tied to device or app | Each VortexNav instance needs license |
| **Token rotation** | Access tokens expire, refresh tokens for long-lived sessions | Offline incompatible |
| **Audit logging** | Log tile requests, sessions, downloads | Must implement for compliance |

### D. Attribution Requirements

| Requirement | Implementation |
|-------------|---------------|
| **"Powered by Esri"** | Must display clearly, bottom-right recommended |
| **Data provider names** | All providers visible on map (TomTom, Garmin, etc.) |
| **Copyright notices** | Must not be removed or obscured |
| **Esri logo** | Must not be altered |
| **Offline display** | Same requirements apply |
| **Print/export** | Attribution must appear on all outputs |

### E. Caching and Offline Packaging

| Term | Esri Definition | Implications |
|------|-----------------|--------------|
| **Cache** | Temporary device storage managed by SDK | Auto-expires, size-limited |
| **Offline package** | TPK/TPKX/VTPK created via official tools | Permanent, requires Runtime |
| **Content Package** | Esri-provided basemap packages | Approved for offline use with Runtime |
| **Encryption** | Not required for TPK files | But extraction prohibited |
| **Size limits** | Varies by package type | World Imagery (for Export) supports large areas |
| **Time limits** | No explicit limit for packages | But license must remain valid |
| **Device limits** | Per Runtime license | One license per deployed app instance |

### F. Redistribution and Sublicensing Models

| Model | Description | Likely Permitted? | License Required |
|-------|-------------|-------------------|------------------|
| **Reseller/Redistributor** | Vortex packages and sells Esri content | ❌ Prohibited without agreement | Redistribution License (custom) |
| **Integrator** | Vortex embeds Esri SDK, customers access via our account | ⚠️ Permitted with proper licensing | Enterprise agreement |
| **Pass-through** | Customers use their own Esri credentials | ✅ Permitted | Customers' own licenses |
| **Value-Added App** | Esri layers as component, not primary product | ⚠️ Permitted with Runtime license | ArcGIS Runtime deployment pack |

### G. Marine Navigation Specific Considerations

| Factor | Concern | Mitigation |
|--------|---------|------------|
| **Global coverage** | Large tile volumes required | Enterprise agreement for bulk offline |
| **Weeks offline** | Token expiry incompatible | Requires embedded Runtime license |
| **Safety critical** | Single deterministic view needed | Dual-engine hybrid unsuitable |
| **Mixed overlays** | AIS, routes, hazards over imagery | Technical challenge with Runtime |
| **Continuous pan/zoom** | High tile consumption | Session model preferred over per-tile |
| **Limited connectivity** | Satellite links unreliable | Must be truly offline-first |

---

## 3. Compliance Decision Matrix

| Scenario | Compliance | License/Approval Needed | Primary Risk | VERIFY |
|----------|------------|------------------------|--------------|--------|
| **Esri tiles via Runtime SDK, managed cache** | ✅ Likely Compliant | ArcGIS Runtime deployment pack | License cost | Pricing |
| **Esri tiles via MapLibre, online only** | ✅ Compliant | ArcGIS Location Platform subscription | Offline not supported | Session limits |
| **Esri tiles exported to MBTiles, non-Esri renderer** | ❌ Non-Compliant | N/A - prohibited | License termination | N/A |
| **Derived products from Esri imagery, redistributed** | ❌ Non-Compliant | N/A - prohibited | Legal action | N/A |
| **Customer downloads directly with own credentials** | ✅ Compliant | Customer's own ArcGIS account | Customer complexity | Customer terms |
| **Esri Content Packages via Runtime, redistributed in app** | ⚠️ Uncertain | Custom redistribution agreement | Unapproved redistribution | Esri sales |
| **Hybrid: Esri SDK + MapLibre separate views** | ⚠️ Uncertain | Runtime + Location Platform | Technical complexity | Feasibility |

---

## 4. Reference Architectures

### Architecture A: Esri SDK-Centric (Compliant but Complex)

```
┌─────────────────────────────────────────────────────────────────┐
│                        VortexNav Application                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     ArcGIS Maps SDK                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │ Esri World  │  │ Esri Vector │  │ Custom Layers   │   │  │
│  │  │ Imagery     │  │ Basemap     │  │ (via SDK)       │   │  │
│  │  │ (TPK)       │  │ (VTPK)      │  │                 │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │  │
│  │         │                │                   │            │  │
│  │         └────────────────┴───────────────────┘            │  │
│  │                          │                                 │  │
│  │              ┌───────────▼───────────┐                    │  │
│  │              │   ArcGIS Runtime      │                    │  │
│  │              │   Rendering Engine    │                    │  │
│  │              └───────────────────────┘                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Open Data Layers (separate view?)             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │ OpenSeaMap  │  │ NOAA Charts │  │ AIS / Routes    │   │  │
│  │  │ (MBTiles)   │  │ (S-57)      │  │ (GeoJSON)       │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Data Storage (Offline):
├── Esri Content: /esri/
│   ├── world_imagery.tpk    (Esri-managed)
│   └── vector_basemap.vtpk  (Esri-managed)
├── Open Data: /charts/
│   ├── noaa_enc.mbtiles
│   ├── openseamap.mbtiles
│   └── sentinel2_global.mbtiles
└── User Data: /user/
    ├── routes.gpx
    └── waypoints.sqlite
```

**Offline Behavior:**
- Esri layers: Fully offline via TPK/VTPK packages, requires valid Runtime license
- Open layers: Fully offline via MBTiles
- Challenge: Synchronizing two rendering engines

**Compliance Enforcement:**
- Runtime SDK validates license at startup
- Attribution automatically displayed by SDK
- Audit logs via SDK telemetry

**Pros:** Fully compliant, Esri-supported path
**Cons:** Complex dual-engine architecture, potential UX inconsistency, additional licensing cost

---

### Architecture B: Customer Credential Direct Access (Transfers Responsibility)

```
┌─────────────────────────────────────────────────────────────────┐
│                        VortexNav Application                     │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    MapLibre GL JS                          │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Unified Rendering Engine                │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                          │                                 │  │
│  │  ┌───────────┬───────────┼───────────┬───────────────┐   │  │
│  │  │           │           │           │               │   │  │
│  │  ▼           ▼           ▼           ▼               ▼   │  │
│  │ Open Data  User's Esri  NOAA       AIS/Routes    Vortex │  │
│  │ (MBTiles)  Account*     (MBTiles)  (Live)        Horizon│  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

* Customer provides their own ArcGIS Location Platform API key
  - Online only (session-based authentication)
  - Customer pays for their own tile consumption
  - Customer agrees to Esri terms directly

Data Storage:
├── Always Offline: /charts/
│   ├── vortex_horizon.mbtiles  (our product)
│   ├── noaa_enc.mbtiles
│   └── openseamap.mbtiles
├── Customer Esri (if configured):
│   └── [Streamed online only, not cached]
└── User Data: /user/
    └── ...
```

**Offline Behavior:**
- Esri layers: NOT AVAILABLE offline (online streaming only)
- Open layers: Fully offline
- Limitation: Does not solve offshore disconnected use case

**Compliance Enforcement:**
- Customer's API key authenticates directly with Esri
- Customer accepts Esri terms
- Vortex has no redistribution liability

**Pros:** No Esri licensing for Vortex, customer relationship with Esri
**Cons:** Does not solve offline requirement, adds customer complexity

---

### Architecture C: Open Data First, Esri as Optional Premium (RECOMMENDED)

```
┌─────────────────────────────────────────────────────────────────┐
│                        VortexNav Application                     │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    MapLibre GL JS                          │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Unified Rendering Engine                │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                          │                                 │  │
│  │  ┌───────────┬───────────┼───────────┬───────────────┐   │  │
│  │  │           │           │           │               │   │  │
│  │  ▼           ▼           ▼           ▼               ▼   │  │
│  │ Vortex    Sentinel-2   NOAA       AIS/Routes    OpenSeaMap│  │
│  │ Horizon   (CC BY-SA)   (Public    (Live)        (ODbL)   │  │
│  │ (Ours)                  Domain)                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  OPTIONAL: Esri Premium Layer (when connected)             │  │
│  │  - User enables in settings                                │  │
│  │  - User provides own API key OR subscribes via Vortex      │  │
│  │  - Streaming only, never cached/offline                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Data Storage:
├── Core Offline Package: /charts/
│   ├── vortex_horizon_caribbean.mbtiles  (our Sentinel-2 product)
│   ├── vortex_horizon_pacific.mbtiles
│   ├── noaa_enc_complete.mbtiles         (public domain)
│   └── openseamap_global.mbtiles         (ODbL)
├── Premium Online: [streaming only]
│   └── Esri World Imagery (when connected + enabled)
└── User Data: /user/
    └── ...
```

**Offline Behavior:**
- Primary: Vortex Horizon (Sentinel-2 based) + NOAA + OpenSeaMap = fully offline
- Premium: Esri available only when connected, enhances harbor detail
- No Esri dependency for safety-critical offshore navigation

**Compliance Enforcement:**
- Esri layer is optional, streaming only, properly authenticated
- Open data properly attributed (CC BY-SA, ODbL, public domain)
- No extraction or conversion of Esri data

**Pros:**
- Solves offline requirement without Esri dependency
- Esri available as value-add when connected
- Single rendering engine (MapLibre)
- Lower licensing complexity

**Cons:**
- Vortex Horizon requires investment in Sentinel-2 processing pipeline
- Esri's higher-resolution imagery (0.3m) not available offline

---

## 5. Questions for Esri Account Management

Send these precise questions to Esri to clarify uncertainties:

### A. Display Requirements

1. "We are building a marine navigation application using MapLibre GL JS for rendering. Can we use ArcGIS Location Platform basemaps via the MapLibre ArcGIS plugin for **offline, disconnected use** (vessels at sea for weeks without internet)?"

2. "If offline use with MapLibre is not permitted, can we use ArcGIS Maps SDK for .NET/Qt to render Esri layers while simultaneously rendering non-Esri layers (OpenSeaMap, NOAA charts) via a separate MapLibre view in the same application?"

3. "Is converting Esri basemap tiles (obtained via World Imagery for Export or basemap APIs) to MBTiles format for use in a non-Esri renderer permitted under any licensing tier?"

### B. Offline Packaging

4. "What is the approved method for creating offline tile packages (TPK/TPKX) of World Imagery for areas up to 40GB (global coastal coverage at z0-z15)?"

5. "Can we pre-generate offline tile packages and include them in our application installer for customer deployment, or must each customer download packages individually?"

6. "What are the cache size, time, and geographic limits for offline tile packages of World Imagery?"

### C. Licensing and Redistribution

7. "We operate Vortex Horizon, a product that delivers offline chart packages to cruising vessels. What licensing tier or agreement would permit us to include Esri World Imagery in these packages?"

8. "Is there a 'Redistribution License' available for Esri basemap imagery that would allow us to distribute pre-packaged tile sets to customers?"

9. "What is the cost structure for an enterprise agreement that would permit offline redistribution of Esri basemap content to [estimated customer count] vessels?"

### D. Attribution and Audit

10. "In an offline scenario where no network connectivity exists for weeks, how should we implement attribution display and audit logging to remain compliant?"

11. "Is there a technical requirement to use Esri's SDK for audit/telemetry purposes, or can we implement our own audit logging?"

### E. Marine-Specific

12. "Are there any special terms or programs for marine navigation applications that operate in safety-critical contexts with extended offline periods?"

13. "Does Esri offer any marine-specific basemaps or partnerships with hydrographic organizations that might be relevant to our use case?"

---

## 6. Summary and Recommendations

### Immediate Actions

1. **Do not proceed** with Esri tile → MBTiles → non-Esri renderer pipeline. This is clearly non-compliant.

2. **Contact Esri account management** with the questions above before finalizing architecture.

3. **Prioritize Vortex Horizon development** (Sentinel-2 based) as the primary offline imagery solution.

4. **Implement Esri as optional online premium layer** using the MapLibre ArcGIS plugin for connected scenarios.

### If Custom Esri Agreement is Desired

Request a meeting with Esri enterprise sales to discuss:
- Custom redistribution agreement for marine navigation
- Volume pricing for offline tile packages
- Hybrid licensing that permits our architecture

### VERIFY IN CURRENT ESRI TERMS

| Item | Where to Verify | Contact |
|------|-----------------|---------|
| E300 document (November 2025 version) | [Esri Legal](https://www.esri.com/en-us/legal/terms/product-specific-terms-of-use) | Download current PDF |
| MapLibre plugin terms | [GitHub repo](https://github.com/Esri/maplibre-arcgis) + Developer docs | Apache 2.0 (plugin), service terms separate |
| World Imagery (for Export) limits | [ArcGIS Online item page](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Check item details |
| Runtime deployment pack pricing | Esri account manager | Direct quote required |
| Enterprise redistribution agreement | Esri enterprise sales | Custom negotiation |

---

## Sources

- [Esri E300 Product-Specific Terms of Use](https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf)
- [Esri Redistribution Rights](https://www.esri.com/en-us/legal/redistribution-rights)
- [Esri Data Attributions and Terms of Use](https://www.esri.com/en-us/legal/terms/data-attributions)
- [Esri and Data Attribution Requirements](https://developers.arcgis.com/documentation/esri-and-data-attribution/)
- [MapLibre GL JS and ArcGIS](https://developers.arcgis.com/maplibre-gl-js/)
- [MapLibre ArcGIS Plugin GitHub](https://github.com/Esri/maplibre-arcgis)
- [ArcGIS Maps SDK License and Deployment](https://developers.arcgis.com/net/license-and-deployment/)
- [ArcGIS Basemap Styles Service](https://developers.arcgis.com/rest/basemap-styles/)
- [Take Web Maps Offline - Esri Documentation](https://doc.arcgis.com/en/arcgis-online/manage-data/take-maps-offline.htm)
- [Tile Package Specification - GitHub](https://github.com/Esri/tile-package-spec)
