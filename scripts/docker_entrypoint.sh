#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_CONFIG_FILE:=/app/project_config.yml}"

if [[ -f "$PROJECT_CONFIG_FILE" ]]; then
  eval "$(python /app/scripts/config_to_env.py)"
fi

exec uvicorn app_api.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
