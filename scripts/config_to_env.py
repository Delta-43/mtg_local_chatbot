#!/usr/bin/env python3
import os
import shlex
from pathlib import Path
from typing import Any

import yaml


DEFAULTS: dict[str, Any] = {
    "OLLAMA_BASE_URL": "http://localhost:11434",
    "LLM_MODEL": "qwen3.5:0.8b",
    "EMBEDDING_MODEL": "mxbai-embed-large",
    "LLM_REASONING": "false",
    "LLM_NUM_PREDICT": "512",
    "LLM_NUM_CTX": "4096",
    "CHROMA_PERSIST_DIR": "./data/chroma",
    "CHROMA_COLLECTION_NAME": "mtg_rules",
    "PDF_PARSER_DIR": "./data/pdf_parser",
    "RULES_PDF_FILENAME": "MagicCompRules.pdf",
    "RULES_JSON_FILENAME": "MagicCompRule_parsed_hierarchical.json",
    "SCRYFALL_API_BASE": "https://api.scryfall.com",
    "HOST": "0.0.0.0",
    "PORT": "8000",
    "LOG_LEVEL": "INFO",
    "MTG_RULES_URL": "https://media.wizards.com/2026/downloads/MagicCompRules%2020260417.pdf",
    "MTG_RULES_INDEX_URL": "https://magic.wizards.com/en/rules",
}

ENV_TO_PATH: dict[str, tuple[str, ...]] = {
    "OLLAMA_BASE_URL": ("ollama", "base_url"),
    "LLM_MODEL": ("models", "llm"),
    "EMBEDDING_MODEL": ("models", "embedding"),
    "LLM_REASONING": ("llm", "reasoning"),
    "LLM_NUM_PREDICT": ("llm", "num_predict"),
    "LLM_NUM_CTX": ("llm", "num_ctx"),
    "CHROMA_PERSIST_DIR": ("chroma", "persist_dir"),
    "CHROMA_COLLECTION_NAME": ("chroma", "collection_name"),
    "PDF_PARSER_DIR": ("parser", "data_dir"),
    "RULES_PDF_FILENAME": ("parser", "rules_pdf_filename"),
    "RULES_JSON_FILENAME": ("parser", "rules_json_filename"),
    "SCRYFALL_API_BASE": ("scryfall", "api_base"),
    "HOST": ("server", "host"),
    "PORT": ("server", "port"),
    "LOG_LEVEL": ("logging", "level"),
    "MTG_RULES_URL": ("rules_source", "fallback_pdf_url"),
    "MTG_RULES_INDEX_URL": ("rules_source", "index_url"),
}


def nested_get(data: dict[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = data
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def main() -> int:
    project_file = Path(os.getenv("PROJECT_CONFIG_FILE", "project_config.yml"))
    if project_file.exists():
        with open(project_file, "r", encoding="utf-8") as handle:
            config_data = yaml.safe_load(handle) or {}
    else:
        config_data = {}

    for env_name, path in ENV_TO_PATH.items():
        if os.getenv(env_name) is not None:
            continue

        value = nested_get(config_data, path)
        if value is None:
            value = DEFAULTS[env_name]

        if isinstance(value, bool):
            value = "true" if value else "false"

        print(f"export {env_name}={shlex.quote(str(value))}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
