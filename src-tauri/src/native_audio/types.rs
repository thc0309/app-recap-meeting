use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeCaptureMode {
    ScreenShareMix,
    AudioInputOnly,
    AppAudioAndMic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAudioDeviceKind {
    Input,
    Aggregate,
    VirtualLoopback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeCaptureTargetKind {
    Browser,
    MeetingApp,
    SystemAudio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioDevice {
    pub id: String,
    pub name: String,
    pub kind: NativeAudioDeviceKind,
    pub is_default: bool,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureTarget {
    pub id: String,
    pub name: String,
    pub bundle_id: Option<String>,
    pub pid: Option<i32>,
    pub kind: NativeCaptureTargetKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioSupport {
    pub platform: String,
    pub native_capture_available: bool,
    pub supports_app_audio_capture: bool,
    pub supports_microphone_mix: bool,
    pub recommended_mode: NativeCaptureMode,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNativeCaptureRequest {
    pub title: String,
    pub mode: NativeCaptureMode,
    pub input_device_id: Option<String>,
    pub target_id: Option<String>,
    pub include_microphone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureSessionState {
    pub active: bool,
    pub title: Option<String>,
    pub mode: Option<NativeCaptureMode>,
    pub selected_input: Option<NativeAudioDevice>,
    pub selected_target: Option<NativeCaptureTarget>,
    pub include_microphone: bool,
    pub status: String,
    pub output_path: Option<String>,
    pub sample_rate: u32,
    pub channels: u32,
    pub last_error: Option<String>,
}
