import os
from pathlib import Path
from typing import Any

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_CONFIG_FILE = Path(
    os.getenv("PROJECT_CONFIG_FILE", PROJECT_ROOT / "project_config.yml")
)


def _load_project_config() -> dict[str, Any]:
    if not PROJECT_CONFIG_FILE.exists():
        return {}
    with open(PROJECT_CONFIG_FILE, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(
            f"Expected mapping at top level of {PROJECT_CONFIG_FILE}, got {type(data).__name__}"
        )
    return data


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _parse_csv_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _get_nested(data: dict[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = data
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _coerce(value: Any, caster: type | None) -> Any:
    if caster is None:
        return value
    if caster is bool:
        return _parse_bool(value)
    return caster(value)


def _resolve(
    config_data: dict[str, Any],
    env_name: str,
    yaml_path: tuple[str, ...],
    default: Any,
    caster: type | None = None,
) -> Any:
    env_value = os.getenv(env_name)
    if env_value is not None:
        return _coerce(env_value, caster)

    yaml_value = _get_nested(config_data, yaml_path)
    if yaml_value is not None:
        return _coerce(yaml_value, caster)

    return default


_CONFIG = _load_project_config()


class Config:
    OLLAMA_BASE_URL = _resolve(
        _CONFIG,
        "OLLAMA_BASE_URL",
        ("ollama", "base_url"),
        "http://localhost:11434",
    )
    LLM_MODEL = _resolve(
        _CONFIG, "LLM_MODEL", ("models", "llm"), "gemma4:cloud"
    )
    EMBEDDING_MODEL = _resolve(
        _CONFIG, "EMBEDDING_MODEL", ("models", "embedding"), "mxbai-embed-large"
    )

    LLM_REASONING = _resolve(
        _CONFIG, "LLM_REASONING", ("llm", "reasoning"), False, bool
    )
    LLM_NUM_PREDICT = _resolve(
        _CONFIG, "LLM_NUM_PREDICT", ("llm", "num_predict"), 512, int
    )
    LLM_NUM_CTX = _resolve(_CONFIG, "LLM_NUM_CTX", ("llm", "num_ctx"), 4096, int)

    # Note: Chroma/PDF-parser settings (persist dir, collection name, rules source
    # URLs, etc.) live in rules_mcp/settings.py now -- that server owns the rules
    # index directly, the main backend only talks to it over MCP. Likewise, the
    # main backend no longer talks to the Scryfall API directly at all (that used
    # to be scryfall_agent's get_card_rulings, now a native scryfall-mcp tool) --
    # SCRYFALL_USER_AGENT lives only in docker-compose.yml, forwarded straight to
    # the scryfall-mcp container.

    HOST = _resolve(_CONFIG, "HOST", ("server", "host"), "0.0.0.0")
    PORT = _resolve(_CONFIG, "PORT", ("server", "port"), 8000, int)
    LOG_LEVEL = _resolve(_CONFIG, "LOG_LEVEL", ("logging", "level"), "INFO")

    # --- Pluggable LLM provider (local Ollama vs. hosted OpenRouter) ---
    LLM_PROVIDER = _resolve(
        _CONFIG, "LLM_PROVIDER", ("llm_provider", "provider"), "local"
    )
    OPENROUTER_API_KEY = _resolve(
        _CONFIG, "OPENROUTER_API_KEY", ("llm_provider", "openrouter_api_key"), None
    )
    OPENROUTER_MODEL = _resolve(
        _CONFIG,
        "OPENROUTER_MODEL",
        ("llm_provider", "openrouter_model"),
        "openrouter/auto",
    )
    OPENROUTER_BASE_URL = _resolve(
        _CONFIG,
        "OPENROUTER_BASE_URL",
        ("llm_provider", "openrouter_base_url"),
        "https://openrouter.ai/api/v1",
    )

    # --- MCP tool servers ---
    RULES_MCP_URL = _resolve(
        _CONFIG, "RULES_MCP_URL", ("mcp", "rules_url"), "http://localhost:8100/mcp"
    )
    SCRYFALL_MCP_URL = _resolve(
        _CONFIG, "SCRYFALL_MCP_URL", ("mcp", "scryfall_url"), "http://localhost:3000/mcp"
    )

    # --- Agentic web search (SearXNG + fetch/extract) ---
    SEARXNG_URL = _resolve(
        _CONFIG, "SEARXNG_URL", ("web_search", "searxng_url"), "http://localhost:8080"
    )
    WEB_SEARCH_MAX_RESULTS = _resolve(
        _CONFIG, "WEB_SEARCH_MAX_RESULTS", ("web_search", "max_results"), 5, int
    )
    WEB_SEARCH_FETCH_TOP_N = _resolve(
        _CONFIG, "WEB_SEARCH_FETCH_TOP_N", ("web_search", "fetch_top_n"), 3, int
    )

    # --- Public API hardening ---
    CORS_ALLOWED_ORIGINS = _resolve(
        _CONFIG,
        "CORS_ALLOWED_ORIGINS",
        ("server", "cors_allowed_origins"),
        [],
        _parse_csv_list,
    )
    API_KEYS = _resolve(
        _CONFIG, "API_KEYS", ("server", "api_keys"), [], _parse_csv_list
    )
    RATE_LIMIT_PER_MINUTE = _resolve(
        _CONFIG, "RATE_LIMIT_PER_MINUTE", ("server", "rate_limit_per_minute"), 20, int
    )
    DAILY_QUOTA_ANONYMOUS = _resolve(
        _CONFIG, "DAILY_QUOTA_ANONYMOUS", ("server", "daily_quota_anonymous"), 30, int
    )
    DAILY_QUOTA_AUTHENTICATED = _resolve(
        _CONFIG,
        "DAILY_QUOTA_AUTHENTICATED",
        ("server", "daily_quota_authenticated"),
        500,
        int,
    )

    # --- Conversation memory (SQLite checkpointer) ---
    CONVERSATION_DB_PATH = _resolve(
        _CONFIG,
        "CONVERSATION_DB_PATH",
        ("conversation", "db_path"),
        "data/conversations/conversations.db",
    )
