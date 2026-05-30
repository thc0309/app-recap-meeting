from __future__ import annotations

import sqlite3
from contextlib import contextmanager

from .config import settings


SCHEMA = """
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_path TEXT,
  status TEXT NOT NULL,
  transcript_path TEXT,
  transcript_text_path TEXT,
  recap_json_path TEXT,
  recap_markdown_path TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  speaker_label TEXT,
  text TEXT NOT NULL,
  FOREIGN KEY(meeting_id) REFERENCES meetings(id)
);

CREATE TABLE IF NOT EXISTS recaps (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  key_points_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  action_items_json TEXT NOT NULL,
  open_questions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(meeting_id) REFERENCES meetings(id)
);
"""


def init_db() -> None:
    with sqlite3.connect(settings.database_path) as conn:
        conn.executescript(SCHEMA)
        conn.commit()


@contextmanager
def get_connection():
    conn = sqlite3.connect(settings.database_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
