use tauri::{AppHandle, Manager, State};

use super::macos;
use super::runtime::NativeAudioRuntime;
use super::types::{
    NativeAudioDevice, NativeAudioSupport, NativeCaptureSessionState, NativeCaptureTarget,
    StartNativeCaptureRequest,
};

#[tauri::command]
pub fn native_audio_support() -> NativeAudioSupport {
    macos::support()
}

#[tauri::command]
pub fn native_audio_inputs() -> Vec<NativeAudioDevice> {
    macos::list_audio_inputs()
}

#[tauri::command]
pub fn native_audio_targets() -> Vec<NativeCaptureTarget> {
    macos::list_capture_targets()
}

#[tauri::command]
pub fn native_audio_state(state: State<NativeAudioRuntime>) -> Option<NativeCaptureSessionState> {
    state.get_session()
}

#[tauri::command]
pub fn start_native_audio_capture(
    app: AppHandle,
    payload: StartNativeCaptureRequest,
    state: State<NativeAudioRuntime>,
) -> Result<NativeCaptureSessionState, String> {
    let inputs = macos::list_audio_inputs();
    let targets = macos::list_capture_targets();
    let selected_input = payload
        .input_device_id
        .as_ref()
        .and_then(|input_id| inputs.into_iter().find(|input| input.id == *input_id));
    let selected_target = payload
        .target_id
        .as_ref()
        .and_then(|target_id| targets.into_iter().find(|target| target.id == *target_id));

    let output_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data dir: {error}"))?
        .join("native-audio");
    std::fs::create_dir_all(&output_root)
        .map_err(|error| format!("Cannot create native audio dir: {error}"))?;

    let session = macos::start_capture(&payload, selected_input, selected_target, output_root)?;
    state.set_session(session.clone());
    Ok(session)
}

#[tauri::command]
pub fn stop_native_audio_capture(
    state: State<NativeAudioRuntime>,
) -> Result<NativeCaptureSessionState, String> {
    let session = macos::stop_capture(state.get_session())?;
    state.set_session(session.clone());
    Ok(session)
}
