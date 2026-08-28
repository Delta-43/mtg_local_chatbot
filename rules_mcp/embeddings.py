import logging

from langchain_core.embeddings import Embeddings

from .settings import Settings as Config

logger = logging.getLogger(__name__)


def embedding_signature() -> str:
    """Stable string identifying which embedding provider+model is currently
    configured -- used by ingestor.py to detect a provider switch and force a
    full re-embed instead of silently mixing incompatible vector spaces
    within one collection (see ingest()'s manifest-mismatch check)."""
    if Config.EMBEDDING_PROVIDER == "hosted":
        return f"hosted:{Config.OPENROUTER_EMBEDDING_MODEL}"
    return f"local:{Config.EMBEDDING_MODEL}"


def build_embeddings() -> Embeddings:
    """Pluggable embedding provider. EMBEDDING_PROVIDER=local (default) uses
    the dedicated Ollama instance; =hosted uses OpenRouter's OpenAI-compatible
    /embeddings endpoint (e.g. baai/bge-m3) -- useful on slower/low-core
    hardware where local embedding compute, not request queueing, is the
    bottleneck (concurrency alone doesn't fix that -- see CLAUDE.md)."""
    if Config.EMBEDDING_PROVIDER == "hosted":
        from langchain_openai import OpenAIEmbeddings

        if not Config.OPENROUTER_EMBEDDING_API_KEY:
            raise RuntimeError("EMBEDDING_PROVIDER=hosted requires OPENROUTER_EMBEDDING_API_KEY to be set.")
        logger.info("Using hosted embeddings via OpenRouter: %s", Config.OPENROUTER_EMBEDDING_MODEL)
        return OpenAIEmbeddings(
            model=Config.OPENROUTER_EMBEDDING_MODEL,
            api_key=Config.OPENROUTER_EMBEDDING_API_KEY,
            base_url=Config.OPENROUTER_BASE_URL,
            # bge-m3 isn't an OpenAI model -- tiktoken-based pre-tokenization
            # (langchain_openai's default) doesn't know its encoding. Send
            # raw strings to the API instead of pre-tokenized integer arrays.
            check_embedding_ctx_length=False,
        )

    from langchain_ollama import OllamaEmbeddings

    logger.info("Using local embeddings via Ollama: %s", Config.EMBEDDING_MODEL)
    return OllamaEmbeddings(model=Config.EMBEDDING_MODEL, base_url=Config.OLLAMA_BASE_URL)
