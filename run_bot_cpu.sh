#!/usr/bin/env bash
set -euo pipefail

VENV_DIR=".venv"
CPU_OLLAMA_URL="http://localhost:11435"

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Missing ${VENV_DIR}. Run ./setup.sh first."
  exit 1
fi

if ! curl -s "${CPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
  echo "Starting CPU-only Ollama in background..."
  ./scripts/run_ollama_cpu.sh > ollama_cpu.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -s "${CPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-${CPU_OLLAMA_URL}}"

APP_HOST="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.HOST)')"
APP_PORT="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.PORT)')"

exec "${VENV_DIR}/bin/python" -m uvicorn app_api.main:app --host "${APP_HOST}" --port "${APP_PORT}"
