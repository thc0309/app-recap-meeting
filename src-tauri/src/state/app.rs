#[cfg(test)]
use std::env;
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering::Relaxed},
        Arc,
    },
};

use serde::{Deserialize, Serialize};

use crate::{
    audio::{helper, helper::NativeCaptureProcess, platform},
    services::{live_transcription, model_download, openai, transcription},
    state::{
        capture::{CaptureManager, CaptureSourceKind, CaptureStateSnapshot},
        session::{
            now_unix_ms, MeetingSession, RemoteSpeakerLabelState, SessionStatus, TranscriptMode,
        },
        transcript::{TranscriptDocument, TranscriptSegment},
    },
    storage::{
        db,
        paths::AppPaths,
        settings::{self, AppSettings},
    },
};

pub struct AppState {
    pub active_session_id: Option<String>,
    pub capture: CaptureManager,
    pub native_capture: Option<NativeCaptureProcess>,
    pub native_capture_enabled: bool,
    pub transcription_enabled: bool,
    pub paths: AppPaths,
    pub settings: AppSettings,
    pub sessions: Vec<MeetingSession>,
    model_download: Option<ModelDownloadState>,
    pub live_transcription: Option<live_transcription::LiveTranscriptionSession>,
    live_poll_cancel: Option<Arc<AtomicBool>>,
}

#[derive(Clone, Debug)]
struct ModelDownloadState {
    model_id: String,
    progress_percent: Option<f64>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub title: Option<String>,
    pub save_raw_audio: bool,
    pub refine_requested: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeSessionInput {
    pub session_id: String,
    pub run_refine: bool,
    pub generate_recap: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    pub active_session_id: Option<String>,
    pub capture: CaptureStateSnapshot,
    pub settings: AppSettings,
    pub sessions: Vec<MeetingSession>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsInput {
    pub openai_model: String,
    pub refine_after_meeting: bool,
    pub save_raw_audio: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatusSnapshot {
    pub selected_model_id: String,
    pub selected_model_label: String,
    pub selected_model_path: String,
    pub selected_model_exists: bool,
    pub is_downloading: bool,
    pub download_model_id: Option<String>,
    pub download_progress_percent: Option<f64>,
    pub download_downloaded_bytes: Option<u64>,
    pub download_total_bytes: Option<u64>,
    pub models: Vec<WhisperModelOptionSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelOptionSnapshot {
    pub id: String,
    pub label: String,
    pub file_name: String,
    pub path: String,
    pub approx_size_bytes: u64,
    pub is_downloaded: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailSnapshot {
    pub segments: Vec<TranscriptSegment>,
    pub recap_markdown: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTranscriptSnapshot {
    pub session_id: Option<String>,
    pub segments: Vec<TranscriptSegment>,
    pub is_active: bool,
    pub model_ready: bool,
}

#[derive(Deserialize)]
struct TranscriptFilePayload {
    #[serde(default)]
    segments: Vec<TranscriptSegment>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationErrorEvent {
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadProgressEvent {
    model_id: String,
    progress_percent: Option<f64>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

impl AppState {
    fn emit_operation_error(app: &tauri::AppHandle, message: String) {
        use tauri::Emitter;
        let _ = app.emit("operation-error", OperationErrorEvent { message });
    }

    fn emit_model_download_progress(
        app: &tauri::AppHandle,
        model_id: String,
        progress_percent: Option<f64>,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    ) {
        use tauri::Emitter;
        let _ = app.emit(
            "model-download-progress",
            ModelDownloadProgressEvent {
                model_id,
                progress_percent,
                downloaded_bytes,
                total_bytes,
            },
        );
    }

    pub fn bootstrap() -> Result<Self, String> {
        Self::from_paths(AppPaths::detect()?)
    }

    fn from_paths(paths: AppPaths) -> Result<Self, String> {
        paths.ensure()?;
        db::initialize(&paths.db_path)?;
        let mut settings = settings::load_or_create(&paths)?;
        if model_download::find_model(&settings.whisper_model).is_none() {
            settings.whisper_model = model_download::DEFAULT_WHISPER_MODEL_ID.to_string();
            settings::save(&paths, &settings)?;
        }
        let sessions = db::load_sessions(&paths.db_path)?;
        let active_session_id = sessions
            .iter()
            .find(|session| {
                matches!(
                    session.status,
                    SessionStatus::Recording | SessionStatus::Recovered | SessionStatus::Processing
                )
            })
            .map(|session| session.id.clone());

        Ok(Self {
            active_session_id,
            capture: CaptureManager::new(platform::descriptor()),
            native_capture: None,
            native_capture_enabled: cfg!(target_os = "macos"),
            transcription_enabled: true,
            paths,
            settings,
            sessions,
            model_download: None,
            live_transcription: None,
            live_poll_cancel: None,
        })
    }

    pub fn live_transcript_snapshot(&self) -> LiveTranscriptSnapshot {
        let model_ready = self.default_model_path().exists();
        match &self.live_transcription {
            Some(live) => LiveTranscriptSnapshot {
                session_id: Some(live.session_id.clone()),
                segments: live.segments.clone(),
                is_active: true,
                model_ready,
            },
            None => LiveTranscriptSnapshot {
                session_id: None,
                segments: Vec::new(),
                is_active: false,
                model_ready,
            },
        }
    }

    fn stop_live_transcription(&mut self) {
        if let Some(cancel) = &self.live_poll_cancel {
            cancel.store(true, Relaxed);
        }
        self.live_poll_cancel = None;
        self.live_transcription = None;
    }

    fn start_live_transcription(
        &mut self,
        session_id: String,
        mic_audio_path: PathBuf,
        system_audio_path: PathBuf,
        app_handle: tauri::AppHandle,
    ) {
        self.stop_live_transcription();

        self.live_transcription = Some(live_transcription::LiveTranscriptionSession::new(
            session_id,
            mic_audio_path,
            system_audio_path,
        ));

        let cancel = Arc::new(AtomicBool::new(false));
        self.live_poll_cancel = Some(cancel.clone());
        let poll_seconds = live_transcription::poll_interval_seconds();

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(poll_seconds)).await;
                if cancel.load(Relaxed) {
                    break;
                }

                let app_for_blocking = app_handle.clone();
                let snapshot = tauri::async_runtime::spawn_blocking(
                    move || -> Result<LiveTranscriptSnapshot, String> {
                        use tauri::Manager;
                        let state = app_for_blocking.state::<std::sync::Mutex<AppState>>();
                        let mut app_state = state
                            .lock()
                            .map_err(|_| "state lock poisoned".to_string())?;
                        let model_path = app_state.default_model_path();

                        if let Some(live) = app_state.live_transcription.as_mut() {
                            if let Err(error) = live_transcription::poll_live_session(live, &model_path) {
                                println!("Live transcription poll failed: {error}");
                            }
                        }

                        Ok(app_state.live_transcript_snapshot())
                    },
                )
                .await;

                match snapshot {
                    Ok(Ok(snapshot)) => {
                        use tauri::Emitter;
                        let _ = app_handle.emit("live-transcript-updated", snapshot);
                    }
                    Ok(Err(error)) => println!("Live transcription lock failed: {error}"),
                    Err(error) => println!("Live transcription task failed: {error}"),
                }
            }
        });
    }

    pub fn snapshot(&self) -> AppStateSnapshot {
        AppStateSnapshot {
            active_session_id: self.active_session_id.clone(),
            capture: self.capture.snapshot(),
            settings: self.settings.clone(),
            sessions: self.sessions.clone(),
        }
    }

    pub fn capture_snapshot(&self) -> CaptureStateSnapshot {
        self.capture.snapshot()
    }

    pub fn model_status_snapshot(&self) -> ModelStatusSnapshot {
        let selected_model = self.selected_model_spec();
        let model_path = self.model_path_for_spec(selected_model);
        ModelStatusSnapshot {
            selected_model_id: selected_model.id.to_string(),
            selected_model_label: selected_model.label.to_string(),
            selected_model_path: model_path.display().to_string(),
            selected_model_exists: model_path.exists(),
            is_downloading: self.model_download.is_some(),
            download_model_id: self
                .model_download
                .as_ref()
                .map(|download| download.model_id.clone()),
            download_progress_percent: self
                .model_download
                .as_ref()
                .and_then(|download| download.progress_percent),
            download_downloaded_bytes: self
                .model_download
                .as_ref()
                .map(|download| download.downloaded_bytes),
            download_total_bytes: self
                .model_download
                .as_ref()
                .and_then(|download| download.total_bytes),
            models: model_download::available_models()
                .iter()
                .map(|model| {
                    let path = self.model_path_for_spec(model);
                    WhisperModelOptionSnapshot {
                        id: model.id.to_string(),
                        label: model.label.to_string(),
                        file_name: model.file_name.to_string(),
                        path: path.display().to_string(),
                        approx_size_bytes: model.approx_size_bytes,
                        is_downloaded: path.exists(),
                    }
                })
                .collect(),
        }
    }

    pub fn create_session(
        &mut self,
        input: CreateSessionInput,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), String> {
        if self.active_session_id.is_some() {
            return Err("an active session already exists".to_string());
        }

        let session_id = format!("session-{}", now_unix_ms());
        let title = input
            .title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("Meeting {}", session_id));

        let session_dir = self.paths.ensure_session_dir(&session_id)?;
        let mic_audio_path = session_dir.join("mic.wav");
        let system_audio_path = session_dir.join("system.wav");
        let transcript_path = session_dir.join("transcript.json");
        let recap_path = session_dir.join("recap.md");

        self.paths
            .write_string(&transcript_path, "{\n  \"segments\": []\n}")?;
        self.paths.write_string(&recap_path, "")?;

        let session = MeetingSession::new(
            session_id.clone(),
            title,
            input.save_raw_audio,
            input.refine_requested,
            session_dir.display().to_string(),
            mic_audio_path.display().to_string(),
            system_audio_path.display().to_string(),
            transcript_path.display().to_string(),
            recap_path.display().to_string(),
        );

        if self.native_capture_enabled {
            let process = helper::NativeCaptureProcess::start(
                &session.mic_audio_path,
                &session.system_audio_path,
            )?;
            self.native_capture = Some(process);
        }

        self.capture.bind_to_session(&session_id);
        self.active_session_id = Some(session_id.clone());
        db::upsert_session(&self.paths.db_path, &session)?;
        self.sessions.push(session);

        if self.transcription_enabled {
            if let Some(app) = app_handle {
                self.start_live_transcription(
                    session_id,
                    mic_audio_path,
                    system_audio_path,
                    app,
                );
            }
        }

        Ok(())
    }

    pub fn recover_active_session(&mut self) -> Result<(), String> {
        let active_id = self
            .active_session_id
            .clone()
            .ok_or_else(|| "no active session to recover".to_string())?;

        let session = self
            .sessions
            .iter_mut()
            .find(|session| session.id == active_id)
            .ok_or_else(|| "active session missing from history".to_string())?;

        if session.status != SessionStatus::Recording {
            return Err("only recording sessions can enter recovered".to_string());
        }

        session.status = SessionStatus::Recovered;
        db::upsert_session(&self.paths.db_path, session)?;
        self.capture.mark_recovered();
        Ok(())
    }

    pub fn start_finalize_session(
        &mut self,
        input: FinalizeSessionInput,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), String> {
        self.stop_live_transcription();

        let session_index = self
            .sessions
            .iter()
            .position(|session| session.id == input.session_id)
            .ok_or_else(|| "session not found".to_string())?;

        // Move all immutable borrows from self UP here
        let model_path = self.default_model_path();
        let db_path = self.paths.db_path.clone();
        let paths = self.paths.clone();
        let settings = self.settings.clone();
        let transcription_enabled = self.transcription_enabled;

        // Borrow session mutably
        let session = &mut self.sessions[session_index];
        match session.status {
            SessionStatus::Recording | SessionStatus::Recovered | SessionStatus::Done => {}
            _ => return Err("session is not in a finalizable state".to_string()),
        }

        // 1. Transition state immediately to Processing
        session.status = SessionStatus::Processing;
        session.ended_at_unix_ms = Some(now_unix_ms());
        session.remote_speaker_label_state = RemoteSpeakerLabelState::PostMeetingPending;

        if input.run_refine && !session.save_raw_audio {
            session.status = SessionStatus::Error;
            let _ = db::upsert_session(&db_path, session);
            self.capture.stop_all();
            if self.active_session_id.as_deref() == Some(session.id.as_str()) {
                self.active_session_id = None;
            }
            return Err("refine requires saved raw audio".to_string());
        }

        if input.run_refine && session.save_raw_audio {
            session.refine_enabled = true;
        }

        db::upsert_session(&db_path, session)?;

        // 2. Stop capture processes immediately
        if let Some(mut native_capture) = self.native_capture.take() {
            let _ = native_capture.stop();
        }

        self.capture.stop_all();
        let session_id = session.id.clone();
        if self.active_session_id.as_deref() == Some(session_id.as_str()) {
            self.active_session_id = None;
        }

        // Clone variables to move to background thread
        let mic_audio_path = std::path::PathBuf::from(session.mic_audio_path.clone());
        let system_audio_path = std::path::PathBuf::from(session.system_audio_path.clone());
        let transcript_path = std::path::PathBuf::from(session.transcript_path.clone());
        let recap_path = std::path::PathBuf::from(session.recap_path.clone());
        let session_title = session.title.clone();
        let generate_recap = input.generate_recap;
        let save_raw_audio = session.save_raw_audio;

        if let Some(app_clone) = app_handle {
            // Asynchronous Path (Production)
            let session_id_clone = session_id.clone();
            tauri::async_runtime::spawn(async move {
                let session_id_for_thread = session_id_clone.clone();
                let process_result = tauri::async_runtime::spawn_blocking(
                    move || -> Result<(SessionStatus, Option<String>), String> {
                        let segments = if transcription_enabled {
                            if !model_path.exists() {
                                return Err(format!(
                                    "missing whisper model at {}. download the selected Whisper model first",
                                    model_path.display()
                                ));
                            }

                            match transcription::transcribe_session(
                                &session_id_for_thread,
                                &model_path,
                                &mic_audio_path,
                                &system_audio_path,
                            ) {
                                Ok(segments) => segments,
                                Err(error) => return Err(error),
                            }
                        } else {
                            Vec::new()
                        };

                        db::replace_segments(&db_path, &session_id_for_thread, &segments)?;

                        // Write transcript file
                        let document = TranscriptDocument {
                            session_id: session_id_for_thread.clone(),
                            segments,
                        };
                        let json = serde_json::to_string_pretty(&document).map_err(|error| {
                            format!("failed to serialize transcript document: {error}")
                        })?;
                        paths.write_string(&transcript_path, &json)?;

                        // Cleanup audio
                        if !save_raw_audio {
                            for path in [&mic_audio_path, &system_audio_path] {
                                if path.exists() {
                                    std::fs::remove_file(path).map_err(|error| {
                                        format!(
                                            "failed to delete raw audio {}: {error}",
                                            path.display()
                                        )
                                    })?;
                                }
                            }
                        }

                        // Optional recap
                        let mut status = SessionStatus::Done;
                        let mut operation_error = None;
                        if generate_recap {
                            let api_key = settings::load_openai_api_key()?.ok_or_else(|| {
                                "no OpenAI API key found in macOS Keychain".to_string()
                            })?;
                            let segments = db::load_segments(&db_path, &session_id_for_thread)?;
                            match openai::summarize_transcript(
                                &api_key,
                                &settings,
                                &session_title,
                                &segments,
                            ) {
                                Ok(recap) => {
                                    paths.write_string(&recap_path, &recap.content)?;
                                    db::upsert_recap(&db_path, &session_id_for_thread, &recap)?;
                                    status = SessionStatus::RecapDone;
                                }
                                Err(error) => {
                                    operation_error = Some(error);
                                }
                            }
                        }

                        Ok((status, operation_error))
                    },
                )
                .await;

                let (final_status, operation_error) = match process_result {
                    Ok(Ok((status, operation_error))) => (status, operation_error),
                    Ok(Err(err)) => {
                        println!("Transcription/Recap background error: {err}");
                        (SessionStatus::Error, Some(err))
                    }
                    Err(err) => {
                        println!("Background task panicked: {err}");
                        (SessionStatus::Error, Some(format!("Background task panicked: {err}")))
                    }
                };

                // Lock AppState to save final status
                {
                    use tauri::Manager;
                    if let Some(state) = app_clone.try_state::<std::sync::Mutex<AppState>>() {
                        if let Ok(mut app_state) = state.lock() {
                            if let Some(pos) = app_state
                                .sessions
                                .iter()
                                .position(|s| s.id == session_id_clone)
                            {
                                app_state.sessions[pos].status = final_status.clone();
                                if final_status != SessionStatus::Error {
                                    app_state.sessions[pos].transcript_mode =
                                        TranscriptMode::FinalSpeakerLabels;
                                    app_state.sessions[pos].remote_speaker_label_state =
                                        RemoteSpeakerLabelState::FinalLabelsApplied;
                                }
                                let _ = db::upsert_session(
                                    &app_state.paths.db_path,
                                    &app_state.sessions[pos],
                                );
                            }
                        }
                    }
                }

                // Emit event
                use tauri::Emitter;
                let _ = app_clone.emit("state-changed", ());
                if let Some(message) = operation_error {
                    Self::emit_operation_error(&app_clone, message);
                }
            });
        } else {
            // Synchronous Path (Tests)
            let segments = if transcription_enabled {
                if !model_path.exists() {
                    return Err(format!(
                        "missing whisper model at {}. download the selected Whisper model first",
                        model_path.display()
                    ));
                }

                transcription::transcribe_session(
                    &session_id,
                    &model_path,
                    &mic_audio_path,
                    &system_audio_path,
                )?
            } else {
                Vec::new()
            };

            db::replace_segments(&db_path, &session_id, &segments)?;

            // Write transcript file
            let document = TranscriptDocument {
                session_id: session_id.clone(),
                segments,
            };
            let json = serde_json::to_string_pretty(&document)
                .map_err(|error| format!("failed to serialize transcript document: {error}"))?;
            paths.write_string(&transcript_path, &json)?;

            // Cleanup audio
            if !save_raw_audio {
                for path in [&mic_audio_path, &system_audio_path] {
                    if path.exists() {
                        std::fs::remove_file(path).map_err(|error| {
                            format!("failed to delete raw audio {}: {error}", path.display())
                        })?;
                    }
                }
            }

            // Optional recap
            let mut final_status = SessionStatus::Done;
            if generate_recap {
                let api_key = settings::load_openai_api_key()?
                    .ok_or_else(|| "no OpenAI API key found in macOS Keychain".to_string())?;
                let segments = db::load_segments(&db_path, &session_id)?;
                let recap =
                    openai::summarize_transcript(&api_key, &settings, &session_title, &segments)?;

                paths.write_string(&recap_path, &recap.content)?;
                db::upsert_recap(&db_path, &session_id, &recap)?;
                final_status = SessionStatus::RecapDone;
            }

            // Update session status directly since we are already inside the lock!
            let pos = self
                .sessions
                .iter()
                .position(|s| s.id == session_id)
                .unwrap();
            self.sessions[pos].status = final_status;
            self.sessions[pos].transcript_mode = TranscriptMode::FinalSpeakerLabels;
            self.sessions[pos].remote_speaker_label_state =
                RemoteSpeakerLabelState::FinalLabelsApplied;
            db::upsert_session(&db_path, &self.sessions[pos])?;
        }

        Ok(())
    }

    pub fn delete_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
            .ok_or_else(|| "session not found".to_string())?;

        db::delete_session(&self.paths.db_path, session_id)?;
        self.paths.remove_session_dir(session_id)?;
        self.sessions.retain(|item| item.id != session_id);

        if self.active_session_id.as_deref() == Some(session_id) {
            if let Some(native_capture) = &mut self.native_capture {
                let _ = native_capture.stop();
            }
            self.native_capture = None;
            self.active_session_id = None;
        }

        self.capture.unbind_session(&session.id);
        Ok(())
    }

    pub fn clear_history(&mut self) -> Result<(), String> {
        let sessions = self.sessions.clone();
        for session in &sessions {
            self.paths.remove_session_dir(&session.id)?;
        }

        if let Some(native_capture) = &mut self.native_capture {
            let _ = native_capture.stop();
        }
        self.native_capture = None;
        db::clear_history(&self.paths.db_path)?;
        self.active_session_id = None;
        self.capture.stop_all();
        self.sessions.clear();
        Ok(())
    }

    pub fn request_system_audio_permission(&mut self) -> Result<(), String> {
        if self.native_capture_enabled {
            let permission_status = helper::request_permissions()?;
            self.capture.apply_permission_result(
                permission_status.screen_recording_granted,
                permission_status.microphone_granted,
            );
            Ok(())
        } else {
            self.capture.request_system_audio_permission()
        }
    }

    pub fn simulate_device_loss(&mut self, source_kind: CaptureSourceKind) -> Result<(), String> {
        if self.active_session_id.is_none() {
            return Err("device loss can only be simulated while a session is active".to_string());
        }

        self.capture.simulate_device_loss(source_kind)
    }

    pub fn recover_capture_device(&mut self, source_kind: CaptureSourceKind) -> Result<(), String> {
        self.capture
            .recover_device(source_kind, self.active_session_id.as_deref())
    }

    pub fn update_settings(&mut self, input: UpdateSettingsInput) -> Result<(), String> {
        self.settings.openai_model = input.openai_model;
        self.settings.refine_after_meeting = input.refine_after_meeting;
        self.settings.save_raw_audio = input.save_raw_audio;
        settings::save(&self.paths, &self.settings)
    }

    pub fn select_whisper_model(&mut self, model_id: String) -> Result<(), String> {
        let model = model_download::find_model(&model_id)
            .ok_or_else(|| format!("unsupported Whisper model: {model_id}"))?;
        self.settings.whisper_model = model.id.to_string();
        settings::save(&self.paths, &self.settings)
    }

    pub fn save_openai_api_key(&self, api_key: &str) -> Result<(), String> {
        settings::save_openai_api_key(api_key)
    }

    pub fn start_download_whisper_model(
        &mut self,
        model_id: String,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), String> {
        if self.model_download.is_some() {
            return Err("model download is already in progress".to_string());
        }

        let model = model_download::find_model(&model_id)
            .ok_or_else(|| format!("unsupported Whisper model: {model_id}"))?;
        let model_path = self.model_path_for_spec(model);
        if model_path.exists() {
            return Err("whisper model already exists".to_string());
        }

        if let Some(app_clone) = app_handle {
            self.model_download = Some(ModelDownloadState {
                model_id: model.id.to_string(),
                progress_percent: Some(0.0),
                downloaded_bytes: 0,
                total_bytes: Some(model.approx_size_bytes),
            });

            tauri::async_runtime::spawn(async move {
                let model_id_for_download = model.id.to_string();
                let model_url = model.download_url.to_string();
                let progress_app = app_clone.clone();

                let download_result = tauri::async_runtime::spawn_blocking(move || {
                    let mut last_progress_bucket = None;
                    model_download::download_to_file_with_progress(
                        &model_url,
                        &model_path,
                        move |downloaded_bytes, total_bytes| {
                            let progress_percent = total_bytes.map(|total| {
                                if total == 0 {
                                    0.0
                                } else {
                                    (downloaded_bytes as f64 / total as f64 * 100.0).min(100.0)
                                }
                            });

                            let progress_bucket = progress_percent
                                .map(|progress| progress.floor() as u64)
                                .unwrap_or(downloaded_bytes / (5 * 1024 * 1024));

                            if Some(progress_bucket) == last_progress_bucket
                                && downloaded_bytes != 0
                                && Some(downloaded_bytes) != total_bytes
                            {
                                return;
                            }
                            last_progress_bucket = Some(progress_bucket);

                            use tauri::Manager;
                            if let Some(state) =
                                progress_app.try_state::<std::sync::Mutex<AppState>>()
                            {
                                if let Ok(mut app_state) = state.lock() {
                                    app_state.model_download = Some(ModelDownloadState {
                                        model_id: model_id_for_download.clone(),
                                        progress_percent,
                                        downloaded_bytes,
                                        total_bytes,
                                    });
                                }
                            }

                            Self::emit_model_download_progress(
                                &progress_app,
                                model_id_for_download.clone(),
                                progress_percent,
                                downloaded_bytes,
                                total_bytes,
                            );
                        },
                    )
                })
                .await;

                let result = match download_result {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(err)) => Err(err),
                    Err(err) => Err(format!("download task panicked: {err}")),
                };

                // Update downloading flag
                {
                    use tauri::Manager;
                    if let Some(state) = app_clone.try_state::<std::sync::Mutex<AppState>>() {
                        if let Ok(mut app_state) = state.lock() {
                            app_state.model_download = None;
                            if let Err(e) = &result {
                                println!("Model download failed: {e}");
                            }
                        }
                    }
                }

                // Emit event to update the frontend
                use tauri::Emitter;
                let _ = app_clone.emit("state-changed", ());
                if let Err(error) = result {
                    Self::emit_operation_error(&app_clone, error);
                }
            });
        } else {
            model_download::download_to_file(model.download_url, &model_path)?;
        }

        Ok(())
    }

    pub fn start_generate_recap(
        &mut self,
        session_id: String,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), String> {
        let session_index = self
            .sessions
            .iter()
            .position(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;

        // Move all immutable borrows from self UP
        let db_path = self.paths.db_path.clone();
        let paths = self.paths.clone();
        let settings = self.settings.clone();

        // Borrow session mutably
        let session = &mut self.sessions[session_index];
        match session.status {
            SessionStatus::Done | SessionStatus::RecapDone => {}
            _ => return Err("recap can only run after transcript finalization".to_string()),
        }

        // 1. Transition state immediately to Processing
        session.status = SessionStatus::Processing;
        db::upsert_session(&db_path, session)?;

        // Clone variables to move to background thread
        let session_title = session.title.clone();
        let recap_path = std::path::PathBuf::from(session.recap_path.clone());
        let session_id_clone = session_id.clone();

        if let Some(app_clone) = app_handle {
            tauri::async_runtime::spawn(async move {
                let session_id_inner = session_id_clone.clone();
                let process_result =
                    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                        let api_key = settings::load_openai_api_key()?.ok_or_else(|| {
                            "no OpenAI API key found in macOS Keychain".to_string()
                        })?;
                        let segments = db::load_segments(&db_path, &session_id_inner)?;
                        let recap = openai::summarize_transcript(
                            &api_key,
                            &settings,
                            &session_title,
                            &segments,
                        )?;

                        paths.write_string(&recap_path, &recap.content)?;
                        db::upsert_recap(&db_path, &session_id_inner, &recap)?;
                        Ok(())
                    })
                    .await;

                let (final_status, operation_error) = match process_result {
                    Ok(Ok(())) => (SessionStatus::RecapDone, None),
                    Ok(Err(err)) => {
                        println!("Recap generation background error: {err}");
                        (SessionStatus::Done, Some(err))
                    }
                    Err(err) => {
                        println!("Background task panicked: {err}");
                        (
                            SessionStatus::Done,
                            Some(format!("Background task panicked: {err}")),
                        )
                    }
                };

                // Lock AppState to save final status
                {
                    use tauri::Manager;
                    if let Some(state) = app_clone.try_state::<std::sync::Mutex<AppState>>() {
                        if let Ok(mut app_state) = state.lock() {
                            if let Some(pos) = app_state
                                .sessions
                                .iter()
                                .position(|s| s.id == session_id_clone)
                            {
                                app_state.sessions[pos].status = final_status;
                                let _ = db::upsert_session(
                                    &app_state.paths.db_path,
                                    &app_state.sessions[pos],
                                );
                            }
                        }
                    }
                }

                // Emit event
                use tauri::Emitter;
                let _ = app_clone.emit("state-changed", ());
                if let Some(message) = operation_error {
                    Self::emit_operation_error(&app_clone, message);
                }
            });
        } else {
            // Tests/Synchronous Path
            let api_key = settings::load_openai_api_key()?
                .ok_or_else(|| "no OpenAI API key found in macOS Keychain".to_string())?;
            let segments = db::load_segments(&db_path, &session_id)?;
            let recap =
                openai::summarize_transcript(&api_key, &settings, &session_title, &segments)?;

            paths.write_string(&recap_path, &recap.content)?;
            db::upsert_recap(&db_path, &session_id, &recap)?;

            let pos = self
                .sessions
                .iter()
                .position(|s| s.id == session_id)
                .unwrap();
            self.sessions[pos].status = SessionStatus::RecapDone;
            db::upsert_session(&db_path, &self.sessions[pos])?;
        }

        Ok(())
    }

    pub fn session_detail_snapshot(
        &self,
        session_id: &str,
    ) -> Result<SessionDetailSnapshot, String> {
        let session = self
            .sessions
            .iter()
            .find(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;

        let mut segments = if self
            .live_transcription
            .as_ref()
            .is_some_and(|live| live.session_id == session_id)
        {
            self.live_transcription
                .as_ref()
                .map(|live| live.segments.clone())
                .unwrap_or_default()
        } else {
            db::load_segments(&self.paths.db_path, session_id)?
        };

        if segments.is_empty() {
            if let Ok(contents) = std::fs::read_to_string(&session.transcript_path) {
                if let Ok(document) = serde_json::from_str::<TranscriptDocument>(&contents) {
                    segments = document.segments;
                } else if let Ok(payload) = serde_json::from_str::<TranscriptFilePayload>(&contents)
                {
                    segments = payload.segments;
                }
            }
        }

        let recap_markdown = db::load_recap(&self.paths.db_path, session_id)
            .ok()
            .flatten()
            .map(|recap| recap.content)
            .filter(|content| !content.trim().is_empty())
            .or_else(|| {
                std::fs::read_to_string(&session.recap_path)
                    .ok()
                    .filter(|content| !content.trim().is_empty())
            });

        Ok(SessionDetailSnapshot {
            segments,
            recap_markdown,
        })
    }

    pub fn export_session_markdown(&self, session_id: &str) -> Result<String, String> {
        let session = self
            .sessions
            .iter()
            .find(|session| session.id == session_id)
            .ok_or_else(|| "session not found".to_string())?;
        let segments = db::load_segments(&self.paths.db_path, session_id)?;
        let recap = db::load_recap(&self.paths.db_path, session_id)?;

        let mut markdown = format!("# {}\n\n", session.title);
        markdown.push_str("## Transcript\n\n");
        for segment in segments {
            markdown.push_str(&format!(
                "- [{} - {}] **{}**: {}\n",
                segment.start_time_ms, segment.end_time_ms, segment.speaker_label, segment.text
            ));
        }

        if let Some(recap) = recap {
            markdown.push_str("\n## Recap\n\n");
            markdown.push_str(&recap.content);
            markdown.push('\n');
        }

        let export_path = self.paths.exports_dir.join(format!("{session_id}.md"));
        self.paths.write_string(&export_path, &markdown)?;
        Ok(export_path.display().to_string())
    }

    fn selected_model_spec(&self) -> &'static model_download::WhisperModelSpec {
        model_download::find_model(&self.settings.whisper_model)
            .unwrap_or_else(model_download::default_model)
    }

    fn model_path_for_spec(
        &self,
        model: &model_download::WhisperModelSpec,
    ) -> std::path::PathBuf {
        self.paths.models_dir.join(model.file_name)
    }

    fn default_model_path(&self) -> std::path::PathBuf {
        self.model_path_for_spec(self.selected_model_spec())
    }

    #[cfg(test)]
    fn for_test() -> Self {
        static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

        let test_root = env::temp_dir().join(format!(
            "meeting-transcriber-test-{}-{}-{}",
            now_unix_ms(),
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let paths = AppPaths::new(test_root);
        let mut state = Self::from_paths(paths).expect("test state should bootstrap");
        state.native_capture_enabled = false;
        state.transcription_enabled = false;
        state
    }
}

#[cfg(test)]
mod tests {
    use super::{AppState, CreateSessionInput, FinalizeSessionInput};
    use crate::state::{
        capture::{CaptureDeviceState, CaptureSourceKind},
        session::{RemoteSpeakerLabelState, SessionStatus},
    };

    #[test]
    fn refine_is_disabled_without_raw_audio() {
        let mut state = AppState::for_test();
        state
            .create_session(
                CreateSessionInput {
                    title: Some("No Raw Audio".to_string()),
                    save_raw_audio: false,
                    refine_requested: true,
                },
                None,
            )
            .expect("session should be created");

        let session = state.sessions.first().expect("session should exist");
        assert!(!session.refine_enabled);
        assert!(std::path::Path::new(&session.transcript_path).exists());
    }

    #[test]
    fn finalize_applies_post_meeting_speaker_labels() {
        let mut state = AppState::for_test();
        state
            .create_session(
                CreateSessionInput {
                    title: Some("Finalize".to_string()),
                    save_raw_audio: true,
                    refine_requested: false,
                },
                None,
            )
            .expect("session should be created");

        let session_id = state
            .active_session_id
            .clone()
            .expect("active session should exist");

        state
            .start_finalize_session(
                FinalizeSessionInput {
                    session_id,
                    run_refine: false,
                    generate_recap: false,
                },
                None,
            )
            .expect("finalization should succeed");

        let session = state.sessions.first().expect("session should exist");
        assert_eq!(session.status, SessionStatus::Done);
        assert_eq!(
            session.remote_speaker_label_state,
            RemoteSpeakerLabelState::FinalLabelsApplied
        );
    }

    #[test]
    fn delete_session_removes_files_and_history() {
        let mut state = AppState::for_test();
        state
            .create_session(
                CreateSessionInput {
                    title: Some("Delete".to_string()),
                    save_raw_audio: true,
                    refine_requested: false,
                },
                None,
            )
            .expect("session should be created");

        let session = state
            .sessions
            .first()
            .cloned()
            .expect("session should exist");
        state
            .delete_session(&session.id)
            .expect("session should delete cleanly");

        assert!(state.sessions.is_empty());
        assert!(!std::path::Path::new(&session.session_dir).exists());
    }

    #[test]
    fn finalize_without_raw_audio_deletes_transient_wavs() {
        let mut state = AppState::for_test();
        state
            .create_session(
                CreateSessionInput {
                    title: Some("Cleanup".to_string()),
                    save_raw_audio: false,
                    refine_requested: false,
                },
                None,
            )
            .expect("session should be created");

        let session = state
            .sessions
            .first()
            .cloned()
            .expect("session should exist");
        std::fs::write(&session.mic_audio_path, b"stub").expect("mic wav should be created");
        std::fs::write(&session.system_audio_path, b"stub").expect("system wav should be created");

        state
            .start_finalize_session(
                FinalizeSessionInput {
                    session_id: session.id.clone(),
                    run_refine: false,
                    generate_recap: false,
                },
                None,
            )
            .expect("finalization should succeed");

        assert!(!std::path::Path::new(&session.mic_audio_path).exists());
        assert!(!std::path::Path::new(&session.system_audio_path).exists());
    }

    #[test]
    fn device_loss_requires_active_session() {
        let mut state = AppState::for_test();
        let error = state
            .simulate_device_loss(CaptureSourceKind::SystemAudio)
            .expect_err("device loss should fail without active session");
        assert!(error.contains("active"));
    }

    #[test]
    fn permission_request_unblocks_macos_system_audio() {
        let mut state = AppState::for_test();
        state
            .request_system_audio_permission()
            .expect("permission request should succeed");

        let system_audio = state
            .capture
            .sources
            .iter()
            .find(|source| source.kind == CaptureSourceKind::SystemAudio)
            .expect("system audio source should exist");

        if cfg!(target_os = "macos") {
            assert_eq!(system_audio.device_state, CaptureDeviceState::Ready);
        }
    }
}
