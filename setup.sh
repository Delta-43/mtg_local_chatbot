#!/usr/bin/env bash
set -euo pipefail

echo "=== MTG Judge Chatbot Setup ==="

# ---------------------------------------------------------------------------
# IMPORTANT (hardware note):
# This machine has an AMD R7 250E / Radeon HD 7700 (GCN 1.0 "VERDE") GPU.
# Ollama 0.32+ auto-detects it as a Vulkan device and offloads model layers to
# it. That GPU's Vulkan compute path is unstable and wedges the amdgpu "ttm"
# kernel workers in uninterruptible sleep, which stalls ALL inference (system
# load average spikes to ~17 and requests never return).
#
# The fix is to run Ollama CPU-only. This script launches a dedicated CPU-only
# Ollama on port 11435 (via run_ollama_cpu.sh) and points the app at it, so the
# system Ollama service is left untouched.
# ---------------------------------------------------------------------------

CPU_OLLAMA_URL="http://localhost:11435"
VENV_DIR=".venv"

echo "Step 1: Creating or reusing .venv..."
if [[ ! -d "${VENV_DIR}" ]]; then
    python3 -m venv "${VENV_DIR}"
fi

echo "Step 2: Installing dependencies..."
"${VENV_DIR}/bin/pip" install --upgrade pip
"${VENV_DIR}/bin/pip" install -r requirements.txt

echo "Step 3: Pulling configured Ollama models..."
LLM_MODEL="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.LLM_MODEL)')"
EMBED_MODEL="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.EMBEDDING_MODEL)')"
ollama pull "${LLM_MODEL}"
ollama pull "${EMBED_MODEL}"

echo "Step 4: Creating local data directories..."
mkdir -p data/pdf_parser data/chroma

echo "Step 5: Verifying project_config.yml..."
if [[ ! -f project_config.yml ]]; then
    echo "Missing project_config.yml. Restore it before running setup."
    exit 1
fi

echo "Step 6: Starting a CPU-only Ollama instance on :11435..."
if curl -s "${CPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
    echo "CPU-only Ollama already running."
else
    ./scripts/run_ollama_cpu.sh > ollama_cpu.log 2>&1 &
    OLLAMA_CPU_PID=$!
    echo "Started CPU Ollama (pid ${OLLAMA_CPU_PID}). Waiting for it to be ready..."
    for i in $(seq 1 30); do
        if curl -s "${CPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
            echo "CPU-only Ollama is ready."
            break
        fi
        sleep 1
    done
fi

echo "Step 7: Running PDF parser..."
OLLAMA_BASE_URL="${CPU_OLLAMA_URL}" "${VENV_DIR}/bin/python" -m rules_parser.parser

echo "Step 8: Ingesting rules into ChromaDB (CPU embeddings, be patient)..."
OLLAMA_BASE_URL="${CPU_OLLAMA_URL}" "${VENV_DIR}/bin/python" -m chroma_embedder.ingestor

echo "=== Setup complete ==="
echo ""
echo "Keep the CPU-only Ollama running with: ./run_ollama_cpu.sh"
echo "Activate the Python env with:          source .venv/bin/activate"
echo "Start the API server with:             uvicorn app_api.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "The app is configured to use ${CPU_OLLAMA_URL} (CPU-only Ollama)."
