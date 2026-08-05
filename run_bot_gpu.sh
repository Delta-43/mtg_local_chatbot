#!/usr/bin/env bash
set -euo pipefail

VENV_DIR=".venv"
GPU_OLLAMA_URL="http://localhost:11434"

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Missing ${VENV_DIR}. Run ./setup.sh first."
  exit 1
fi

if ! curl -s "${GPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
  echo "Starting GPU-capable Ollama in background..."
  ./scripts/run_ollama_gpu.sh > ollama_gpu.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -s "${GPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-${GPU_OLLAMA_URL}}"

APP_HOST="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.HOST)')"
APP_PORT="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.PORT)')"

exec "${VENV_DIR}/bin/python" -m uvicorn app_api.main:app --host "${APP_HOST}" --port "${APP_PORT}"
