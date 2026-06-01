use crate::state::capture::{CaptureDeviceState, CapturePermissionState};

pub struct PlatformDescriptor {
    pub platform_name: &'static str,
    pub system_audio_backend: &'static str,
    pub supports_system_audio: bool,
    pub requires_explicit_permission: bool,
    pub supports_mid_session_device_recovery: bool,
    pub initial_permission_state: CapturePermissionState,
    pub initial_system_audio_state: CaptureDeviceState,
}

pub fn descriptor() -> PlatformDescriptor {
    #[cfg(target_os = "macos")]
    {
        PlatformDescriptor {
            platform_name: "macos",
            system_audio_backend: "screencapturekit",
            supports_system_audio: true,
            requires_explicit_permission: true,
            supports_mid_session_device_recovery: false,
            initial_permission_state: CapturePermissionState::Unknown,
            initial_system_audio_state: CaptureDeviceState::PermissionBlocked,
        }
    }

    #[cfg(target_os = "windows")]
    {
        PlatformDescriptor {
            platform_name: "windows",
            system_audio_backend: "wasapi-loopback",
            supports_system_audio: true,
            requires_explicit_permission: false,
            supports_mid_session_device_recovery: true,
            initial_permission_state: CapturePermissionState::NotRequired,
            initial_system_audio_state: CaptureDeviceState::Ready,
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        PlatformDescriptor {
            platform_name: std::env::consts::OS,
            system_audio_backend: "unsupported",
            supports_system_audio: false,
            requires_explicit_permission: false,
            supports_mid_session_device_recovery: false,
            initial_permission_state: CapturePermissionState::Denied,
            initial_system_audio_state: CaptureDeviceState::Error,
        }
    }
}
