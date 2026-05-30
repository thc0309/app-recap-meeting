from __future__ import annotations

import asyncio
import base64
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
import wave

from fastapi import WebSocket

from ..config import settings
from ..schemas import LiveSessionStateResponse, MeetingCreateRequest
from .meetings import create_meeting, get_meeting, set_meeting_status, update_meeting_source
from .recap import generate_recap
from .transcription import run_transcription


CHUNK_SAMPLE_RATE = 16000
CHUNK_CHANNELS = 1
BYTES_PER_SECOND = CHUNK_SAMPLE_RATE * CHUNK_CHANNELS * 2
PARTIAL_INTERVAL_SECONDS = 3
PARTIAL_TAIL_SECONDS = 18


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def is_sparse_segment(start: float, end: float, text: str) -> bool:
    words = [word for word in text.split() if word.strip()]
    if not words:
        return True

    duration = max(0.0, end - start)
    seconds_per_word = duration / max(1, len(words))
    return duration >= 12 and len(words) <= 18 and seconds_per_word > 1.3


def has_repeating_pattern(text: str) -> bool:
    compact = re.sub(r"\s+", "", text.lower())
    if len(compact) < 12:
        return False

    for unit_size in range(1, min(5, len(compact) // 2 + 1)):
        pattern = compact[:unit_size]
        repeats = len(compact) // unit_size
        repeated = pattern * repeats
        if len(repeated) < len(compact):
            repeated += pattern[: len(compact) - len(repeated)]
        matches = sum(1 for left, right in zip(compact, repeated) if left == right)
        if matches / len(compact) >= 0.8:
            return True
    return False


def is_low_variety_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", text.lower())
    if len(compact) < 12:
        return False
    return len(set(compact)) <= max(3, len(compact) // 10)


def looks_like_partial_garbage(text: str) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return True

    words = normalized.split()
    if len(words) >= 6:
        unique_words = len(set(words))
        if unique_words <= max(1, len(words) // 5):
            return True

    return has_repeating_pattern(normalized) or is_low_variety_text(normalized)


def state_payload(session: "LiveSession") -> dict:
    return session.to_state().model_dump(mode="json")


@dataclass
class LiveSession:
    meeting_id: str
    title: str
    model_name: str
    raw_pcm_path: Path
    wav_path: Path
    websocket: WebSocket | None = None
    chunk_count: int = 0
    bytes_written: int = 0
    has_microphone: bool = False
    has_system_audio: bool = False
    status: str = "recording"
    last_error: str | None = None
    processing_started: bool = False
    finalized: bool = False
    partial_transcript: str | None = None
    partial_updated_at: datetime | None = None
    partial_task: asyncio.Task | None = None
    last_partial_chunk_count: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def seconds_recorded(self) -> float:
        if BYTES_PER_SECOND == 0:
            return 0.0
        return self.bytes_written / BYTES_PER_SECOND

    def to_state(self) -> LiveSessionStateResponse:
        return LiveSessionStateResponse(
            meeting_id=self.meeting_id,
            title=self.title,
            status=self.status,
            seconds_recorded=round(self.seconds_recorded, 2),
            chunk_count=self.chunk_count,
            has_microphone=self.has_microphone,
            has_system_audio=self.has_system_audio,
            transcript_ready=self.status in {"transcribed", "recap_ready"},
            recap_ready=self.status == "recap_ready",
            partial_transcript=self.partial_transcript,
            partial_updated_at=self.partial_updated_at,
            last_error=self.last_error,
        )


class LiveSessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, LiveSession] = {}
        self._partial_model = None

    def create_session(self, title: str, model_name: str | None = None) -> LiveSession:
        meeting = create_meeting(
            MeetingCreateRequest(title=title, source_path=None, model_name=model_name or settings.default_model)
        )
        meeting_id = meeting["id"]
        output_dir = settings.output_root / meeting_id
        output_dir.mkdir(parents=True, exist_ok=True)
        raw_pcm_path = output_dir / "live-session.raw.pcm"
        wav_path = output_dir / "live-session.wav"
        raw_pcm_path.write_bytes(b"")
        session = LiveSession(
            meeting_id=meeting_id,
            title=title,
            model_name=meeting["model_name"] or settings.default_model,
            raw_pcm_path=raw_pcm_path,
            wav_path=wav_path,
        )
        self.sessions[meeting_id] = session
        set_meeting_status(meeting_id, "recording")
        return session

    def get_session(self, meeting_id: str) -> LiveSession | None:
        return self.sessions.get(meeting_id)

    async def attach_websocket(self, meeting_id: str, websocket: WebSocket) -> LiveSession:
        session = self.sessions.get(meeting_id)
        if not session:
            raise ValueError("Live session not found")
        session.websocket = websocket
        if session.partial_task is None:
            session.partial_task = asyncio.create_task(self._partial_transcript_loop(session))
        return session

    async def process_websocket(self, meeting_id: str) -> None:
        session = self.sessions.get(meeting_id)
        if not session or not session.websocket:
            raise ValueError("Live session websocket not attached")

        websocket = session.websocket
        await websocket.accept()
        await self._send(session, {"type": "session_ready", "meetingId": meeting_id})

        try:
            while True:
                payload = await websocket.receive_text()
                message = json.loads(payload)
                message_type = message.get("type")
                if message_type == "audio_chunk":
                    await self.append_chunk(
                        session,
                        base64_payload=message["payload"],
                        source=message.get("source", "mixed"),
                    )
                    await self._send(
                        session,
                        {
                            "type": "recording_progress",
                            "secondsRecorded": session.seconds_recorded,
                            "chunkCount": session.chunk_count,
                            "hasMicrophone": session.has_microphone,
                            "hasSystemAudio": session.has_system_audio,
                        }
                    )
                elif message_type == "stop":
                    await self._send(session, {"type": "processing_started"})
                    state = await self.finalize_and_process(
                        session,
                        progress_callback=lambda payload: self._send(session, payload),
                    )
                    await self._send(session, {"type": "processing_finished", "state": state.model_dump(mode="json")})
                    break
        except Exception as exc:  # noqa: BLE001
            session.status = "failed"
            session.last_error = str(exc)
            set_meeting_status(session.meeting_id, "failed")
            if session.websocket:
                await self._send(session, {"type": "error", "detail": str(exc)})
        finally:
            if session.partial_task:
                session.partial_task.cancel()
            await websocket.close()

    async def append_chunk(self, session: LiveSession, *, base64_payload: str, source: str) -> None:
        chunk_bytes = base64.b64decode(base64_payload)
        async with session.lock:
            with session.raw_pcm_path.open("ab") as handle:
                handle.write(chunk_bytes)
            session.chunk_count += 1
            session.bytes_written += len(chunk_bytes)
            if source == "microphone":
                session.has_microphone = True
            elif source == "system":
                session.has_system_audio = True
            else:
                session.has_microphone = True
                session.has_system_audio = True

    async def finalize_and_process(self, session: LiveSession, progress_callback=None) -> LiveSessionStateResponse:
        if session.processing_started:
            return session.to_state()

        if session.bytes_written == 0:
            raise ValueError("Chua nhan duoc audio nao. Hay kiem tra microphone va screen share audio.")

        session.processing_started = True
        session.status = "finalizing"
        if progress_callback:
            await progress_callback(
                {
                    "type": "processing_update",
                    "phase": "finalizing",
                    "message": "Dang dong file audio tu session realtime...",
                    "state": state_payload(session),
                }
            )

        self._write_wav(session.raw_pcm_path, session.wav_path)
        update_meeting_source(session.meeting_id, str(session.wav_path))

        session.status = "transcribing"
        set_meeting_status(session.meeting_id, "transcribing")
        if progress_callback:
            await progress_callback(
                {
                    "type": "processing_update",
                    "phase": "transcribing",
                    "message": "Dang chay transcript tu audio vua ghi...",
                    "state": state_payload(session),
                }
            )
        run_transcription(session.meeting_id, use_speakers=False)
        session.status = "transcribed"

        if progress_callback:
            await progress_callback(
                {
                    "type": "processing_update",
                    "phase": "recap",
                    "message": "Dang tao recap sau khi transcript xong...",
                    "state": state_payload(session),
                }
            )

        session.status = "generating_recap"
        generate_recap(session.meeting_id)
        session.status = "recap_ready"
        session.finalized = True
        return session.to_state()

    async def _partial_transcript_loop(self, session: LiveSession) -> None:
        try:
            while not session.processing_started:
                await asyncio.sleep(PARTIAL_INTERVAL_SECONDS)
                if session.processing_started or session.websocket is None:
                    continue
                if session.chunk_count == session.last_partial_chunk_count:
                    continue
                if session.seconds_recorded < PARTIAL_INTERVAL_SECONDS:
                    continue

                partial_text = await asyncio.to_thread(self._transcribe_partial_tail, session)
                session.last_partial_chunk_count = session.chunk_count
                if not partial_text:
                    continue
                if normalize_text(partial_text) == normalize_text(session.partial_transcript or ""):
                    continue

                session.partial_transcript = partial_text
                session.partial_updated_at = datetime.now(UTC)
                await self._send(
                    session,
                    {
                        "type": "partial_transcript",
                        "text": partial_text,
                        "secondsRecorded": session.seconds_recorded,
                        "state": state_payload(session),
                    },
                )
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            session.last_error = str(exc)
            if session.websocket:
                await self._send(session, {"type": "error", "detail": f"Partial transcript error: {exc}"})

    def _transcribe_partial_tail(self, session: LiveSession) -> str:
        from faster_whisper import WhisperModel

        tail_bytes = int(PARTIAL_TAIL_SECONDS * BYTES_PER_SECOND)
        raw_bytes = session.raw_pcm_path.read_bytes()
        if not raw_bytes:
            return ""
        recent_bytes = raw_bytes[-tail_bytes:]

        partial_wav_path = session.raw_pcm_path.parent / "live-session.partial.wav"
        self._write_wav_bytes(recent_bytes, partial_wav_path)

        if self._partial_model is None:
            self._partial_model = WhisperModel(settings.partial_model, device="cpu", compute_type="int8")

        requested_language = None
        segments, _info = self._partial_model.transcribe(
            str(partial_wav_path),
            language=requested_language,
            vad_filter=True,
            beam_size=1,
            condition_on_previous_text=False,
            temperature=0,
        )

        lines: list[str] = []
        previous_normalized = None
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue

            normalized = normalize_text(text)
            if normalized == previous_normalized:
                continue
            if is_sparse_segment(float(segment.start), float(segment.end), text):
                continue
            if looks_like_partial_garbage(text):
                continue

            lines.append(text)
            previous_normalized = normalized

        partial_text = " ".join(lines).strip()
        if looks_like_partial_garbage(partial_text):
            return ""
        return partial_text

    async def _send(self, session: LiveSession, payload: dict) -> None:
        if session.websocket is None:
            return
        async with session.send_lock:
            await session.websocket.send_json(payload)

    def list_states(self) -> list[LiveSessionStateResponse]:
        return [session.to_state() for session in self.sessions.values()]

    def get_state(self, meeting_id: str) -> LiveSessionStateResponse | None:
        session = self.sessions.get(meeting_id)
        return session.to_state() if session else None

    def remove_session(self, meeting_id: str) -> None:
        session = self.sessions.pop(meeting_id, None)
        if not session:
            return
        if session.partial_task:
            session.partial_task.cancel()

    def clear_sessions(self) -> None:
        for meeting_id in list(self.sessions.keys()):
            self.remove_session(meeting_id)

    @staticmethod
    def _write_wav(raw_pcm_path: Path, wav_path: Path) -> None:
        raw_bytes = raw_pcm_path.read_bytes()
        LiveSessionManager._write_wav_bytes(raw_bytes, wav_path)

    @staticmethod
    def _write_wav_bytes(raw_bytes: bytes, wav_path: Path) -> None:
        with wave.open(str(wav_path), "wb") as wav_handle:
            wav_handle.setnchannels(CHUNK_CHANNELS)
            wav_handle.setsampwidth(2)
            wav_handle.setframerate(CHUNK_SAMPLE_RATE)
            wav_handle.writeframes(raw_bytes)


manager = LiveSessionManager()
