use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};

#[derive(Clone, Copy, Debug)]
pub struct WhisperModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub file_name: &'static str,
    pub download_url: &'static str,
    pub approx_size_bytes: u64,
}

pub const DEFAULT_WHISPER_MODEL_ID: &str = "medium";

const AVAILABLE_MODELS: [WhisperModelSpec; 2] = [
    WhisperModelSpec {
        id: "small",
        label: "Whisper Small",
        file_name: "ggml-small.bin",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        approx_size_bytes: 466 * 1024 * 1024,
    },
    WhisperModelSpec {
        id: "medium",
        label: "Whisper Medium",
        file_name: "ggml-medium.bin",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        approx_size_bytes: 1_500 * 1024 * 1024,
    },
];

/// Reject obvious HTML/error payloads regardless of chosen model.
const MIN_MODEL_BYTES: u64 = 50 * 1024 * 1024;

pub fn available_models() -> &'static [WhisperModelSpec] {
    &AVAILABLE_MODELS
}

pub fn default_model() -> &'static WhisperModelSpec {
    find_model(DEFAULT_WHISPER_MODEL_ID).expect("default Whisper model should exist")
}

pub fn find_model(model_id: &str) -> Option<&'static WhisperModelSpec> {
    AVAILABLE_MODELS.iter().find(|model| model.id == model_id)
}

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

fn format_expected_model_name(dest_path: &Path) -> String {
    dest_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("whisper model")
        .to_string()
}

pub fn download_to_file(url: &str, dest_path: &Path) -> Result<(), String> {
    download_to_file_with_progress(url, dest_path, |_downloaded, _total| {})
}

/// Streams the model to `dest_path` via a `.tmp` sibling file.
pub fn download_to_file_with_progress<F>(
    url: &str,
    dest_path: &Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    let temp_path = dest_path.with_extension("bin.tmp");
    if temp_path.exists() {
        std::fs::remove_file(&temp_path)
            .map_err(|error| format!("failed to clear stale model download: {error}"))?;
    }

    let client = build_client()?;
    let mut response = send_model_request(&client, url)?;
    validate_response(&response)?;
    let total_bytes = response.content_length();

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|error| format!("failed to create model temp file: {error}"))?;

    let mut buffer = [0_u8; 8192];
    let mut total_downloaded = 0_u64;
    let mut prefix = Vec::with_capacity(512);
    let model_name = format_expected_model_name(dest_path);
    on_progress(0, total_bytes);

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
        total_downloaded += read_bytes as u64;
        on_progress(total_downloaded, total_bytes);
    }

    if looks_like_html(&prefix) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Downloaded data looks like an HTML/JSON error page, not {model_name}. Verify HF_TOKEN."
        ));
    }

    if total_downloaded < MIN_MODEL_BYTES {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "downloaded file is only {total_downloaded} bytes; expected at least {MIN_MODEL_BYTES} bytes for {model_name}"
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
