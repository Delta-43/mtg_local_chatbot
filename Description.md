# MTG Judge Chatbot — Full Project Description

This document is a complete, self-contained explanation of the **MTG Judge Chatbot**:
what it does, the technology stack, how every component works, why each tool and
method was chosen, and the notable engineering problems that were solved while building
it. It is intended for a reader who wants to understand the project end-to-end without
reading the source code first (though it maps directly onto the code).

---

## 1. What the project is

The MTG Judge Chatbot is a locally hosted AI assistant that answers **Magic: The
Gathering (MTG)** rules questions the way a human judge would. It combines three sources
of truth:

1. **The official Comprehensive Rules** of Magic (a ~300-page PDF, ~800 numbered rules
   and ~1000 sub-rules), retrieved with semantic search (RAG).
2. **Live card data** from the **Scryfall API** (oracle text, mana cost, type line,
   power/toughness) whenever a specific card is named.
3. **A local Large Language Model (LLM)** that reads the retrieved rules and card data
   and writes a natural-language answer, citing the relevant rule numbers.

It runs entirely on modest, older hardware (Intel **i5-4590**, **AMD R7 250E** GPU) with
no cloud dependencies for inference, and it exposes a small **HTTP API** so it can later
be wired into a web app, Telegram bot, or Discord bot.

### Design goals

| Goal | How it is met |
|---|---|
| Run locally / privately | Ollama serves the LLM and embeddings on-device |
| Cheap on old hardware | Tiny 0.8B LLM, CPU-only inference, batched embedding |
| Accurate on rules | RAG over the official rules PDF, always up to date |
| Accurate on cards | Live Scryfall lookups instead of relying on LLM memory |
| Reusable | FastAPI HTTP endpoint, configuration via env/`.env` |
| Reproducible | `setup.sh` one-shot install, Docker packaging |

---

## 2. High-level architecture

```
                          ┌─────────────────────────────────────────────┐
                          │                FastAPI (main.py)            │
   HTTP POST /chat  ───▶  │   1. classify query (LLM)                   │
                          │   2a. rules → ChromaDB similarity search    │
                          │   2b. card  → Scryfall API tool             │
                          │   3. merge contexts → LLM answer            │
                          └───────────┬──────────────────┬──────────────┘
                                      │                  │
                          ┌───────────▼────────┐   ┌─────▼───────────────┐
                          │     ChromaDB       │   │   Scryfall API      │
                          │ (vector store of   │   │ (external, free)    │
                          │  official rules)   │   └─────────────────────┘
                          └───────────▲────────┘
                                      │ embeddings (mxbai-embed-large)
                          ┌───────────┴────────┐
                          │      Ollama        │  ← local model server
                          │  LLM + embeddings  │     (CPU-only on this box)
                          └────────────────────┘

  Offline / build-time pipeline (run once, or when rules update):

   pdf_parser.py  ──▶  MagicCompRule_parsed_hierarchical.json  ──▶  chroma_ingestor.py  ──▶  ChromaDB
   (download+parse)         (structured rules)                        (chunk + embed)
```

There are two distinct phases:

- **Offline / ingestion phase** (`pdf_parser.py` → `chroma_ingestor.py`): downloads and
  parses the rules PDF and builds the vector database. Run once, and again whenever the
  official rules are updated.
- **Online / serving phase** (`main.py`): the FastAPI service that answers queries.

---

## 3. Technology stack and why each piece was chosen

### 3.1 Ollama (local model server)
- **What:** A local runtime that downloads and serves GGUF models over an HTTP API
  (`/api/chat`, `/api/embed`).
- **Why:** It removes the need for cloud LLM APIs (cost, privacy, latency) and gives a
  single, uniform interface for both the chat model and the embedding model. It also
  handles model loading, quantization, and keep-alive.
- **How used:** Accessed via the `langchain-ollama` integration (`ChatOllama`,
  `OllamaEmbeddings`). The base URL is configurable (`OLLAMA_BASE_URL`).

### 3.2 The models
- **LLM: `qwen3.5:0.8b`** — an 0.8-billion-parameter chat model.
  - **Why:** It is one of the smallest capable instruction/chat models, so it fits in RAM
    and produces a token every fraction of a second even on an old CPU. Larger models
    would be more accurate but too slow on this hardware.
  - **Trade-off:** At 0.8B it makes factual mistakes; the RAG context mitigates but does
    not eliminate this. The model is swappable via `LLM_MODEL` (e.g. `qwen2.5:3b`,
    `llama3.2:3b`) for users with better hardware.
- **Embeddings: `mxbai-embed-large`** — a strong open embedding model.
  - **Why:** Rules retrieval quality depends heavily on embedding quality. `mxbai-embed-large`
    gives high-quality 1024-dim vectors and is well supported by Ollama. Embeddings are
    computed once at ingestion time, so its larger size is acceptable.

### 3.3 LangChain (orchestration layer)
- **What:** A framework of composable primitives for LLM apps (prompts, chains, tools,
  retrievers, vector-store and model integrations).
- **Why:** It provides ready-made, well-tested glue between Ollama, ChromaDB, and the
  application logic, so the project does not reinvent retrievers, prompt templating, or
  output parsing. It also gives a clean "Tool" abstraction for the Scryfall agent.
- **How used (specific pieces):**
  - `langchain_ollama.ChatOllama` / `OllamaEmbeddings` — model access.
  - `langchain_chroma.Chroma` — vector store + `.as_retriever(...)`.
  - `langchain_core.prompts.ChatPromptTemplate` — the router and answer prompts.
  - `langchain_core.output_parsers.StrOutputParser` — turn model output into a string.
  - LCEL pipe syntax: `answer_prompt | llm | StrOutputParser()` composes the answer chain.
  - `langchain_core.tools.tool` — decorator that turns the Scryfall functions into tools.
  - `langchain_text_splitters.RecursiveCharacterTextSplitter` — chunking for ingestion.
- **Version note:** The project targets **LangChain 1.x**. In 1.x the text splitters moved
  to the standalone `langchain-text-splitters` package and the canonical tool decorator
  lives in `langchain_core.tools` (not `langchain.tools`). `requirements.txt` pins the 1.x
  line to avoid silent import breakage.

### 3.4 ChromaDB (vector store)
- **What:** An embedded, file-persisted vector database (SQLite-backed by default).
- **Why:** It requires no separate server, persists to a local directory, and integrates
  directly with LangChain. Perfect for a single-node local app.
- **How used:** The parsed rules are embedded and stored in a persistent collection
  (`mtg_rules`) under `./data/chroma`. At query time the retriever performs cosine
  similarity search and returns the top `k=5` rule chunks.

### 3.5 Scryfall API (card data)
- **What:** A free, public, well-documented MTG card database API.
- **Why:** MTG has 25,000+ cards; embedding all of them is unnecessary and the LLM cannot
  reliably memorize card text. A live API guarantees correct, current oracle text.
- **How used:** Two LangChain tools call `GET /cards/named?fuzzy=` (exact/typo-tolerant
  card lookup) and `GET /cards/search` (name search). A descriptive `User-Agent` is sent
  (Scryfall requests this), and `fuzzy` matching tolerates minor spelling errors.

### 3.6 FastAPI + Uvicorn (serving)
- **What:** A modern async Python web framework and its ASGI server.
- **Why:** Minimal boilerplate, automatic request/response validation via Pydantic,
  built-in OpenAPI docs, and easy integration points for future bots/web front-ends.
- **How used:** Two endpoints — `POST /chat` and `GET /health`. The heavy `MTGJudgeChain`
  object (model handles, vector store) is built once at startup via a **lifespan** context
  manager so it is reused across requests.

### 3.7 pdfminer.six + BeautifulSoup + requests (rules acquisition)
- **pdfminer.six:** low-level PDF text extraction with layout parameters — needed because
  the rules are only published as a PDF.
- **requests:** HTTP client for downloading the PDF and probing for updates.
- **BeautifulSoup:** parses the rules index page to discover the latest PDF link.

### 3.8 Docker + docker-compose (packaging)
- **Why:** Reproducible deployment and a clean path to running the API as a service that a
  web app or chat bot can call. The compose file sets memory limits appropriate for the
  target hardware and wires the container to a host-run Ollama.

### 3.9 python-dotenv + a central `Config` (configuration)
- **Why:** Every tunable (model names, paths, ports, URLs, LLM behavior) is read from
  environment variables with sensible defaults, so the same code runs locally and in
  Docker without edits. `.env` overrides defaults; `config.py` is the single source of
  truth consumed by every module.

---

## 4. Component-by-component walkthrough

### 4.1 `config.py` — centralized configuration
Loads `.env` (via `python-dotenv`) and exposes a `Config` class of class attributes. Key
settings:

- `OLLAMA_BASE_URL`, `LLM_MODEL`, `EMBEDDING_MODEL` — model server and models.
- `LLM_REASONING`, `LLM_NUM_PREDICT`, `LLM_NUM_CTX` — LLM behavior (see §6.4).
- `CHROMA_PERSIST_DIR`, `CHROMA_COLLECTION_NAME` — vector store location and collection.
- `PDF_PARSER_DIR`, `RULES_PDF_FILENAME`, `RULES_JSON_FILENAME` — rules artifact paths.
- `SCRYFALL_API_BASE` — Scryfall base URL.
- `HOST`, `PORT`, `LOG_LEVEL` — server settings.
- `MTG_RULES_URL`, `MTG_RULES_INDEX_URL` — fallback PDF URL and the page to scrape for the
  latest PDF link (both env-overridable so they can be fixed without code changes when
  Wizards changes their site).

**Why this design:** a single import (`from config import Config`) gives every module the
same configuration, and nothing is hard-coded, which is what makes local↔Docker parity and
"update a model by editing `.env`" possible.

### 4.2 `pdf_parser/pdf_parser.py` — download + structure the rules
Class `MTGRulesPDFParser` with a clear responsibility per method:

- **`_get_latest_rules_url()`** — fetches the rules index page with a browser-like
  `User-Agent`, then finds candidate PDF links two ways: a regex over the raw HTML for
  `.../MagicCompRules …*.pdf`, and BeautifulSoup anchor parsing. Because the filenames
  embed a date (`MagicCompRules 20260619.pdf`), it selects the **newest by date**. If the
  page can't be scraped it falls back to `Config.MTG_RULES_URL`.
- **`_file_needs_update()`** — decides whether to re-download. It issues an HTTP `HEAD` and
  compares the server's `Last-Modified` timestamp against the local file's mtime (with a
  1-hour tolerance). If the header is missing it falls back to a streamed **MD5 content
  hash** comparison. This avoids re-downloading a 2.4 MB PDF unnecessarily.
- **`download_rules_pdf()`** — streams the PDF to disk in chunks (memory-friendly).
- **`parse_pdf()`** — the core parser. It extracts text with `pdfminer` (skipping the first
  few cover/TOC pages), merges wrapped lines back into whole logical lines
  (`_merge_pdf_lines`), then walks the lines building a **hierarchy**:
  `chapter → section → rule → subrule`. It recognizes each level with anchored regexes:
  - chapter: `1. Game Concepts` (single digit)
  - section: `100. General` (three digits)
  - rule: `100.1. …`
  - subrule: `100.1a …`
  The result is written as `MagicCompRule_parsed_hierarchical.json`.
- **`main()`** — orchestration: update-check → download → parse, with graceful fallbacks
  to any existing local PDF/JSON.

**Output shape:**
```json
[
  { "heading": "1. Game Concepts",
    "sections": [
      { "section_id": "100", "section_title": "General",
        "rules": [
          { "rule_id": "100.1", "text": "These Magic rules apply…",
            "subrules": [ { "subrule_id": "100.1a", "text": "A two-player game…" } ] }
        ] } ] }
]
```
Typical parse yields ~34 chapters, ~148 sections, ~806 rules, ~960 subrules.

**Why a structured parse (not raw text):** keeping the `rule_id` hierarchy lets the
ingester attach precise metadata to each chunk, which in turn lets the chatbot **cite exact
rule numbers** (e.g. "Rule 502.3") in its answers.

### 4.3 `local_llm/chroma_ingestor.py` — build the vector database
Class `RulesIngestor`:

- **`_flatten_rules()`** — reads the hierarchical JSON and turns it into LangChain
  `Document` objects. For each rule it builds a human-readable header
  (`"1. Game Concepts > 100. General > 100.1."`) plus the rule text and all its subrules,
  then splits that with a `RecursiveCharacterTextSplitter` (`chunk_size=800`,
  `chunk_overlap=150`). Each chunk carries metadata: `chapter`, `section_id`,
  `section_title`, `rule_id`, `type`.
  - **Why chunk:** some rules with many subrules are long; chunking keeps each vector
    focused and improves retrieval precision, while the overlap preserves context across
    chunk boundaries. The header prefix means every chunk is self-describing to the LLM.
- **`ingest(recreate=False)`** — optionally wipes the existing store, creates the Chroma
  collection, and adds documents in **batches of 50**. Batching is important on CPU
  because each batch triggers an embedding call to Ollama; batching bounds request size
  and gives progress logging.

Result: ~1300 embedded chunks persisted under `./data/chroma`.

### 4.4 `scryfall_agent/scryfall_tools.py` — card lookups as tools
Two functions decorated with `@tool`:

- **`get_mtg_card_oracle_text(card_name)`** — `GET /cards/named?fuzzy=`; returns a compact
  block: name, mana cost, type, oracle text, power/toughness. `fuzzy` tolerates typos.
- **`search_mtg_cards(query)`** — `GET /cards/search`; returns up to five candidate names,
  used to discover card names mentioned in free text.

Both send a descriptive `User-Agent`, use timeouts, and degrade gracefully (returning an
explanatory string instead of throwing) so a Scryfall hiccup never crashes a chat request.

**Why tools:** the `@tool` abstraction gives each function a name + description that an
agent/LLM can reason about, and a uniform `.invoke()` interface the app calls directly.

### 4.5 `main.py` — the judge service
- **`lifespan`** — builds a single `MTGJudgeChain` at startup (loading models, opening the
  vector store) and reuses it for all requests; logs shutdown.
- **`ChatRequest` / `ChatResponse`** — Pydantic models. The response reports the `answer`,
  the `sources` (rule numbers and/or `Scryfall: <card>`), and two booleans indicating
  whether the rules retriever and/or card lookup were used (useful for debugging and UI).
- **`MTGJudgeChain`** — the brain:
  - Builds the `ChatOllama` LLM (with reasoning disabled and token caps — see §6.4), the
    `OllamaEmbeddings`, the `Chroma` vector store, and a `k=5` similarity retriever.
  - **`_classify_query()`** — a first LLM call using the **router prompt** labels the query
    as `rules`, `card`, `both`, or `general`. This is a lightweight "router" that decides
    which knowledge sources to consult, avoiding unnecessary work (e.g. no Scryfall call
    for a pure rules question). Defaults to `both` on any failure (fail-safe).
  - **`_extract_card_names()`** — first looks for card names in double quotes (an explicit
    signal from the user); if none, it probes n-gram phrases against Scryfall search to
    discover named cards. Capped to 3 to bound API calls.
  - **`query()`** — the orchestration:
    1. classify;
    2. if rules-relevant, retrieve top rule chunks and format them with their `rule_id`s;
    3. if card-relevant, resolve card names and fetch oracle text from Scryfall;
    4. **merge** both contexts into the **answer prompt** and generate the final answer via
       the LCEL chain `answer_prompt | llm | StrOutputParser()`;
    5. return the answer plus de-duplicated sources and the usage flags.
- **Endpoints:** `POST /chat` (validates non-empty input, 503 until ready) and
  `GET /health` (reports model + readiness).

**Why "classify → retrieve → merge → generate" instead of a fully autonomous agent:** on a
0.8B CPU model, a deterministic router is faster, cheaper, and far more reliable than
letting a tiny model plan multi-step tool use. It still achieves the "sub-agent for cards +
RAG for rules" design the project set out to build.

---

## 5. Request lifecycle (end-to-end example)

Query: `What does "Lightning Bolt" do?`

1. `POST /chat` → FastAPI validates and calls `judge_chain.query(...)`.
2. Router LLM call classifies it as `card` (a card is named in quotes).
3. `_extract_card_names` finds `Lightning Bolt` from the quotes.
4. `get_mtg_card_oracle_text` calls Scryfall → "deals 3 damage to any target", etc.
5. The answer prompt is filled with the card context (no rules context needed).
6. The LLM writes the answer; response includes `sources: ["Scryfall: Lightning Bolt"]`
   and `used_card_lookup: true`.

Query: `What happens during the untap step?`

1. Classified as `rules`.
2. The retriever embeds the query and returns the 5 nearest rule chunks (the 502.x untap
   rules).
3. Chunks are formatted with their rule numbers and passed as rules context.
4. The LLM answers and the response cites `Rule 502.3`, `502.4`, etc.

---

## 6. Notable engineering problems and how they were solved

These are the real issues encountered during development; documenting them explains several
non-obvious design decisions in the code.

### 6.1 Outdated rules URLs (HTTP 404)
The originally hard-coded 2025 PDF URL and the old rules index path returned 404 (Wizards
moved the page to `magic.wizards.com/en/rules` and the PDF to a `/2026/downloads/` path).
**Fix:** update the defaults, make both URLs env-overridable, and rewrite
`_get_latest_rules_url()` to scrape the current page and pick the newest dated PDF, with the
configured URL only as a fallback.

### 6.2 LangChain 1.x import breakage
The environment installed LangChain **1.x**, where `langchain.text_splitter` no longer
exists and the tool decorator's canonical home is `langchain_core.tools`.
**Fix:** import `RecursiveCharacterTextSplitter` from `langchain_text_splitters`, import
`tool` from `langchain_core.tools`, and pin the 1.x line in `requirements.txt` so a fresh
install is consistent.

### 6.3 Parser produced an empty database
The original heading validator required three digits, so single-digit **chapter** headings
(`1. Game Concepts`) were rejected; with no chapters created, every parsed rule was
discarded and the JSON came out empty (`[]`).
**Fix:** split validation into `_is_valid_chapter_heading` (single digit) and
`_is_valid_section_heading` (three digits), and reorder the match checks
(subrule → rule → section → chapter, most specific first). The parser now yields the full
34/148/806/960 hierarchy.

### 6.4 LLM returned empty answers
`qwen3.5:0.8b` is a **reasoning model**: it emits hidden `<think>` tokens before its visible
answer. On CPU with default limits it exhausted the token budget while "thinking" and
returned an empty string (`done_reason: length`).
**Fix:** disable thinking (`reasoning=False`) and set explicit `num_predict`/`num_ctx`,
surfaced as `LLM_REASONING`, `LLM_NUM_PREDICT`, `LLM_NUM_CTX` in `config.py`/`.env`. This
turned an ~8-minute empty response into a ~15-second real answer.

### 6.5 The critical one — Ollama hard-hang on the AMD GPU
On this machine Ollama auto-detected the old **AMD R7 250E / Radeon HD 7700 (GCN 1.0
"VERDE")** as a **Vulkan** compute device and offloaded model layers to it. That GPU's
Vulkan path is unstable and wedged the kernel's **amdgpu `ttm`** (GPU memory) worker threads
in uninterruptible sleep. The symptom: system load average spiked to ~18 and **every**
inference request (even a one-token embed) never returned.
**Diagnosis:** Ollama logs showed `OLLAMA_VULKAN:true` and layer offload to
`AMD Radeon HD 7700 Series (RADV VERDE)`; `ps` showed 16 stuck `kworker/u9:*+ttm` threads
while disk I/O and memory were idle — a classic wedged-GPU-driver signature.
**Fix:** run Ollama **CPU-only**. Since the machine has no passwordless sudo to edit the
system service, the project ships `run_ollama_cpu.sh`, which launches a *second*, dedicated
CPU-only Ollama on port **11435** (with `OLLAMA_VULKAN=0` and all GPU device visibility
variables cleared) pointed at the same model store. `setup.sh`, `.env`, and
`docker-compose.yml` point the app at `:11435`. After the fix a single embed dropped from
*timeout* to **0.64 s**. (System-wide alternative: add `Environment="OLLAMA_VULKAN=0"` to
the Ollama systemd unit and restart.)

---

## 7. Files and directory layout

```
mtg_local_chatbot/
├── config.py                 # Central configuration (env-driven)
├── main.py                   # FastAPI service + MTGJudgeChain (router/RAG/merge)
├── setup.sh                  # One-shot local setup (venv, deps, parse, ingest, CPU-Ollama)
├── run_ollama_cpu.sh         # CPU-only Ollama launcher on :11435 (GPU workaround)
├── requirements.txt          # Python deps (LangChain 1.x line)
├── Dockerfile                # Container image
├── docker-compose.yml        # Service orchestration + memory limits
├── .env.example              # Environment template
├── README.md                 # Quick start + hardware notes
├── Description.md            # (this document)
├── pdf_parser/
│   └── pdf_parser.py         # Download + parse rules PDF → hierarchical JSON
├── local_llm/
│   └── chroma_ingestor.py    # Flatten + chunk + embed rules → ChromaDB
├── scryfall_agent/
│   └── scryfall_tools.py     # Scryfall card-lookup tools
├── context_agent/            # (reserved for future Reddit/forum context source)
├── example_pipeline/         # Reference project (Local-RAG-with-Ollama) for inspiration
├── pdf_parser_old/           # Original parser experiments (kept for reference, untouched)
└── data/                     # Generated at runtime (PDF, JSON, ChromaDB) — git-ignored
    ├── pdf_parser/
    └── chroma/
```

---

## 8. Configuration reference

All values are read from the environment (see `.env.example`); defaults live in `config.py`.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint (use `:11435` for CPU-only) |
| `LLM_MODEL` | `qwen3.5:0.8b` | Chat model |
| `EMBEDDING_MODEL` | `mxbai-embed-large` | Embedding model |
| `LLM_REASONING` | `false` | Keep qwen3.5 "thinking" off (essential on CPU) |
| `LLM_NUM_PREDICT` | `512` | Max answer tokens |
| `LLM_NUM_CTX` | `4096` | Context window size |
| `CHROMA_PERSIST_DIR` | `./data/chroma` | Vector store directory |
| `CHROMA_COLLECTION_NAME` | `mtg_rules` | Chroma collection name |
| `PDF_PARSER_DIR` | `./data/pdf_parser` | Rules PDF/JSON directory |
| `RULES_PDF_FILENAME` | `MagicCompRules.pdf` | Local PDF filename |
| `RULES_JSON_FILENAME` | `MagicCompRule_parsed_hierarchical.json` | Parsed JSON filename |
| `SCRYFALL_API_BASE` | `https://api.scryfall.com` | Scryfall base URL |
| `MTG_RULES_URL` | 2026 PDF URL | Fallback PDF download URL |
| `MTG_RULES_INDEX_URL` | `magic.wizards.com/en/rules` | Page scraped for latest PDF |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | API bind address/port |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

---

## 9. How to run

### Local (recommended on this hardware)
```bash
./setup.sh                                   # venv, deps, models, parse, ingest, CPU-Ollama
# then, in two terminals:
./run_ollama_cpu.sh                          # terminal 1: CPU-only Ollama on :11435 (leave running)
source venv/bin/activate                     # terminal 2
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Re-running individual steps
```bash
OLLAMA_BASE_URL=http://localhost:11435 ./venv/bin/python -m pdf_parser.pdf_parser
OLLAMA_BASE_URL=http://localhost:11435 ./venv/bin/python -m local_llm.chroma_ingestor
```

### Docker
```bash
cp .env.example .env         # ensure OLLAMA_BASE_URL points at a CPU-only host Ollama
docker-compose up --build
```

### Calling the API
```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"query": "What happens during the untap step?"}'
```

---

## 10. Performance characteristics (i5-4590, CPU-only)

- Rules ingestion of ~1300 chunks: ~8–10 minutes (one-time).
- Single chat query: ~15–20 s (router call + retrieval + answer generation).
- Single embedding: ~0.6 s (with the CPU-only fix).
- `LLM_REASONING=false` is mandatory for usable latency and non-empty answers.

---

## 11. Limitations and future work

- **Model accuracy:** `qwen3.5:0.8b` is tiny and can state rules imprecisely even with
  correct context. Swapping to a 3B model (`LLM_MODEL`) markedly improves quality on
  capable hardware.
- **Conversation memory:** `conversation_id` exists in the request model but multi-turn
  memory is not yet implemented; each query is currently stateless.
- **Extended community context:** `context_agent/` is reserved for a planned source that
  pulls informal rulings/discussion (e.g. a Reddit API or forum scrape) to enrich answers
  on corner cases. This was intentionally deferred to keep the core reliable first.
- **Card-name extraction:** the n-gram Scryfall probing is a pragmatic heuristic; a named
  entity recognizer or a local card-name index would be faster and more precise.
- **GPU acceleration:** blocked by the specific AMD GCN 1.0 card. A newer ROCm-capable or
  NVIDIA GPU would allow GPU offload and much faster inference; the code already reads the
  endpoint from config, so only `OLLAMA_BASE_URL` would change.
```
