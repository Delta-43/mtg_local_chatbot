#!/usr/bin/env bash
set -euo pipefail

echo "=== MTG Judge Chatbot Setup ==="

VENV_DIR=".venv"
OLLAMA_URL="http://localhost:11435"

echo "Step 1: Creating or reusing .venv..."
if [[ ! -d "${VENV_DIR}" ]]; then
    python3 -m venv "${VENV_DIR}"
fi

echo "Step 2: Installing dependencies..."
"${VENV_DIR}/bin/pip" install --upgrade pip
"${VENV_DIR}/bin/pip" install -r requirements.txt

echo "Step 3: Verifying project_config.yml..."
if [[ ! -f project_config.yml ]]; then
    echo "Missing project_config.yml. Restore it before running setup."
    exit 1
fi

echo "Step 4: Starting Ollama on :11435 (if not already running)..."
if curl -s "${OLLAMA_URL}/api/version" >/dev/null 2>&1; then
    echo "Already running."
else
    ./scripts/run_ollama.sh > ollama.log 2>&1 &
    echo "Started (pid $!). Waiting for it to be ready..."
    for _ in $(seq 1 30); do
        if curl -s "${OLLAMA_URL}/api/version" >/dev/null 2>&1; then
            echo "Ready."
            break
        fi
        sleep 1
    done
fi

LLM_MODEL="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.LLM_MODEL)')"
EMBED_MODEL="$("${VENV_DIR}/bin/python" -c 'from core_config import Config; print(Config.EMBEDDING_MODEL)')"

echo "Step 5: Pulling configured Ollama models..."
OLLAMA_HOST="${OLLAMA_URL#http://}" ollama pull "${LLM_MODEL}"
OLLAMA_HOST="${OLLAMA_URL#http://}" ollama pull "${EMBED_MODEL}"

if [[ "${LLM_MODEL}" == *:cloud ]]; then
    echo ""
    echo "'${LLM_MODEL}' is an Ollama cloud model -- inference runs on Ollama's"
    echo "infrastructure, not this host. If you haven't already, sign in once:"
    echo "    OLLAMA_HOST=${OLLAMA_URL#http://} ollama signin"
fi

echo "Step 6: Creating local data directories (used by the rules-mcp container)..."
mkdir -p data/pdf_parser data/chroma

echo "Step 7: Fetching the scryfall-mcp submodule..."
if [[ -f .gitmodules ]]; then
    git submodule update --init --recursive
fi

echo "=== Setup complete ==="
echo ""
echo "Rules ingestion happens automatically inside the rules-mcp container on"
echo "first boot -- no separate host-side parsing step."
echo ""
echo "Next step:"
echo "  ./run_bot.sh   -- starts rules-mcp/scryfall-mcp/searxng via docker compose,"
echo "                     then runs the FastAPI backend directly on the host"
