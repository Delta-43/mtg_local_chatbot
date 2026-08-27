from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from core_config import Config


class LLMConfigError(RuntimeError):
    """Raised when the selected LLM_PROVIDER is missing required configuration."""


def build_chat_model():
    """Construct the chat model for the configured provider.

    Config.LLM_PROVIDER selects between a local Ollama model and a hosted model
    via OpenRouter (OpenAI-API-compatible), so the same agent code runs whether or
    not the deployment has access to local GPU/CPU inference.
    """
    if Config.LLM_PROVIDER == "hosted":
        if not Config.OPENROUTER_API_KEY:
            raise LLMConfigError(
                "LLM_PROVIDER=hosted but OPENROUTER_API_KEY is not set."
            )
        return ChatOpenAI(
            base_url=Config.OPENROUTER_BASE_URL,
            api_key=Config.OPENROUTER_API_KEY,
            model=Config.OPENROUTER_MODEL,
            temperature=0.1,
        )

    return ChatOllama(
        model=Config.LLM_MODEL,
        base_url=Config.OLLAMA_BASE_URL,
        temperature=0.1,
        reasoning=Config.LLM_REASONING,
        num_predict=Config.LLM_NUM_PREDICT,
        num_ctx=Config.LLM_NUM_CTX,
    )
