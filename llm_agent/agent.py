import logging
import re
from typing import Any

from langchain.agents import create_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

from core_config import Config
from llm_agent.llm_provider import build_chat_model
from llm_agent.web_search_tool import web_search
from scryfall_agent.scryfall_tools import get_card_rulings

logger = logging.getLogger(__name__)

JUDGE_SYSTEM_PROMPT = (
    "You are an experienced Magic: The Gathering judge. Answer the player's "
    "question accurately using ONLY information returned by your tools -- never "
    "rely on memorized card text or rules text, since it can be outdated or wrong.\n\n"
    "Workflow:\n"
    "1. For rules questions, call search_rules first.\n"
    "2. For card-specific questions, use scryfall-mcp's card tools (search_cards, "
    "get_card, etc.) for oracle text/legality/pricing, and get_card_rulings for "
    "official rulings on that card.\n"
    "3. Only call web_search when a question is ambiguous, contested, or not "
    "clearly resolved by rules text or official rulings -- e.g. complex multi-card "
    "timing/priority interactions the community has debated. Do not use it for "
    "questions search_rules or get_card_rulings can already answer.\n\n"
    "Every final answer MUST end with a citation block listing:\n"
    "- Rule number(s) used (from search_rules results)\n"
    "- Official ruling(s) used, if any (from get_card_rulings)\n"
    "- Source URL(s), if web_search was used\n"
    "If you cannot ground part of the answer in a tool result, say so explicitly "
    "instead of guessing rather than filling the gap from memory."
)

# Tool-output shapes we parse citations back out of:
#   search_rules      -> "[rule_id] text" blocks
#   get_card_rulings   -> "Official rulings for {card}:\n- (date) comment" or a
#                          "No official rulings found..." / error string
#   web_search          -> "{title} (https://...)\n{content}" blocks
_RULE_ID_PATTERN = re.compile(r"^\[([^\]]+)\]", re.MULTILINE)
_RULING_CARD_PATTERN = re.compile(r"^Official rulings for ([^:]+):")
_URL_PATTERN = re.compile(r"\((https?://[^)\s]+)\)")


def _content_to_text(content: Any) -> str:
    """Tool message content is a plain str for our in-process @tools (get_card_rulings,
    web_search), but MCP-sourced tools (search_rules, via langchain-mcp-adapters) return
    a list of content blocks (e.g. [{"type": "text", "text": "..."}]) instead -- stringify
    that list directly and every regex below matches into the Python repr, not the text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and "text" in block:
                parts.append(block["text"])
            else:
                parts.append(str(block))
        return "\n".join(parts)
    return str(content)


def _extract_sources(messages: list) -> dict[str, list[str]]:
    rules: set[str] = set()
    rulings: set[str] = set()
    web_links: set[str] = set()

    for message in messages:
        if getattr(message, "type", None) != "tool":
            continue
        name = getattr(message, "name", None)
        content = _content_to_text(message.content)

        if name == "search_rules":
            rules.update(_RULE_ID_PATTERN.findall(content))
        elif name == "get_card_rulings":
            match = _RULING_CARD_PATTERN.search(content)
            if match:
                rulings.add(match.group(1).strip())
        elif name == "web_search":
            web_links.update(_URL_PATTERN.findall(content))

    return {
        "rules": sorted(rules),
        "rulings": sorted(rulings),
        "web_links": sorted(web_links),
    }


class MTGJudgeAgent:
    """Wraps the compiled tool-calling agent graph with the query() interface the
    rest of the app expects (mirrors the old MTGJudgeChain.query shape, but async
    and with structured, tool-derived citations instead of hand-set flags)."""

    def __init__(self, agent, mcp_client: MultiServerMCPClient):
        self._agent = agent
        self._mcp_client = mcp_client  # kept referenced for the process lifetime

    async def query(self, user_query: str) -> dict[str, Any]:
        try:
            result = await self._agent.ainvoke(
                {"messages": [{"role": "user", "content": user_query}]}
            )
        except Exception:
            logger.exception("Agent run failed for query: %r", user_query)
            return {
                "answer": "I ran into an error processing your question. Please try again.",
                "sources": {"rules": [], "rulings": [], "web_links": []},
            }

        messages = result.get("messages", [])
        answer = messages[-1].content if messages else ""
        return {
            "answer": answer,
            "sources": _extract_sources(messages),
        }


async def build_agent() -> MTGJudgeAgent:
    mcp_client = MultiServerMCPClient(
        {
            "rules": {"url": Config.RULES_MCP_URL, "transport": "streamable_http"},
            "scryfall": {"url": Config.SCRYFALL_MCP_URL, "transport": "streamable_http"},
        }
    )
    mcp_tools = await mcp_client.get_tools()
    tools = [*mcp_tools, get_card_rulings, web_search]

    model = build_chat_model()
    agent = create_agent(model=model, tools=tools, system_prompt=JUDGE_SYSTEM_PROMPT)

    logger.info(
        "MTG judge agent ready with %d tools (provider=%s): %s",
        len(tools),
        Config.LLM_PROVIDER,
        [getattr(t, "name", str(t)) for t in tools],
    )
    return MTGJudgeAgent(agent, mcp_client)
