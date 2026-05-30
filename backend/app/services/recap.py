from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, UTC
import json
from pathlib import Path
import uuid

from ..config import settings
from ..schemas import ActionItem, RecapPayload, RecapResponse
from .meetings import get_meeting, get_recap, list_segments, save_recap, set_meeting_status


def _sentence_cleanup(text: str) -> str:
    return " ".join(text.split()).strip()


def _build_summary(texts: list[str]) -> str:
    if not texts:
        return "Chưa có transcript để tạo recap."
    picked = texts[:3]
    return " ".join(picked)


def _extract_key_points(texts: list[str]) -> list[str]:
    seen = OrderedDict()
    for text in texts[:8]:
        cleaned = _sentence_cleanup(text)
        if cleaned and cleaned not in seen:
            seen[cleaned] = None
    return list(seen.keys())


def _extract_decisions(texts: list[str]) -> list[str]:
    keywords = ("chốt", "xác nhận", "quyết định", "thống nhất")
    return [text for text in texts if any(keyword in text.lower() for keyword in keywords)]


def _extract_action_items(texts: list[str]) -> list[ActionItem]:
    action_keywords = ("cần", "phải", "sẽ", "chuẩn bị", "gửi", "hoàn thành")
    items: list[ActionItem] = []
    for text in texts:
        if any(keyword in text.lower() for keyword in action_keywords):
            items.append(ActionItem(task=text))
        if len(items) >= 5:
            break
    return items


def _extract_open_questions(texts: list[str]) -> list[str]:
    return [text for text in texts if "?" in text][:5]


def generate_recap(meeting_id: str) -> RecapResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise ValueError("Meeting not found")

    segment_rows = list_segments(meeting_id)
    texts = [row["text"] for row in segment_rows]

    payload = RecapPayload(
        summary=_build_summary(texts),
        key_points=_extract_key_points(texts),
        decisions=_extract_decisions(texts),
        action_items=_extract_action_items(texts),
        open_questions=_extract_open_questions(texts),
    )

    recap_id = str(uuid.uuid4())
    created_at = datetime.now(UTC)

    output_dir = settings.output_root / meeting_id
    output_dir.mkdir(parents=True, exist_ok=True)

    recap_json_path = output_dir / "recap.json"
    recap_md_path = output_dir / "recap.md"

    recap_json_path.write_text(
        json.dumps(payload.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    recap_md_path.write_text(render_recap_markdown(meeting["title"], payload), encoding="utf-8")

    save_recap(
        meeting_id,
        recap_id=recap_id,
        summary=payload.summary,
        key_points_json=json.dumps(payload.key_points, ensure_ascii=False),
        decisions_json=json.dumps(payload.decisions, ensure_ascii=False),
        action_items_json=json.dumps([item.model_dump() for item in payload.action_items], ensure_ascii=False),
        open_questions_json=json.dumps(payload.open_questions, ensure_ascii=False),
    )
    set_meeting_status(
        meeting_id,
        "recap_ready",
        recap_json_path=str(recap_json_path),
        recap_markdown_path=str(recap_md_path),
    )

    return RecapResponse(
        meeting_id=meeting_id,
        recap=payload,
        created_at=created_at,
    )


def render_recap_markdown(title: str, payload: RecapPayload) -> str:
    lines = [
        f"# {title}",
        "",
        "## Executive Summary",
        payload.summary,
        "",
        "## Key Points",
    ]
    lines.extend([f"- {item}" for item in payload.key_points] or ["- Chưa có dữ liệu"])
    lines.extend(["", "## Decisions"])
    lines.extend([f"- {item}" for item in payload.decisions] or ["- Chưa ghi nhận quyết định rõ ràng"])
    lines.extend(["", "## Action Items"])
    if payload.action_items:
        lines.extend(
            [
                f"- {item.task}" + (f" (owner: {item.owner})" if item.owner else "") + (f" - deadline: {item.deadline}" if item.deadline else "")
                for item in payload.action_items
            ]
        )
    else:
        lines.append("- Chưa phát hiện action item rõ ràng")
    lines.extend(["", "## Open Questions"])
    lines.extend([f"- {item}" for item in payload.open_questions] or ["- Không có câu hỏi mở"])
    lines.append("")
    return "\n".join(lines)


def read_saved_recap(meeting_id: str) -> RecapResponse | None:
    recap_row = get_recap(meeting_id)
    if not recap_row:
        return None

    payload = RecapPayload(
        summary=recap_row["summary"],
        key_points=json.loads(recap_row["key_points_json"]),
        decisions=json.loads(recap_row["decisions_json"]),
        action_items=[ActionItem(**item) for item in json.loads(recap_row["action_items_json"])],
        open_questions=json.loads(recap_row["open_questions_json"]),
    )
    return RecapResponse(
        meeting_id=meeting_id,
        recap=payload,
        created_at=datetime.fromisoformat(recap_row["created_at"]),
    )
