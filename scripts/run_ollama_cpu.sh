#!/usr/bin/env bash
set -euo pipefail

export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11435}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/repos/ollama/models}"
export OLLAMA_VULKAN=0
export CUDA_VISIBLE_DEVICES=""
export HIP_VISIBLE_DEVICES=""
export ROCR_VISIBLE_DEVICES=""
export GGML_VK_VISIBLE_DEVICES=""
export OLLAMA_LLM_LIBRARY="cpu"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"

echo "Starting CPU-only Ollama on http://${OLLAMA_HOST}"
exec ollama serve
