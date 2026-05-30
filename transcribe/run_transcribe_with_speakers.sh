#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./run_transcribe_with_speakers.sh "/path/to/video.mkv" [output_dir] [model]

Examples:
  cp .hf.env.example .hf.env
  ./run_transcribe_with_speakers.sh "/Users/me/Desktop/video.mkv"
  ./run_transcribe_with_speakers.sh "/Users/me/Desktop/video.mkv" "$HOME/video-transcript" large-v3

Notes:
  - You must accept the Hugging Face terms for:
    https://huggingface.co/pyannote/speaker-diarization-community-1
  - Then create a Hugging Face token and place it in .hf.env as HF_TOKEN=...
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

load_local_env() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    log "Loading env from $env_file"
    # shellcheck disable=SC1090
    set -a
    source "$env_file"
    set +a
  fi
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
MIN_SPEAKERS="${MIN_SPEAKERS:-}"
MAX_SPEAKERS="${MAX_SPEAKERS:-}"
DIAR_DEVICE="${DIAR_DEVICE:-cpu}"

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
VENV_DIR="$SCRIPT_DIR/.venv-speakers"
AUDIO_PATH="$OUTPUT_DIR/$STEM.16k.wav"
LOG_PATH="$OUTPUT_DIR/$STEM.run.log"
PY_SCRIPT="$SCRIPT_DIR/transcribe_with_speakers.py"
ENV_FILE="$SCRIPT_DIR/.hf.env"

load_local_env "$ENV_FILE"
HF_TOKEN="${HF_TOKEN:-}"

if [[ -z "$HF_TOKEN" ]]; then
  printf 'HF_TOKEN is required for speaker diarization.\n' >&2
  printf 'Create %s or export HF_TOKEN first.\n' "$ENV_FILE" >&2
  printf 'Example: cp %s/.hf.env.example %s && edit HF_TOKEN inside it.\n' "$SCRIPT_DIR" "$ENV_FILE" >&2
  exit 1
fi

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
log "Diarization device: $DIAR_DEVICE"
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
python -m pip install -U "faster-whisper" "pyannote.audio"

log "Extracting mono 16k WAV"
ffmpeg -y -i "$VIDEO_PATH" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$AUDIO_PATH"

export HF_TOKEN
export DIAR_DEVICE

CMD=(
  python -u "$PY_SCRIPT"
  --audio "$AUDIO_PATH"
  --output-dir "$OUTPUT_DIR"
  --model "$MODEL_NAME"
  --language "$LANGUAGE"
)

if [[ -n "$MIN_SPEAKERS" ]]; then
  CMD+=(--min-speakers "$MIN_SPEAKERS")
fi

if [[ -n "$MAX_SPEAKERS" ]]; then
  CMD+=(--max-speakers "$MAX_SPEAKERS")
fi

log "Starting transcription with speaker labels"
"${CMD[@]}"

log "Done"
