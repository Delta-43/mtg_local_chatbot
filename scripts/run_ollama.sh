#!/usr/bin/env bash
set -euo pipefail

# A dedicated instance on its own port (not Ollama's usual 11434), bound to
# 0.0.0.0 rather than loopback:
#   - own port: coexists with any system-wide Ollama already running, rather
#     than fighting it for the same port.
#   - 0.0.0.0, not 127.0.0.1: rules-mcp and mtg-judge reach this over Docker
#     via host.docker.internal, which resolves to the host's bridge-gateway
#     address, not loopback -- a service bound to 127.0.0.1 is unreachable
#     from a container.
# Hardware detection (GPU/CPU) is left to Ollama's own defaults; override via
# the usual Ollama env vars (e.g. OLLAMA_VULKAN=0) if your driver needs it.
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11435}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"

echo "Starting Ollama on http://${OLLAMA_HOST}"
exec ollama serve
