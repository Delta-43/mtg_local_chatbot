import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

class Config:
    OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    LLM_MODEL = os.getenv("LLM_MODEL", "qwen3.5:0.8b")
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "mxbai-embed-large")

    # Reasoning models (qwen3.x) emit <think> tokens first. On CPU-only hardware
    # this exhausts the token budget before any visible answer is produced, so
    # thinking is disabled by default. Set LLM_REASONING=true to re-enable.
    LLM_REASONING = os.getenv("LLM_REASONING", "false").lower() in ("1", "true", "yes")
    LLM_NUM_PREDICT = int(os.getenv("LLM_NUM_PREDICT", "512"))
    LLM_NUM_CTX = int(os.getenv("LLM_NUM_CTX", "4096"))

    CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
    CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "mtg_rules")

    PDF_PARSER_DIR = os.getenv("PDF_PARSER_DIR", "./data/pdf_parser")
    RULES_PDF_FILENAME = os.getenv("RULES_PDF_FILENAME", "MagicCompRules.pdf")
    RULES_JSON_FILENAME = os.getenv("RULES_JSON_FILENAME", "MagicCompRule_parsed_hierarchical.json")

    SCRYFALL_API_BASE = os.getenv("SCRYFALL_API_BASE", "https://api.scryfall.com")

    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

    MTG_RULES_URL = os.getenv("MTG_RULES_URL", "https://media.wizards.com/2026/downloads/MagicCompRules%2020260417.pdf")
    MTG_RULES_INDEX_URL = os.getenv("MTG_RULES_INDEX_URL", "https://magic.wizards.com/en/rules")
