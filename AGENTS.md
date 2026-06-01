# Agent Rules

## Project Focus

Build the Meeting Transcriber as a desktop-first Tauri application optimized for:

- macOS 13+
- Windows 10+
- online meetings on one machine
- dual-source capture: local mic + system audio

## Engineering Rules

- Treat `system audio capture` as the highest technical risk.
- Do not claim realtime diarization in v1. Remote speaker labeling happens after the meeting ends.
- Prefer additive changes to the Rust core over frontend polish.
- Keep the session state machine explicit and synchronized with the product plan.
- Do not add cloud upload paths that send audio off-device.
- Keep recap opt-in only.

## State Machine

Supported session states:

- `recording`
- `processing`
- `recovered`
- `done`
- `recap_done`
- `error`

Supported v1 transitions:

- `recording -> processing`
- `recording -> recovered`
- `recovered -> processing`
- `processing -> done`
- `done -> processing`
- `done -> recap_done`
- `processing -> error`
- `recording -> error`

Unsupported in v1:

- `recovered -> recording`

## Data Rules

- `segments` + `speakers` are the source of truth once SQLite lands.
- `transcript.json` is a denormalized snapshot, not the canonical store.
- If `Save raw audio` is off, raw WAV files must be deleted after session finalization.
- If `Save raw audio` is off, refine must be disabled.

## Tooling Rules

- Source the React UI in `frontend/` and build production assets into `web/` with `pnpm --dir frontend build` before packaging Tauri.
- Keep Rust core modules small and testable.
- Document any new MCP or skill dependency in `docs/skills-mcp-rules.md`.
- Keep capture-state behavior deterministic even before native APIs are integrated.
