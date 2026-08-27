#!/usr/bin/env bash
set -euo pipefail

VENV_DIR=".venv"
DEFAULT_OLLAMA_URL="http://localhost:11435"

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Missing ${VENV_DIR}. Run ./setup.sh first."
  exit 1
fi

if ! curl -s "${DEFAULT_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
  echo "Starting Ollama in background..."
  ./scripts/run_ollama.sh > ollama.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -s "${DEFAULT_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-${DEFAULT_OLLAMA_URL}}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "docker compose is required to run rules-mcp/scryfall-mcp/searxng. Install Docker."
  exit 1
fi

echo "Ensuring rules-mcp, scryfall-mcp, and searxng are up (docker compose)..."
"${DOCKER_COMPOSE[@]}" up -d --build rules-mcp scryfall-mcp searxng

for name_url in "rules-mcp:http://localhost:8100/health" "scryfall-mcp:http://localhost:3000/health" "searxng:http://localhost:8080/"; do
  name="${name_url%%:*}"
  url="${name_url#*:}"
  echo -n "Waiting for ${name}..."
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "${url}"; then
      echo " ready."
      break
    fi
    sleep 1
  done
done

APP_HOST="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.HOST)')"
APP_PORT="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.PORT)')"

exec "${VENV_DIR}/bin/python" -m uvicorn app_api.main:app --host "${APP_HOST}" --port "${APP_PORT}"
