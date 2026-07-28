#!/usr/bin/env bash
set -e

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

echo "Step 1: Creating virtual environment..."
python3 -m venv venv

echo "Step 2: Installing dependencies..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

echo "Step 3: Pulling Ollama models (uses system ollama, download only)..."
ollama pull qwen3.5:0.8b
ollama pull mxbai-embed-large

echo "Step 4: Creating local data directories..."
mkdir -p data/pdf_parser data/chroma

echo "Step 5: Setting up local .env file..."
if [ ! -f .env ]; then
    cp .env.example .env
fi
# Ensure local paths and the CPU-only Ollama endpoint are used.
sed -i 's|PDF_PARSER_DIR=/app/data/pdf_parser|PDF_PARSER_DIR=./data/pdf_parser|' .env
sed -i 's|CHROMA_PERSIST_DIR=/app/data/chroma|CHROMA_PERSIST_DIR=./data/chroma|' .env
sed -i "s|OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=${CPU_OLLAMA_URL}|" .env

echo "Step 6: Starting a CPU-only Ollama instance on :11435..."
if curl -s "${CPU_OLLAMA_URL}/api/version" >/dev/null 2>&1; then
    echo "CPU-only Ollama already running."
else
    ./run_ollama_cpu.sh > ollama_cpu.log 2>&1 &
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
OLLAMA_BASE_URL="${CPU_OLLAMA_URL}" ./venv/bin/python -m pdf_parser.pdf_parser

echo "Step 8: Ingesting rules into ChromaDB (CPU embeddings, be patient)..."
OLLAMA_BASE_URL="${CPU_OLLAMA_URL}" ./venv/bin/python -m local_llm.chroma_ingestor

echo "=== Setup complete ==="
echo ""
echo "Keep the CPU-only Ollama running with: ./run_ollama_cpu.sh"
echo "Activate the Python env with:          source venv/bin/activate"
echo "Start the API server with:             uvicorn main:app --host 0.0.0.0 --port 8000"
echo ""
echo "The app is configured to use ${CPU_OLLAMA_URL} (CPU-only Ollama)."
