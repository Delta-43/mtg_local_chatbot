# MTG Judge Chatbot

An AI-powered Magic: The Gathering rules judge chatbot using a local LLM, RAG, and the Scryfall API.

## Architecture

- **LLM**: `qwen3.5:0.8b` via Ollama (lightweight for older hardware; reasoning disabled by default)
- **Embeddings**: `mxbai-embed-large` via Ollama
- **Vector Store**: ChromaDB for semantic rule retrieval
- **Card Data**: Scryfall API for real-time card oracle text
- **API**: FastAPI for chatbot access (ready for web/Telegram/Discord integration)

## Pipeline

1. **`pdf_parser/pdf_parser.py`** – downloads the latest Comprehensive Rules PDF from
   wizards.com (if newer than the local copy) and parses it into a hierarchical JSON.
2. **`local_llm/chroma_ingestor.py`** – chunks the parsed rules into LangChain
   Documents and embeds them into a local ChromaDB.
3. **`scryfall_agent/scryfall_tools.py`** – LangChain tools that query the Scryfall API.
4. **`main.py`** – FastAPI app that classifies each query, retrieves rules from ChromaDB
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
  `http://localhost:11435` (this is what `setup.sh` and `.env` do).
- **System-wide (needs sudo):** add `Environment="OLLAMA_VULKAN=0"` to the Ollama
  systemd unit (`sudo systemctl edit ollama`) and restart it.

## Quick start (local)

```bash
./setup.sh
```

`setup.sh` creates a venv, installs deps, pulls the models, downloads + parses the
rules, launches CPU-only Ollama on `:11435`, and ingests the rules into ChromaDB.

Then run the API (keep CPU-only Ollama running in another terminal):

```bash
./run_ollama_cpu.sh                      # terminal 1 (leave running)
source venv/bin/activate                 # terminal 2
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Docker

```bash
cp .env.example .env
docker-compose up --build
```

Note: inside Docker, `OLLAMA_BASE_URL` must point to a CPU-only Ollama reachable from
the container (e.g. `http://host.docker.internal:11435`).

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

All settings live in `config.py` and can be overridden via `.env`:

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
├── config.py                 # Centralized configuration
├── main.py                   # FastAPI server and judge chain
├── setup.sh                  # One-shot local setup (venv, deps, parse, ingest)
├── run_ollama_cpu.sh         # CPU-only Ollama launcher (:11435)
├── requirements.txt          # Python dependencies (LangChain 1.x)
├── Dockerfile                # Container definition
├── docker-compose.yml        # Docker orchestration
├── .env.example              # Environment template
├── pdf_parser/
│   └── pdf_parser.py         # Rules PDF download and parsing
├── local_llm/
│   └── chroma_ingestor.py    # ChromaDB ingestion
└── scryfall_agent/
    └── scryfall_tools.py     # Scryfall API tools
```

## Performance notes (i5-4590, CPU-only)

- Rules ingestion (~1300 chunks) takes roughly 8-10 minutes.
- A single chat query takes ~15-20s (classification + retrieval + answer).
- Keeping `LLM_REASONING=false` is critical: with reasoning on, qwen3.5:0.8b spends its
  whole token budget "thinking" and returns an empty answer after several minutes.
- `qwen3.5:0.8b` is tiny; answers can be imprecise. For better accuracy at higher cost,
  try `qwen2.5:3b` or `llama3.2:3b` via `LLM_MODEL`.
```
