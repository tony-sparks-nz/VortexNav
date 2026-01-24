// GPS source management module
// Handles serial port enumeration, connection, and NMEA reading

use crate::nmea::{GpsData, NmeaParser};
use serde::{Deserialize, Serialize};
use serialport::SerialPortType;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GpsError {
    #[error("Serial port error: {0}")]
    SerialPort(#[from] serialport::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("No GPS sources configured")]
    NoSourcesConfigured,
    #[error("GPS source not found: {0}")]
    SourceNotFound(String),
}

// Available GPS source types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GpsSourceType {
    SerialPort,
    TcpStream,
    Simulated,
}

// Information about a detected serial port
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedPort {
    pub port_name: String,
    pub port_type: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
    pub is_likely_gps: bool,
}

// GPS source configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpsSourceConfig {
    pub id: String,
    pub name: String,
    pub source_type: GpsSourceType,
    pub port_name: Option<String>,
    pub baud_rate: u32,
    pub enabled: bool,
    pub priority: i32, // Lower number = higher priority
}

impl Default for GpsSourceConfig {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: "GPS".to_string(),
            source_type: GpsSourceType::SerialPort,
            port_name: None,
            baud_rate: 4800, // Standard NMEA baud rate
            enabled: true,
            priority: 0,
        }
    }
}

// GPS connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GpsConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    ReceivingData,
    Error,
}

// Current GPS source status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpsSourceStatus {
    pub source_id: Option<String>,
    pub source_name: Option<String>,
    pub status: GpsConnectionStatus,
    pub last_error: Option<String>,
    pub sentences_received: u64,
    pub last_fix_time: Option<String>,
}

impl Default for GpsSourceStatus {
    fn default() -> Self {
        Self {
            source_id: None,
            source_name: None,
            status: GpsConnectionStatus::Disconnected,
            last_error: None,
            sentences_received: 0,
            last_fix_time: None,
        }
    }
}

// GPS Manager - handles all GPS operations
pub struct GpsManager {
    // Current GPS data
    pub data: RwLock<GpsData>,
    // Connection status
    pub status: RwLock<GpsSourceStatus>,
    // Configured sources
    sources: RwLock<Vec<GpsSourceConfig>>,
    // NMEA parser
    parser: NmeaParser,
    // Flag to stop the reader thread
    stop_flag: Arc<AtomicBool>,
    // Reader thread handle
    reader_handle: Mutex<Option<thread::JoinHandle<()>>>,
}

impl GpsManager {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(GpsData::default()),
            status: RwLock::new(GpsSourceStatus::default()),
            sources: RwLock::new(Vec::new()),
            parser: NmeaParser::new(),
            stop_flag: Arc::new(AtomicBool::new(false)),
            reader_handle: Mutex::new(None),
        }
    }

    /// Enumerate all available serial ports
    pub fn list_serial_ports() -> Result<Vec<DetectedPort>, GpsError> {
        let ports = serialport::available_ports()?;

        let detected: Vec<DetectedPort> = ports
            .into_iter()
            .map(|port| {
                let (port_type, manufacturer, product, serial_number, is_likely_gps) =
                    match &port.port_type {
                        SerialPortType::UsbPort(info) => {
                            let mfr = info.manufacturer.clone();
                            let prod = info.product.clone();

                            // Heuristic: check if this looks like a GPS device
                            let likely_gps = is_likely_gps_device(&mfr, &prod);

                            (
                                "USB".to_string(),
                                mfr,
                                prod,
                                info.serial_number.clone(),
                                likely_gps,
                            )
                        }
                        SerialPortType::BluetoothPort => {
                            ("Bluetooth".to_string(), None, None, None, false)
                        }
                        SerialPortType::PciPort => ("PCI".to_string(), None, None, None, false),
                        SerialPortType::Unknown => {
                            ("Unknown".to_string(), None, None, None, false)
                        }
                    };

                DetectedPort {
                    port_name: port.port_name,
                    port_type,
                    manufacturer,
                    product,
                    serial_number,
                    is_likely_gps,
                }
            })
            .collect();

        Ok(detected)
    }

    /// Test if a port is a GPS device by reading a few sentences
    pub fn test_port(port_name: &str, baud_rate: u32, timeout_ms: u64) -> Result<bool, GpsError> {
        let port = serialport::new(port_name, baud_rate)
            .timeout(Duration::from_millis(timeout_ms))
            .open()?;

        let mut reader = BufReader::new(port);
        let mut line = String::new();
        let mut nmea_count = 0;

        // Try to read up to 10 lines, looking for NMEA sentences
        for _ in 0..10 {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.starts_with('$') && (trimmed.contains("GP") || trimmed.contains("GN") || trimmed.contains("GL")) {
                        nmea_count += 1;
                        if nmea_count >= 2 {
                            return Ok(true);
                        }
                    }
                }
                Err(_) => break,
            }
        }

        Ok(nmea_count > 0)
    }

    /// Set the GPS source configuration
    pub fn set_sources(&self, sources: Vec<GpsSourceConfig>) {
        let mut src = self.sources.write().unwrap();
        *src = sources;
    }

    /// Get current source configuration
    pub fn get_sources(&self) -> Vec<GpsSourceConfig> {
        self.sources.read().unwrap().clone()
    }

    /// Get current GPS data
    pub fn get_data(&self) -> GpsData {
        self.data.read().unwrap().clone()
    }

    /// Get current status
    pub fn get_status(&self) -> GpsSourceStatus {
        self.status.read().unwrap().clone()
    }

    /// Start reading from configured GPS sources
    pub fn start(&self) -> Result<(), GpsError> {
        // Stop any existing reader
        self.stop();

        let sources = self.get_sources();
        if sources.is_empty() {
            return Err(GpsError::NoSourcesConfigured);
        }

        // Find highest priority enabled source
        let mut enabled_sources: Vec<_> = sources.into_iter().filter(|s| s.enabled).collect();
        enabled_sources.sort_by_key(|s| s.priority);

        if enabled_sources.is_empty() {
            return Err(GpsError::NoSourcesConfigured);
        }

        // Reset stop flag
        self.stop_flag.store(false, Ordering::SeqCst);

        // Clone what we need for the thread
        let stop_flag = Arc::clone(&self.stop_flag);
        let data_lock = unsafe {
            // Safety: We're creating a raw pointer that lives as long as GpsManager
            &*(&self.data as *const RwLock<GpsData>)
        };
        let status_lock = unsafe { &*(&self.status as *const RwLock<GpsSourceStatus>) };
        let parser = NmeaParser::new();
        let sources_for_thread = enabled_sources.clone();

        // Start reader thread
        let handle = thread::spawn(move || {
            Self::reader_thread(stop_flag, data_lock, status_lock, parser, sources_for_thread);
        });

        *self.reader_handle.lock().unwrap() = Some(handle);

        // Update status
        if let Some(source) = enabled_sources.first() {
            let mut status = self.status.write().unwrap();
            status.source_id = Some(source.id.clone());
            status.source_name = Some(source.name.clone());
            status.status = GpsConnectionStatus::Connecting;
            status.last_error = None;
        }

        Ok(())
    }

    /// Stop GPS reading
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);

        if let Some(handle) = self.reader_handle.lock().unwrap().take() {
            // Give it a moment to stop gracefully
            thread::sleep(Duration::from_millis(100));
            // We can't really force-stop a thread, but setting the flag should work
            drop(handle);
        }

        let mut status = self.status.write().unwrap();
        status.status = GpsConnectionStatus::Disconnected;
    }

    /// Reader thread function
    fn reader_thread(
        stop_flag: Arc<AtomicBool>,
        data_lock: &RwLock<GpsData>,
        status_lock: &RwLock<GpsSourceStatus>,
        parser: NmeaParser,
        sources: Vec<GpsSourceConfig>,
    ) {
        let mut current_source_idx = 0;
        let mut retry_count = 0;
        const MAX_RETRIES: u32 = 3;

        while !stop_flag.load(Ordering::SeqCst) {
            if current_source_idx >= sources.len() {
                current_source_idx = 0;
                retry_count += 1;
                if retry_count > MAX_RETRIES {
                    let mut status = status_lock.write().unwrap();
                    status.status = GpsConnectionStatus::Error;
                    status.last_error = Some("All GPS sources failed".to_string());
                    break;
                }
                thread::sleep(Duration::from_secs(2));
                continue;
            }

            let source = &sources[current_source_idx];

            match &source.source_type {
                GpsSourceType::SerialPort => {
                    if let Some(ref port_name) = source.port_name {
                        match Self::read_from_serial(
                            &stop_flag,
                            data_lock,
                            status_lock,
                            &parser,
                            port_name,
                            source.baud_rate,
                            source,
                        ) {
                            Ok(()) => {
                                // Normal stop requested
                                return;
                            }
                            Err(e) => {
                                log::warn!("GPS source {} failed: {}", source.name, e);
                                let mut status = status_lock.write().unwrap();
                                status.last_error = Some(e.to_string());
                                status.status = GpsConnectionStatus::Error;
                            }
                        }
                    }
                }
                GpsSourceType::Simulated => {
                    Self::run_simulated_gps(&stop_flag, data_lock, status_lock, source);
                    return;
                }
                _ => {}
            }

            current_source_idx += 1;
            thread::sleep(Duration::from_millis(500));
        }
    }

    /// Read GPS data from a serial port
    fn read_from_serial(
        stop_flag: &Arc<AtomicBool>,
        data_lock: &RwLock<GpsData>,
        status_lock: &RwLock<GpsSourceStatus>,
        parser: &NmeaParser,
        port_name: &str,
        baud_rate: u32,
        source: &GpsSourceConfig,
    ) -> Result<(), GpsError> {
        let port = serialport::new(port_name, baud_rate)
            .timeout(Duration::from_millis(1000))
            .open()?;

        // Update status to connected
        {
            let mut status = status_lock.write().unwrap();
            status.source_id = Some(source.id.clone());
            status.source_name = Some(source.name.clone());
            status.status = GpsConnectionStatus::Connected;
            status.last_error = None;
        }

        let mut reader = BufReader::new(port);
        let mut line = String::new();
        let mut sentences_received: u64 = 0;

        while !stop_flag.load(Ordering::SeqCst) {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    // EOF - port closed
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.starts_with('$') {
                        sentences_received += 1;

                        // Parse the NMEA sentence
                        if let Ok(new_data) = parser.parse_sentence(trimmed) {
                            // Update GPS data
                            let mut data = data_lock.write().unwrap();
                            if new_data.latitude.is_some() {
                                data.latitude = new_data.latitude;
                            }
                            if new_data.longitude.is_some() {
                                data.longitude = new_data.longitude;
                            }
                            if new_data.speed_knots.is_some() {
                                data.speed_knots = new_data.speed_knots;
                            }
                            if new_data.course.is_some() {
                                data.course = new_data.course;
                            }
                            if new_data.heading.is_some() {
                                data.heading = new_data.heading;
                            }
                            if new_data.altitude.is_some() {
                                data.altitude = new_data.altitude;
                            }
                            if new_data.fix_quality.is_some() {
                                data.fix_quality = new_data.fix_quality;
                            }
                            if new_data.satellites.is_some() {
                                data.satellites = new_data.satellites;
                            }
                            if new_data.hdop.is_some() {
                                data.hdop = new_data.hdop;
                            }
                            if new_data.timestamp.is_some() {
                                data.timestamp = new_data.timestamp.clone();
                            }
                        }

                        // Update status
                        {
                            let mut status = status_lock.write().unwrap();
                            status.status = GpsConnectionStatus::ReceivingData;
                            status.sentences_received = sentences_received;
                            if let Some(ref ts) = data_lock.read().unwrap().timestamp {
                                status.last_fix_time = Some(ts.clone());
                            }
                        }
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::TimedOut {
                        return Err(GpsError::Io(e));
                    }
                    // Timeout is okay, just continue
                }
            }
        }

        Ok(())
    }

    /// Run simulated GPS for testing
    fn run_simulated_gps(
        stop_flag: &Arc<AtomicBool>,
        data_lock: &RwLock<GpsData>,
        status_lock: &RwLock<GpsSourceStatus>,
        source: &GpsSourceConfig,
    ) {
        {
            let mut status = status_lock.write().unwrap();
            status.source_id = Some(source.id.clone());
            status.source_name = Some(source.name.clone());
            status.status = GpsConnectionStatus::ReceivingData;
        }

        let mut lat: f64 = 37.8044;
        let mut lon: f64 = -122.4194;
        let mut heading: f64 = 45.0;
        let mut count: u64 = 0;

        while !stop_flag.load(Ordering::SeqCst) {
            // Simulate movement
            lat += 0.0001 * heading.to_radians().cos();
            lon += 0.0001 * heading.to_radians().sin();
            heading = (heading + 0.5) % 360.0;
            count += 1;

            {
                let mut data = data_lock.write().unwrap();
                data.latitude = Some(lat);
                data.longitude = Some(lon);
                data.course = Some(heading);
                data.speed_knots = Some(5.5);
                data.heading = Some(heading);
                data.fix_quality = Some(1);
                data.satellites = Some(8);
            }

            {
                let mut status = status_lock.write().unwrap();
                status.sentences_received = count;
            }

            thread::sleep(Duration::from_millis(1000));
        }
    }
}

impl Drop for GpsManager {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Heuristic to detect if a USB device is likely a GPS
fn is_likely_gps_device(manufacturer: &Option<String>, product: &Option<String>) -> bool {
    let keywords = [
        "gps", "gnss", "u-blox", "ublox", "sirf", "nmea", "garmin", "globalsat",
        "bu-353", "vk-162", "g-mouse", "receiver", "navigation",
    ];

    let check_string = |s: &Option<String>| -> bool {
        if let Some(ref text) = s {
            let lower = text.to_lowercase();
            keywords.iter().any(|kw| lower.contains(kw))
        } else {
            false
        }
    };

    check_string(manufacturer) || check_string(product)
}
