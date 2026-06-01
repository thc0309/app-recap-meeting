use std::sync::Mutex;

use tauri::State;

use crate::state::{
    app::{
        AppState, AppStateSnapshot, CreateSessionInput, FinalizeSessionInput,
        LiveTranscriptSnapshot, ModelStatusSnapshot, SessionDetailSnapshot, UpdateSettingsInput,
    },
    capture::{CaptureSourceKind, CaptureStateSnapshot},
};

#[tauri::command]
pub fn health() -> &'static str {
    "ok"
}

#[tauri::command]
pub fn get_app_state(state: State<'_, Mutex<AppState>>) -> Result<AppStateSnapshot, String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn get_capture_overview(
    state: State<'_, Mutex<AppState>>,
) -> Result<CaptureStateSnapshot, String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    Ok(app_state.capture_snapshot())
}

#[tauri::command]
pub fn get_model_status(state: State<'_, Mutex<AppState>>) -> Result<ModelStatusSnapshot, String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    Ok(app_state.model_status_snapshot())
}

#[tauri::command]
pub fn create_session(
    input: CreateSessionInput,
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.create_session(input, Some(app))?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn get_live_transcript(state: State<'_, Mutex<AppState>>) -> Result<LiveTranscriptSnapshot, String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    Ok(app_state.live_transcript_snapshot())
}

#[tauri::command]
pub fn recover_active_session(
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.recover_active_session()?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn finalize_session(
    input: FinalizeSessionInput,
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.start_finalize_session(input, Some(app))?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn delete_session(
    session_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.delete_session(&session_id)?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn clear_history(state: State<'_, Mutex<AppState>>) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.clear_history()?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn request_system_audio_permission(
    state: State<'_, Mutex<AppState>>,
) -> Result<CaptureStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.request_system_audio_permission()?;
    Ok(app_state.capture_snapshot())
}

#[tauri::command]
pub fn simulate_device_loss(
    source_kind: CaptureSourceKind,
    state: State<'_, Mutex<AppState>>,
) -> Result<CaptureStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.simulate_device_loss(source_kind)?;
    Ok(app_state.capture_snapshot())
}

#[tauri::command]
pub fn recover_capture_device(
    source_kind: CaptureSourceKind,
    state: State<'_, Mutex<AppState>>,
) -> Result<CaptureStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.recover_capture_device(source_kind)?;
    Ok(app_state.capture_snapshot())
}

#[tauri::command]
pub fn update_settings(
    input: UpdateSettingsInput,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.update_settings(input)?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn save_openai_api_key(
    api_key: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.save_openai_api_key(&api_key)
}

#[tauri::command]
pub fn select_whisper_model(
    model_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.select_whisper_model(model_id)?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn download_whisper_model(
    model_id: String,
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.start_download_whisper_model(model_id, Some(app))
}

#[tauri::command]
pub fn generate_recap(
    session_id: String,
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<AppStateSnapshot, String> {
    let mut app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.start_generate_recap(session_id, Some(app))?;
    Ok(app_state.snapshot())
}

#[tauri::command]
pub fn export_session_markdown(
    session_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.export_session_markdown(&session_id)
}

#[tauri::command]
pub fn get_session_detail(
    session_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<SessionDetailSnapshot, String> {
    let app_state = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    app_state.session_detail_snapshot(&session_id)
}
