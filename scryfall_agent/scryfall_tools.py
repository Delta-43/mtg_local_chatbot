import logging
import requests
from typing import Optional
from langchain_core.tools import tool
from config import Config

logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
logger = logging.getLogger(__name__)

SCRYFALL_USER_AGENT = "MTG-Judge-Chatbot/1.0 (https://github.com/mtg-judge)"


@tool
def get_mtg_card_oracle_text(card_name: str) -> str:
    """Useful for when you need to know what a specific Magic The Gathering card does.
    Input should be the exact name of the card.
    Returns the card's oracle text, type line, and mana cost."""
    try:
        url = f"{Config.SCRYFALL_API_BASE}/cards/named"
        params = {"fuzzy": card_name}
        headers = {"Accept": "application/json", "User-Agent": SCRYFALL_USER_AGENT}
        
        response = requests.get(url, params=params, headers=headers, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        return (
            f"Card: {data.get('name')}\n"
            f"Mana Cost: {data.get('mana_cost', 'N/A')}\n"
            f"Type: {data.get('type_line', 'N/A')}\n"
            f"Oracle Text: {data.get('oracle_text', 'No oracle text available')}\n"
            f"Power/Toughness: {data.get('power', 'N/A')}/{data.get('toughness', 'N/A')}"
        )
    except requests.exceptions.RequestException as e:
        logger.error(f"Scryfall API error: {e}")
        return f"Error fetching card '{card_name}': {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected error fetching card: {e}")
        return f"Card '{card_name}' not found or API error."


@tool
def search_mtg_cards(query: str) -> str:
    """Search for Magic The Gathering cards by name or partial name.
    Input should be a search query (card name or partial name).
    Returns a list of matching card names."""
    try:
        url = f"{Config.SCRYFALL_API_BASE}/cards/search"
        params = {"q": query, "unique": "cards", "order": "name"}
        headers = {"Accept": "application/json", "User-Agent": SCRYFALL_USER_AGENT}
        
        response = requests.get(url, params=params, headers=headers, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        cards = data.get("data", [])
        
        if not cards:
            return f"No cards found matching '{query}'."
        
        matches = [card.get("name") for card in cards[:5]]
        return f"Found {len(cards)} cards matching '{query}'. Top matches: {', '.join(matches)}"
    except Exception as e:
        logger.error(f"Scryfall search error: {e}")
        return f"Error searching for '{query}': {str(e)}"
