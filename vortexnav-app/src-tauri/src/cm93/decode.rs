// CM93 XOR Decode Tables
// Based on OpenCPN's CM93 implementation (GPL v2)
// Reference: https://github.com/OpenCPN/OpenCPN

/// CM93 uses a substitution cipher based on a 256-byte lookup table.
/// The encoding table is derived from Table_0 by XORing each value with 8,
/// then the decode table is the inverse mapping.

/// Original Table_0 values from OpenCPN (256 bytes)
/// This is the basis for building encode and decode tables
const TABLE_0: [u8; 256] = [
    0xCD, 0xEA, 0xDC, 0x48, 0x3E, 0x6D, 0xCA, 0x7B, 0x52, 0xE1,
    0xA4, 0x8E, 0xAB, 0x05, 0xA7, 0x97, 0xB9, 0x60, 0x39, 0x85,
    0x7C, 0x56, 0x7A, 0xBA, 0x68, 0x6E, 0xF5, 0x5D, 0x02, 0x4E,  // Fixed: 0x5D at pos 27
    0x0F, 0xA1, 0x27, 0x24, 0x41, 0x34, 0x00, 0x5A, 0xFE, 0xCB,
    0xD0, 0xFA, 0xF8, 0x6C, 0x74, 0x96, 0x9E, 0x0E, 0xC2, 0x49,
    0xE3, 0xE5, 0xC0, 0x3B, 0x59, 0x18, 0xA9, 0x86, 0x8F, 0x30,
    0xC3, 0xA8, 0x22, 0x0A, 0x14, 0x1A, 0xB2, 0xC9, 0xC7, 0xED,
    0xAA, 0x29, 0x94, 0x75, 0x0D, 0xAC, 0x0C, 0xF4, 0xBB, 0xC5,
    0x3F, 0xFD, 0xD9, 0x9C, 0x4F, 0xD5, 0x84, 0x1E, 0xB1, 0x81,
    0x69, 0xB4, 0x09, 0xB8, 0x3C, 0xAF, 0xA3, 0x08, 0xBF, 0xE0,
    0x9A, 0xD7, 0xF7, 0x8C, 0x67, 0x66, 0xAE, 0xD4, 0x4C, 0xA5,
    0xEC, 0xF9, 0xB6, 0x64, 0x78, 0x06, 0x5B, 0x9B, 0xF2, 0x99,
    0xCE, 0xDB, 0x53, 0x55, 0x65, 0x8D, 0x07, 0x33, 0x04, 0x37,
    0x92, 0x26, 0x23, 0xB5, 0x58, 0xDA, 0x2F, 0xB3, 0x40, 0x5E,
    0x7F, 0x4B, 0x62, 0x80, 0xE4, 0x6F, 0x73, 0x1D, 0xDF, 0x17,
    0xCC, 0x28, 0x25, 0x2D, 0xEE, 0x3A, 0x98, 0xE2, 0x01, 0x0B,
    0xDD, 0xBC, 0x90, 0xB0, 0xFC, 0x95, 0x76, 0x93, 0x46, 0x57,
    0x2C, 0x2B, 0x50, 0x11, 0x0B, 0xC1, 0xF0, 0xE7, 0xD6, 0x21,  // Fixed: 0x0B at pos 174
    0x31, 0xDE, 0xFF, 0xD8, 0x12, 0xA6, 0x4D, 0x8A, 0x13, 0x43,
    0x45, 0x38, 0xD2, 0x87, 0xA0, 0xEF, 0x82, 0xF1, 0x47, 0x89,
    0x6A, 0xC8, 0x54, 0x1B, 0x16, 0x7E, 0x79, 0xBD, 0x6B, 0x91,
    0xA2, 0x71, 0x36, 0xB7, 0x03, 0x3D, 0x72, 0xC6, 0x44, 0x8B,
    0xCF, 0x15, 0x9F, 0x32, 0xC4, 0x77, 0x83, 0x63, 0x20, 0x88,
    0xF6, 0xAD, 0xF3, 0xE8, 0x4A, 0xE9, 0x35, 0x1C, 0x5F, 0x19,
    0x1F, 0x7D, 0x70, 0xFB, 0xD1, 0x51, 0x10, 0xD3, 0x2E, 0x61,
    0x9D, 0x5C, 0x2A, 0x42, 0xBE, 0xE6,
];

use std::sync::OnceLock;

/// The decode table - built once at runtime from TABLE_0
/// Decode_table[encoded_byte] = original_byte
static DECODE_TABLE: OnceLock<[u8; 256]> = OnceLock::new();

/// The encode table - built once at runtime from TABLE_0
/// Encode_table[original_byte] = encoded_byte
static ENCODE_TABLE: OnceLock<[u8; 256]> = OnceLock::new();

/// Initialize the decode and encode tables from TABLE_0
/// This follows OpenCPN's algorithm exactly:
/// 1. Encode_table[i] = Table_0[i] ^ 8
/// 2. Decode_table[Encode_table[i]] = i
fn init_tables() -> ([u8; 256], [u8; 256]) {
    let mut encode_table = [0u8; 256];
    let mut decode_table = [0u8; 256];

    for i in 0..256 {
        let encoded = TABLE_0[i] ^ 8;
        encode_table[i] = encoded;
        decode_table[encoded as usize] = i as u8;
    }

    (encode_table, decode_table)
}

/// Get the decode table (lazy initialization)
pub fn get_decode_table() -> &'static [u8; 256] {
    DECODE_TABLE.get_or_init(|| {
        let (_, decode) = init_tables();
        decode
    })
}

/// Get the encode table (lazy initialization)
pub fn get_encode_table() -> &'static [u8; 256] {
    ENCODE_TABLE.get_or_init(|| {
        let (encode, _) = init_tables();
        encode
    })
}

/// Decode a single byte using the CM93 substitution cipher
#[inline]
pub fn decode_byte(byte: u8) -> u8 {
    get_decode_table()[byte as usize]
}

/// Encode a single byte using the CM93 substitution cipher
#[inline]
pub fn encode_byte(byte: u8) -> u8 {
    get_encode_table()[byte as usize]
}

/// Decode a buffer of CM93 data in-place using substitution cipher
/// This is the correct CM93 decoding algorithm from OpenCPN
pub fn decode_buffer(data: &mut [u8]) {
    let table = get_decode_table();
    for byte in data.iter_mut() {
        *byte = table[*byte as usize];
    }
}

/// Encode a buffer of data using the CM93 substitution cipher
pub fn encode_buffer(data: &mut [u8]) {
    let table = get_encode_table();
    for byte in data.iter_mut() {
        *byte = table[*byte as usize];
    }
}

/// Decode a CM93 buffer and return a new vector
pub fn decode_to_vec(data: &[u8]) -> Vec<u8> {
    let table = get_decode_table();
    data.iter().map(|&b| table[b as usize]).collect()
}

/// CM93 Decoder for streaming decoding
pub struct Cm93Decoder {
    // No position needed - substitution cipher is stateless
}

impl Cm93Decoder {
    pub fn new() -> Self {
        Self {}
    }

    /// Decode a single byte
    pub fn decode_byte(&self, byte: u8) -> u8 {
        decode_byte(byte)
    }

    /// Decode a buffer in-place
    pub fn decode(&self, data: &mut [u8]) {
        decode_buffer(data);
    }

    /// Decode and return a new buffer
    pub fn decode_copy(&self, data: &[u8]) -> Vec<u8> {
        decode_to_vec(data)
    }
}

impl Default for Cm93Decoder {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper functions for reading and decoding primitive types
/// These read little-endian values and decode each byte

/// Read a decoded u16 from a byte slice at the given offset
pub fn read_decoded_u16(data: &[u8], offset: usize) -> u16 {
    let b0 = decode_byte(data[offset]) as u16;
    let b1 = decode_byte(data[offset + 1]) as u16;
    b0 | (b1 << 8)
}

/// Read a decoded u32 from a byte slice at the given offset
pub fn read_decoded_u32(data: &[u8], offset: usize) -> u32 {
    let b0 = decode_byte(data[offset]) as u32;
    let b1 = decode_byte(data[offset + 1]) as u32;
    let b2 = decode_byte(data[offset + 2]) as u32;
    let b3 = decode_byte(data[offset + 3]) as u32;
    b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
}

/// Read a decoded i32 from a byte slice at the given offset
pub fn read_decoded_i32(data: &[u8], offset: usize) -> i32 {
    read_decoded_u32(data, offset) as i32
}

/// Read a decoded f64 (double) from a byte slice at the given offset
pub fn read_decoded_f64(data: &[u8], offset: usize) -> f64 {
    let mut bytes = [0u8; 8];
    for i in 0..8 {
        bytes[i] = decode_byte(data[offset + i]);
    }
    f64::from_le_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tables_initialized() {
        // Ensure tables can be initialized
        let decode = get_decode_table();
        let encode = get_encode_table();

        // Tables should have 256 entries
        assert_eq!(decode.len(), 256);
        assert_eq!(encode.len(), 256);
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        // Encoding then decoding should return the original
        for i in 0..=255u8 {
            let encoded = encode_byte(i);
            let decoded = decode_byte(encoded);
            assert_eq!(i, decoded, "Roundtrip failed for byte {}", i);
        }
    }

    #[test]
    fn test_decode_encode_roundtrip() {
        // Decoding then encoding should return the original
        for i in 0..=255u8 {
            let decoded = decode_byte(i);
            let encoded = encode_byte(decoded);
            assert_eq!(i, encoded, "Reverse roundtrip failed for byte {}", i);
        }
    }

    #[test]
    fn test_buffer_decode() {
        let original = vec![0x00, 0x01, 0x02, 0x03, 0x04];
        let mut encoded = original.clone();

        // Encode
        encode_buffer(&mut encoded);

        // Decode
        let mut decoded = encoded.clone();
        decode_buffer(&mut decoded);

        assert_eq!(original, decoded);
    }

    #[test]
    fn test_table_0_xor_relationship() {
        // Verify that encode_table[i] = TABLE_0[i] ^ 8
        let encode = get_encode_table();
        for i in 0..256 {
            assert_eq!(encode[i], TABLE_0[i] ^ 8, "XOR relationship failed at index {}", i);
        }
    }

    #[test]
    fn test_known_decode_values() {
        // Test some specific decode values based on the TABLE_0
        // When TABLE_0[0] = 0xCD, encode[0] = 0xCD ^ 8 = 0xC5
        // So decode[0xC5] = 0
        let decode = get_decode_table();
        assert_eq!(decode[0xC5], 0);

        // TABLE_0[1] = 0xEA, encode[1] = 0xEA ^ 8 = 0xE2
        // So decode[0xE2] = 1
        assert_eq!(decode[0xE2], 1);
    }
}
