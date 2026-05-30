use std::sync::Mutex;

use super::types::NativeCaptureSessionState;

#[derive(Default)]
pub struct NativeAudioRuntime {
    session: Mutex<Option<NativeCaptureSessionState>>,
}

impl NativeAudioRuntime {
    pub fn get_session(&self) -> Option<NativeCaptureSessionState> {
        self.session.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn set_session(&self, session: NativeCaptureSessionState) {
        if let Ok(mut guard) = self.session.lock() {
            *guard = Some(session);
        }
    }
}
