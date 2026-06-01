use serde::{Deserialize, Serialize};

use crate::audio::platform::PlatformDescriptor;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureSourceKind {
    LocalMic,
    SystemAudio,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapturePermissionState {
    NotRequired,
    Unknown,
    Requested,
    Granted,
    Denied,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureDeviceState {
    Idle,
    Ready,
    Capturing,
    PermissionBlocked,
    DeviceLost,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub kind: CaptureSourceKind,
    pub display_name: String,
    pub backend: String,
    pub permission_state: CapturePermissionState,
    pub device_state: CaptureDeviceState,
    pub bound_session_id: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStateSnapshot {
    pub platform_name: String,
    pub system_audio_backend: String,
    pub supports_system_audio: bool,
    pub requires_explicit_permission: bool,
    pub supports_mid_session_device_recovery: bool,
    pub sources: Vec<CaptureSource>,
}

pub struct CaptureManager {
    base: CaptureStateSnapshot,
    pub sources: Vec<CaptureSource>,
}

impl CaptureManager {
    pub fn new(descriptor: PlatformDescriptor) -> Self {
        let sources = vec![
            CaptureSource {
                kind: CaptureSourceKind::LocalMic,
                display_name: "Local microphone".to_string(),
                backend: "cpal".to_string(),
                permission_state: CapturePermissionState::NotRequired,
                device_state: CaptureDeviceState::Ready,
                bound_session_id: None,
                last_error: None,
            },
            CaptureSource {
                kind: CaptureSourceKind::SystemAudio,
                display_name: "System audio".to_string(),
                backend: descriptor.system_audio_backend.to_string(),
                permission_state: descriptor.initial_permission_state,
                device_state: descriptor.initial_system_audio_state,
                bound_session_id: None,
                last_error: None,
            },
        ];

        let base = CaptureStateSnapshot {
            platform_name: descriptor.platform_name.to_string(),
            system_audio_backend: descriptor.system_audio_backend.to_string(),
            supports_system_audio: descriptor.supports_system_audio,
            requires_explicit_permission: descriptor.requires_explicit_permission,
            supports_mid_session_device_recovery: descriptor.supports_mid_session_device_recovery,
            sources: Vec::new(),
        };

        Self { base, sources }
    }

    pub fn snapshot(&self) -> CaptureStateSnapshot {
        let mut snapshot = self.base.clone();
        snapshot.sources = self.sources.clone();
        snapshot
    }

    pub fn bind_to_session(&mut self, session_id: &str) {
        for source in &mut self.sources {
            source.bound_session_id = Some(session_id.to_string());
            source.last_error = None;
            source.device_state = match source.kind {
                CaptureSourceKind::LocalMic => CaptureDeviceState::Capturing,
                CaptureSourceKind::SystemAudio => match source.permission_state {
                    CapturePermissionState::Granted | CapturePermissionState::NotRequired => {
                        CaptureDeviceState::Capturing
                    }
                    _ => CaptureDeviceState::PermissionBlocked,
                },
            };
        }
    }

    pub fn unbind_session(&mut self, session_id: &str) {
        for source in &mut self.sources {
            if source.bound_session_id.as_deref() == Some(session_id) {
                source.bound_session_id = None;
            }
        }
    }

    pub fn stop_all(&mut self) {
        for source in &mut self.sources {
            source.bound_session_id = None;
            source.last_error = None;
            source.device_state = match source.kind {
                CaptureSourceKind::LocalMic => CaptureDeviceState::Ready,
                CaptureSourceKind::SystemAudio => match source.permission_state {
                    CapturePermissionState::Granted | CapturePermissionState::NotRequired => {
                        CaptureDeviceState::Ready
                    }
                    _ => CaptureDeviceState::PermissionBlocked,
                },
            };
        }
    }

    pub fn mark_recovered(&mut self) {
        for source in &mut self.sources {
            if source.device_state == CaptureDeviceState::Capturing {
                source.device_state = CaptureDeviceState::Ready;
            }
        }
    }

    pub fn request_system_audio_permission(&mut self) -> Result<(), String> {
        let source = self
            .source_mut(CaptureSourceKind::SystemAudio)
            .ok_or_else(|| "system audio source is not configured".to_string())?;

        source.permission_state = CapturePermissionState::Requested;

        if cfg!(target_os = "macos") {
            source.permission_state = CapturePermissionState::Granted;
        } else {
            source.permission_state = CapturePermissionState::NotRequired;
        }

        source.device_state = if source.bound_session_id.is_some() {
            CaptureDeviceState::Capturing
        } else {
            CaptureDeviceState::Ready
        };

        Ok(())
    }

    pub fn apply_permission_result(&mut self, screen_granted: bool, microphone_granted: bool) {
        if let Some(system_audio) = self.source_mut(CaptureSourceKind::SystemAudio) {
            system_audio.permission_state = if screen_granted {
                CapturePermissionState::Granted
            } else {
                CapturePermissionState::Denied
            };
            system_audio.device_state = if screen_granted {
                CaptureDeviceState::Ready
            } else {
                CaptureDeviceState::PermissionBlocked
            };
            system_audio.last_error = if screen_granted {
                None
            } else {
                Some("Screen Recording permission is required.".to_string())
            };
        }

        if let Some(local_mic) = self.source_mut(CaptureSourceKind::LocalMic) {
            local_mic.permission_state = if microphone_granted {
                CapturePermissionState::Granted
            } else {
                CapturePermissionState::Denied
            };
            local_mic.device_state = if microphone_granted {
                CaptureDeviceState::Ready
            } else {
                CaptureDeviceState::PermissionBlocked
            };
            local_mic.last_error = if microphone_granted {
                None
            } else {
                Some("Microphone permission is required.".to_string())
            };
        }
    }

    pub fn simulate_device_loss(&mut self, source_kind: CaptureSourceKind) -> Result<(), String> {
        let source = self
            .source_mut(source_kind)
            .ok_or_else(|| "capture source not found".to_string())?;
        source.device_state = CaptureDeviceState::DeviceLost;
        source.last_error = Some("simulated spike failure".to_string());
        Ok(())
    }

    pub fn recover_device(
        &mut self,
        source_kind: CaptureSourceKind,
        active_session_id: Option<&str>,
    ) -> Result<(), String> {
        let source = self
            .source_mut(source_kind)
            .ok_or_else(|| "capture source not found".to_string())?;
        source.bound_session_id = active_session_id.map(ToString::to_string);
        source.last_error = None;
        source.device_state = if active_session_id.is_some() {
            match source.kind {
                CaptureSourceKind::LocalMic => CaptureDeviceState::Capturing,
                CaptureSourceKind::SystemAudio => match source.permission_state {
                    CapturePermissionState::Granted | CapturePermissionState::NotRequired => {
                        CaptureDeviceState::Capturing
                    }
                    _ => CaptureDeviceState::PermissionBlocked,
                },
            }
        } else {
            CaptureDeviceState::Ready
        };
        Ok(())
    }

    fn source_mut(&mut self, source_kind: CaptureSourceKind) -> Option<&mut CaptureSource> {
        self.sources
            .iter_mut()
            .find(|source| source.kind == source_kind)
    }
}
