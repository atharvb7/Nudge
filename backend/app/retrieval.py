"""Semantic retrieval over strategy cards.

Preferred: all-MiniLM-L6-v2 embeddings in ChromaDB (persisted to backend/.chroma).
Fallback: a small pure-Python TF-IDF cosine retriever with a few study-domain
synonyms, so the backend works with only the core requirements installed.

Both return raw similarity per card id in [0, 1]. Initialisation is lazy and
never raises: any failure in the ML path permanently drops to keyword mode.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
from collections import Counter
from typing import Protocol

from .config import get_settings
from .strategies import Card, load_cards

log = logging.getLogger("nudge.retrieval")

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


class Retriever(Protocol):
    name: str

    def similarities(self, query: str) -> dict[str, float]: ...


# ---------------------------------------------------------------- keyword ---

_STOP = {
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with", "is", "it", "this", "that",
    "i", "im", "i'm", "me", "my", "you", "your", "be", "am", "are", "was", "at", "as", "so", "just",
    "do", "dont", "can", "cant", "can't", "have", "has", "get", "got", "need", "want", "really", "very",
    "one", "then", "if", "but", "not", "no", "all", "any", "up", "out", "by", "from", "task",
}

# Map everyday student words onto the vocabulary the cards use.
_SYNONYMS: dict[str, list[str]] = {
    "essay": ["writing", "draft", "sentence", "blank"],
    "report": ["writing", "draft", "structure"],
    "write": ["writing", "draft", "sentence"],
    "thesis": ["writing", "structure", "draft"],
    "assignment": ["assignment", "instructions", "question"],
    "homework": ["assignment", "question"],
    "pdf": ["reading", "read", "paragraph", "open"],
    "chapter": ["reading", "paragraph", "study"],
    "read": ["reading", "paragraph", "highlight"],
    "notes": ["reading", "study", "highlight"],
    "lecture": ["reading", "study", "example"],
    "exam": ["study", "question", "checklist"],
    "study": ["study", "reading", "question"],
    "revise": ["study", "reading", "highlight"],
    "code": ["screen", "example", "concrete"],
    "bug": ["screen", "example", "question"],
    "program": ["screen", "example"],
    "email": ["social", "message", "help"],
    "message": ["social", "message"],
    "overwhelmed": ["overwhelm", "brain", "dump", "calm", "sensory"],
    "overwhelm": ["overwhelm", "brain", "dump", "calm"],
    "loud": ["sensory", "noise", "calm", "headphones"],
    "noisy": ["sensory", "noise", "sound"],
    "tired": ["rest", "body", "water", "pause"],
    "exhausted": ["rest", "body", "pause"],
    "sleepy": ["rest", "body", "movement"],
    "bored": ["interest", "novelty", "gamify", "game"],
    "boring": ["interest", "novelty", "gamify", "game"],
    "restless": ["movement", "fidget", "sensory"],
    "perfect": ["perfectionism", "ugly", "draft"],
    "perfectionism": ["perfectionism", "ugly", "draft"],
    "confused": ["clarity", "question", "example"],
    "lost": ["clarity", "question", "example"],
    "alone": ["company", "body-double", "presence"],
    "lonely": ["company", "body-double", "presence"],
    "phone": ["phone", "distraction"],
    "music": ["music", "sound", "song"],
    "start": ["start", "open", "smallest"],
}


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(text: str, expand: bool = False) -> list[str]:
    words = re.findall(r"[a-z0-9][a-z0-9'\-]*", (text or "").lower())
    out: list[str] = []
    for w in words:
        w = w.strip("'-")
        if not w or w in _STOP:
            continue
        out.append(_stem(w))
        if expand and w in _SYNONYMS:
            out.extend(_stem(s) for s in _SYNONYMS[w])
    return out


class KeywordRetriever:
    name = "keyword"

    def __init__(self, cards: tuple[Card, ...]):
        self.ids = [c.id for c in cards]
        docs = [Counter(tokenize(c.document())) for c in cards]
        n = len(docs)
        df: Counter[str] = Counter()
        for d in docs:
            df.update(d.keys())
        self.idf = {t: math.log((1 + n) / (1 + f)) + 1.0 for t, f in df.items()}
        self.vectors = [self._weigh(d) for d in docs]

    def _weigh(self, tf: Counter[str]) -> dict[str, float]:
        vec = {t: (1 + math.log(c)) * self.idf.get(t, 0.0) for t, c in tf.items() if t in self.idf}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        return {t: v / norm for t, v in vec.items()}

    def similarities(self, query: str) -> dict[str, float]:
        q = self._weigh(Counter(tokenize(query, expand=True)))
        if not q:
            return {}
        return {cid: sum(w * vec.get(t, 0.0) for t, w in q.items()) for cid, vec in zip(self.ids, self.vectors)}


# ------------------------------------------------------------- embeddings ---


class ChromaRetriever:
    name = "minilm"

    def __init__(self, cards: tuple[Card, ...]):
        import chromadb  # noqa: WPS433 (optional dependency)
        from sentence_transformers import SentenceTransformer

        settings = get_settings()
        self.model = SentenceTransformer(MODEL_NAME)
        digest = hashlib.sha1("|".join(c.document() for c in cards).encode()).hexdigest()[:12]
        try:
            settings.chroma_dir.mkdir(parents=True, exist_ok=True)
            client = chromadb.PersistentClient(path=str(settings.chroma_dir))
        except Exception:  # read-only FS etc.
            client = chromadb.EphemeralClient()
        self.collection = client.get_or_create_collection(
            name=f"nudge_strategies_{digest}", metadata={"hnsw:space": "cosine"}
        )
        if self.collection.count() != len(cards):
            docs = [c.document() for c in cards]
            emb = self.model.encode(docs, normalize_embeddings=True).tolist()
            existing = self.collection.get()["ids"]
            if existing:
                self.collection.delete(ids=existing)
            self.collection.add(
                ids=[c.id for c in cards],
                documents=docs,
                embeddings=emb,
                metadatas=[{"min_energy": c.min_energy, "size": c.size} for c in cards],
            )
        self.n = len(cards)

    def similarities(self, query: str) -> dict[str, float]:
        if not query.strip():
            return {}
        q = self.model.encode([query], normalize_embeddings=True).tolist()
        res = self.collection.query(query_embeddings=q, n_results=self.n)
        ids, dists = res["ids"][0], res["distances"][0]
        # cosine distance in [0, 2] -> similarity in [0, 1]
        return {cid: max(0.0, 1.0 - d / 2.0) for cid, d in zip(ids, dists)}


# ---------------------------------------------------------------- factory ---
#
# The keyword retriever is always available instantly. The semantic one loads
# in a background thread (model download / embedding can take a while); until
# it is ready, requests are served by the keyword retriever so nothing blocks.

_lock = threading.Lock()
_keyword: KeywordRetriever | None = None
_semantic: Retriever | None = None
_semantic_state = "idle"  # idle | loading | ready | unavailable


def _load_semantic() -> None:
    global _semantic, _semantic_state
    try:
        r = ChromaRetriever(load_cards())
        with _lock:
            _semantic, _semantic_state = r, "ready"
        log.info("Semantic retrieval ready: MiniLM + Chroma")
    except Exception as exc:  # ImportError, no network for the model, etc.
        with _lock:
            _semantic_state = "unavailable"
        log.info("Semantic retrieval unavailable (%s); using keyword retriever", type(exc).__name__)


def warm_up(blocking: bool = False) -> None:
    """Start loading the semantic retriever if allowed. Never raises."""
    global _semantic_state
    if get_settings().embeddings == "keyword":
        return
    with _lock:
        if _semantic_state != "idle":
            return
        _semantic_state = "loading"
    if blocking:
        _load_semantic()
    else:
        threading.Thread(target=_load_semantic, name="nudge-embeddings", daemon=True).start()


def get_retriever() -> Retriever:
    global _keyword
    if get_settings().embeddings != "keyword" and _semantic is not None:
        return _semantic
    with _lock:
        if _keyword is None:
            _keyword = KeywordRetriever(load_cards())
        return _keyword


def reset_retriever() -> None:
    """For tests."""
    global _keyword, _semantic, _semantic_state
    with _lock:
        _keyword, _semantic, _semantic_state = None, None, "idle"


def retriever_name() -> str:
    return get_retriever().name
