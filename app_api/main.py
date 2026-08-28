import asyncio
import json
import logging
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from core_config import Config
from llm_agent import MTGJudgeAgent, build_agent
from llm_agent.llm_provider import LLMConfigError

logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
logger = logging.getLogger(__name__)


def _rate_limit_key(request: Request) -> str:
    api_key = request.headers.get("X-API-Key")
    return api_key or get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)


def _init_usage_counters_db() -> None:
    Path(Config.CONVERSATION_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(Config.CONVERSATION_DB_PATH) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS usage_counters ("
            "bucket_key TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, "
            "PRIMARY KEY (bucket_key, day))"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global judge_agent
    logger.info("Initializing MTG Judge Agent (provider=%s)...", Config.LLM_PROVIDER)

    if Config.LLM_PROVIDER == "hosted" and not Config.OPENROUTER_API_KEY:
        raise LLMConfigError("LLM_PROVIDER=hosted but OPENROUTER_API_KEY is not set.")

    Path(Config.CONVERSATION_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    _init_usage_counters_db()
    async with AsyncSqliteSaver.from_conn_string(Config.CONVERSATION_DB_PATH) as saver:
        judge_agent = await build_agent(checkpointer=saver)
        logger.info("MTG Judge Agent initialized successfully.")
        yield
    logger.info("Shutting down MTG Judge Chatbot.")


app = FastAPI(
    title="MTG Judge Chatbot",
    description="AI-powered Magic: The Gathering rules judge",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

if Config.CORS_ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=Config.CORS_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


class ChatRequest(BaseModel):
    query: str = Field(..., max_length=2000)
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: dict[str, list[str]] = {"rules": [], "rulings": [], "web_links": [], "images": []}
    conversation_id: str


judge_agent: MTGJudgeAgent | None = None


def _authenticate(request: Request) -> bool:
    """True if the request carries a valid API key (authenticated tier: e.g. the
    Discord bot). False for keyless callers (anonymous tier: the public PWA,
    which can't keep a client-side key secret) -- allowed through, not rejected,
    but subject to a stricter daily quota. Only raises when a key IS present but
    doesn't match -- a caller that tries and fails a key is rejected outright,
    not silently downgraded to anonymous."""
    api_key = request.headers.get("X-API-Key")
    if api_key is None:
        return False
    if Config.API_KEYS and api_key not in Config.API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return bool(Config.API_KEYS)


def _check_and_increment_quota(bucket_key: str, authenticated: bool) -> None:
    limit = Config.DAILY_QUOTA_AUTHENTICATED if authenticated else Config.DAILY_QUOTA_ANONYMOUS
    day = datetime.now(timezone.utc).date().isoformat()
    with sqlite3.connect(Config.CONVERSATION_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO usage_counters (bucket_key, day, count) VALUES (?, ?, 1) "
            "ON CONFLICT(bucket_key, day) DO UPDATE SET count = count + 1",
            (bucket_key, day),
        )
        count = conn.execute(
            "SELECT count FROM usage_counters WHERE bucket_key = ? AND day = ?",
            (bucket_key, day),
        ).fetchone()[0]
    if count > limit:
        raise HTTPException(status_code=429, detail="Daily request quota exceeded.")


async def _validate_chat_request(request: Request, chat_request: ChatRequest) -> tuple[str, bool]:
    """Shared pre-checks for /chat and /chat/stream. Returns (thread_id, authenticated)."""
    authenticated = _authenticate(request)
    # sqlite3 is sync -- run off the event loop, mirroring _check_mcp_health below.
    await asyncio.to_thread(_check_and_increment_quota, _rate_limit_key(request), authenticated)
    if not chat_request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    if judge_agent is None:
        raise HTTPException(
            status_code=503, detail="Service not ready. Please wait for initialization."
        )
    thread_id = chat_request.conversation_id or uuid.uuid4().hex
    return thread_id, authenticated


@app.post("/chat", response_model=ChatResponse)
@limiter.limit(f"{Config.RATE_LIMIT_PER_MINUTE}/minute")
async def chat(request: Request, chat_request: ChatRequest):
    thread_id, _authenticated = await _validate_chat_request(request, chat_request)
    result = await judge_agent.query(chat_request.query, thread_id=thread_id)
    return ChatResponse(**result, conversation_id=thread_id)


async def _sse_chat_events(user_query: str, thread_id: str):
    try:
        async for kind, payload in judge_agent.stream_tokens(user_query, thread_id=thread_id):
            if kind == "token":
                yield f"event: token\ndata: {json.dumps({'text': payload})}\n\n"
            elif kind == "error":
                yield f"event: error\ndata: {json.dumps({'message': payload})}\n\n"
                return
            elif kind == "sources":
                yield f"event: sources\ndata: {json.dumps(payload)}\n\n"
    except Exception:
        logger.exception("Streaming agent run failed for query: %r", user_query)
        yield f"event: error\ndata: {json.dumps({'message': 'I ran into an error processing your question. Please try again.'})}\n\n"
        return
    yield f"event: done\ndata: {json.dumps({'conversation_id': thread_id})}\n\n"


@app.post("/chat/stream")
@limiter.limit(f"{Config.RATE_LIMIT_PER_MINUTE}/minute")
async def chat_stream(request: Request, chat_request: ChatRequest):
    thread_id, _authenticated = await _validate_chat_request(request, chat_request)
    return StreamingResponse(
        _sse_chat_events(chat_request.query, thread_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _mcp_health_url(mcp_url: str) -> str:
    base = mcp_url.rsplit("/mcp", 1)[0]
    return f"{base}/health"


def _check_mcp_health(url: str) -> bool:
    try:
        response = requests.get(_mcp_health_url(url), timeout=2)
        return response.status_code == 200
    except requests.exceptions.RequestException:
        return False


@app.get("/health")
async def health_check():
    names = ("rules_mcp", "scryfall_mcp")
    urls = (Config.RULES_MCP_URL, Config.SCRYFALL_MCP_URL)
    # requests is sync -- run the checks off the event loop rather than blocking it.
    results = await asyncio.gather(*(asyncio.to_thread(_check_mcp_health, url) for url in urls))
    mcp_status = dict(zip(names, results))

    return {
        "status": "healthy",
        "provider": Config.LLM_PROVIDER,
        "ready": judge_agent is not None,
        "mcp_servers": mcp_status,
    }
