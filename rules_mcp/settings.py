import os


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value is not None else default


class Settings:
    """Self-contained config for the rules-mcp server.

    Deliberately does not import anything from the rest of this monorepo (e.g.
    `core_config`) so this package can be lifted into its own repo unchanged.
    """

    OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "mxbai-embed-large")

    # Pluggable embedding provider, mirroring llm_agent/llm_provider.py's
    # local/hosted split for chat -- "local" (default) uses the dedicated
    # Ollama instance above; "hosted" uses OpenRouter's OpenAI-compatible
    # /embeddings endpoint. Exists for slower/low-core-count machines where
    # local embedding compute is the actual bottleneck (measured: raising
    # concurrency alone doesn't help there -- see CLAUDE.md).
    EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local")
    # Deliberately a *separate* var/key from the main backend's
    # OPENROUTER_API_KEY (core_config/settings.py) -- chat and embeddings
    # are different containers hitting different OpenRouter models, and
    # keeping the keys distinct lets them be tracked/rotated/rate-limited
    # independently on OpenRouter's side rather than sharing one key's quota.
    OPENROUTER_EMBEDDING_API_KEY = os.getenv("OPENROUTER_EMBEDDING_API_KEY")
    OPENROUTER_EMBEDDING_MODEL = os.getenv("OPENROUTER_EMBEDDING_MODEL", "baai/bge-m3")
    OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

    PDF_PARSER_DIR = os.getenv("PDF_PARSER_DIR", "./data/pdf_parser")
    CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
    CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "mtg_rules")

    RULES_PDF_FILENAME = os.getenv("RULES_PDF_FILENAME", "MagicCompRules.pdf")
    RULES_JSON_FILENAME = os.getenv(
        "RULES_JSON_FILENAME", "MagicCompRule_parsed_hierarchical.json"
    )

    MTG_RULES_URL = os.getenv(
        "MTG_RULES_URL",
        "https://media.wizards.com/2026/downloads/MagicCompRules%2020260807.pdf",
    )
    MTG_RULES_INDEX_URL = os.getenv(
        "MTG_RULES_INDEX_URL", "https://magic.wizards.com/en/rules"
    )

    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

    HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
    HTTP_PORT = _int("HTTP_PORT", 8100)

    # If true, the server checks for a newer rules PDF and re-ingests on startup
    # before accepting requests, so a long-running container self-refreshes
    # instead of requiring a host-side setup step.
    REFRESH_ON_BOOT = _bool("REFRESH_ON_BOOT", True)

    # How many embedding batches ingest() sends to Ollama concurrently.
    # Defaults to available CPU cores (capped at 8 -- most Ollama setups
    # serialize inference per request unless OLLAMA_NUM_PARALLEL raises that,
    # so throwing more than a handful of concurrent requests at it usually
    # just queues them without extra benefit). Override directly if you know
    # your Ollama instance handles more, or fewer, concurrency well.
    INGEST_CONCURRENCY = _int("INGEST_CONCURRENCY", min(os.cpu_count() or 2, 8))
