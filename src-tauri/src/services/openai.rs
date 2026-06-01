use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

use crate::{
    state::transcript::{SessionRecap, TranscriptSegment},
    storage::settings::AppSettings,
};

#[derive(Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatCompletionsResponse {
    choices: Vec<ChatChoice>,
}

pub fn summarize_transcript(
    api_key: &str,
    settings: &AppSettings,
    session_title: &str,
    segments: &[TranscriptSegment],
) -> Result<SessionRecap, String> {
    let prompt = build_prompt(session_title, segments);
    let request_body = ChatCompletionsRequest {
        model: settings.openai_model.clone(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }],
    };

    let client = Client::new();
    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&request_body)
        .send()
        .map_err(|error| format!("failed to call OpenAI Chat Completions API: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "OpenAI Chat Completions API returned non-success status {}",
            response.status()
        ));
    }

    let response_body = response
        .json::<ChatCompletionsResponse>()
        .map_err(|error| format!("failed to parse OpenAI recap response: {error}"))?;

    let content = response_body
        .choices
        .first()
        .map(|choice| choice.message.content.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OpenAI recap response was empty".to_string())?;

    Ok(SessionRecap {
        provider: "openai".to_string(),
        model_used: settings.openai_model.clone(),
        content,
        created_at_unix_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or_default(),
    })
}

fn build_prompt(session_title: &str, segments: &[TranscriptSegment]) -> String {
    let transcript = segments
        .iter()
        .map(|segment| {
            format!(
                "[{}-{}] {}: {}",
                segment.start_time_ms, segment.end_time_ms, segment.speaker_label, segment.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are a meeting summarizer.\n\
         Summarize the following meeting transcript in Vietnamese.\n\
         Title: {session_title}\n\
         Requirements:\n\
         1. Tóm tắt tổng quan\n\
         2. Các điểm chính\n\
         3. Quyết định đã chốt\n\
         4. Việc cần làm và người phụ trách theo speaker label\n\
         5. Rủi ro / follow-up\n\n\
         Transcript:\n{transcript}"
    )
}
