use std::path::Path;

use rusqlite::{params, Connection};

use crate::state::{
    session::{MeetingSession, RemoteSpeakerLabelState, SessionStatus, TranscriptMode},
    transcript::{SessionRecap, TranscriptSegment},
};

pub fn initialize(db_path: &Path) -> Result<(), String> {
    let connection = open(db_path)?;

    // Check for legacy schema and drop old tables to trigger clean recreation
    let has_old_schema = match connection.prepare("SELECT start_time FROM segments LIMIT 1") {
        Ok(_) => true,
        Err(_) => false,
    };
    if has_old_schema {
        connection
            .execute_batch(
                r#"
                DROP TABLE IF EXISTS segments;
                DROP TABLE IF EXISTS recaps;
                "#,
            )
            .map_err(|error| format!("failed to clear legacy schema tables: {error}"))?;
    }

    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              status TEXT NOT NULL,
              transcript_mode TEXT NOT NULL,
              remote_speaker_label_state TEXT NOT NULL,
              save_raw_audio INTEGER NOT NULL,
              refine_enabled INTEGER NOT NULL,
              started_at_unix_ms INTEGER NOT NULL,
              ended_at_unix_ms INTEGER,
              session_dir TEXT NOT NULL,
              mic_audio_path TEXT NOT NULL,
              system_audio_path TEXT NOT NULL,
              transcript_path TEXT NOT NULL,
              recap_path TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS segments (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              source_type TEXT NOT NULL,
              speaker_label TEXT NOT NULL,
              start_time_ms INTEGER NOT NULL,
              end_time_ms INTEGER NOT NULL,
              text TEXT NOT NULL,
              created_at_unix_ms INTEGER NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS recaps (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              model_used TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at_unix_ms INTEGER NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
            CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id, start_time_ms);
            CREATE INDEX IF NOT EXISTS idx_recaps_session ON recaps(session_id, created_at_unix_ms);
            "#,
        )
        .map_err(|error| format!("failed to initialize database schema: {error}"))?;

    Ok(())
}

pub fn load_sessions(db_path: &Path) -> Result<Vec<MeetingSession>, String> {
    let connection = open(db_path)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
              id,
              title,
              status,
              transcript_mode,
              remote_speaker_label_state,
              save_raw_audio,
              refine_enabled,
              started_at_unix_ms,
              ended_at_unix_ms,
              session_dir,
              mic_audio_path,
              system_audio_path,
              transcript_path,
              recap_path
            FROM sessions
            ORDER BY started_at_unix_ms DESC
            "#,
        )
        .map_err(|error| format!("failed to prepare load_sessions query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(MeetingSession {
                id: row.get(0)?,
                title: row.get(1)?,
                status: decode_status(row.get::<_, String>(2)?),
                transcript_mode: decode_transcript_mode(row.get::<_, String>(3)?),
                remote_speaker_label_state: decode_remote_state(row.get::<_, String>(4)?),
                save_raw_audio: row.get::<_, i64>(5)? != 0,
                refine_enabled: row.get::<_, i64>(6)? != 0,
                started_at_unix_ms: row.get::<_, i64>(7)? as u128,
                ended_at_unix_ms: row.get::<_, Option<i64>>(8)?.map(|value| value as u128),
                session_dir: row.get(9)?,
                mic_audio_path: row.get(10)?,
                system_audio_path: row.get(11)?,
                transcript_path: row.get(12)?,
                recap_path: row.get(13)?,
            })
        })
        .map_err(|error| format!("failed to query sessions: {error}"))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|error| format!("failed to decode session row: {error}"))?);
    }

    Ok(sessions)
}

pub fn upsert_session(db_path: &Path, session: &MeetingSession) -> Result<(), String> {
    let connection = open(db_path)?;
    connection
        .execute(
            r#"
            INSERT INTO sessions (
              id, title, status, transcript_mode, remote_speaker_label_state,
              save_raw_audio, refine_enabled, started_at_unix_ms, ended_at_unix_ms,
              session_dir, mic_audio_path, system_audio_path, transcript_path, recap_path
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              status = excluded.status,
              transcript_mode = excluded.transcript_mode,
              remote_speaker_label_state = excluded.remote_speaker_label_state,
              save_raw_audio = excluded.save_raw_audio,
              refine_enabled = excluded.refine_enabled,
              started_at_unix_ms = excluded.started_at_unix_ms,
              ended_at_unix_ms = excluded.ended_at_unix_ms,
              session_dir = excluded.session_dir,
              mic_audio_path = excluded.mic_audio_path,
              system_audio_path = excluded.system_audio_path,
              transcript_path = excluded.transcript_path,
              recap_path = excluded.recap_path
            "#,
            params![
                session.id,
                session.title,
                encode_status(&session.status),
                encode_transcript_mode(&session.transcript_mode),
                encode_remote_state(&session.remote_speaker_label_state),
                session.save_raw_audio as i64,
                session.refine_enabled as i64,
                session.started_at_unix_ms as i64,
                session.ended_at_unix_ms.map(|value| value as i64),
                session.session_dir,
                session.mic_audio_path,
                session.system_audio_path,
                session.transcript_path,
                session.recap_path,
            ],
        )
        .map_err(|error| format!("failed to upsert session {}: {error}", session.id))?;
    Ok(())
}

pub fn delete_session(db_path: &Path, session_id: &str) -> Result<(), String> {
    let connection = open(db_path)?;
    connection
        .execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
        .map_err(|error| format!("failed to delete session row {session_id}: {error}"))?;
    Ok(())
}

pub fn clear_history(db_path: &Path) -> Result<(), String> {
    let connection = open(db_path)?;
    connection
        .execute_batch(
            r#"
            DELETE FROM segments;
            DELETE FROM recaps;
            DELETE FROM sessions;
            "#,
        )
        .map_err(|error| format!("failed to clear history: {error}"))?;
    Ok(())
}

pub fn replace_segments(
    db_path: &Path,
    session_id: &str,
    segments: &[TranscriptSegment],
) -> Result<(), String> {
    let mut connection = open(db_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to open segment transaction: {error}"))?;

    transaction
        .execute(
            "DELETE FROM segments WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|error| format!("failed to clear existing segments: {error}"))?;

    for segment in segments {
        transaction
            .execute(
                r#"
                INSERT INTO segments (
                  id, session_id, source_type, speaker_label, start_time_ms, end_time_ms, text, created_at_unix_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    segment.id,
                    session_id,
                    segment.source_type,
                    segment.speaker_label,
                    segment.start_time_ms,
                    segment.end_time_ms,
                    segment.text,
                    0_i64,
                ],
            )
            .map_err(|error| format!("failed to insert segment {}: {error}", segment.id))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("failed to commit segments transaction: {error}"))
}

pub fn load_segments(db_path: &Path, session_id: &str) -> Result<Vec<TranscriptSegment>, String> {
    let connection = open(db_path)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, source_type, speaker_label, start_time_ms, end_time_ms, text
            FROM segments
            WHERE session_id = ?1
            ORDER BY start_time_ms ASC
            "#,
        )
        .map_err(|error| format!("failed to prepare load_segments query: {error}"))?;

    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(TranscriptSegment {
                id: row.get(0)?,
                source_type: row.get(1)?,
                speaker_label: row.get(2)?,
                start_time_ms: row.get::<_, i64>(3)?,
                end_time_ms: row.get::<_, i64>(4)?,
                text: row.get(5)?,
            })
        })
        .map_err(|error| format!("failed to query segments: {error}"))?;

    let mut segments = Vec::new();
    for row in rows {
        segments.push(row.map_err(|error| format!("failed to decode segment row: {error}"))?);
    }

    Ok(segments)
}

pub fn upsert_recap(db_path: &Path, session_id: &str, recap: &SessionRecap) -> Result<(), String> {
    let connection = open(db_path)?;
    connection
        .execute(
            r#"
            INSERT INTO recaps (id, session_id, provider, model_used, content, created_at_unix_ms)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
              provider = excluded.provider,
              model_used = excluded.model_used,
              content = excluded.content,
              created_at_unix_ms = excluded.created_at_unix_ms
            "#,
            params![
                format!("recap-{session_id}"),
                session_id,
                recap.provider,
                recap.model_used,
                recap.content,
                recap.created_at_unix_ms,
            ],
        )
        .map_err(|error| format!("failed to upsert recap for {session_id}: {error}"))?;
    Ok(())
}

pub fn load_recap(db_path: &Path, session_id: &str) -> Result<Option<SessionRecap>, String> {
    let connection = open(db_path)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT provider, model_used, content, created_at_unix_ms
            FROM recaps
            WHERE session_id = ?1
            ORDER BY created_at_unix_ms DESC
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("failed to prepare load_recap query: {error}"))?;

    let mut rows = statement
        .query(params![session_id])
        .map_err(|error| format!("failed to query recap: {error}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|error| format!("failed to iterate recap rows: {error}"))?
    {
        Ok(Some(SessionRecap {
            provider: row
                .get(0)
                .map_err(|error| format!("failed to decode recap provider: {error}"))?,
            model_used: row
                .get(1)
                .map_err(|error| format!("failed to decode recap model: {error}"))?,
            content: row
                .get(2)
                .map_err(|error| format!("failed to decode recap content: {error}"))?,
            created_at_unix_ms: row
                .get(3)
                .map_err(|error| format!("failed to decode recap timestamp: {error}"))?,
        }))
    } else {
        Ok(None)
    }
}

fn open(db_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(db_path)
        .map_err(|error| format!("failed to open database {}: {error}", db_path.display()))?;
    connection
        .execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|error| format!("failed to enable foreign key support: {error}"))?;
    Ok(connection)
}

fn encode_status(status: &SessionStatus) -> &'static str {
    match status {
        SessionStatus::Recording => "recording",
        SessionStatus::Recovered => "recovered",
        SessionStatus::Processing => "processing",
        SessionStatus::Done => "done",
        SessionStatus::RecapDone => "recap_done",
        SessionStatus::Error => "error",
    }
}

fn decode_status(value: String) -> SessionStatus {
    match value.as_str() {
        "recording" => SessionStatus::Recording,
        "recovered" => SessionStatus::Recovered,
        "processing" => SessionStatus::Processing,
        "done" => SessionStatus::Done,
        "recap_done" => SessionStatus::RecapDone,
        _ => SessionStatus::Error,
    }
}

fn encode_transcript_mode(mode: &TranscriptMode) -> &'static str {
    match mode {
        TranscriptMode::StaticSourceLabel => "static_source_label",
        TranscriptMode::FinalSpeakerLabels => "final_speaker_labels",
    }
}

fn decode_transcript_mode(value: String) -> TranscriptMode {
    match value.as_str() {
        "final_speaker_labels" => TranscriptMode::FinalSpeakerLabels,
        _ => TranscriptMode::StaticSourceLabel,
    }
}

fn encode_remote_state(state: &RemoteSpeakerLabelState) -> &'static str {
    match state {
        RemoteSpeakerLabelState::SourceOnly => "source_only",
        RemoteSpeakerLabelState::PostMeetingPending => "post_meeting_pending",
        RemoteSpeakerLabelState::FinalLabelsApplied => "final_labels_applied",
    }
}

fn decode_remote_state(value: String) -> RemoteSpeakerLabelState {
    match value.as_str() {
        "post_meeting_pending" => RemoteSpeakerLabelState::PostMeetingPending,
        "final_labels_applied" => RemoteSpeakerLabelState::FinalLabelsApplied,
        _ => RemoteSpeakerLabelState::SourceOnly,
    }
}
