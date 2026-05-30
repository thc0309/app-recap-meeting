from __future__ import annotations

from fastapi import APIRouter, HTTPException, WebSocket

from ...schemas import (
    LiveSessionStartRequest,
    LiveSessionStartResponse,
    LiveSessionStateResponse,
    MeetingResponse,
)
from ...services.meetings import get_meeting
from ...services.realtime import CHUNK_CHANNELS, CHUNK_SAMPLE_RATE, manager


router = APIRouter(prefix="/api/live-sessions", tags=["live-sessions"])


def _serialize_meeting(row) -> MeetingResponse:
    from datetime import datetime

    return MeetingResponse(
        id=row["id"],
        title=row["title"],
        source_path=row["source_path"],
        status=row["status"],
        transcript_path=row["transcript_path"],
        transcript_text_path=row["transcript_text_path"],
        recap_json_path=row["recap_json_path"],
        recap_markdown_path=row["recap_markdown_path"],
        model_name=row["model_name"],
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
    )


@router.post("/start", response_model=LiveSessionStartResponse)
def start_live_session(payload: LiveSessionStartRequest):
    session = manager.create_session(payload.title, payload.model_name)
    meeting = get_meeting(session.meeting_id)
    if not meeting:
        raise HTTPException(status_code=500, detail="Meeting was not created")
    return LiveSessionStartResponse(
        meeting=_serialize_meeting(meeting),
        websocket_url=f"ws://127.0.0.1:8000/ws/live/{session.meeting_id}",
        chunk_sample_rate=CHUNK_SAMPLE_RATE,
        chunk_channels=CHUNK_CHANNELS,
    )


@router.get("", response_model=list[LiveSessionStateResponse])
def list_live_sessions():
    return manager.list_states()


@router.get("/{meeting_id}", response_model=LiveSessionStateResponse)
def get_live_session(meeting_id: str):
    state = manager.get_state(meeting_id)
    if not state:
        raise HTTPException(status_code=404, detail="Live session not found")
    return state


async def live_session_socket(websocket: WebSocket, meeting_id: str):
    try:
        await manager.attach_websocket(meeting_id, websocket)
    except ValueError as exc:
        await websocket.accept()
        await websocket.send_json({"type": "error", "detail": str(exc)})
        await websocket.close()
        return
    await manager.process_websocket(meeting_id)
