import json
import logging
import shutil
from pathlib import Path

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from .settings import Settings as Config

logger = logging.getLogger(__name__)

# Marks a persist dir as holding a fully-ingested collection. Checking for this
# file's existence (see server.py's _bootstrap) -- instead of opening a Chroma
# client just to read a count -- avoids a second PersistentClient touching this
# same path in-process: chromadb caches system state per path, so a throwaway
# client opened before ingest() wipes and rebuilds the dir leaves the *next*
# client (ingest()'s own) stuck against stale state and failing writes with
# "attempt to write a readonly database".
INGEST_MARKER = ".ingest_complete"


class RulesIngestor:
    def __init__(self):
        self.data_dir = Path(Config.PDF_PARSER_DIR)
        self.json_path = self.data_dir / Config.RULES_JSON_FILENAME
        self.chroma_dir = Path(Config.CHROMA_PERSIST_DIR)
        self.chroma_dir.mkdir(parents=True, exist_ok=True)

        self.embeddings = OllamaEmbeddings(
            model=Config.EMBEDDING_MODEL,
            base_url=Config.OLLAMA_BASE_URL,
        )

        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=800,
            chunk_overlap=150,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

    def _flatten_rules(self) -> list[Document]:
        if not self.json_path.exists():
            logger.error("JSON file not found: %s", self.json_path)
            return []

        with open(self.json_path, "r", encoding="utf-8") as handle:
            hierarchy = json.load(handle)

        documents: list[Document] = []
        for chapter in hierarchy:
            chapter_heading = chapter.get("heading", "")
            for section in chapter.get("sections", []):
                section_title = section.get("section_title", "")
                section_id = section.get("section_id", "")
                for rule in section.get("rules", []):
                    rule_id = rule.get("rule_id", "")
                    rule_text = rule.get("text", "")
                    subrules = rule.get("subrules", [])

                    context = f"{chapter_heading} > {section_id}. {section_title} > {rule_id}."
                    full_text = f"{context}\n{rule_text}"

                    if subrules:
                        for sub in subrules:
                            sub_id = sub.get("subrule_id", "")
                            sub_text = sub.get("text", "")
                            full_text += f"\n{sub_id}. {sub_text}"

                    chunked = self.text_splitter.split_text(full_text)
                    for chunk in chunked:
                        documents.append(
                            Document(
                                page_content=chunk,
                                metadata={
                                    "chapter": chapter_heading,
                                    "section_id": section_id,
                                    "section_title": section_title,
                                    "rule_id": rule_id,
                                    "type": "rule",
                                },
                            )
                        )

        logger.info("Flattened and chunked %s rule documents from JSON.", len(documents))
        return documents

    def ingest(self, recreate: bool = False) -> Chroma | None:
        if recreate and self.chroma_dir.exists():
            logger.info("Clearing existing ChromaDB contents at %s", self.chroma_dir)
            # Clear contents rather than rmtree-ing the directory itself: in Docker
            # it's a bind-mount point, and removing a mount point raises
            # "Device or resource busy".
            for child in self.chroma_dir.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()

        documents = self._flatten_rules()
        if not documents:
            logger.error("No documents to ingest.")
            return None

        logger.info("Creating Chroma vector store...")
        vector_store = Chroma(
            collection_name=Config.CHROMA_COLLECTION_NAME,
            embedding_function=self.embeddings,
            persist_directory=str(self.chroma_dir),
        )

        batch_size = 50
        total_batches = (len(documents) + batch_size - 1) // batch_size
        for i in range(0, len(documents), batch_size):
            batch = documents[i : i + batch_size]
            vector_store.add_documents(batch)
            logger.info("Ingested batch %s/%s", i // batch_size + 1, total_batches)

        (self.chroma_dir / INGEST_MARKER).write_text(str(len(documents)))
        logger.info("ChromaDB ingestion complete. Collection: %s", Config.CHROMA_COLLECTION_NAME)
        return vector_store


def main():
    logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
    RulesIngestor().ingest(recreate=True)


if __name__ == "__main__":
    main()
