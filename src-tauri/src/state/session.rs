use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Recording,
    Recovered,
    Processing,
    Done,
    RecapDone,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptMode {
    StaticSourceLabel,
    FinalSpeakerLabels,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteSpeakerLabelState {
    SourceOnly,
    PostMeetingPending,
    FinalLabelsApplied,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSession {
    pub id: String,
    pub title: String,
    pub status: SessionStatus,
    pub transcript_mode: TranscriptMode,
    pub remote_speaker_label_state: RemoteSpeakerLabelState,
    pub save_raw_audio: bool,
    pub refine_enabled: bool,
    pub started_at_unix_ms: u128,
    pub ended_at_unix_ms: Option<u128>,
    pub session_dir: String,
    pub mic_audio_path: String,
    pub system_audio_path: String,
    pub transcript_path: String,
    pub recap_path: String,
}

impl MeetingSession {
    pub fn new(
        id: String,
        title: String,
        save_raw_audio: bool,
        refine_requested: bool,
        session_dir: String,
        mic_audio_path: String,
        system_audio_path: String,
        transcript_path: String,
        recap_path: String,
    ) -> Self {
        Self {
            id,
            title,
            status: SessionStatus::Recording,
            transcript_mode: TranscriptMode::StaticSourceLabel,
            remote_speaker_label_state: RemoteSpeakerLabelState::SourceOnly,
            save_raw_audio,
            refine_enabled: save_raw_audio && refine_requested,
            started_at_unix_ms: now_unix_ms(),
            ended_at_unix_ms: None,
            session_dir,
            mic_audio_path,
            system_audio_path,
            transcript_path,
            recap_path,
        }
    }
}

pub fn now_unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
