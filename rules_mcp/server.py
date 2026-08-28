import logging
from pathlib import Path

from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings
# NOTE: pinned to mcp<2 (see requirements.txt) to match langchain-mcp-adapters,
# which as of this writing still requires mcp<2.0.0. mcp v2 renamed this class to
# MCPServer (mcp.server.mcpserver) -- revisit this import once
# langchain-mcp-adapters supports mcp v2.
from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from .ingestor import INGEST_MARKER, RulesIngestor
from .parser import refresh_if_needed
from .settings import Settings as Config

logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
logger = logging.getLogger(__name__)

mcp = FastMCP("mtg-rules", host=Config.HTTP_HOST, port=Config.HTTP_PORT)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "healthy"})

# Built lazily (see _get_vector_store) so it's only opened *after* _bootstrap() has
# finished any recreate=True rebuild — opening it earlier and then having ingest()
# rmtree the persist dir out from under an already-open Chroma client is asking for
# stale-handle trouble.
_vector_store: Chroma | None = None


def _get_vector_store() -> Chroma:
    global _vector_store
    if _vector_store is None:
        embeddings = OllamaEmbeddings(model=Config.EMBEDDING_MODEL, base_url=Config.OLLAMA_BASE_URL)
        _vector_store = Chroma(
            collection_name=Config.CHROMA_COLLECTION_NAME,
            embedding_function=embeddings,
            persist_directory=Config.CHROMA_PERSIST_DIR,
        )
    return _vector_store


@mcp.tool()
def search_rules(query: str, section: str | None = None, k: int = 5) -> str:
    """Semantically search the Magic: The Gathering Comprehensive Rules.

    Args:
        query: Natural-language rules question or interaction to search for.
        section: Optional chapter/section number to restrict results to (e.g. "704").
        k: Max number of matching rule chunks to return (default 5, max 10).
    """
    search_kwargs: dict = {"k": max(1, min(k, 10))}
    if section:
        search_kwargs["filter"] = {"section_id": section}

    retriever = _get_vector_store().as_retriever(search_type="similarity", search_kwargs=search_kwargs)
    docs = retriever.invoke(query)

    if not docs:
        message = f"No rules found matching '{query}'"
        if section:
            message += f" in section {section}"
        return message + "."

    parts = []
    for doc in docs:
        rule_id = doc.metadata.get("rule_id", "Unknown")
        parts.append(f"[{rule_id}] {doc.page_content}")
    return "\n\n".join(parts)


def _index_is_empty() -> bool:
    # Checked via the ingest-complete marker file rather than by opening a Chroma
    # client: chromadb caches system state per persist_directory within a
    # process, so a client opened here just to read a count would leave the
    # *next* client (ingest()'s own, after recreate=True wipes and rebuilds this
    # same path) stuck against stale state -- writes fail with "attempt to write
    # a readonly database". See INGEST_MARKER in ingestor.py.
    return not (Path(Config.CHROMA_PERSIST_DIR) / INGEST_MARKER).exists()


def _bootstrap() -> None:
    """Refresh the rules PDF/JSON and (re)ingest into Chroma only when something
    actually changed, so a container restart doesn't re-embed the collection
    every time. The ingest itself is incremental (see RulesIngestor.ingest): a
    Comprehensive Rules update only re-embeds the rules whose text actually
    changed, tracked via a content-hash manifest -- not the whole collection.
    A genuinely empty index takes the same code path and just finds everything
    "new", since there's no prior manifest to diff against."""
    if not Config.REFRESH_ON_BOOT:
        return
    try:
        json_updated = refresh_if_needed()
        chroma_is_empty = _index_is_empty()
        if json_updated or chroma_is_empty:
            logger.info("Ingesting rules into ChromaDB (updated=%s, empty=%s)...", json_updated, chroma_is_empty)
            RulesIngestor().ingest()
        else:
            logger.info("Rules index already current; skipping ingest.")
    except Exception:
        logger.exception("Rules refresh/ingest on boot failed; serving with existing index if present.")


def main():
    _bootstrap()
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
