use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};

pub const DEFAULT_WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";

/// ggml-small.bin is ~466 MB; reject obvious HTML/error payloads.
const MIN_MODEL_BYTES: u64 = 50 * 1024 * 1024;

pub fn huggingface_token() -> Option<String> {
    std::env::var("HF_TOKEN")
        .ok()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3600))
        .connect_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("MeetingTranscriber/0.1")
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))
}

fn send_model_request(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<reqwest::blocking::Response, String> {
    let mut request = client.get(url);
    if let Some(token) = huggingface_token() {
        request = request.header("Authorization", format!("Bearer {token}"));
    }

    request
        .send()
        .map_err(|error| format!("failed to download whisper model: {error}"))
}

fn validate_response(response: &reqwest::blocking::Response) -> Result<(), String> {
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(
            "Hugging Face rejected the download (401). Set HF_TOKEN in .env or your environment."
                .to_string(),
        );
    }

    if !response.status().is_success() {
        return Err(format!(
            "whisper model download returned non-success status {}",
            response.status()
        ));
    }

    if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        let content_type = content_type
            .to_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if content_type.contains("text/html") || content_type.contains("application/json") {
            return Err(
                "Hugging Face returned an HTML/JSON page instead of the model file. Check HF_TOKEN and model access."
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn looks_like_html(prefix: &[u8]) -> bool {
    let sample = String::from_utf8_lossy(prefix).to_ascii_lowercase();
    sample.starts_with("<!doctype")
        || sample.starts_with("<html")
        || sample.trim_start().starts_with('{')
}

/// Streams the model to `dest_path` via a `.tmp` sibling file.
pub fn download_to_file(url: &str, dest_path: &Path) -> Result<(), String> {
    let temp_path = dest_path.with_extension("bin.tmp");
    if temp_path.exists() {
        std::fs::remove_file(&temp_path)
            .map_err(|error| format!("failed to clear stale model download: {error}"))?;
    }

    let client = build_client()?;
    let mut response = send_model_request(&client, url)?;
    validate_response(&response)?;

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|error| format!("failed to create model temp file: {error}"))?;

    let mut buffer = [0_u8; 8192];
    let mut total_bytes = 0_u64;
    let mut prefix = Vec::with_capacity(512);

    loop {
        let read_bytes = response
            .read(&mut buffer)
            .map_err(|error| format!("failed to read whisper model stream: {error}"))?;
        if read_bytes == 0 {
            break;
        }

        if prefix.len() < 512 {
            let remaining = 512 - prefix.len();
            prefix.extend_from_slice(&buffer[..read_bytes.min(remaining)]);
        }

        file.write_all(&buffer[..read_bytes])
            .map_err(|error| format!("failed to write whisper model chunk: {error}"))?;
        total_bytes += read_bytes as u64;
    }

    if looks_like_html(&prefix) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(
            "Downloaded data looks like an HTML/JSON error page, not ggml-small.bin. Verify HF_TOKEN."
                .to_string(),
        );
    }

    if total_bytes < MIN_MODEL_BYTES {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "downloaded file is only {total_bytes} bytes; expected at least {MIN_MODEL_BYTES} bytes for ggml-small.bin"
        ));
    }

    if dest_path.exists() {
        std::fs::remove_file(dest_path)
            .map_err(|error| format!("failed to replace existing model file: {error}"))?;
    }

    std::fs::rename(&temp_path, dest_path)
        .map_err(|error| format!("failed to finalize model download: {error}"))?;

    Ok(())
}
