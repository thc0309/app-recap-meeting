from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import subprocess

from ..config import settings
from .meetings import get_meeting, replace_segments, set_meeting_status


TIMESTAMP_RE = re.compile(r"^\[(?P<start>[\d:]+)-(?P<end>[\d:]+)\]\s+(?P<text>.+)$")


@dataclass
class TranscriptResult:
    transcript_text_path: Path
    transcript_timestamps_path: Path
    output_dir: Path
    segments: list[dict[str, float | str]]


def hhmmss_to_seconds(raw: str) -> float:
    parts = [int(part) for part in raw.split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        return minutes * 60 + seconds
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return hours * 3600 + minutes * 60 + seconds
    raise ValueError(f"Unsupported timestamp format: {raw}")


def parse_timestamp_file(path: Path) -> list[dict[str, float | str]]:
    segments: list[dict[str, float | str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        match = TIMESTAMP_RE.match(line.strip())
        if not match:
            continue
        segments.append(
            {
                "start_sec": hhmmss_to_seconds(match.group("start")),
                "end_sec": hhmmss_to_seconds(match.group("end")),
                "speaker_label": None,
                "text": match.group("text"),
            }
        )
    return segments


def run_transcription(meeting_id: str, *, use_speakers: bool = False) -> TranscriptResult:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise ValueError("Meeting not found")

    source_path_raw = meeting["source_path"]
    if not source_path_raw:
        raise ValueError(
            "Meeting chua co source_path. Neu day la session realtime, hay bam Stop meeting de backend finalize audio truoc khi transcribe."
        )

    source_path = Path(source_path_raw).expanduser().resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Source file not found: {source_path}")

    script_path = settings.transcribe_speakers_script if use_speakers else settings.transcribe_script
    if not script_path.exists():
        raise FileNotFoundError(f"Transcribe script not found: {script_path}")

    output_dir = settings.output_root / meeting_id
    output_dir.mkdir(parents=True, exist_ok=True)

    model_name = meeting["model_name"] or settings.default_model
    set_meeting_status(meeting_id, "transcribing")

    subprocess.run(
        [str(script_path), str(source_path), str(output_dir), model_name],
        cwd=settings.legacy_root,
        check=True,
    )

    timestamp_files = sorted(output_dir.glob("*.timestamps.txt"))
    transcript_files = sorted(output_dir.glob("*.transcript.txt"))
    if not timestamp_files or not transcript_files:
        raise FileNotFoundError(f"Missing transcript outputs in {output_dir}")

    timestamp_path = timestamp_files[0]
    transcript_path = transcript_files[0]
    segments = parse_timestamp_file(timestamp_path)
    replace_segments(meeting_id, segments)
    set_meeting_status(
        meeting_id,
        "transcribed",
        transcript_path=str(timestamp_path),
        transcript_text_path=str(transcript_path),
    )

    return TranscriptResult(
        transcript_text_path=transcript_path,
        transcript_timestamps_path=timestamp_path,
        output_dir=output_dir,
        segments=segments,
    )
