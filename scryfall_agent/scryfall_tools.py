import logging

import requests
from langchain_core.tools import tool

from core_config import Config

logger = logging.getLogger(__name__)


@tool
def get_card_rulings(card_name: str) -> str:
    """Get official Scryfall rulings for a specific Magic: The Gathering card.
    Input should be the exact (or close) name of the card.
    Returns any official rulings with their publication dates, useful for
    resolving card-specific interactions that aren't fully covered by the
    Comprehensive Rules text alone. Complements search_rules (rules-mcp) and
    scryfall-mcp's card-data tools, which don't expose rulings."""
    headers = {"Accept": "application/json", "User-Agent": Config.SCRYFALL_USER_AGENT}
    try:
        card_response = requests.get(
            f"{Config.SCRYFALL_API_BASE}/cards/named",
            params={"fuzzy": card_name},
            headers=headers,
            timeout=15,
        )
        card_response.raise_for_status()
        card = card_response.json()

        rulings_uri = card.get("rulings_uri")
        if not rulings_uri:
            return f"No rulings URI available for '{card.get('name', card_name)}'."

        rulings_response = requests.get(rulings_uri, headers=headers, timeout=15)
        rulings_response.raise_for_status()
        rulings = rulings_response.json().get("data", [])

        if not rulings:
            return f"No official rulings found for '{card.get('name', card_name)}'."

        formatted = "\n".join(
            f"- ({ruling.get('published_at', 'unknown date')}) {ruling.get('comment', '')}"
            for ruling in rulings
        )
        return f"Official rulings for {card.get('name', card_name)}:\n{formatted}"
    except requests.exceptions.RequestException as e:
        logger.error(f"Scryfall API error fetching rulings: {e}")
        return f"Error fetching rulings for '{card_name}': {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected error fetching rulings: {e}")
        return f"Card '{card_name}' not found or rulings API error."
