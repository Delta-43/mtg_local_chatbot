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
