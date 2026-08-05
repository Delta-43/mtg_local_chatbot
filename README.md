# MTG Judge Chatbot

An AI-powered Magic: The Gathering rules judge chatbot using a local LLM, RAG, and the Scryfall API.

## Architecture

- **LLM**: `qwen3.5:0.8b` via Ollama (lightweight for older hardware; reasoning disabled by default)
- **Embeddings**: `mxbai-embed-large` via Ollama
- **Vector Store**: ChromaDB for semantic rule retrieval
- **Card Data**: Scryfall API for real-time card oracle text
- **API**: FastAPI for chatbot access (ready for web/Telegram/Discord integration)

## Pipeline

1. **`rules_parser/parser.py`** – downloads the latest Comprehensive Rules PDF from
   wizards.com (if newer than the local copy) and parses it into a hierarchical JSON.
2. **`chroma_embedder/ingestor.py`** – chunks the parsed rules into LangChain
   Documents and embeds them into a local ChromaDB.
3. **`scryfall_agent/scryfall_tools.py`** – LangChain tools that query the Scryfall API.
4. **`app_api/main.py`** – FastAPI app that classifies each query, retrieves rules from ChromaDB
   and/or card data from Scryfall, then generates a judge answer with the LLM.

## IMPORTANT: Hardware note (AMD R7 250E / HD 7700 "VERDE")

Modern Ollama auto-detects this old GCN 1.0 GPU as a **Vulkan** device and offloads
model layers to it. That GPU's Vulkan compute path is unstable and **hangs the amdgpu
`ttm` kernel workers in uninterruptible sleep**, which stalls all inference (system load
average spikes and requests never return).

**You must run Ollama CPU-only on this machine.** This repo ships `run_ollama_cpu.sh`,
which starts a dedicated CPU-only Ollama on port `11435` and leaves the system Ollama
service untouched.

Two options:
- **Recommended (no sudo):** use `./run_ollama_cpu.sh` and point the app at
  `http://localhost:11435` (this is what `setup.sh` and `project_config.yml` do).
- **System-wide (needs sudo):** add `Environment="OLLAMA_VULKAN=0"` to the Ollama
  systemd unit (`sudo systemctl edit ollama`) and restart it.

## Quick start (local)

```bash
./setup.sh
```

`setup.sh` creates or reuses `.venv`, installs deps, pulls the models, downloads + parses the
rules, launches CPU-only Ollama on `:11435`, and ingests the rules into ChromaDB.

Then run the full stack:

```bash
./run_bot_cpu.sh
```

GPU path (for compatible hosts):

```bash
./run_bot_gpu.sh
```

Manual API start (if Ollama is already running):

```bash
source .venv/bin/activate
uvicorn app_api.main:app --host 0.0.0.0 --port 8000
```

## Docker

```bash
docker-compose up --build
```

Note: inside Docker, `OLLAMA_BASE_URL` must point to a CPU-only Ollama reachable from
the container (e.g. `http://host.docker.internal:11435`).

## WSL2 + RTX 4070

Yes, this project can run well in WSL2 with an RTX 4070.

Recommended setup:

1. Install latest NVIDIA Windows driver with WSL2 CUDA support.
2. Install Ollama in WSL2 and verify the GPU path with:

```bash
ollama ps
```

3. In `project_config.yml`, keep `ollama.base_url` at `http://localhost:11434` for GPU mode.
4. Start with:

```bash
./setup.sh
./run_bot_gpu.sh
```

Notes:

- If GPU offload is not available, Ollama will fall back to CPU and still work.
- For higher answer quality on RTX 4070, try larger models by changing `models.llm` (for example `qwen2.5:3b` or `llama3.2:3b`).
- For Docker in WSL2, host networking behavior can vary; validate `OLLAMA_BASE_URL` from inside the container and adjust to the reachable host endpoint when needed.

## Troubleshooting

### `./run_bot_cpu.sh` or `./run_bot_gpu.sh` exits with `127`

This is usually a broken virtual environment executable path (often after renaming `venv` to `.venv`).

```bash
rm -rf .venv
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
```

Then retry:

```bash
./run_bot_cpu.sh
```

### API starts but requests fail or hang

1. Check API health:

```bash
curl -s http://localhost:8000/health
```

2. Check Ollama endpoint from your shell:

```bash
curl -s http://localhost:11434/api/version
```

3. Verify the active endpoint in config:

- GPU mode default: `ollama.base_url: http://localhost:11434`
- CPU mode default: `ollama.base_url: http://localhost:11435`

### WSL2 GPU is not being used

1. Confirm driver support on Windows and restart WSL:

```bash
wsl --shutdown
```

2. Start Ollama again and check active models:

```bash
ollama ps
```

If no GPU utilization appears, continue with CPU mode and validate behavior first.

### Larger model is too slow or runs out of memory

- Reduce model size (for example back to `qwen3.5:0.8b` or try `qwen2.5:3b`).
- Lower generation cost by reducing `llm.num_predict` and/or `llm.num_ctx` in `project_config.yml`.
- Keep `llm.reasoning: false` unless you explicitly want longer reasoning traces.

### Docker cannot reach Ollama in WSL2

Networking can differ by machine. If chat fails in Docker but works locally:

1. Test from container shell which endpoint is reachable.
2. Override `OLLAMA_BASE_URL` in compose environment to that reachable host/IP.

## API Endpoints

**Health Check:**
```bash
curl http://localhost:8000/health
```

**Chat:**
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What happens during the untap step?"}'
```

Put a card in double quotes to force a Scryfall lookup:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What does \"Lightning Bolt\" do?"}'
```

## Configuration

Primary settings live in `project_config.yml`. Environment variables override YAML values:

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint (use `:11435` for CPU-only) |
| `LLM_MODEL` | `qwen3.5:0.8b` | Chat model |
| `EMBEDDING_MODEL` | `mxbai-embed-large` | Embedding model |
| `LLM_REASONING` | `false` | Keep qwen3.5 thinking off (essential on CPU) |
| `LLM_NUM_PREDICT` | `512` | Max answer tokens |
| `LLM_NUM_CTX` | `4096` | Context window |
| `CHROMA_PERSIST_DIR` | `./data/chroma` | Vector store path |
| `PDF_PARSER_DIR` | `./data/pdf_parser` | Rules PDF/JSON path |

## Project Structure

```
mtg_local_chatbot/
├── app_api/                  # FastAPI app
├── llm_agent/                # Query classification + RAG answer chain
├── chroma_embedder/          # Chroma ingestion pipeline
├── rules_parser/             # Rules PDF download + parse pipeline
├── scryfall_agent/           # Scryfall API tools
├── core_config/              # YAML-first config loader
├── project_config.yml        # Canonical project configuration
├── setup.sh                  # One-shot local setup (.venv, deps, parse, ingest)
├── run_bot_cpu.sh            # Full stack launcher (CPU)
├── run_bot_gpu.sh            # Full stack launcher (GPU)
├── run_ollama_cpu.sh         # CPU-only Ollama launcher (:11435)
├── requirements.txt          # Python dependencies (LangChain 1.x)
├── Dockerfile                # Container definition
├── docker-compose.yml        # Docker orchestration
└── scripts/                  # Utility scripts and Docker entrypoint
```

## Performance notes (i5-4590, CPU-only)

- Rules ingestion (~1300 chunks) takes roughly 8-10 minutes.
- A single chat query takes ~15-20s (classification + retrieval + answer).
- Keeping `LLM_REASONING=false` is critical: with reasoning on, qwen3.5:0.8b spends its
  whole token budget "thinking" and returns an empty answer after several minutes.
- `qwen3.5:0.8b` is tiny; answers can be imprecise. For better accuracy at higher cost,
  try `qwen2.5:3b` or `llama3.2:3b` via `LLM_MODEL`.
```
