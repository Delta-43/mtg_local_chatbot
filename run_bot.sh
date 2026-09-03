#!/usr/bin/env bash
set -euo pipefail

# Automatically switch to docker group if member but session does not have it active yet
if ! docker info >/dev/null 2>&1; then
  if getent group docker | grep -qw "${USER:-$(whoami)}"; then
    exec sg docker -c "$0 $*"
  fi
fi

VENV_DIR=".venv"
DEFAULT_OLLAMA_URL="http://localhost:11435"

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Missing ${VENV_DIR}. Run ./setup.sh first."
  exit 1
fi

if ! curl -s "${DEFAULT_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Error: 'ollama' command not found. Please install Ollama or ensure it is running on ${DEFAULT_OLLAMA_URL}."
    exit 1
  fi
  echo "Starting Ollama in background..."
  ./scripts/run_ollama.sh > ollama.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -s "${DEFAULT_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -s "${DEFAULT_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
    echo "Error: Ollama failed to start on ${DEFAULT_OLLAMA_URL}. Check ollama.log."
    exit 1
  fi
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

for entry in "rules-mcp:http://localhost:8100/health:600" "scryfall-mcp:http://localhost:3000/health:60" "searxng:http://localhost:8080/:60"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  timeout="${rest##*:}"
  url="${rest%:*}"
  echo -n "Waiting for ${name} (up to ${timeout}s)..."
  ready=false
  for i in $(seq 1 "${timeout}"); do
    if curl -s -o /dev/null "${url}"; then
      echo " ready."
      ready=true
      break
    fi
    if (( i % 15 == 0 )); then
      echo -n " (${i}s)..."
    fi
    sleep 1
  done
  if [[ "${ready}" != "true" ]]; then
    echo " timed out after ${timeout}s! Check docker compose logs for ${name}."
    exit 1
  fi
done

APP_HOST="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.HOST)')"
APP_PORT="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.PORT)')"

exec "${VENV_DIR}/bin/python" -m uvicorn app_api.main:app --host "${APP_HOST}" --port "${APP_PORT}"
