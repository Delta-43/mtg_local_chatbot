# MTG Judge Chatbot — Full Project Description

This document explains the current (refactored) architecture of the MTG Judge Chatbot,
including component boundaries, configuration model, local/Docker runtime flow, and
known hardware constraints.

---

## 1. What the project does

The MTG Judge Chatbot is a local AI assistant for **Magic: The Gathering** rules questions.
It combines three data sources at answer time:

1. Official Comprehensive Rules content retrieved from a local ChromaDB vector index.
2. Live Scryfall card data (oracle text, type line, mana cost, etc.).
3. A local Ollama-hosted LLM that merges the retrieved context into a final response.

The service is exposed over HTTP with FastAPI, so it can be used by a web app, bot, or CLI.

### Design goals

| Goal | How it is met |
|---|---|
| Local-first | Ollama serves models locally |
| Low-resource capable | Small default model and CPU-safe runtime path |
| Rules-grounded answers | RAG over parsed official rules |
| Up-to-date card text | On-demand Scryfall API lookup |
| Reproducible setup | One-shot setup script |
| Portable deployment | Docker + YAML-driven configuration |

---

## 2. Current architecture

There are two operational phases.

1. Offline preparation:
1. Download and parse MTG rules PDF into hierarchical JSON.
2. Chunk and embed the parsed rules into ChromaDB.

2. Online serving:
1. Accept chat query.
2. Classify query intent (`rules`, `card`, `both`, `general`).
3. Retrieve rules context and/or call Scryfall.
4. Generate answer with citations where possible.

### Logical flow

```text
Client -> FastAPI (app_api/main.py)
       -> llm_agent/judge_chain.py
          -> rules retrieval (ChromaDB)
          -> card lookup (Scryfall API)
          -> Ollama LLM answer generation
```

---

## 3. Refactored component layout

Top-level packages now map one package per tool responsibility.

- `app_api`: FastAPI app lifecycle and HTTP endpoints.
- `llm_agent`: query router + answer generation chain.
- `rules_parser`: rules PDF acquisition and hierarchical parsing.
- `chroma_embedder`: flatten/chunk/embed pipeline into ChromaDB.
- `scryfall_agent`: Scryfall tools used during card-aware queries.
- `core_config`: canonical configuration loader (YAML-first).
- `scripts`: runtime helpers, including Docker config bootstrap.

Runtime data lives under `data/`.

- `data/pdf_parser`: rules PDF + parsed JSON artifacts.
- `data/chroma`: persisted vector index.

---

## 4. Configuration model (current)

Configuration is **YAML-first** using `project_config.yml`.

1. The app loads defaults from `project_config.yml`.
2. Environment variables override YAML values.
3. Docker entrypoint exports env vars from YAML for uniform runtime behavior.

Key implementation files:

- `core_config/settings.py`: config resolution and typed coercion.
- `project_config.yml`: canonical project-level settings.
- `scripts/config_to_env.py`: YAML to exported environment variables.
- `scripts/docker_entrypoint.sh`: container startup bootstrap.

---

## 5. Main modules

### 5.1 API surface (`app_api/main.py`)

- `GET /health`: readiness/status information.
- `POST /chat`: judge response endpoint.
- Lifespan startup initializes the judge chain once.

### 5.2 Judge chain (`llm_agent/judge_chain.py`)

- Creates ChatOllama and OllamaEmbeddings clients.
- Connects to persistent ChromaDB collection.
- Classifies each query to choose retrieval/tools path.
- Builds merged context and generates final answer.

### 5.3 Rules parser (`rules_parser/parser.py`)

- Finds latest rules PDF URL (with fallback URL support).
- Downloads PDF when missing/outdated.
- Parses chapter/section/rule/subrule hierarchy.
- Saves parsed JSON artifact for ingestion.

### 5.4 Chroma embedder (`chroma_embedder/ingestor.py`)

- Reads parsed JSON.
- Flattens and chunks rules with metadata.
- Embeds chunks through Ollama embeddings.
- Persists into ChromaDB in batches.

### 5.5 Scryfall tools (`scryfall_agent/scryfall_tools.py`)

- Fuzzy card detail lookup (`/cards/named`).
- Card search helper (`/cards/search`).
- Returns resilient text output even on upstream API errors.

---

## 6. Runtime scripts

- `setup.sh`: one-shot local setup.
1. Reuses/creates `.venv`.
2. Installs dependencies.
3. Pulls configured models.
4. Ensures local data dirs.
5. Runs parser and ingestion pipeline.

- `run_bot_cpu.sh`: full local stack start, CPU-safe Ollama endpoint.
- `run_bot_gpu.sh`: full local stack start, GPU-capable endpoint.
- `run_ollama_cpu.sh`: convenience launcher delegating to scripts version.
- `scripts/run_ollama_cpu.sh`: CPU-only Ollama runtime flags.
- `scripts/run_ollama_gpu.sh`: default Ollama runtime path.

---

## 7. Docker deployment

Docker runtime is aligned with YAML-first config.

1. Compose mounts `project_config.yml` into the container.
2. Entry script translates YAML config into exported env vars.
3. Service starts Uvicorn for `app_api.main:app`.
4. Compose keeps host-Ollama connectivity via `host.docker.internal` by default.

Primary files:

- `Dockerfile`
- `docker-compose.yml`
- `scripts/docker_entrypoint.sh`
- `scripts/config_to_env.py`

---

## 8. Local usage

### Initial setup

```bash
./setup.sh
```

### Start the bot stack

```bash
./run_bot_cpu.sh
```

Optional GPU path:

```bash
./run_bot_gpu.sh
```

### API checks

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"query": "What happens during the untap step?"}'
```

---

## 9. Hardware notes

On AMD R7 250E / Radeon HD 7700 (GCN 1.0), Vulkan offload can hang inference.
Use CPU-only Ollama mode on this hardware. The provided CPU scripts enforce that mode.

---

## 10. Current limitations

- The default 0.8B model is lightweight but less accurate than larger options.
- Multi-turn conversation memory is not implemented yet.
- Card-name extraction is heuristic and could be improved with a dedicated entity layer.
- GPU acceleration depends on host compatibility and driver stability.

---

## 11. WSL2 + RTX 4070 compatibility

This stack is compatible with WSL2 on an RTX 4070 and is a strong deployment target.

Recommended path:

1. Install current NVIDIA drivers on Windows with WSL2 GPU support.
2. Run Ollama inside WSL2 and confirm GPU visibility.
3. Use `run_bot_gpu.sh` for standard GPU runtime.
4. Keep `project_config.yml` pointing at `http://localhost:11434` for GPU mode unless your host topology requires a different endpoint.

If GPU is unavailable at runtime, the project can still run in CPU mode using `run_bot_cpu.sh`.
```
