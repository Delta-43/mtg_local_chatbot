import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from core_config import Config
from llm_agent import MTGJudgeAgent, build_agent
from llm_agent.llm_provider import LLMConfigError

logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
logger = logging.getLogger(__name__)

STATIC_DIR: Path = Path(__file__).resolve().parent / "static"
INDEX_FILE: Path = STATIC_DIR / "index.html"


def _rate_limit_key(request: Request) -> str:
    api_key = request.headers.get("X-API-Key")
    return api_key or get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global judge_agent
    logger.info("Initializing MTG Judge Agent (provider=%s)...", Config.LLM_PROVIDER)

    if Config.LLM_PROVIDER == "hosted" and not Config.OPENROUTER_API_KEY:
        raise LLMConfigError("LLM_PROVIDER=hosted but OPENROUTER_API_KEY is not set.")

    judge_agent = await build_agent()
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

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class ChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: dict[str, list[str]] = {"rules": [], "rulings": [], "web_links": []}


judge_agent: MTGJudgeAgent | None = None


def _require_api_key(request: Request) -> None:
    if not Config.API_KEYS:
        return  # auth disabled -- default for local/dev use
    if request.headers.get("X-API-Key") not in Config.API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.get("/", response_class=FileResponse, include_in_schema=False)
async def serve_index() -> FileResponse:
    """Provides a zero-build browser test harness for developers to interact with the MTG Judge Chatbot.

    Serving this lightweight single-page interface directly from FastAPI eliminates external CDN
    dependencies, avoids separate build pipelines, and allows manual testing in both host and
    containerized deployment environments.
    """
    if not INDEX_FILE.is_file():
        raise HTTPException(status_code=404, detail="Frontend test UI not found")
    return FileResponse(
        INDEX_FILE,
        media_type="text/html",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.post("/chat", response_model=ChatResponse)
@limiter.limit(f"{Config.RATE_LIMIT_PER_MINUTE}/minute")
async def chat(request: Request, chat_request: ChatRequest) -> ChatResponse:
    """Processes user rules questions by invoking the MTG Judge LLM agent and returning verified citations.

    Enforces rate limits and API key authorization to protect LLM provider quotas and prevent service
    exhaustion during interactive queries.
    """
    _require_api_key(request)
    if not chat_request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    if judge_agent is None:
        raise HTTPException(
            status_code=503, detail="Service not ready. Please wait for initialization."
        )
    result = await judge_agent.query(chat_request.query)
    return ChatResponse(**result)


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
async def health_check() -> dict[str, str | bool | dict[str, bool]]:
    """Reports overall system availability and upstream MCP server connectivity.

    Allows orchestration harnesses and frontends to verify that rules and card database backends
    are responsive before issuing rules queries.
    """
    names = ("rules_mcp", "scryfall_mcp")
    urls = (Config.RULES_MCP_URL, Config.SCRYFALL_MCP_URL)
    # requests is sync -- run the checks off the event loop rather than blocking it.
    results = await asyncio.gather(*(asyncio.to_thread(_check_mcp_health, url) for url in urls))
    mcp_status: dict[str, bool] = dict(zip(names, results))

    return {
        "status": "healthy",
        "provider": Config.LLM_PROVIDER,
        "ready": judge_agent is not None,
        "mcp_servers": mcp_status,
    }
