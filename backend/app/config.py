from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    project_root: Path
    backend_root: Path
    transcribe_root: Path
    data_root: Path
    output_root: Path
    upload_root: Path
    log_root: Path
    database_path: Path
    transcribe_script: Path
    transcribe_speakers_script: Path
    default_model: str
    partial_model: str


def load_settings() -> Settings:
    backend_root = Path(__file__).resolve().parents[1]
    project_root = backend_root.parent
    transcribe_root = project_root / "transcribe"
    data_root = project_root / "data"
    output_root = data_root / "output"
    upload_root = data_root / "uploads"
    log_root = data_root / "logs"
    database_path = data_root / "app.db"

    settings = Settings(
        project_root=project_root,
        backend_root=backend_root,
        transcribe_root=transcribe_root,
        data_root=data_root,
        output_root=output_root,
        upload_root=upload_root,
        log_root=log_root,
        database_path=database_path,
        transcribe_script=transcribe_root / "run_transcribe.sh",
        transcribe_speakers_script=transcribe_root / "run_transcribe_with_speakers.sh",
        default_model=os.environ.get("MEETING_RECAP_MODEL", "large-v3"),
        partial_model=os.environ.get("MEETING_RECAP_PARTIAL_MODEL", "small"),
    )

    for directory in (transcribe_root, data_root, output_root, upload_root, log_root):
        directory.mkdir(parents=True, exist_ok=True)

    return settings


settings = load_settings()
