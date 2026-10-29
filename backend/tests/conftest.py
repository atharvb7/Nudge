import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    # Fast, offline, deterministic defaults. Individual tests override.
    monkeypatch.setenv("NUDGE_EMBEDDINGS", "keyword")
    monkeypatch.setenv("NUDGE_USE_OLLAMA", "0")
    monkeypatch.setenv("NUDGE_ALLOW_CLOUD", "0")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app import llm, retrieval

    retrieval.reset_retriever()
    llm._health_cache.update(at=0.0, value=None)
    yield
    retrieval.reset_retriever()


@pytest.fixture
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def mock_llm(monkeypatch):
    """Replace the LLM with a scripted list of replies (dicts)."""
    from app import llm

    calls = []

    def install(*replies):
        queue = list(replies)

        async def fake(messages, prefer=None):
            calls.append(messages)
            if not queue:
                raise llm.LLMUnavailable("script exhausted")
            reply = queue.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply, "ollama"

        monkeypatch.setattr(llm, "chat_json", fake)
        return calls

    return install
