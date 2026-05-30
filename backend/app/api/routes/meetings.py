from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ...schemas import (
    JobRunResponse,
    MeetingCreateRequest,
    MeetingResponse,
    MeetingUpdateRequest,
    RecapResponse,
    TranscriptSegment,
)
from ...services import meetings as meeting_service
from ...services.recap import generate_recap, read_saved_recap
from ...services.transcription import run_transcription


router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _serialize_meeting(row) -> MeetingResponse:
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


@router.get("", response_model=list[MeetingResponse])
def list_meetings():
    return [_serialize_meeting(row) for row in meeting_service.list_meetings()]


@router.delete("")
def delete_all_meetings():
    deleted_count = meeting_service.delete_all_meetings()
    try:
        from ...services.realtime import manager

        manager.clear_sessions()
    except Exception:
        pass
    return {"status": "deleted_all", "deleted_count": deleted_count}


@router.post("", response_model=MeetingResponse)
def create_meeting(payload: MeetingCreateRequest):
    row = meeting_service.create_meeting(payload)
    return _serialize_meeting(row)


@router.post("/import", response_model=MeetingResponse)
async def import_meeting(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    model_name: str | None = Form(default=None),
):
    filename = file.filename or "uploaded-source"
    resolved_title = (title or "").strip() or Path(filename).stem
    try:
        row = meeting_service.create_meeting(
            MeetingCreateRequest(title=resolved_title, source_path=None, model_name=model_name)
        )
        content = await file.read()
        if not content:
            raise ValueError("Uploaded file is empty")
        meeting_service.store_uploaded_source(row["id"], filename, content)
        updated = meeting_service.get_meeting(row["id"])
        if not updated:
            raise ValueError("Meeting not found after upload")
        return _serialize_meeting(updated)
    except Exception as exc:  # noqa: BLE001
        if "row" in locals():
            meeting_service.delete_meeting(row["id"])
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        await file.close()


@router.get("/{meeting_id}", response_model=MeetingResponse)
def get_meeting(meeting_id: str):
    row = meeting_service.get_meeting(meeting_id)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _serialize_meeting(row)


@router.delete("/{meeting_id}")
def delete_meeting(meeting_id: str):
    row = meeting_service.get_meeting(meeting_id)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    deleted = meeting_service.delete_meeting(meeting_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Delete failed")
    try:
        from ...services.realtime import manager

        manager.remove_session(meeting_id)
    except Exception:
        pass
    return {"status": "deleted", "meeting_id": meeting_id}


@router.patch("/{meeting_id}", response_model=MeetingResponse)
def update_meeting(meeting_id: str, payload: MeetingUpdateRequest):
    row = meeting_service.update_meeting(meeting_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _serialize_meeting(row)


@router.get("/{meeting_id}/segments", response_model=list[TranscriptSegment])
def list_segments(meeting_id: str):
    if not meeting_service.get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    return [
        TranscriptSegment(
            start_sec=row["start_sec"],
            end_sec=row["end_sec"],
            speaker_label=row["speaker_label"],
            text=row["text"],
        )
        for row in meeting_service.list_segments(meeting_id)
    ]


@router.post("/{meeting_id}/transcribe", response_model=JobRunResponse)
def transcribe_meeting(meeting_id: str):
    if not meeting_service.get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    try:
        result = run_transcription(meeting_id, use_speakers=False)
    except Exception as exc:  # noqa: BLE001
        meeting_service.set_meeting_status(meeting_id, "failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JobRunResponse(
        meeting_id=meeting_id,
        status="transcribed",
        detail=f"Transcript saved to {result.output_dir}",
    )


@router.post("/{meeting_id}/transcribe-with-speakers", response_model=JobRunResponse)
def transcribe_meeting_with_speakers(meeting_id: str):
    if not meeting_service.get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    try:
        result = run_transcription(meeting_id, use_speakers=True)
    except Exception as exc:  # noqa: BLE001
        meeting_service.set_meeting_status(meeting_id, "failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JobRunResponse(
        meeting_id=meeting_id,
        status="transcribed",
        detail=f"Transcript with speakers saved to {result.output_dir}",
    )


@router.post("/{meeting_id}/recap", response_model=RecapResponse)
def create_recap(meeting_id: str):
    if not meeting_service.get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    try:
        return generate_recap(meeting_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{meeting_id}/recap", response_model=RecapResponse)
def get_recap(meeting_id: str):
    if not meeting_service.get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    recap = read_saved_recap(meeting_id)
    if not recap:
        raise HTTPException(status_code=404, detail="Recap not found")
    return recap
