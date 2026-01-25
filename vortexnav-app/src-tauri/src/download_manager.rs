// Download manager for chart files with progress tracking and ZIP extraction

use futures::StreamExt;
use reqwest::Client;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;
use zip::ZipArchive;

#[derive(Error, Debug)]
pub enum DownloadError {
    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("HTTP {0}: {1}")]
    HttpStatus(u16, String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("ZIP error: {0}")]
    ZipError(#[from] zip::result::ZipError),
    #[error("Invalid ZIP file - downloaded content is not a valid archive")]
    InvalidZipContent,
    #[error("Download cancelled")]
    Cancelled,
    #[error("No content length available")]
    NoContentLength,
}

#[derive(Debug, Clone)]
pub struct DownloadState {
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub status: String,
    pub error: Option<String>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            bytes_downloaded: 0,
            total_bytes: 0,
            status: "pending".to_string(),
            error: None,
        }
    }
}

/// Download a file from URL to the specified path with progress tracking
pub async fn download_file(
    url: &str,
    dest_path: &Path,
    progress: Arc<Mutex<DownloadState>>,
) -> Result<PathBuf, DownloadError> {
    let client = Client::builder()
        .user_agent("VortexNav/1.0 (Marine Navigation App)")
        .build()?;

    // Start the request
    let response = client.get(url).send().await?;

    // Check for HTTP errors
    let status = response.status();
    if !status.is_success() {
        return Err(DownloadError::HttpStatus(status.as_u16(), status.to_string()));
    }

    // Get content length if available
    let total_size = response.content_length().unwrap_or(0);

    {
        let mut state = progress.lock().await;
        state.total_bytes = total_size;
        state.status = "downloading".to_string();
    }

    // Create parent directories if needed
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Create the destination file
    let mut file = File::create(dest_path)?;
    let mut downloaded: u64 = 0;

    // Stream the response body
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;

        // Update progress
        {
            let mut state = progress.lock().await;
            state.bytes_downloaded = downloaded;
        }
    }

    // Mark as downloaded
    {
        let mut state = progress.lock().await;
        state.status = "downloaded".to_string();
    }

    Ok(dest_path.to_path_buf())
}

/// Check if a file appears to be a valid ZIP archive (by checking magic bytes)
pub fn is_valid_zip_file(path: &Path) -> bool {
    use std::io::Read;
    if let Ok(mut file) = File::open(path) {
        let mut magic = [0u8; 4];
        if file.read_exact(&mut magic).is_ok() {
            // ZIP magic bytes: PK\x03\x04 (local file header)
            // or PK\x05\x06 (empty archive) or PK\x07\x08 (spanned archive)
            return magic[0] == 0x50 && magic[1] == 0x4B
                && (magic[2] == 0x03 || magic[2] == 0x05 || magic[2] == 0x07);
        }
    }
    false
}

/// Extract a ZIP file to a directory
pub fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<Vec<PathBuf>, DownloadError> {
    // First verify it's actually a ZIP file
    if !is_valid_zip_file(zip_path) {
        return Err(DownloadError::InvalidZipContent);
    }

    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    // Create destination directory
    fs::create_dir_all(dest_dir)?;

    let mut extracted_files: Vec<PathBuf> = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = match file.enclosed_name() {
            Some(path) => dest_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            // Create directory
            fs::create_dir_all(&outpath)?;
        } else {
            // Create parent directories if needed
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)?;
                }
            }

            // Extract file
            let mut outfile = File::create(&outpath)?;
            io::copy(&mut file, &mut outfile)?;
            extracted_files.push(outpath);
        }
    }

    Ok(extracted_files)
}

/// Scan extracted files and categorize by chart type
#[derive(Debug, Clone)]
pub struct ExtractedChartFiles {
    pub mbtiles_files: Vec<PathBuf>,
    pub bsb_files: Vec<PathBuf>,   // .kap, .bsb files (RNC)
    pub s57_files: Vec<PathBuf>,   // .000 files (ENC)
    pub other_files: Vec<PathBuf>,
}

pub fn categorize_extracted_files(files: &[PathBuf]) -> ExtractedChartFiles {
    let mut result = ExtractedChartFiles {
        mbtiles_files: Vec::new(),
        bsb_files: Vec::new(),
        s57_files: Vec::new(),
        other_files: Vec::new(),
    };

    for file in files {
        if let Some(ext) = file.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            match ext_lower.as_str() {
                "mbtiles" => result.mbtiles_files.push(file.clone()),
                "kap" | "bsb" | "cap" => result.bsb_files.push(file.clone()),
                "000" => result.s57_files.push(file.clone()),
                _ => result.other_files.push(file.clone()),
            }
        }
    }

    result
}

/// Fetch catalog XML from a URL
pub async fn fetch_catalog_url(url: &str) -> Result<String, DownloadError> {
    let client = Client::new();
    let response = client.get(url).send().await?;
    let text = response.text().await?;
    Ok(text)
}

/// Get a safe filename from URL
pub fn filename_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .unwrap_or("download")
        .to_string()
}

/// Clean up temporary files
pub fn cleanup_temp_dir(dir: &Path) -> io::Result<()> {
    if dir.exists() && dir.is_dir() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filename_from_url() {
        assert_eq!(
            filename_from_url("https://example.com/charts/chart.zip"),
            "chart.zip"
        );
        assert_eq!(
            filename_from_url("https://example.com/US1AK90M.zip"),
            "US1AK90M.zip"
        );
    }

    #[test]
    fn test_categorize_files() {
        let files = vec![
            PathBuf::from("/tmp/chart.mbtiles"),
            PathBuf::from("/tmp/NZ1234.KAP"),
            PathBuf::from("/tmp/US5CA01M.000"),
            PathBuf::from("/tmp/readme.txt"),
        ];

        let categorized = categorize_extracted_files(&files);
        assert_eq!(categorized.mbtiles_files.len(), 1);
        assert_eq!(categorized.bsb_files.len(), 1);
        assert_eq!(categorized.s57_files.len(), 1);
        assert_eq!(categorized.other_files.len(), 1);
    }
}
