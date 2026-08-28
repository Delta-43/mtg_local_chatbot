"""Thin wrapper over the backend's /chat endpoint. Uses the non-streaming
response, not /chat/stream -- coalescing a token stream into Discord message
edits fights Discord's own edit rate limits for no real UX gain, and
channel.typing() already gives a native "thinking" indicator for the blocking
wait (see PLAN.md's Discord section for the full rationale)."""

from typing import Any

import httpx

from .settings import Settings


class ChatApiError(Exception):
    pass


async def chat(query: str, conversation_id: str) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if Settings.API_KEY:
        headers["X-API-Key"] = Settings.API_KEY

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{Settings.API_BASE_URL}/chat",
                json={"query": query, "conversation_id": conversation_id},
                headers=headers,
            )
        except httpx.RequestError as exc:
            raise ChatApiError(f"Could not reach the judge API: {exc}") from exc

    if response.status_code == 429:
        raise ChatApiError("The judge is rate-limited right now -- try again in a bit.")
    if response.status_code == 401:
        raise ChatApiError("Bot is misconfigured (invalid API key). Ask an admin to check it.")
    if response.status_code != 200:
        raise ChatApiError(f"Judge API returned {response.status_code}.")

    return response.json()
