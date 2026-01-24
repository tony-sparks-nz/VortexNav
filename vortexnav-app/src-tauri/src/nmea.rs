// NMEA 0183 parser module for GPS data

use nmea::Nmea;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum NmeaError {
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Serial port error: {0}")]
    SerialPort(String),
    #[error("No GPS fix")]
    NoFix,
}

// GPS position data sent to frontend
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GpsData {
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub speed_knots: Option<f64>,     // SOG - Speed Over Ground
    pub course: Option<f64>,           // COG - Course Over Ground
    pub heading: Option<f64>,          // HDG - True heading (from compass)
    pub altitude: Option<f64>,
    pub fix_quality: Option<u8>,
    pub satellites: Option<u32>,
    pub hdop: Option<f32>,             // Horizontal dilution of precision
    pub timestamp: Option<String>,
}

// NMEA parser state
pub struct NmeaParser {
    nmea: Mutex<Nmea>,
}

impl NmeaParser {
    pub fn new() -> Self {
        Self {
            nmea: Mutex::new(Nmea::default()),
        }
    }

    /// Parse an NMEA sentence and return updated GPS data
    pub fn parse_sentence(&self, sentence: &str) -> Result<GpsData, NmeaError> {
        let mut nmea = self.nmea.lock().unwrap();

        // Parse the sentence
        nmea.parse(sentence).map_err(|e| NmeaError::Parse(format!("{:?}", e)))?;

        // Extract all available data (convert f32 to f64 where needed)
        let data = GpsData {
            latitude: nmea.latitude,
            longitude: nmea.longitude,
            speed_knots: nmea.speed_over_ground.map(|v| v as f64),
            course: nmea.true_course.map(|v| v as f64),
            heading: None, // Would come from HDT/HDG sentence
            altitude: nmea.altitude.map(|v| v as f64),
            fix_quality: nmea.fix_type.map(|f| f as u8),
            satellites: nmea.num_of_fix_satellites,
            hdop: nmea.hdop,
            timestamp: nmea.fix_time.map(|t| t.to_string()),
        };

        Ok(data)
    }

    /// Parse multiple lines of NMEA data
    pub fn parse_batch(&self, data: &str) -> GpsData {
        let mut latest = GpsData::default();

        for line in data.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Ok(gps) = self.parse_sentence(trimmed) {
                    // Merge non-None values
                    if gps.latitude.is_some() { latest.latitude = gps.latitude; }
                    if gps.longitude.is_some() { latest.longitude = gps.longitude; }
                    if gps.speed_knots.is_some() { latest.speed_knots = gps.speed_knots; }
                    if gps.course.is_some() { latest.course = gps.course; }
                    if gps.heading.is_some() { latest.heading = gps.heading; }
                    if gps.altitude.is_some() { latest.altitude = gps.altitude; }
                    if gps.fix_quality.is_some() { latest.fix_quality = gps.fix_quality; }
                    if gps.satellites.is_some() { latest.satellites = gps.satellites; }
                    if gps.hdop.is_some() { latest.hdop = gps.hdop; }
                    if gps.timestamp.is_some() { latest.timestamp = gps.timestamp; }
                }
            }
        }

        latest
    }

    /// Reset parser state
    pub fn reset(&self) {
        let mut nmea = self.nmea.lock().unwrap();
        *nmea = Nmea::default();
    }
}

// Shared GPS state for the application
pub struct GpsState {
    pub data: Mutex<GpsData>,
    parser: NmeaParser,
}

impl GpsState {
    pub fn new() -> Self {
        Self {
            data: Mutex::new(GpsData::default()),
            parser: NmeaParser::new(),
        }
    }

    /// Update GPS state with new NMEA data
    pub fn update(&self, nmea_data: &str) -> GpsData {
        let new_data = self.parser.parse_batch(nmea_data);
        let mut current = self.data.lock().unwrap();

        // Merge new data with current (keep existing values if new is None)
        if new_data.latitude.is_some() { current.latitude = new_data.latitude; }
        if new_data.longitude.is_some() { current.longitude = new_data.longitude; }
        if new_data.speed_knots.is_some() { current.speed_knots = new_data.speed_knots; }
        if new_data.course.is_some() { current.course = new_data.course; }
        if new_data.heading.is_some() { current.heading = new_data.heading; }
        if new_data.altitude.is_some() { current.altitude = new_data.altitude; }
        if new_data.fix_quality.is_some() { current.fix_quality = new_data.fix_quality; }
        if new_data.satellites.is_some() { current.satellites = new_data.satellites; }
        if new_data.hdop.is_some() { current.hdop = new_data.hdop; }
        if new_data.timestamp.is_some() { current.timestamp = new_data.timestamp.clone(); }

        current.clone()
    }

    /// Get current GPS data
    pub fn get_current(&self) -> GpsData {
        self.data.lock().unwrap().clone()
    }
}

// Common NMEA sentence examples for reference:
//
// GGA - Global Positioning System Fix Data
// $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47
//
// RMC - Recommended Minimum Navigation Information
// $GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A
//
// VTG - Track Made Good and Ground Speed
// $GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48
//
// GSA - GPS DOP and Active Satellites
// $GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39
//
// HDT - Heading True
// $GPHDT,123.4,T*1D

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gga() {
        let parser = NmeaParser::new();
        let sentence = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47";
        let result = parser.parse_sentence(sentence);
        assert!(result.is_ok());
        let gps = result.unwrap();
        assert!(gps.latitude.is_some());
        assert!(gps.longitude.is_some());
    }

    #[test]
    fn test_parse_rmc() {
        let parser = NmeaParser::new();
        let sentence = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";
        let result = parser.parse_sentence(sentence);
        assert!(result.is_ok());
        let gps = result.unwrap();
        assert!(gps.speed_knots.is_some());
    }

    #[test]
    fn test_gps_state() {
        let state = GpsState::new();
        let nmea = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47\n\
                    $GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";
        let data = state.update(nmea);
        assert!(data.latitude.is_some());
        assert!(data.speed_knots.is_some());
    }
}
