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
# Without this, Ollama serializes requests to a given model (effectively
# num_parallel=1) regardless of how many concurrent HTTP calls a client
# sends -- relevant to rules_mcp/ingestor.py's concurrent embedding batches
# (INGEST_CONCURRENCY). Only affects locally-run models (the embedding model
# here); chat inference against gemma4:cloud runs on Ollama's infrastructure
# regardless. Measured on the reference dev host (4 CPU cores, CPU-only
# embedding inference, no usable GPU): setting this to 4 made no measurable
# difference (three timing runs -- serial, concurrent without this set,
# concurrent with it set to 4 -- all landed within ~2% of each other). On
# that hardware the bottleneck is raw CPU compute for the embedding model
# itself, not request queueing, so neither this nor client-side concurrency
# helps. Left on by default anyway since it's harmless there and genuinely
# helps on hardware where the bottleneck actually is queueing/latency (more
# cores, a GPU-backed embedding model, or a remote/high-latency Ollama).
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-4}"

echo "Starting Ollama on http://${OLLAMA_HOST}"
exec ollama serve
