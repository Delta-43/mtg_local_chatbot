import logging

import requests
import trafilatura
from langchain_community.utilities import SearxSearchWrapper
from langchain_core.tools import tool

from core_config import Config

logger = logging.getLogger(__name__)

_WEB_SEARCH_USER_AGENT = "MTG-Judge-Chatbot/1.0 (+https://github.com/mtg-judge)"


def _fetch_and_extract(url: str) -> str | None:
    try:
        response = requests.get(
            url, headers={"User-Agent": _WEB_SEARCH_USER_AGENT}, timeout=10
        )
        response.raise_for_status()
        extracted = trafilatura.extract(response.text)
        return extracted.strip() if extracted else None
    except Exception as exc:
        logger.warning("Failed to fetch/extract %s: %s", url, exc)
        return None


@tool
def web_search(query: str) -> str:
    """Search the public web for Magic: The Gathering judge verdicts, forum
    discussion, and rulings commentary not captured by the Comprehensive Rules
    text or Scryfall's official rulings. Use this ONLY for interactions that are
    ambiguous, contested, or not clearly resolved by search_rules /
    get_card_rulings first -- e.g. complex multi-card timing/priority
    interactions the community has debated. Always cite the returned source
    URL(s) when using information from this tool in the final answer."""
    try:
        # Internal docker-network SearXNG is plain HTTP; `unsecure=True` allows that
        # (equivalent to the wrapper's own http-scheme opt-in).
        searx = SearxSearchWrapper(searx_host=Config.SEARXNG_URL, unsecure=True)
        raw_results = searx.results(query, num_results=Config.WEB_SEARCH_MAX_RESULTS)
    except Exception as exc:
        logger.error("SearXNG search failed: %s", exc)
        return f"Web search is currently unavailable: {exc}"

    # SearxSearchWrapper.results() returns [{"Result": "No good Search Result was
    # found"}] (a single sentinel dict, not an empty list) when nothing matches.
    if not raw_results or "link" not in raw_results[0]:
        return f"No web results found for '{query}'."

    blocks = []
    for i, result in enumerate(raw_results):
        title = result.get("title", "Untitled")
        url = result.get("link", "")
        snippet = result.get("snippet", "")

        content = _fetch_and_extract(url) if url and i < Config.WEB_SEARCH_FETCH_TOP_N else None
        body = content or snippet or "(no content available)"
        blocks.append(f"{title} ({url})\n{body}")

    return "\n\n---\n\n".join(blocks)
