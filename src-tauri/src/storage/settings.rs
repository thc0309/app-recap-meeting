use std::{fs, process::Command};

use serde::{Deserialize, Serialize};

use crate::services::model_download;

use super::paths::AppPaths;

pub const OPENAI_KEYCHAIN_ACCOUNT: &str = "openai_api_key";
pub const OPENAI_KEYCHAIN_SERVICE: &str = "MeetingTranscriber";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecapProvider {
    OpenAi,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub recap_provider: RecapProvider,
    pub openai_model: String,
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
    pub refine_after_meeting: bool,
    pub save_raw_audio: bool,
    pub data_directory: String,
}

fn default_whisper_model() -> String {
    model_download::DEFAULT_WHISPER_MODEL_ID.to_string()
}

impl AppSettings {
    pub fn default_for_paths(paths: &AppPaths) -> Self {
        Self {
            recap_provider: RecapProvider::OpenAi,
            openai_model: "gpt-4.1-mini".to_string(),
            whisper_model: default_whisper_model(),
            refine_after_meeting: true,
            save_raw_audio: true,
            data_directory: paths.root_dir.display().to_string(),
        }
    }
}

pub fn load_or_create(paths: &AppPaths) -> Result<AppSettings, String> {
    if paths.config_path.exists() {
        let contents = fs::read_to_string(&paths.config_path).map_err(|error| {
            format!(
                "failed to read settings file {}: {error}",
                paths.config_path.display()
            )
        })?;

        serde_json::from_str(&contents).map_err(|error| {
            format!(
                "failed to parse settings file {}: {error}",
                paths.config_path.display()
            )
        })
    } else {
        let settings = AppSettings::default_for_paths(paths);
        save(paths, &settings)?;
        Ok(settings)
    }
}

pub fn save(paths: &AppPaths, settings: &AppSettings) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))?;
    paths.write_string(&paths.config_path, &contents)
}

#[allow(dead_code)]
pub fn save_openai_api_key(api_key: &str) -> Result<(), String> {
    let status = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            OPENAI_KEYCHAIN_ACCOUNT,
            "-s",
            OPENAI_KEYCHAIN_SERVICE,
            "-w",
            api_key,
            "-U",
        ])
        .status()
        .map_err(|error| format!("failed to invoke macOS security tool: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "security add-generic-password failed with status {status}"
        ))
    }
}

#[allow(dead_code)]
pub fn load_openai_api_key() -> Result<Option<String>, String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            OPENAI_KEYCHAIN_ACCOUNT,
            "-s",
            OPENAI_KEYCHAIN_SERVICE,
            "-w",
        ])
        .output()
        .map_err(|error| format!("failed to invoke macOS security tool: {error}"))?;

    if output.status.success() {
        String::from_utf8(output.stdout)
            .map(|value| Some(value.trim().to_string()))
            .map_err(|error| format!("failed to decode keychain value: {error}"))
    } else {
        Ok(None)
    }
}
