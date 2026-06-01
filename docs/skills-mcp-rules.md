# Skills, MCP, and Rules

## Installed Skills

These are the Codex skills installed specifically for this project work:

- `speech`
- `transcribe`
- `security-threat-model`
- `playwright`

Use them for:

- `speech`, `transcribe`: audio, ASR, and meeting-transcript workflows
- `security-threat-model`: privacy review, permission flows, and cloud recap boundaries
- `playwright`: browser and UI validation once the frontend becomes interactive

## Recommended MCP Usage

Current useful MCP/tool categories for this repo:

- `GitHub`: future issue/PR automation and review flow
- `Figma`: later UI exploration, not needed for the current core scaffold
- browser automation tools: later responsiveness and desktop-webview smoke checks

No extra MCP configuration file is added yet because this repo does not currently depend on a custom MCP server.

## Repo Rules

- Keep the app local-first.
- Remote speaker diarization is a post-meeting pass in v1.
- Recap is explicit user action only.
- macOS distribution requires both signing and notarization.
- Session history must support deleting one session or clearing all history.

## Gaps Still Open

- JS package manager bootstrap
- actual Tauri CLI installation
- native audio capture spike for ScreenCaptureKit and WASAPI loopback
- persistent SQLite storage

## Current Capture Spike Surface

The Rust core now exposes a spike-oriented capture model:

- platform descriptor for `macOS` vs `Windows`
- system-audio permission status
- capture device status for local mic and system audio
- simulated `device_lost` and `recover_device` flows

This is architecture-only. It does not yet call native ScreenCaptureKit or WASAPI APIs.
