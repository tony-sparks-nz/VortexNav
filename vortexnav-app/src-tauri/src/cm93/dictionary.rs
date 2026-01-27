// CM93 Dictionary Parser
// Parses CM93OBJ.DIC and CM93ATTR.DIC files
// Based on OpenCPN's CM93 implementation (GPL v2)

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use super::Cm93Error;

/// CM93 object class definition from CM93OBJ.DIC
#[derive(Debug, Clone)]
pub struct Cm93ObjectClass {
    pub code: u16,           // CM93 object class code
    pub acronym: String,     // S57-style acronym (e.g., "LIGHTS", "BOYCAR")
    pub name: String,        // Full name
    pub geometry_type: u8,   // Allowed geometry types bitmask
}

/// CM93 attribute definition from CM93ATTR.DIC
#[derive(Debug, Clone)]
pub struct Cm93Attribute {
    pub code: u16,           // CM93 attribute code
    pub acronym: String,     // S57-style acronym (e.g., "COLOUR", "HEIGHT")
    pub attr_type: char,     // Attribute type: A=string, I=int, F=float, E=enum, L=list
}

/// CM93 Dictionary containing object classes and attributes
#[derive(Debug)]
pub struct Cm93Dictionary {
    /// Object classes indexed by CM93 code
    pub objects: HashMap<u16, Cm93ObjectClass>,
    /// Object classes indexed by acronym
    pub objects_by_acronym: HashMap<String, u16>,
    /// Attributes indexed by CM93 code
    pub attributes: HashMap<u16, Cm93Attribute>,
    /// Attributes indexed by acronym
    pub attributes_by_acronym: HashMap<String, u16>,
}

impl Cm93Dictionary {
    /// Load dictionaries from a CM93 root directory
    pub fn load(root_path: &Path) -> Result<Self, Cm93Error> {
        let obj_path = root_path.join("CM93OBJ.DIC");
        let attr_path = root_path.join("CM93ATTR.DIC");

        let mut dict = Self {
            objects: HashMap::new(),
            objects_by_acronym: HashMap::new(),
            attributes: HashMap::new(),
            attributes_by_acronym: HashMap::new(),
        };

        // Load object dictionary
        dict.load_objects(&obj_path)?;

        // Load attribute dictionary
        dict.load_attributes(&attr_path)?;

        Ok(dict)
    }

    /// Parse CM93OBJ.DIC file
    fn load_objects(&mut self, path: &Path) -> Result<(), Cm93Error> {
        let file = File::open(path).map_err(Cm93Error::Io)?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line.map_err(Cm93Error::Io)?;
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            // Format: CODE,ACRONYM,NAME,GEOM_TYPE
            // Example: 1,ADMARE,Administration Area,4
            let parts: Vec<&str> = line.splitn(4, ',').collect();
            if parts.len() >= 3 {
                if let Ok(code) = parts[0].trim().parse::<u16>() {
                    let acronym = parts[1].trim().to_string();
                    let name = parts[2].trim().to_string();
                    let geometry_type = parts
                        .get(3)
                        .and_then(|s| s.trim().parse::<u8>().ok())
                        .unwrap_or(7); // Default: all geometry types

                    self.objects_by_acronym.insert(acronym.clone(), code);
                    self.objects.insert(
                        code,
                        Cm93ObjectClass {
                            code,
                            acronym,
                            name,
                            geometry_type,
                        },
                    );
                }
            }
        }

        log::debug!("Loaded {} CM93 object classes", self.objects.len());
        Ok(())
    }

    /// Parse CM93ATTR.DIC file
    fn load_attributes(&mut self, path: &Path) -> Result<(), Cm93Error> {
        let file = File::open(path).map_err(Cm93Error::Io)?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line.map_err(Cm93Error::Io)?;
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            // Format: CODE,ACRONYM,TYPE
            // Example: 1,AGENCY,A
            let parts: Vec<&str> = line.splitn(3, ',').collect();
            if parts.len() >= 3 {
                if let Ok(code) = parts[0].trim().parse::<u16>() {
                    let acronym = parts[1].trim().to_string();
                    let attr_type = parts[2].trim().chars().next().unwrap_or('A');

                    self.attributes_by_acronym.insert(acronym.clone(), code);
                    self.attributes.insert(
                        code,
                        Cm93Attribute {
                            code,
                            acronym,
                            attr_type,
                        },
                    );
                }
            }
        }

        log::debug!("Loaded {} CM93 attributes", self.attributes.len());
        Ok(())
    }

    /// Get object class by code
    pub fn get_object(&self, code: u16) -> Option<&Cm93ObjectClass> {
        self.objects.get(&code)
    }

    /// Get object class by acronym
    pub fn get_object_by_acronym(&self, acronym: &str) -> Option<&Cm93ObjectClass> {
        self.objects_by_acronym
            .get(acronym)
            .and_then(|code| self.objects.get(code))
    }

    /// Get attribute by code
    pub fn get_attribute(&self, code: u16) -> Option<&Cm93Attribute> {
        self.attributes.get(&code)
    }

    /// Get attribute by acronym
    pub fn get_attribute_by_acronym(&self, acronym: &str) -> Option<&Cm93Attribute> {
        self.attributes_by_acronym
            .get(acronym)
            .and_then(|code| self.attributes.get(code))
    }

    /// Convert CM93 object code to S57 object class code
    /// CM93 uses its own numbering that maps to S57 codes
    pub fn cm93_to_s57_object(&self, cm93_code: u16) -> Option<u16> {
        // The mapping is typically 1:1 for common objects
        // More complex mappings may be needed for some objects
        Some(cm93_code)
    }
}

/// Well-known CM93 object class codes (from CM93OBJ.DIC)
/// These codes are specific to CM93 format and differ from S-57 codes
pub mod object_codes {
    pub const AIRARE: u16 = 1;   // Airport area
    pub const ACHPNT: u16 = 2;   // Anchor point
    pub const ACHBRT: u16 = 3;   // Anchor berth
    pub const ACHARE: u16 = 4;   // Anchorage area
    pub const BCNCAR: u16 = 5;   // Beacon, cardinal
    pub const BCNISD: u16 = 6;   // Beacon, isolated danger
    pub const BCNLAT: u16 = 7;   // Beacon, lateral
    pub const BCNSAW: u16 = 8;   // Beacon, safe water
    pub const BCNSPP: u16 = 9;   // Beacon, special purpose
    pub const BRTFAC: u16 = 10;  // Berthing facility
    pub const BRIDGE: u16 = 11;  // Bridge
    pub const BUISGL: u16 = 13;  // Building, single
    pub const BUAARE: u16 = 14;  // Built-up area
    pub const BOYCAR: u16 = 15;  // Buoy, cardinal
    pub const BOYINB: u16 = 16;  // Buoy, installation
    pub const BOYISD: u16 = 17;  // Buoy, isolated danger
    pub const BOYLAT: u16 = 18;  // Buoy, lateral
    pub const BOYSAW: u16 = 19;  // Buoy, safe water
    pub const BOYSPP: u16 = 20;  // Buoy, special purpose
    pub const CTNARE: u16 = 29;  // Caution area
    pub const COALNE: u16 = 35;  // Coastline
    pub const DEPARE: u16 = 44;  // Depth area
    pub const DEPCNT: u16 = 45;  // Depth contour
    pub const DRGARE: u16 = 50;  // Dredged area
    pub const FAIRWY: u16 = 57;  // Fairway
    pub const LNDARE: u16 = 81;  // Land area
    pub const LNDELV: u16 = 82;  // Land elevation
    pub const LIGHTS: u16 = 86;  // Light
    pub const NAVLNE: u16 = 98;  // Navigation line
    pub const OBSTRN: u16 = 99;  // Obstruction
    pub const PILBOP: u16 = 104; // Pilot boarding place
    pub const RIVERS: u16 = 129; // River
    pub const SLCONS: u16 = 139; // Shoreline construction
    pub const SEAARE: u16 = 136; // Sea area
    pub const SOUNDG: u16 = 147; // Sounding (spot soundings)
    pub const TSSLPT: u16 = 162; // Traffic separation scheme lane part
    pub const TSEZNE: u16 = 164; // Traffic separation zone
    pub const UWTROC: u16 = 168; // Underwater rock
    pub const VEGARE: u16 = 169; // Vegetation area
    pub const WRECKS: u16 = 176; // Wreck
    pub const ZEMCNT: u16 = 177; // Zero meter contour
    pub const ITDARE: u16 = 78;  // Intertidal area
    pub const SBDARE: u16 = 138; // Seabed area
    pub const LNDRGN: u16 = 83;  // Land region
    pub const RESARE: u16 = 128; // Restricted area
    pub const CBLSUB: u16 = 22;  // Cable, submarine
    pub const CBLOHD: u16 = 21;  // Cable, overhead
    pub const PIPSOL: u16 = 107; // Pipeline, submarine/on land
}

/// Well-known CM93 attribute codes
pub mod attr_codes {
    pub const COLOUR: u16 = 75;   // Colour
    pub const DRVAL1: u16 = 87;   // Depth range value 1
    pub const DRVAL2: u16 = 88;   // Depth range value 2
    pub const HEIGHT: u16 = 95;   // Height
    pub const LITCHR: u16 = 107;  // Light characteristic
    pub const LITVIS: u16 = 108;  // Light visibility
    pub const OBJNAM: u16 = 116;  // Object name
    pub const ORIENT: u16 = 117;  // Orientation
    pub const PEREND: u16 = 119;  // Period end
    pub const PERSTA: u16 = 120;  // Period start
    pub const QUASOU: u16 = 127;  // Quality of sounding measurement
    pub const SCAMIN: u16 = 133;  // Scale minimum
    pub const SCAMAX: u16 = 134;  // Scale maximum
    pub const SECTR1: u16 = 136;  // Sector limit one
    pub const SECTR2: u16 = 137;  // Sector limit two
    pub const SIGFRQ: u16 = 140;  // Signal frequency
    pub const SIGPER: u16 = 142;  // Signal period
    pub const SIGSEQ: u16 = 143;  // Signal sequence
    pub const VALDCO: u16 = 170;  // Value of depth contour
    pub const VALSOU: u16 = 172;  // Value of sounding
    pub const WATLEV: u16 = 187;  // Water level effect
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_object_codes() {
        // CM93 object codes from CM93OBJ.DIC
        assert_eq!(object_codes::LIGHTS, 86);
        assert_eq!(object_codes::SOUNDG, 147);
        assert_eq!(object_codes::DEPARE, 44);
        assert_eq!(object_codes::DEPCNT, 45);
        assert_eq!(object_codes::LNDARE, 81);
    }

    #[test]
    fn test_attr_codes() {
        assert_eq!(attr_codes::VALSOU, 172);
        assert_eq!(attr_codes::OBJNAM, 116);
    }
}
