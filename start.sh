#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

cleanup() {
  echo
  echo "Stopping services..."
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

start_backend() {
  cd "$ROOT_DIR/server"

  if command -v conda >/dev/null 2>&1; then
    eval "$(conda shell.bash hook)"
  elif [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
    # Fallback for shells where conda is not on PATH yet.
    source "$HOME/miniconda3/etc/profile.d/conda.sh"
  elif [ -f "$HOME/anaconda3/etc/profile.d/conda.sh" ]; then
    source "$HOME/anaconda3/etc/profile.d/conda.sh"
  else
    echo "conda was not found. Please install conda or add it to PATH." >&2
    exit 1
  fi

  conda activate aiagent
  python app.py
}

start_frontend() {
  cd "$ROOT_DIR/web"
  npm run dev
}

echo "Starting backend..."
start_backend &
PIDS+=("$!")

echo "Starting frontend..."
start_frontend &
PIDS+=("$!")

wait
