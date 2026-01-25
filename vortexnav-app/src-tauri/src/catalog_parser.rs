// Catalog parser for RNC and ENC XML catalog files

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CatalogParseError {
    #[error("XML parsing error: {0}")]
    XmlError(#[from] quick_xml::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Unknown catalog format")]
    UnknownFormat,
    #[error("Missing required field: {0}")]
    MissingField(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedCatalog {
    pub name: String,
    pub catalog_type: String,  // "RNC" or "ENC"
    pub charts: Vec<ParsedChart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedChart {
    pub chart_id: String,
    pub title: String,
    pub chart_type: String,
    pub format: Option<String>,
    pub scale: Option<i64>,
    pub status: Option<String>,
    pub download_url: String,
    pub file_size: Option<i64>,
    pub last_updated: Option<String>,
    pub bounds: Option<String>,
}

/// Parse a catalog XML file and return the parsed catalog
pub fn parse_catalog_xml(xml_content: &str) -> Result<ParsedCatalog, CatalogParseError> {
    // Detect catalog type by looking at root element
    if xml_content.contains("<RncProductCatalogChartCatalogs") || xml_content.contains("<RncProductCatalog") {
        parse_rnc_catalog(xml_content)
    } else if xml_content.contains("<EncProductCatalog") {
        parse_enc_catalog(xml_content)
    } else {
        Err(CatalogParseError::UnknownFormat)
    }
}

/// Parse RNC (Raster Nautical Chart) catalog XML
fn parse_rnc_catalog(xml_content: &str) -> Result<ParsedCatalog, CatalogParseError> {
    let mut reader = Reader::from_str(xml_content);
    reader.trim_text(true);

    let mut catalog_name = String::from("RNC Catalog");
    let mut charts: Vec<ParsedChart> = Vec::new();
    let mut buf = Vec::new();

    // Current parsing state
    let mut in_header = false;
    let mut in_chart = false;
    let mut current_element = String::new();

    // Current chart being parsed
    let mut chart_number = String::new();
    let mut chart_title = String::new();
    let mut chart_format = None;
    let mut chart_url = String::new();
    let mut chart_datetime = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                current_element = name.clone();

                match name.as_str() {
                    "Header" => in_header = true,
                    "chart" => {
                        in_chart = true;
                        chart_number = String::new();
                        chart_title = String::new();
                        chart_format = None;
                        chart_url = String::new();
                        chart_datetime = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();

                match name.as_str() {
                    "Header" => in_header = false,
                    "chart" => {
                        if in_chart && !chart_url.is_empty() {
                            charts.push(ParsedChart {
                                chart_id: chart_number.clone(),
                                title: if chart_title.is_empty() { chart_number.clone() } else { chart_title.clone() },
                                chart_type: "RNC".to_string(),
                                format: chart_format.clone().or(Some("BSB".to_string())),
                                scale: None,
                                status: Some("Active".to_string()),
                                download_url: chart_url.clone(),
                                file_size: None,
                                last_updated: chart_datetime.clone(),
                                bounds: None,
                            });
                        }
                        in_chart = false;
                    }
                    _ => {}
                }
                current_element.clear();
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();

                if in_header && current_element == "title" {
                    catalog_name = text;
                } else if in_chart {
                    match current_element.as_str() {
                        "number" => chart_number = text,
                        "title" => chart_title = text,
                        "format" => chart_format = Some(text),
                        "zipfile_location" => chart_url = text,
                        "zipfile_datetime_iso8601" => chart_datetime = Some(text),
                        _ => {}
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(CatalogParseError::XmlError(e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(ParsedCatalog {
        name: catalog_name,
        catalog_type: "RNC".to_string(),
        charts,
    })
}

/// Parse ENC (Electronic Navigational Chart) catalog XML
fn parse_enc_catalog(xml_content: &str) -> Result<ParsedCatalog, CatalogParseError> {
    let mut reader = Reader::from_str(xml_content);
    reader.trim_text(true);

    let mut catalog_name = String::from("ENC Catalog");
    let mut charts: Vec<ParsedChart> = Vec::new();
    let mut buf = Vec::new();

    // Current parsing state
    let mut in_header = false;
    let mut in_cell = false;
    let mut in_cov = false;
    let mut in_panel = false;
    let mut in_vertex = false;
    let mut current_element = String::new();

    // Current chart being parsed
    let mut cell_name = String::new();
    let mut cell_lname = String::new();
    let mut cell_scale: Option<i64> = None;
    let mut cell_status = None;
    let mut cell_url = String::new();
    let mut cell_size: Option<i64> = None;
    let mut cell_updated = None;
    let mut vertices: Vec<(f64, f64)> = Vec::new();
    let mut current_lat: Option<f64> = None;
    let mut current_lon: Option<f64> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                current_element = name.clone();

                match name.as_str() {
                    "Header" => in_header = true,
                    "cell" => {
                        in_cell = true;
                        cell_name = String::new();
                        cell_lname = String::new();
                        cell_scale = None;
                        cell_status = None;
                        cell_url = String::new();
                        cell_size = None;
                        cell_updated = None;
                        vertices.clear();
                    }
                    "cov" => in_cov = true,
                    "panel" => in_panel = true,
                    "vertex" => {
                        in_vertex = true;
                        current_lat = None;
                        current_lon = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();

                match name.as_str() {
                    "Header" => in_header = false,
                    "cell" => {
                        if in_cell && !cell_url.is_empty() {
                            // Convert vertices to bounds JSON if available
                            let bounds = if !vertices.is_empty() {
                                Some(serde_json::to_string(&vertices).unwrap_or_default())
                            } else {
                                None
                            };

                            charts.push(ParsedChart {
                                chart_id: cell_name.clone(),
                                title: if cell_lname.is_empty() { cell_name.clone() } else { cell_lname.clone() },
                                chart_type: "ENC".to_string(),
                                format: Some("S57".to_string()),
                                scale: cell_scale,
                                status: cell_status.clone(),
                                download_url: cell_url.clone(),
                                file_size: cell_size,
                                last_updated: cell_updated.clone(),
                                bounds,
                            });
                        }
                        in_cell = false;
                    }
                    "cov" => in_cov = false,
                    "panel" => in_panel = false,
                    "vertex" => {
                        if let (Some(lat), Some(lon)) = (current_lat, current_lon) {
                            vertices.push((lat, lon));
                        }
                        in_vertex = false;
                    }
                    _ => {}
                }
                current_element.clear();
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();

                if in_header && current_element == "title" {
                    catalog_name = text;
                } else if in_cell {
                    if in_vertex {
                        match current_element.as_str() {
                            "lat" => current_lat = text.parse().ok(),
                            "long" => current_lon = text.parse().ok(),
                            _ => {}
                        }
                    } else if !in_cov {
                        match current_element.as_str() {
                            "name" => cell_name = text,
                            "lname" => cell_lname = text,
                            "cscale" => cell_scale = text.parse().ok(),
                            "status" => cell_status = Some(text),
                            "zipfile_location" => cell_url = text,
                            "zipfile_size" => cell_size = text.parse().ok(),
                            "uadt" | "isdt" => {
                                if cell_updated.is_none() {
                                    cell_updated = Some(text);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(CatalogParseError::XmlError(e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(ParsedCatalog {
        name: catalog_name,
        catalog_type: "ENC".to_string(),
        charts,
    })
}

/// Parse catalog from a file path
pub fn parse_catalog_file(path: &str) -> Result<ParsedCatalog, CatalogParseError> {
    let content = std::fs::read_to_string(path)?;
    parse_catalog_xml(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rnc_catalog() {
        let xml = r#"
        <RncProductCatalogChartCatalogs>
            <Header>
                <title>Test RNC Catalog</title>
            </Header>
            <chart>
                <number>NZ1234</number>
                <title>Test Chart</title>
                <format>Sailing Chart</format>
                <zipfile_location>https://example.com/chart.zip</zipfile_location>
                <zipfile_datetime_iso8601>2023-06-16T10:59:00Z</zipfile_datetime_iso8601>
            </chart>
        </RncProductCatalogChartCatalogs>
        "#;

        let catalog = parse_catalog_xml(xml).unwrap();
        assert_eq!(catalog.name, "Test RNC Catalog");
        assert_eq!(catalog.catalog_type, "RNC");
        assert_eq!(catalog.charts.len(), 1);
        assert_eq!(catalog.charts[0].chart_id, "NZ1234");
        assert_eq!(catalog.charts[0].title, "Test Chart");
    }

    #[test]
    fn test_parse_enc_catalog() {
        let xml = r#"
        <?xml version="1.0" encoding="UTF-8" ?>
        <EncProductCatalog>
            <Header>
                <title>Test ENC Catalog</title>
            </Header>
            <cell>
                <name>US1AK90M</name>
                <lname>Arctic Coast</lname>
                <cscale>1587870</cscale>
                <status>Active</status>
                <zipfile_location>https://example.com/enc.zip</zipfile_location>
                <zipfile_size>789477</zipfile_size>
            </cell>
        </EncProductCatalog>
        "#;

        let catalog = parse_catalog_xml(xml).unwrap();
        assert_eq!(catalog.name, "Test ENC Catalog");
        assert_eq!(catalog.catalog_type, "ENC");
        assert_eq!(catalog.charts.len(), 1);
        assert_eq!(catalog.charts[0].chart_id, "US1AK90M");
        assert_eq!(catalog.charts[0].scale, Some(1587870));
    }
}
