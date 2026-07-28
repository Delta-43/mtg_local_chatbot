import logging
import re
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_chroma import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from config import Config
from scryfall_agent.scryfall_tools import get_mtg_card_oracle_text, search_mtg_cards

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

class MTGJudgeChain:
    def __init__(self):
        self.llm = ChatOllama(
            model=Config.LLM_MODEL,
            base_url=Config.OLLAMA_BASE_URL,
            temperature=0.1,
            # qwen3.5 is a reasoning model. On CPU it burns the whole token
            # budget on <think> tokens and returns an empty answer, so disable
            # thinking and cap output for fast, direct judge responses.
            reasoning=Config.LLM_REASONING,
            num_predict=Config.LLM_NUM_PREDICT,
            num_ctx=Config.LLM_NUM_CTX,
        )
        
        self.embeddings = OllamaEmbeddings(
            model=Config.EMBEDDING_MODEL,
            base_url=Config.OLLAMA_BASE_URL
        )
        
        self.vector_store = Chroma(
            collection_name=Config.CHROMA_COLLECTION_NAME,
            embedding_function=self.embeddings,
            persist_directory=Config.CHROMA_PERSIST_DIR
        )
        
        self.rules_retriever = self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 5}
        )
        
        self.card_name_pattern = re.compile(r'"([^"]+)"')
        
        self.router_prompt = ChatPromptTemplate.from_template(
            "You are a Magic: The Gathering rules classifier. "
            "Classify this query into one of: 'rules', 'card', 'both', or 'general'.\n"
            "- 'rules': Asks about game rules, mechanics, or interactions\n"
            "- 'card': Asks specifically what a card does\n"
            "- 'both': Asks how a card interacts with rules or other cards\n"
            "- 'general': Greeting, thanks, or non-MTG questions\n"
            "Query: {query}\n"
            "Respond with ONLY the classification word."
        )
        
        self.answer_prompt = ChatPromptTemplate.from_template(
            "You are an experienced Magic: The Gathering judge. "
            "Answer the player's question accurately using the provided context. "
            "If the context doesn't contain enough information, say so clearly. "
            "Always cite the relevant rule numbers when applicable.\n\n"
            "Rules Context:\n{rules_context}\n\n"
            "Card Information:\n{card_context}\n\n"
            "Player's Question: {query}\n\n"
            "Answer:"
        )
        
        self.answer_chain = self.answer_prompt | self.llm | StrOutputParser()
    
    def _extract_card_names(self, query: str) -> list[str]:
        quoted = self.card_name_pattern.findall(query)
        if quoted:
            return quoted
        
        known_cards = []
        words = query.split()
        for i in range(len(words)):
            for j in range(i+1, min(i+4, len(words)+1)):
                phrase = " ".join(words[i:j])
                if len(phrase) > 3:
                    try:
                        result = search_mtg_cards.invoke(phrase)
                        if "No cards found" not in result:
                            names = result.split("Top matches: ")[-1].split(", ")
                            known_cards.extend(names)
                    except:
                        pass
        return list(set(known_cards))[:3]
    
    def _classify_query(self, query: str) -> str:
        try:
            response = self.llm.invoke(self.router_prompt.format_prompt(query=query).to_string())
            classification = response.content.strip().lower()
            if classification in ['rules', 'card', 'both', 'general']:
                return classification
        except Exception as e:
            logger.warning(f"Classification failed: {e}. Defaulting to 'both'")
        return 'both'
    
    def query(self, user_query: str) -> ChatResponse:
        classification = self._classify_query(user_query)
        logger.info(f"Query classified as: {classification}")
        
        rules_context = ""
        card_context = ""
        sources = []
        used_card_lookup = False
        used_rules_lookup = False
        
        if classification in ['rules', 'both']:
            try:
                docs = self.rules_retriever.invoke(user_query)
                if docs:
                    rules_parts = []
                    for doc in docs:
                        rule_id = doc.metadata.get('rule_id', 'Unknown')
                        rules_parts.append(f"[{rule_id}] {doc.page_content}")
                    rules_context = "\n\n".join(rules_parts)
                    used_rules_lookup = True
                    sources = [f"Rule {doc.metadata.get('rule_id', 'Unknown')}" for doc in docs]
            except Exception as e:
                logger.error(f"Rules retrieval failed: {e}")
        
        if classification in ['card', 'both']:
            card_names = self._extract_card_names(user_query)
            if card_names:
                card_parts = []
                for name in card_names:
                    try:
                        card_info = get_mtg_card_oracle_text.invoke(name)
                        card_parts.append(card_info)
                        used_card_lookup = True
                        sources.append(f"Scryfall: {name}")
                    except Exception as e:
                        logger.warning(f"Card lookup failed for '{name}': {e}")
                card_context = "\n\n".join(card_parts)
        
        if classification == 'general':
            rules_context = "The user is greeting you or asking a general question. Respond warmly and offer to help with MTG rules questions."
        
        try:
            answer = self.answer_chain.invoke({
                "rules_context": rules_context or "No specific rules context retrieved.",
                "card_context": card_context or "No specific card information retrieved.",
                "query": user_query
            })
        except Exception as e:
            logger.error(f"Answer generation failed: {e}")
            answer = f"I apologize, but I encountered an error processing your question: {str(e)}"
        
        return ChatResponse(
            answer=answer,
            sources=list(set(sources)),
            used_card_lookup=used_card_lookup,
            used_rules_lookup=used_rules_lookup
        )

judge_chain = None

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    if judge_chain is None:
        raise HTTPException(status_code=503, detail="Service not ready. Please wait for initialization.")
    return judge_chain.query(request.query)

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model": Config.LLM_MODEL, "ready": judge_chain is not None}
