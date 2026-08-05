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
        _CONFIG, "LLM_MODEL", ("models", "llm"), "qwen3.5:0.8b"
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

    CHROMA_PERSIST_DIR = _resolve(
        _CONFIG, "CHROMA_PERSIST_DIR", ("chroma", "persist_dir"), "./data/chroma"
    )
    CHROMA_COLLECTION_NAME = _resolve(
        _CONFIG,
        "CHROMA_COLLECTION_NAME",
        ("chroma", "collection_name"),
        "mtg_rules",
    )

    PDF_PARSER_DIR = _resolve(
        _CONFIG, "PDF_PARSER_DIR", ("parser", "data_dir"), "./data/pdf_parser"
    )
    RULES_PDF_FILENAME = _resolve(
        _CONFIG,
        "RULES_PDF_FILENAME",
        ("parser", "rules_pdf_filename"),
        "MagicCompRules.pdf",
    )
    RULES_JSON_FILENAME = _resolve(
        _CONFIG,
        "RULES_JSON_FILENAME",
        ("parser", "rules_json_filename"),
        "MagicCompRule_parsed_hierarchical.json",
    )

    SCRYFALL_API_BASE = _resolve(
        _CONFIG,
        "SCRYFALL_API_BASE",
        ("scryfall", "api_base"),
        "https://api.scryfall.com",
    )

    HOST = _resolve(_CONFIG, "HOST", ("server", "host"), "0.0.0.0")
    PORT = _resolve(_CONFIG, "PORT", ("server", "port"), 8000, int)
    LOG_LEVEL = _resolve(_CONFIG, "LOG_LEVEL", ("logging", "level"), "INFO")

    MTG_RULES_URL = _resolve(
        _CONFIG,
        "MTG_RULES_URL",
        ("rules_source", "fallback_pdf_url"),
        "https://media.wizards.com/2026/downloads/MagicCompRules%2020260417.pdf",
    )
    MTG_RULES_INDEX_URL = _resolve(
        _CONFIG,
        "MTG_RULES_INDEX_URL",
        ("rules_source", "index_url"),
        "https://magic.wizards.com/en/rules",
    )
