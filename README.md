# Meeting Transcriber

Meeting Transcriber is a desktop-first Tauri app for online meetings on one machine.

Current target:

- macOS 13+
- dual-source capture: local mic + system audio
- local transcription with Whisper
- opt-in recap with OpenAI

## What Works Now

- Tauri 2 desktop shell with a React control panel built into `web/`
- explicit session state machine: `recording`, `recovered`, `processing`, `done`, `recap_done`, `error`
- macOS native capture helper built with `ScreenCaptureKit` + `AVFoundation`
- SQLite persistence for sessions, transcript segments, and recaps
- local Whisper transcription from saved `mic.wav` + `system.wav`
- OpenAI recap generation after the meeting ends
- OpenAI API key storage in macOS Keychain
- session history operations: delete one session or clear all history
- markdown export for finalized sessions

## Important Limits

- This repo is `macOS-first`. Windows is not implemented yet.
- Real per-speaker diarization is not finished. Remote audio is captured correctly, but transcript speaker names are still generic labels.
- `ScreenCaptureKit` capture cannot be validated in a headless environment. You need a normal macOS desktop session with a visible display.
- Signing and notarization are intentionally not part of the current build flow.

## Hugging Face model download

Whisper `ggml-small.bin` is downloaded from Hugging Face. If the download fails with `401`, add a read token:

```bash
cp .env.example .env
# Edit .env and set HF_TOKEN=hf_...
```

The app loads `.env` from the repo root on startup (`HF_TOKEN` is sent as `Authorization: Bearer …`). Do not commit `.env`.

## Prerequisites

- macOS 13+
- Rust toolchain with `cargo`
- Xcode command line tools and `xcrun`
- `cargo-tauri`

Install the Tauri CLI if needed:

```bash
cargo install tauri-cli --version '^2'
```

The UI lives in `frontend/` (React, TypeScript, Tailwind CSS v4) and builds into `web/` for Tauri. You need `pnpm` for frontend builds.

## Run The App

Build the frontend, then start Tauri from the repo root:

```bash
cd /Users/chuongtong/Project/stagoo/app-recap-meeting/frontend
pnpm install
pnpm build

cd /Users/chuongtong/Project/stagoo/app-recap-meeting/src-tauri
cargo run
```

What happens on startup:

- Tauri loads the built frontend from `web/`
- the Rust core bootstraps app directories, `sessions.db`, and `config.json`
- the macOS capture helper is compiled by `build.rs` when needed

## First-Run macOS Permissions

The app needs:

- `Screen Recording`
- `Microphone`

Use the `Request system audio permission` button in the UI. macOS will prompt for access when possible. If access was previously denied, you may need to re-enable permissions manually in System Settings and relaunch the app.

## Typical Flow

1. Launch the app with `cargo run`.
2. In `Settings`, save your OpenAI model and API key if you want recap generation.
3. In `Model + Output`, download the default Whisper model.
4. Create a session.
5. Grant `Screen Recording` and `Microphone` access.
6. Finalize the session when the meeting ends.
7. Generate recap or export markdown from the selected session.

## Data Locations

App data is stored under the platform app-data directory from `directories::ProjectDirs`.

Main artifacts:

- `sessions.db`
- `config.json`
- `sessions/<session-id>/mic.wav`
- `sessions/<session-id>/system.wav`
- `sessions/<session-id>/transcript.json`
- `sessions/<session-id>/recap.md`
- `exports/<session-id>.md`
- `models/ggml-small.bin`

If `Save raw audio` is off, `mic.wav` and `system.wav` are deleted after a successful finalization.

## Useful Commands

Rebuild the frontend after UI changes:

```bash
cd /Users/chuongtong/Project/stagoo/app-recap-meeting/frontend
pnpm build
```

Validate the Rust core:

```bash
cd /Users/chuongtong/Project/stagoo/app-recap-meeting/src-tauri
cargo check
```

Run tests:

```bash
cd /Users/chuongtong/Documents/app-recap/src-tauri
cargo test
```

Format Rust code:

```bash
cd /Users/chuongtong/Documents/app-recap/src-tauri
cargo fmt
```

## Package The macOS App

From the repo root:

```bash
cd /Users/chuongtong/Documents/app-recap
cargo tauri build --bundles app
```

Confirmed bundle output:

- `/Users/chuongtong/Documents/app-recap/src-tauri/target/release/bundle/macos/`

Unsigned local builds are suitable for development and manual testing. They are not notarized.

If you also want a DMG:

```bash
cd /Users/chuongtong/Documents/app-recap
cargo tauri build
```

In this environment, the `.app` bundle completed successfully, but the DMG script did not finish cleanly because macOS DMG creation depends on a fuller GUI session.

## Project Layout

- `src-tauri/`: Rust backend, Tauri config, native macOS helper
- `frontend/`: React + TypeScript source (Vite, Tailwind v4)
- `web/`: production frontend bundle consumed by Tauri
- `docs/`: project notes, skills, MCP rules
- `AGENTS.md`: repo-specific agent rules
