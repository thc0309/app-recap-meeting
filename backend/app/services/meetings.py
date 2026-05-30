from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
import shutil
import sqlite3
import uuid

from ..config import settings
from ..database import get_connection
from ..schemas import MeetingCreateRequest, MeetingUpdateRequest


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def create_meeting(payload: MeetingCreateRequest) -> sqlite3.Row:
    meeting_id = str(uuid.uuid4())
    now = _now_iso()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO meetings (
              id, title, source_path, status, transcript_path, transcript_text_path,
              recap_json_path, recap_markdown_path, model_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
            """,
            (
                meeting_id,
                payload.title,
                payload.source_path,
                "draft",
                payload.model_name,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
    return row


def store_uploaded_source(meeting_id: str, filename: str, content: bytes) -> Path:
    safe_name = Path(filename or "uploaded-source").name
    upload_dir = settings.upload_root / meeting_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    destination = upload_dir / safe_name
    destination.write_bytes(content)
    update_meeting_source(meeting_id, str(destination))
    return destination


def list_meetings() -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM meetings ORDER BY datetime(created_at) DESC"
        ).fetchall()


def get_meeting(meeting_id: str) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()


def update_meeting(meeting_id: str, payload: MeetingUpdateRequest) -> sqlite3.Row | None:
    existing = get_meeting(meeting_id)
    if not existing:
        return None

    title = payload.title if payload.title is not None else existing["title"]
    source_path = payload.source_path if payload.source_path is not None else existing["source_path"]
    now = _now_iso()
    with get_connection() as conn:
        conn.execute(
            "UPDATE meetings SET title = ?, source_path = ?, updated_at = ? WHERE id = ?",
            (title, source_path, now, meeting_id),
        )
        return conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()


def update_meeting_source(meeting_id: str, source_path: str) -> None:
    now = _now_iso()
    with get_connection() as conn:
        conn.execute(
            "UPDATE meetings SET source_path = ?, updated_at = ? WHERE id = ?",
            (source_path, now, meeting_id),
        )


def set_meeting_status(
    meeting_id: str,
    status: str,
    *,
    transcript_path: str | None = None,
    transcript_text_path: str | None = None,
    recap_json_path: str | None = None,
    recap_markdown_path: str | None = None,
) -> None:
    now = _now_iso()
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE meetings
            SET status = ?,
                transcript_path = COALESCE(?, transcript_path),
                transcript_text_path = COALESCE(?, transcript_text_path),
                recap_json_path = COALESCE(?, recap_json_path),
                recap_markdown_path = COALESCE(?, recap_markdown_path),
                updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                transcript_path,
                transcript_text_path,
                recap_json_path,
                recap_markdown_path,
                now,
                meeting_id,
            ),
        )


def replace_segments(meeting_id: str, segments: list[dict[str, float | str]]) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
        conn.executemany(
            """
            INSERT INTO transcript_segments (meeting_id, start_sec, end_sec, speaker_label, text)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    meeting_id,
                    float(segment["start_sec"]),
                    float(segment["end_sec"]),
                    segment.get("speaker_label"),
                    str(segment["text"]),
                )
                for segment in segments
            ],
        )


def list_segments(meeting_id: str) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT start_sec, end_sec, speaker_label, text
            FROM transcript_segments
            WHERE meeting_id = ?
            ORDER BY start_sec ASC
            """,
            (meeting_id,),
        ).fetchall()


def save_recap(
    meeting_id: str,
    *,
    recap_id: str,
    summary: str,
    key_points_json: str,
    decisions_json: str,
    action_items_json: str,
    open_questions_json: str,
) -> None:
    now = _now_iso()
    with get_connection() as conn:
        conn.execute("DELETE FROM recaps WHERE meeting_id = ?", (meeting_id,))
        conn.execute(
            """
            INSERT INTO recaps (
              id, meeting_id, summary, key_points_json, decisions_json,
              action_items_json, open_questions_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                recap_id,
                meeting_id,
                summary,
                key_points_json,
                decisions_json,
                action_items_json,
                open_questions_json,
                now,
            ),
        )


def get_recap(meeting_id: str) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute("SELECT * FROM recaps WHERE meeting_id = ?", (meeting_id,)).fetchone()


def delete_meeting(meeting_id: str) -> bool:
    existing = get_meeting(meeting_id)
    if not existing:
        return False

    with get_connection() as conn:
        conn.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
        conn.execute("DELETE FROM recaps WHERE meeting_id = ?", (meeting_id,))
        conn.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))

    output_dir = settings.output_root / meeting_id
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)

    upload_dir = settings.upload_root / meeting_id
    if upload_dir.exists():
        shutil.rmtree(upload_dir, ignore_errors=True)

    for candidate in (
        existing["transcript_path"],
        existing["transcript_text_path"],
        existing["recap_json_path"],
        existing["recap_markdown_path"],
    ):
        if candidate:
            path = Path(candidate)
            if path.exists() and path.is_file():
                path.unlink(missing_ok=True)

    return True


def delete_all_meetings() -> int:
    meetings = list_meetings()
    deleted_count = 0
    for meeting in meetings:
        if delete_meeting(meeting["id"]):
            deleted_count += 1
    return deleted_count
