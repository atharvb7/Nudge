"""Hostile, sloppy or huge input must never crash the backend or break help."""

import concurrent.futures
import os
import time

import pytest

from app.strategies import cards_by_id

BUTTONS = ["done", "too_big", "smaller", "different", "rest"]


def ok_step(r):
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "coach"
    assert body["next_step"]
    assert body["buttons"] == BUTTONS
    return body


def test_malformed_json_is_a_clean_422(client):
    r = client.post("/sequence", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_empty_body_object_still_helps(client):
    ok_step(client.post("/sequence", json={}))


def test_missing_and_null_fields(client):
    ok_step(client.post("/sequence", json={"task": None, "transcript": None, "history": None, "top_strategies": None}))


@pytest.mark.parametrize("energy", [0, 6, -3, "3", "high", None, 2.7, 99999])
def test_energy_is_forgiving(client, energy):
    body = ok_step(client.post("/sequence", json={"task": "essay", "energy": energy}))
    assert body["size"] in ("tiny", "small")


@pytest.mark.parametrize(
    "field,value",
    [("state", "flow"), ("state", "PANIC"), ("action", "explode"), ("wording_style", "pirate"), ("state", 7)],
)
def test_unknown_enum_values_degrade_gently(client, field, value):
    ok_step(client.post("/sequence", json={"task": "essay", field: value}))


def test_huge_transcript_is_truncated_not_fatal(client):
    big = "I need to start my essay but everything is noisy. " * 2000  # ~100 KB
    t0 = time.perf_counter()
    body = ok_step(client.post("/sequence", json={"task": "essay", "transcript": big}))
    assert time.perf_counter() - t0 < 5
    assert len(body["next_step"]) < 400


def test_crisis_at_the_end_of_a_long_ramble_is_still_caught(client):
    ramble = "so much to do, the lab, the essay, emails. " * 400 + "honestly I want to die"
    r = client.post("/sequence", json={"task": "", "transcript": ramble}).json()
    assert r["mode"] == "safety"


def test_body_size_limit(client):
    r = client.post("/sequence", content=b'{"task":"' + b"a" * (2 * 1024 * 1024) + b'"}',
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


@pytest.mark.parametrize(
    "task",
    ["📚✨ essay 😩", "مقالة التاريخ", "निबंध लिखना है", "   ", "​​", "<script>alert(1)</script>", "{task}", "a" * 600],
)
def test_unicode_rtl_empty_and_odd_tasks(client, task):
    body = ok_step(client.post("/sequence", json={"task": task, "wording_style": "literal"}))
    assert "{task}" not in body["next_step"]


def test_history_with_unknown_strategy_ids(client):
    history = [{"step": "x", "outcome": "done", "strategy_id": "not_a_card"}, {"step": "", "strategy_id": None}]
    for action in ("next", "smaller", "different", "too_big", "start"):
        ok_step(client.post("/sequence", json={"task": "essay", "history": history, "action": action}))


@pytest.mark.parametrize("score", [-5, 3.2, 1e308, "0.9", None])
def test_odd_personal_scores(client, score):
    ok_step(client.post("/sequence", json={"task": "essay", "top_strategies": [{"id": "body_doubling", "score": score}]}))


def test_nan_and_infinity_scores(client):
    raw = b'{"task":"essay","top_strategies":[{"id":"body_doubling","score":NaN},{"id":"music_cue","score":Infinity}]}'
    r = client.post("/sequence", content=raw, headers={"content-type": "application/json"})
    # Strict JSON forbids NaN; either a clean 422 or a step is acceptable — never a 500.
    assert r.status_code in (200, 422)


def test_excluding_every_card_still_returns_a_step(client):
    every = list(cards_by_id())
    for energy in (1, 3, 5):
        for action in ("start", "different", "too_big"):
            ok_step(client.post("/sequence", json={"task": "essay", "exclude_ids": every, "energy": energy, "action": action}))


def test_many_list_items_are_capped(client):
    body = {
        "task": "essay",
        "recent_phrasings": ["x" * 300] * 500,
        "exclude_ids": [f"id{i}" for i in range(5000)],
        "top_strategies": [{"id": f"id{i}", "score": 0.5} for i in range(3000)],
        "history": [{"step": "y" * 2000, "strategy_id": "two_minute_start", "outcome": "done"}] * 200,
    }
    ok_step(client.post("/sequence", json=body))


def test_fifty_concurrent_requests(client):
    def one(i):
        return client.post("/sequence", json={"task": f"task {i}", "energy": (i % 5) + 1}).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        codes = list(ex.map(one, range(50)))
    assert codes == [200] * 50


def test_cors_allows_extension_and_dashboard_only(client):
    ext = "chrome-extension://" + "a" * 32
    pre = {"access-control-request-method": "POST", "access-control-request-headers": "content-type"}
    r = client.options("/sequence", headers={"origin": ext, **pre})
    assert r.headers.get("access-control-allow-origin") == ext
    r = client.options("/sequence", headers={"origin": "http://localhost:3000", **pre})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
    for bad in ("https://evil.example", "http://localhost.evil.com", "chrome-extension://short"):
        r = client.options("/sequence", headers={"origin": bad, **pre})
        assert "access-control-allow-origin" not in r.headers, bad


def test_transcribe_edge_cases(client):
    assert client.post("/transcribe").status_code in (422, 501)
    r = client.post("/transcribe", files={"audio": ("x.txt", b"hello", "text/plain")})
    assert r.status_code in (415, 501)


def test_transcribe_too_big_and_wrong_type_when_available(client, monkeypatch):
    from app import transcribe

    async def fake(data, suffix, lang):
        return "hello"

    monkeypatch.setattr(transcribe, "available", lambda: True)
    monkeypatch.setattr(transcribe, "transcribe_bytes", fake)
    assert client.post("/transcribe", files={"audio": ("a.webm", b"x" * 100, "audio/webm")}).json() == {"text": "hello"}
    assert client.post("/transcribe", files={"audio": ("x.txt", b"hello", "text/plain")}).status_code == 415
    assert client.post("/transcribe", files={"audio": ("a.webm", b"", "audio/webm")}).status_code == 400
    big = b"x" * (25 * 1024 * 1024 + 10)
    assert client.post("/transcribe", files={"audio": ("a.webm", big, "audio/webm")}).status_code == 413


def test_offramp_and_braindump_robustness(client):
    assert client.post("/offramp", json={}).status_code == 200
    assert client.post("/offramp", json={"progress": ["z" * 5000] * 100, "energy": "9"}).status_code == 200
    r = client.post("/braindump", json={"transcript": "essay, " * 20000})
    assert r.status_code == 200
    assert len(r.json()["alternatives"]) <= 12
    assert client.post("/braindump", json={"transcript": "🙂🙂🙂"}).status_code == 200
    assert client.post("/safety/check", json={"text": "x" * 300000}).status_code in (200, 413)


def test_missing_strategies_file_gives_a_clear_error(monkeypatch, tmp_path):
    from app import strategies

    monkeypatch.setenv("NUDGE_STRATEGIES_PATH", str(tmp_path / "nope.json"))
    strategies._load.cache_clear()
    try:
        with pytest.raises(FileNotFoundError, match="strategies"):
            strategies.load_cards()
    finally:
        monkeypatch.delenv("NUDGE_STRATEGIES_PATH")
        strategies._load.cache_clear()


@pytest.mark.skipif(os.getenv("NUDGE_TEST_MINILM") != "1", reason="set NUDGE_TEST_MINILM=1 to test MiniLM + Chroma")
def test_unwritable_chroma_dir_does_not_break_startup(monkeypatch, tmp_path):
    from app import retrieval

    blocker = tmp_path / "file"
    blocker.write_text("x")
    monkeypatch.setenv("NUDGE_CHROMA_DIR", str(blocker / "sub"))
    monkeypatch.setenv("NUDGE_EMBEDDINGS", "auto")
    retrieval.reset_retriever()
    retrieval.warm_up(blocking=True)
    assert retrieval.retriever_name() in ("minilm", "keyword")
    assert retrieval.get_retriever().similarities("essay")


def test_user_text_never_reaches_logs(client, caplog, monkeypatch):
    import logging

    secret = "zebra-secret-phrase I want to die"
    monkeypatch.setenv("NUDGE_USE_OLLAMA", "1")
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    with caplog.at_level(logging.DEBUG):
        client.post("/sequence", json={"task": secret, "transcript": secret})
        client.post("/sequence", json={"task": "zebra-secret-phrase essay", "energy": 3})
        client.post("/sequence", json={"task": "zebra-secret-phrase", "history": "zebra-secret-phrase"})
        client.post("/braindump", json={"transcript": "zebra-secret-phrase, laundry"})
        client.post("/offramp", json={"task": "zebra-secret-phrase"})
        client.post("/safety/check", json={"text": secret})
        r = client.post("/sequence", content=b'{"task": "zebra-secret-phrase", "energy": ', headers={"content-type": "application/json"})
        assert r.status_code == 422 and "zebra" not in r.text
    assert "zebra" not in caplog.text
