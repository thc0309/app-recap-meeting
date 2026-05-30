use std::path::PathBuf;

use super::types::{
    NativeAudioDevice, NativeAudioDeviceKind, NativeAudioSupport, NativeCaptureMode,
    NativeCaptureTarget, NativeCaptureTargetKind, NativeCaptureSessionState, StartNativeCaptureRequest,
};

pub fn support() -> NativeAudioSupport {
    #[cfg(target_os = "macos")]
    {
        NativeAudioSupport {
            platform: "macos".to_string(),
            native_capture_available: true,
            supports_app_audio_capture: true,
            supports_microphone_mix: true,
            recommended_mode: NativeCaptureMode::AppAudioAndMic,
            notes: vec![
                "Target architecture: ScreenCaptureKit for app audio, AVAudioEngine/CoreAudio for microphone."
                    .to_string(),
                "Frontend should stop using getDisplayMedia/getUserMedia for macOS native mode.".to_string(),
                "Persist capture into app data as PCM/WAV before transcript and recap jobs run.".to_string(),
            ],
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        NativeAudioSupport {
            platform: std::env::consts::OS.to_string(),
            native_capture_available: false,
            supports_app_audio_capture: false,
            supports_microphone_mix: false,
            recommended_mode: NativeCaptureMode::ScreenShareMix,
            notes: vec!["Native macOS capture mode is only available on macOS.".to_string()],
        }
    }
}

pub fn list_audio_inputs() -> Vec<NativeAudioDevice> {
    #[cfg(target_os = "macos")]
    {
        vec![
            NativeAudioDevice {
                id: "default-input".to_string(),
                name: "System Default Input".to_string(),
                kind: NativeAudioDeviceKind::Input,
                is_default: true,
                channels: 1,
            },
            NativeAudioDevice {
                id: "aggregate-device".to_string(),
                name: "Aggregate Device (placeholder)".to_string(),
                kind: NativeAudioDeviceKind::Aggregate,
                is_default: false,
                channels: 2,
            },
            NativeAudioDevice {
                id: "blackhole-2ch".to_string(),
                name: "BlackHole 2ch (placeholder)".to_string(),
                kind: NativeAudioDeviceKind::VirtualLoopback,
                is_default: false,
                channels: 2,
            },
        ]
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

pub fn list_capture_targets() -> Vec<NativeCaptureTarget> {
    #[cfg(target_os = "macos")]
    {
        vec![
            NativeCaptureTarget {
                id: "com.google.Chrome".to_string(),
                name: "Google Chrome".to_string(),
                bundle_id: Some("com.google.Chrome".to_string()),
                pid: None,
                kind: NativeCaptureTargetKind::Browser,
            },
            NativeCaptureTarget {
                id: "us.zoom.xos".to_string(),
                name: "Zoom".to_string(),
                bundle_id: Some("us.zoom.xos".to_string()),
                pid: None,
                kind: NativeCaptureTargetKind::MeetingApp,
            },
            NativeCaptureTarget {
                id: "system-audio".to_string(),
                name: "System audio".to_string(),
                bundle_id: None,
                pid: None,
                kind: NativeCaptureTargetKind::SystemAudio,
            },
        ]
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

pub fn start_capture(
    request: &StartNativeCaptureRequest,
    selected_input: Option<NativeAudioDevice>,
    selected_target: Option<NativeCaptureTarget>,
    output_root: PathBuf,
) -> Result<NativeCaptureSessionState, String> {
    #[cfg(target_os = "macos")]
    {
        let output_path = output_root.join("native-capture-session.wav");
        return Ok(NativeCaptureSessionState {
            active: true,
            title: Some(request.title.clone()),
            mode: Some(request.mode.clone()),
            selected_input,
            selected_target,
            include_microphone: request.include_microphone,
            status: "planned_native_capture".to_string(),
            output_path: Some(output_path.to_string_lossy().to_string()),
            sample_rate: 16_000,
            channels: 1,
            last_error: Some(
                "Scaffold only: wire ScreenCaptureKit + AVAudioEngine in this module to replace sidecar streaming."
                    .to_string(),
            ),
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (request, selected_input, selected_target, output_root);
        Err("Native macOS audio capture mode is not available on this platform.".to_string())
    }
}

pub fn stop_capture(
    current: Option<NativeCaptureSessionState>,
) -> Result<NativeCaptureSessionState, String> {
    let mut session = current.ok_or_else(|| "No native capture session is active.".to_string())?;
    session.active = false;
    session.status = "stopped".to_string();
    Ok(session)
}
