import hashlib
import json
import logging
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
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

# Maps each top-level rule's stable id -> {"hash": content hash, "chunk_ids":
# [...]}, written after every successful ingest. Lets a later ingest() diff
# against what's already embedded and only re-embed rules whose text actually
# changed, instead of wiping and re-embedding the whole ~1300-chunk collection
# for every Comprehensive Rules update.
MANIFEST_FILE = ".ingest_manifest.json"


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

    def _collect_rules(self) -> list[dict]:
        """One record per top-level rule entry (its subrules folded into the same
        full_text, matching the old flattening), pre-chunking -- chunking happens
        in ingest() once we know whether the rule's content actually changed."""
        if not self.json_path.exists():
            logger.error("JSON file not found: %s", self.json_path)
            return []

        with open(self.json_path, "r", encoding="utf-8") as handle:
            hierarchy = json.load(handle)

        records: list[dict] = []
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

                    # rule_id is globally unique in the actual Comprehensive Rules,
                    # but fall back to a content hash for any malformed/blank entry
                    # so two such entries can't collide on the same stable id.
                    stable_id = rule_id or hashlib.sha1(full_text.encode("utf-8")).hexdigest()[:16]

                    records.append(
                        {
                            "id": stable_id,
                            "full_text": full_text,
                            "metadata": {
                                "chapter": chapter_heading,
                                "section_id": section_id,
                                "section_title": section_title,
                                "rule_id": rule_id,
                                "type": "rule",
                            },
                        }
                    )

        logger.info("Collected %s rule records from JSON.", len(records))
        return records

    def _load_manifest(self) -> dict:
        manifest_path = self.chroma_dir / MANIFEST_FILE
        if not manifest_path.exists():
            return {}
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("Couldn't read %s -- treating as no prior manifest.", manifest_path)
            return {}

    def _save_manifest(self, manifest: dict) -> None:
        (self.chroma_dir / MANIFEST_FILE).write_text(json.dumps(manifest), encoding="utf-8")

    def _embed_batch(self, docs: list[Document]) -> list[list[float]]:
        """Runs in a worker thread (see ingest()) -- pure computation/HTTP call
        against Ollama, no shared mutable state, safe to run concurrently."""
        return self.embeddings.embed_documents([d.page_content for d in docs])

    def ingest(self, recreate: bool = False) -> Chroma | None:
        """Upserts rules into Chroma, re-embedding only rules whose text actually
        changed since the last ingest (tracked via a content-hash manifest) --
        a Comprehensive Rules update no longer means re-embedding the whole
        ~1300-chunk collection. recreate=True wipes everything first (used for a
        manual forced rebuild, e.g. `python -m rules_mcp.ingestor`); a fresh/empty
        persist dir naturally takes the same "everything is new" path anyway,
        since there's no prior manifest to diff against.

        Embedding batches run concurrently, bounded by
        Config.INGEST_CONCURRENCY (default: available CPU cores, capped at
        8) instead of a fixed serial loop. Whether this actually speeds
        anything up depends on where Ollama's bottleneck is: measured on a
        4-core, CPU-only, no-GPU reference host, it made no measurable
        difference (serial and concurrent landed within ~2% of each other,
        with or without OLLAMA_NUM_PARALLEL raised on the Ollama side too)
        -- the bottleneck there is raw CPU compute for the embedding model
        itself, not request queueing. It's correct and harmless either way,
        and should genuinely help on hardware where queueing/latency (not
        raw compute) is the limiting factor -- more cores, GPU-backed
        embeddings, or a remote/high-latency Ollama instance."""
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

        records = self._collect_rules()
        if not records:
            logger.error("No documents to ingest.")
            return None

        logger.info("Creating Chroma vector store...")
        vector_store = Chroma(
            collection_name=Config.CHROMA_COLLECTION_NAME,
            embedding_function=self.embeddings,
            persist_directory=str(self.chroma_dir),
        )

        manifest = {} if recreate else self._load_manifest()
        new_manifest: dict = {}
        add_docs: list[Document] = []
        add_ids: list[str] = []
        delete_ids: list[str] = []
        seen_ids: set[str] = set()
        unchanged = 0

        for record in records:
            seen_ids.add(record["id"])
            content_hash = hashlib.sha256(record["full_text"].encode("utf-8")).hexdigest()
            prior = manifest.get(record["id"])
            if prior and prior["hash"] == content_hash:
                new_manifest[record["id"]] = prior
                unchanged += 1
                continue

            if prior:
                delete_ids.extend(prior["chunk_ids"])

            chunks = self.text_splitter.split_text(record["full_text"])
            chunk_ids = [f"{record['id']}::{i}" for i in range(len(chunks))]
            for chunk_id, chunk_text in zip(chunk_ids, chunks):
                add_ids.append(chunk_id)
                add_docs.append(Document(page_content=chunk_text, metadata=record["metadata"]))
            new_manifest[record["id"]] = {"hash": content_hash, "chunk_ids": chunk_ids}

        # Rules present in the last ingest but absent now (removed/renumbered).
        for old_id, old_entry in manifest.items():
            if old_id not in seen_ids:
                delete_ids.extend(old_entry["chunk_ids"])

        if delete_ids:
            vector_store.delete(ids=delete_ids)

        batch_size = 50
        id_batches = [add_ids[i : i + batch_size] for i in range(0, len(add_ids), batch_size)]
        doc_batches = [add_docs[i : i + batch_size] for i in range(0, len(add_docs), batch_size)]
        total_batches = len(doc_batches)

        # Embedding (the expensive, Ollama-bound part) is safe to run
        # concurrently across batches -- each call is independent and
        # stateless. The actual Chroma writes stay serialized in this thread
        # below, since chromadb's SQLite-backed collection isn't meant to be
        # written to concurrently from multiple threads.
        logger.info(
            "Ingesting %d batch(es) with concurrency=%d (cpu_count=%s)",
            total_batches,
            Config.INGEST_CONCURRENCY,
            os.cpu_count(),
        )
        with ThreadPoolExecutor(max_workers=Config.INGEST_CONCURRENCY) as pool:
            embedded = pool.map(self._embed_batch, doc_batches)
            for batch_num, (ids, docs, vectors) in enumerate(zip(id_batches, doc_batches, embedded), start=1):
                vector_store._collection.add(
                    ids=ids,
                    embeddings=vectors,
                    documents=[d.page_content for d in docs],
                    metadatas=[d.metadata for d in docs],
                )
                logger.info("Ingested batch %s/%s", batch_num, max(total_batches, 1))

        self._save_manifest(new_manifest)
        (self.chroma_dir / INGEST_MARKER).write_text(
            str(sum(len(entry["chunk_ids"]) for entry in new_manifest.values()))
        )
        logger.info(
            "ChromaDB ingestion complete. Collection: %s (%d rules unchanged, "
            "%d rules changed/new, %d stale chunks deleted, %d chunks added)",
            Config.CHROMA_COLLECTION_NAME,
            unchanged,
            len(records) - unchanged,
            len(delete_ids),
            len(add_docs),
        )
        return vector_store


def main():
    logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
    RulesIngestor().ingest(recreate=True)


if __name__ == "__main__":
    main()
