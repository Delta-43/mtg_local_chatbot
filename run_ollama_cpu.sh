#!/usr/bin/env bash
# Starts a CPU-only Ollama server to avoid the AMD R7 250E / HD 7700 (VERDE)
# Vulkan GPU path, which hangs the amdgpu "ttm" kernel workers on this hardware
# and stalls all inference (load average spikes, requests never return).
#
# This runs a SECOND ollama instance on port 11435 with GPU disabled, leaving
# the system service untouched. Point the app at it via OLLAMA_BASE_URL.
#
# Usage:
#   ./run_ollama_cpu.sh              # starts CPU-only ollama on :11435
#   OLLAMA_BASE_URL=http://localhost:11435 ./venv/bin/python -m local_llm.chroma_ingestor
set -e

export OLLAMA_HOST="127.0.0.1:11435"
# Reuse the same model store as the system Ollama service so already-pulled
# models are found. Override with OLLAMA_MODELS if your path differs.
export OLLAMA_MODELS="${OLLAMA_MODELS:-/repos/ollama/models}"
# Disable every GPU backend so llama.cpp runs purely on CPU.
export OLLAMA_VULKAN=0
export CUDA_VISIBLE_DEVICES=""
export HIP_VISIBLE_DEVICES=""
export ROCR_VISIBLE_DEVICES=""
export GGML_VK_VISIBLE_DEVICES=""
export OLLAMA_LLM_LIBRARY="cpu"
# Keep models resident so they are not reloaded between requests.
export OLLAMA_KEEP_ALIVE="30m"

echo "Starting CPU-only Ollama on http://${OLLAMA_HOST}"
echo "Leave this running, then in another terminal set:"
echo "  export OLLAMA_BASE_URL=http://localhost:11435"
exec ollama serve
