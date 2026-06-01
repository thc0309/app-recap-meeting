use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub source_type: String,
    pub speaker_label: String,
    pub start_time_ms: i64,
    pub end_time_ms: i64,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDocument {
    pub session_id: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecap {
    pub provider: String,
    pub model_used: String,
    pub content: String,
    pub created_at_unix_ms: i64,
}
