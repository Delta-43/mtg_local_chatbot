#!/usr/bin/env bash
set -euo pipefail

export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"

echo "Starting GPU-capable Ollama on http://${OLLAMA_HOST}"
exec ollama serve
