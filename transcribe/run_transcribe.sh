#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./run_transcribe.sh "/path/to/video.mkv" [output_dir] [model]

Examples:
  ./run_transcribe.sh "/Users/me/Desktop/video.mkv"
  ./run_transcribe.sh "/Users/me/Desktop/video.mkv" "$HOME/video-transcript" large-v3
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

pick_python() {
  local candidates=(python3.12 python3.11 python3.10 python3)
  local py
  for py in "${candidates[@]}"; do
    if command -v "$py" >/dev/null 2>&1; then
      printf '%s\n' "$py"
      return 0
    fi
  done
  return 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INPUT_DIR="$SCRIPT_DIR/input"
DEFAULT_OUTPUT_DIR="$SCRIPT_DIR/output"

VIDEO_PATH="$1"
OUTPUT_DIR="${2:-$DEFAULT_OUTPUT_DIR}"
MODEL_NAME="${3:-large-v3}"
LANGUAGE="${LANGUAGE:-auto}"

if [[ ! -f "$VIDEO_PATH" ]]; then
  printf 'Video not found: %s\n' "$VIDEO_PATH" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  printf 'ffmpeg is required. Install with: brew install ffmpeg\n' >&2
  exit 1
fi

PYTHON_BIN="$(pick_python)"
mkdir -p "$INPUT_DIR" "$OUTPUT_DIR"

BASE_NAME="$(basename "$VIDEO_PATH")"
STEM="${BASE_NAME%.*}"
VENV_DIR="$SCRIPT_DIR/.venv"
AUDIO_PATH="$OUTPUT_DIR/$STEM.16k.wav"
LOG_PATH="$OUTPUT_DIR/$STEM.run.log"
PY_SCRIPT="$SCRIPT_DIR/transcribe.py"

if [[ ! -f "$PY_SCRIPT" ]]; then
  printf 'Missing helper script: %s\n' "$PY_SCRIPT" >&2
  exit 1
fi

if [[ -t 1 ]]; then
  exec > >(tee -a "$LOG_PATH") 2>&1
else
  exec >>"$LOG_PATH" 2>&1
fi

log "Video: $VIDEO_PATH"
log "Output dir: $OUTPUT_DIR"
log "Model: $MODEL_NAME"
log "Language: $LANGUAGE"
log "Python: $PYTHON_BIN"

if [[ ! -d "$VENV_DIR" ]]; then
  log "Creating virtualenv at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log "Upgrading pip tooling"
python -m pip install -U pip setuptools wheel

log "Installing dependencies"
python -m pip install -U "faster-whisper"

log "Extracting mono 16k WAV"
ffmpeg -y -i "$VIDEO_PATH" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$AUDIO_PATH"

log "Starting transcription"
python -u "$PY_SCRIPT" \
  --audio "$AUDIO_PATH" \
  --output-dir "$OUTPUT_DIR" \
  --model "$MODEL_NAME" \
  --language "$LANGUAGE"

log "Done"
