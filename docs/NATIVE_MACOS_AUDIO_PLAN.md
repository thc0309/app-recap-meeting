# Native macOS Audio Plan

## Goal

Move the app from:

- Tauri frontend
- FastAPI sidecar server
- browser `getUserMedia` / `getDisplayMedia`

to:

- Tauri native commands
- macOS-native audio capture
- no always-on HTTP sidecar for realtime

This plan targets the specific user experience:

- capture microphone
- capture audio from Chrome or meeting apps
- keep using any headphones for playback
- avoid forcing users into screen-share based capture flows

## Current state

Realtime today depends on:

1. frontend captures PCM with Web Audio API
2. frontend streams chunks over WebSocket
3. FastAPI sidecar persists PCM and runs partial transcript
4. sidecar finalizes WAV and triggers transcript + recap

Main problems:

- macOS system audio from `getDisplayMedia` is unreliable
- browser capture does not match desktop app expectations
- sidecar adds process management, HTTP, and synchronization overhead

## Target architecture

### Native-first runtime

Tauri becomes the runtime owner for:

- capture session lifecycle
- device enumeration
- app/window selection
- PCM/WAV persistence
- transcript/recap job orchestration

Frontend talks to Tauri using:

- `invoke(...)` for commands
- Tauri events for progress

### Native macOS capture stack

Recommended macOS-native capture split:

1. `ScreenCaptureKit`
- app audio capture
- window/app selection
- Chrome / Zoom / Meet / system audio targeting

2. `AVAudioEngine` or CoreAudio input unit
- microphone capture
- input device selection
- mixing mic into app audio stream

3. local PCM mixer
- normalize both streams to one sample rate
- mono/stereo downmix policy
- save to rolling PCM / WAV

4. transcript runner
- initially can still invoke existing local Whisper scripts as child processes
- later can be ported to Rust-native orchestration

## Migration strategy

### Phase 1

Keep the current app working, but add a native macOS runtime contract in `src-tauri`.

Done in scaffold:

- `src-tauri/src/native_audio/`
- Tauri commands for support, devices, targets, start, stop, state

This phase is about interface stability, not full capture replacement yet.

### Phase 2

Replace browser capture on macOS with native capture:

- frontend no longer calls `getUserMedia` or `getDisplayMedia` for macOS-native mode
- frontend selects:
  - input device
  - capture target app
  - include microphone yes/no
- Tauri starts native capture and emits progress events

### Phase 3

Remove realtime dependency on FastAPI:

- no WebSocket chunk streaming to localhost
- no `live-sessions/start` REST route for macOS native mode
- Tauri writes WAV directly into app data
- Tauri calls transcript job directly after stop

### Phase 4

Replace sidecar meeting CRUD and transcript/recap orchestration:

- move meeting/session store into `src-tauri`
- move transcript file discovery/state updates into `src-tauri`
- keep existing Python ASR script as a direct child-process job only if needed

### Phase 5

Retire FastAPI sidecar completely when these exist in Tauri:

- meeting CRUD
- session state
- native capture
- transcript job runner
- recap job runner

## Recommended module layout

```text
src-tauri/src/
  native_audio/
    commands.rs
    runtime.rs
    macos.rs
    types.rs
  meetings/
    commands.rs
    store.rs
    types.rs
  transcript/
    commands.rs
    runner.rs
    types.rs
  recap/
    commands.rs
    runner.rs
    types.rs
```

## Native command contract

### Already scaffolded

- `native_audio_support`
- `native_audio_inputs`
- `native_audio_targets`
- `native_audio_state`
- `start_native_audio_capture`
- `stop_native_audio_capture`

### Next commands to add

- `native_audio_request_permissions`
- `native_audio_level_meter`
- `native_audio_partial_transcript`
- `native_transcript_run`
- `native_recap_run`

## Native event contract

Recommended events:

- `native-audio:started`
- `native-audio:levels`
- `native-audio:progress`
- `native-audio:partial-transcript`
- `native-audio:stopped`
- `native-audio:error`

## Capture modes to support

### 1. App audio + mic

Best default for desktop meeting UX.

User selects:

- target app: Chrome / Zoom / Meet
- mic input

Runtime captures:

- target app audio with ScreenCaptureKit
- microphone with AVAudioEngine/CoreAudio
- mixed stream saved to PCM/WAV

### 2. Input device only

Fallback for BlackHole / Aggregate Device workflows.

User selects:

- Aggregate Device or virtual loopback

Runtime captures only from selected input.

### 3. System audio only

Useful for recording webinars or playback-only sessions.

## Data storage plan

Move runtime-generated files under app data:

```text
AppData/
  meetings/
    <meeting-id>/
      capture.raw.pcm
      capture.wav
      transcript.txt
      transcript.timestamps.txt
      recap.json
      recap.md
```

## What to remove when native path is complete

- localhost health polling
- `/api/live-sessions/*`
- frontend `fetch(...127.0.0.1...)` for realtime
- sidecar lifecycle management in `src-tauri/src/lib.rs`
- backend WebSocket chunk relay

## Practical next implementation step

Implement real macOS capture inside:

- `src-tauri/src/native_audio/macos.rs`

in this order:

1. enumerate real audio inputs
2. enumerate running apps/windows for capture targets
3. start app-audio capture with ScreenCaptureKit
4. add microphone capture with AVAudioEngine/CoreAudio
5. mix and write PCM/WAV
6. emit live level/progress events
7. invoke transcript runner after stop

## Important constraint

Even in native mode, macOS permissions still apply:

- Microphone
- Screen & System Audio Recording

The difference is only that the app owns the capture flow directly, instead of depending on browser web APIs.
