#!/usr/bin/env bash
set -euo pipefail

# core_config.Config already resolves project_config.yml (with env-var overrides)
# directly in Python at import time -- no need to pre-export it to the shell here.
APP_HOST="$(python -c 'from core_config import Config; print(Config.HOST)')"
APP_PORT="$(python -c 'from core_config import Config; print(Config.PORT)')"

exec uvicorn app_api.main:app --host "${APP_HOST}" --port "${APP_PORT}"
