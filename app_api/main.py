import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from core_config import Config
from llm_agent import MTGJudgeChain

logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global judge_chain
    logger.info("Initializing MTG Judge Chain...")
    judge_chain = MTGJudgeChain()
    logger.info("MTG Judge Chain initialized successfully.")
    yield
    logger.info("Shutting down MTG Judge Chatbot.")


app = FastAPI(
    title="MTG Judge Chatbot",
    description="AI-powered Magic: The Gathering rules judge",
    lifespan=lifespan,
)


class ChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = []
    used_card_lookup: bool = False
    used_rules_lookup: bool = False


judge_chain: MTGJudgeChain | None = None


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    if judge_chain is None:
        raise HTTPException(
            status_code=503, detail="Service not ready. Please wait for initialization."
        )
    return ChatResponse(**judge_chain.query(request.query))


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model": Config.LLM_MODEL,
        "ready": judge_chain is not None,
    }
