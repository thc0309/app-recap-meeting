from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


MeetingStatus = Literal[
    "draft",
    "recording",
    "finalizing",
    "transcribing",
    "transcribed",
    "generating_recap",
    "recap_ready",
    "failed",
]


class MeetingCreateRequest(BaseModel):
    title: str = Field(min_length=1)
    source_path: str | None = None
    model_name: str | None = None


class MeetingUpdateRequest(BaseModel):
    title: str | None = None
    source_path: str | None = None


class TranscriptSegment(BaseModel):
    start_sec: float
    end_sec: float
    speaker_label: str | None = None
    text: str


class MeetingResponse(BaseModel):
    id: str
    title: str
    source_path: str | None
    status: MeetingStatus
    transcript_path: str | None = None
    transcript_text_path: str | None = None
    recap_json_path: str | None = None
    recap_markdown_path: str | None = None
    model_name: str | None = None
    created_at: datetime
    updated_at: datetime


class ActionItem(BaseModel):
    owner: str | None = None
    task: str
    deadline: str | None = None


class RecapPayload(BaseModel):
    summary: str
    key_points: list[str]
    decisions: list[str]
    action_items: list[ActionItem]
    open_questions: list[str]


class RecapResponse(BaseModel):
    meeting_id: str
    recap: RecapPayload
    created_at: datetime


class JobRunResponse(BaseModel):
    meeting_id: str
    status: str
    detail: str


class LiveSessionStartRequest(BaseModel):
    title: str = Field(min_length=1)
    model_name: str | None = None


class LiveSessionStartResponse(BaseModel):
    meeting: MeetingResponse
    websocket_url: str
    chunk_sample_rate: int
    chunk_channels: int


class LiveSessionStateResponse(BaseModel):
    meeting_id: str
    title: str
    status: str
    seconds_recorded: float
    chunk_count: int
    has_microphone: bool = False
    has_system_audio: bool = False
    transcript_ready: bool = False
    recap_ready: bool = False
    partial_transcript: str | None = None
    partial_updated_at: datetime | None = None
    last_error: str | None = None
