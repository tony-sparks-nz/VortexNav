// GPX file parser and generator for route import/export
// Supports GPX 1.0 and 1.1 formats

use quick_xml::de::from_str;
use quick_xml::se::to_string;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpxImportResult {
    pub routes_imported: usize,
    pub waypoints_imported: usize,
    pub tracks_imported: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpxRoutePoint {
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub ele: Option<f64>,
    pub time: Option<String>,
    pub desc: Option<String>,
    pub sym: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpxRoute {
    pub name: Option<String>,
    pub desc: Option<String>,
    pub points: Vec<GpxRoutePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpxWaypoint {
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub ele: Option<f64>,
    pub time: Option<String>,
    pub desc: Option<String>,
    pub sym: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpxTrack {
    pub name: Option<String>,
    pub desc: Option<String>,
    pub segments: Vec<Vec<GpxRoutePoint>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedGpx {
    pub waypoints: Vec<GpxWaypoint>,
    pub routes: Vec<GpxRoute>,
    pub tracks: Vec<GpxTrack>,
}

// GPX XML structures for deserialization
#[derive(Debug, Deserialize)]
#[serde(rename = "gpx")]
struct GpxXml {
    #[serde(default)]
    wpt: Vec<WptXml>,
    #[serde(default)]
    rte: Vec<RteXml>,
    #[serde(default)]
    trk: Vec<TrkXml>,
}

#[derive(Debug, Deserialize)]
struct WptXml {
    #[serde(rename = "@lat")]
    lat: f64,
    #[serde(rename = "@lon")]
    lon: f64,
    name: Option<String>,
    ele: Option<f64>,
    time: Option<String>,
    desc: Option<String>,
    sym: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RteXml {
    name: Option<String>,
    desc: Option<String>,
    #[serde(default)]
    rtept: Vec<WptXml>,
}

#[derive(Debug, Deserialize)]
struct TrkXml {
    name: Option<String>,
    desc: Option<String>,
    #[serde(default)]
    trkseg: Vec<TrksegXml>,
}

#[derive(Debug, Deserialize)]
struct TrksegXml {
    #[serde(default)]
    trkpt: Vec<WptXml>,
}

// GPX XML structures for serialization
#[derive(Debug, Serialize)]
#[serde(rename = "gpx")]
struct GpxXmlOut {
    #[serde(rename = "@version")]
    version: String,
    #[serde(rename = "@creator")]
    creator: String,
    #[serde(rename = "@xmlns")]
    xmlns: String,
    metadata: Option<MetadataXmlOut>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    wpt: Vec<WptXmlOut>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    rte: Vec<RteXmlOut>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    trk: Vec<TrkXmlOut>,
}

#[derive(Debug, Serialize)]
struct TrkXmlOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desc: Option<String>,
    trkseg: Vec<TrksegXmlOut>,
}

#[derive(Debug, Serialize)]
struct TrksegXmlOut {
    trkpt: Vec<TrkptXmlOut>,
}

#[derive(Debug, Serialize)]
struct TrkptXmlOut {
    #[serde(rename = "@lat")]
    lat: f64,
    #[serde(rename = "@lon")]
    lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ele: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    course: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<f64>,
}

#[derive(Debug, Serialize)]
struct MetadataXmlOut {
    name: Option<String>,
    time: Option<String>,
}

#[derive(Debug, Serialize)]
struct WptXmlOut {
    #[serde(rename = "@lat")]
    lat: f64,
    #[serde(rename = "@lon")]
    lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ele: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sym: Option<String>,
}

#[derive(Debug, Serialize)]
struct RteXmlOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desc: Option<String>,
    rtept: Vec<WptXmlOut>,
}

/// Parse a GPX file from disk
pub fn parse_gpx_file(path: &Path) -> Result<ParsedGpx, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read GPX file: {}", e))?;
    parse_gpx_string(&content)
}

/// Parse GPX content from a string
pub fn parse_gpx_string(content: &str) -> Result<ParsedGpx, String> {
    // Try to parse the GPX XML
    let gpx: GpxXml = from_str(content)
        .map_err(|e| format!("Failed to parse GPX XML: {}", e))?;

    // Convert waypoints
    let waypoints: Vec<GpxWaypoint> = gpx.wpt.into_iter().map(|w| GpxWaypoint {
        name: w.name,
        lat: w.lat,
        lon: w.lon,
        ele: w.ele,
        time: w.time,
        desc: w.desc,
        sym: w.sym,
    }).collect();

    // Convert routes
    let routes: Vec<GpxRoute> = gpx.rte.into_iter().map(|r| GpxRoute {
        name: r.name,
        desc: r.desc,
        points: r.rtept.into_iter().map(|p| GpxRoutePoint {
            name: p.name,
            lat: p.lat,
            lon: p.lon,
            ele: p.ele,
            time: p.time,
            desc: p.desc,
            sym: p.sym,
        }).collect(),
    }).collect();

    // Convert tracks
    let tracks: Vec<GpxTrack> = gpx.trk.into_iter().map(|t| GpxTrack {
        name: t.name,
        desc: t.desc,
        segments: t.trkseg.into_iter().map(|seg| {
            seg.trkpt.into_iter().map(|p| GpxRoutePoint {
                name: p.name,
                lat: p.lat,
                lon: p.lon,
                ele: p.ele,
                time: p.time,
                desc: p.desc,
                sym: p.sym,
            }).collect()
        }).collect(),
    }).collect();

    Ok(ParsedGpx { waypoints, routes, tracks })
}

/// Generate GPX XML for a list of routes
pub fn generate_gpx(routes: Vec<GpxRoute>, waypoints: Vec<GpxWaypoint>, name: Option<String>) -> Result<String, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let gpx = GpxXmlOut {
        version: "1.1".to_string(),
        creator: "VortexNav".to_string(),
        xmlns: "http://www.topografix.com/GPX/1/1".to_string(),
        metadata: Some(MetadataXmlOut {
            name,
            time: Some(now),
        }),
        wpt: waypoints.into_iter().map(|w| WptXmlOut {
            lat: w.lat,
            lon: w.lon,
            name: w.name,
            ele: w.ele,
            desc: w.desc,
            sym: w.sym,
        }).collect(),
        rte: routes.into_iter().map(|r| RteXmlOut {
            name: r.name,
            desc: r.desc,
            rtept: r.points.into_iter().map(|p| WptXmlOut {
                lat: p.lat,
                lon: p.lon,
                name: p.name,
                ele: p.ele,
                desc: p.desc,
                sym: p.sym,
            }).collect(),
        }).collect(),
        trk: vec![],
    };

    let xml = to_string(&gpx)
        .map_err(|e| format!("Failed to generate GPX XML: {}", e))?;

    // Add XML declaration
    Ok(format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{}", xml))
}

/// Generate GPX XML for a track
pub fn generate_track_gpx(track_with_points: &crate::database::TrackWithPoints) -> Result<String, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let track = &track_with_points.track;
    let points = &track_with_points.points;

    // Convert track points to GPX format
    let trkpts: Vec<TrkptXmlOut> = points.iter().map(|p| {
        // Convert SOG from knots to m/s for GPX (optional, most apps accept either)
        let speed_ms = p.sog.map(|s| s * 0.514444);

        TrkptXmlOut {
            lat: p.lat,
            lon: p.lon,
            time: Some(p.timestamp.clone()),
            ele: None,
            course: p.cog,
            speed: speed_ms,
        }
    }).collect();

    let gpx = GpxXmlOut {
        version: "1.1".to_string(),
        creator: "VortexNav".to_string(),
        xmlns: "http://www.topografix.com/GPX/1/1".to_string(),
        metadata: Some(MetadataXmlOut {
            name: Some(format!("VortexNav Track: {}", track.name)),
            time: Some(now),
        }),
        wpt: vec![],
        rte: vec![],
        trk: vec![TrkXmlOut {
            name: Some(track.name.clone()),
            desc: track.description.clone(),
            trkseg: vec![TrksegXmlOut { trkpt: trkpts }],
        }],
    };

    let xml = to_string(&gpx)
        .map_err(|e| format!("Failed to generate GPX XML: {}", e))?;

    // Add XML declaration
    Ok(format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{}", xml))
}

/// Generate a text summary of a track for sharing
pub fn generate_track_summary(
    track: &crate::database::Track,
    point_count: usize,
) -> String {
    let mut summary = format!("Track: {}\n", track.name);

    if let Some(ref desc) = track.description {
        if !desc.is_empty() {
            summary.push_str(&format!("Description: {}\n", desc));
        }
    }

    if let Some(distance) = track.total_distance_nm {
        summary.push_str(&format!("Distance: {:.1} nm\n", distance));
    }

    if let (Some(ref started), Some(ref ended)) = (&track.started_at, &track.ended_at) {
        summary.push_str(&format!("Started: {}\n", started));
        summary.push_str(&format!("Ended: {}\n", ended));
    }

    summary.push_str(&format!("Points: {}\n", point_count));

    summary.push_str("\nGenerated by VortexNav");
    summary
}

/// Generate GPX for a single route
pub fn generate_route_gpx(route: GpxRoute) -> Result<String, String> {
    generate_gpx(vec![route], vec![], Some("VortexNav Route Export".to_string()))
}

/// Generate a text summary of a route for sharing
pub fn generate_route_summary(
    name: &str,
    description: Option<&str>,
    waypoints: &[(String, f64, f64)], // (name, lat, lon)
    total_distance_nm: f64,
    estimated_time_hours: f64,
) -> String {
    let mut summary = format!("Route: {}\n", name);

    if let Some(desc) = description {
        if !desc.is_empty() {
            summary.push_str(&format!("Description: {}\n", desc));
        }
    }

    summary.push_str(&format!(
        "Distance: {:.1} nm | Estimated Time: {:.1} hours\n\n",
        total_distance_nm, estimated_time_hours
    ));

    summary.push_str("Waypoints:\n");
    for (i, (name, lat, lon)) in waypoints.iter().enumerate() {
        summary.push_str(&format!(
            "  {}. {} ({:.6}°, {:.6}°)\n",
            i + 1, name, lat, lon
        ));
    }

    summary.push_str("\nGenerated by VortexNav");
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_gpx() {
        let gpx_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
    <wpt lat="37.8044" lon="-122.4194">
        <name>San Francisco</name>
    </wpt>
    <rte>
        <name>Test Route</name>
        <rtept lat="37.8044" lon="-122.4194">
            <name>Start</name>
        </rtept>
        <rtept lat="21.3069" lon="-157.8583">
            <name>End</name>
        </rtept>
    </rte>
</gpx>"#;

        let result = parse_gpx_string(gpx_content);
        assert!(result.is_ok());

        let parsed = result.unwrap();
        assert_eq!(parsed.waypoints.len(), 1);
        assert_eq!(parsed.routes.len(), 1);
        assert_eq!(parsed.routes[0].points.len(), 2);
    }

    #[test]
    fn test_generate_gpx() {
        let route = GpxRoute {
            name: Some("Test Route".to_string()),
            desc: Some("A test route".to_string()),
            points: vec![
                GpxRoutePoint {
                    name: Some("Start".to_string()),
                    lat: 37.8044,
                    lon: -122.4194,
                    ele: None,
                    time: None,
                    desc: None,
                    sym: None,
                },
                GpxRoutePoint {
                    name: Some("End".to_string()),
                    lat: 21.3069,
                    lon: -157.8583,
                    ele: None,
                    time: None,
                    desc: None,
                    sym: None,
                },
            ],
        };

        let result = generate_route_gpx(route);
        assert!(result.is_ok());

        let xml = result.unwrap();
        assert!(xml.contains("Test Route"));
        assert!(xml.contains("37.8044"));
    }
}
