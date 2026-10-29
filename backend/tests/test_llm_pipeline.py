"""The real HTTP LLM path, against a fake Ollama server that answers like a
messy small local model. No model is downloaded; the server is scripted.
"""

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from app.copy_guard import BANNED_RE, IDIOM_RE

BUTTONS = ["done", "too_big", "smaller", "different", "rest"]


class FakeOllama:
    """Scripted replies: each item is a str (assistant content), or a dict
    {"status": int, "content": str, "delay": float, "raw": bytes}."""

    def __init__(self):
        self.script: list = []
        self.requests: list[dict] = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # keep test output quiet
                pass

            def do_GET(self):
                self.send_response(200 if self.path == "/api/tags" else 404)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"models": []}')

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                fake.requests.append(body)
                item = fake.script.pop(0) if fake.script else {"status": 500, "content": ""}
                if isinstance(item, str):
                    item = {"content": item}
                time.sleep(item.get("delay", 0))
                status = item.get("status", 200)
                raw = item.get("raw")
                if raw is None:
                    raw = json.dumps({"message": {"role": "assistant", "content": item.get("content", "")}}).encode()
                try:
                    self.send_response(status)
                    self.send_header("content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def close(self):
        self.server.shutdown()


@pytest.fixture
def ollama(monkeypatch):
    fake = FakeOllama()
    monkeypatch.setenv("NUDGE_USE_OLLAMA", "1")
    monkeypatch.setenv("OLLAMA_URL", fake.url)
    monkeypatch.setenv("NUDGE_LLM_TIMEOUT", "3")
    yield fake
    fake.close()


def j(**kw):
    base = {"next_step": "Open DBMS_Assignment.pdf and look at question 1 only.", "why_one_line": "Opening it is the hardest part.",
            "size": "tiny", "validation": None, "suggest_rest": False, "lead": "Want a tiny one?"}
    base.update(kw)
    return json.dumps(base)


def seq(client, **body):
    body.setdefault("task", "DBMS assignment")
    body.setdefault("task_tab_title", "DBMS_Assignment.pdf")
    body.setdefault("state", "stuck")
    body.setdefault("energy", 3)
    r = client.post("/sequence", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["buttons"] == BUTTONS and out["next_step"]
    assert not BANNED_RE.search(" ".join(str(out.get(k) or "") for k in ("next_step", "why_one_line", "lead", "validation")))
    return out


def test_clean_json(client, ollama):
    ollama.script = [j()]
    r = seq(client)
    assert r["source"] == "ollama"
    assert r["next_step"].startswith("Open DBMS_Assignment.pdf")
    req = ollama.requests[0]
    assert req["format"] == "json" and req["stream"] is False
    assert "ONE micro-step" in req["messages"][0]["content"]


def test_json_in_code_fence(client, ollama):
    ollama.script = ["```json\n" + j(next_step="Just open the PDF and read the title.") + "\n```"]
    assert seq(client)["next_step"] == "Just open the PDF and read the title."


def test_json_with_prose_and_trailing_braces(client, ollama):
    ollama.script = ["Sure! Here you go: " + j(next_step="Type your name at the top of the page.") + " Hope this helps {:)}"]
    r = seq(client)
    assert r["source"] == "ollama" and r["next_step"] == "Type your name at the top of the page."


@pytest.mark.parametrize(
    "content",
    [
        "",  # empty reply
        "I think you can do it!",  # no JSON
        "[1, 2, 3]",  # JSON but not an object
        json.dumps({"why_one_line": "x"}),  # missing next_step
        json.dumps({"next_step": ["open", "it"]}),  # wrong type
        json.dumps({"next_step": "ok"}),  # too short to be a step
        json.dumps({"next_step": "word " * 80}),  # far too long
    ],
)
def test_unusable_replies_fall_back_to_card(client, ollama, content):
    ollama.script = [content]
    r = seq(client)
    assert r["source"] == "card"


def test_raw_garbage_body(client, ollama):
    ollama.script = [{"raw": b"not even json"}]
    assert seq(client)["source"] == "card"


def test_server_error_falls_back(client, ollama):
    ollama.script = [{"status": 500, "content": "boom"}]
    assert seq(client)["source"] == "card"


def test_wrong_types_are_repaired(client, ollama):
    ollama.script = [j(size="medium", suggest_rest="false", why_one_line=42, lead=["x"])]
    r = seq(client)
    assert r["source"] == "ollama"
    assert r["size"] in ("tiny", "small")
    assert r["suggest_rest"] is False
    assert isinstance(r["why_one_line"], str) and r["why_one_line"]


def test_two_steps_become_one(client, ollama):
    ollama.script = [j(next_step="Open the PDF and read question 1. Then write two lines of notes and start question 2.")]
    r = seq(client)
    assert r["next_step"] == "Open the PDF and read question 1."


def test_numbered_list_becomes_one_step(client, ollama):
    ollama.script = [j(next_step="1. Open the PDF.\n2. Read question 1.\n3. Write notes.")]
    assert seq(client)["next_step"] == "Open the PDF."


def test_multiple_questions_fall_back(client, ollama):
    ollama.script = [j(next_step="Want to open it? Or write a title? Or read the notes?")]
    assert seq(client)["source"] == "card"


def test_banned_words_retry_then_clean(client, ollama):
    ollama.script = [
        j(next_step="You should open the PDF before the deadline."),
        j(next_step="Maybe open the PDF and look at the first line?"),
    ]
    r = seq(client)
    assert r["next_step"] == "Maybe open the PDF and look at the first line?"
    assert len(ollama.requests) == 2
    assert "copy rules" in ollama.requests[1]["messages"][-1]["content"]
    # The retry shows the model its own reply as JSON, not a Python repr.
    json.loads(ollama.requests[1]["messages"][-2]["content"])


def test_banned_words_twice_soft_rewritten(client, ollama):
    ollama.script = [j(next_step="You should open the PDF now."), j(next_step="You should open the PDF now.")]
    r = seq(client)
    assert r["next_step"] == "You could open the PDF now."


def test_shaming_language_is_removed(client, ollama):
    ollama.script = [j(next_step="Stop being lazy and just do it: open the PDF."), j(next_step="No excuses, open the PDF.")]
    r = seq(client)
    assert not re.search(r"lazy|no excuses|just do it", r["next_step"], re.I)


def test_overdue_streak_failed_words(client, ollama):
    ollama.script = [j(next_step="Your overdue work broke your streak, you failed today."),
                     j(next_step="Your overdue work broke your streak, you failed today.")]
    r = seq(client)
    assert r["source"] in ("ollama", "card")  # rewritten or replaced, never shown raw


@pytest.mark.parametrize(
    "idiom",
    ["Dip your toe in and open the PDF.", "Let's get the ball rolling with the PDF.", "Chip away at question 1.",
     "Do one bite-sized bit of question 1.", "Knock it out: open question 1."],
)
def test_literal_mode_rejects_idioms(client, ollama, idiom):
    ollama.script = [j(next_step=idiom, lead=None), j(next_step=idiom, lead=None)]
    r = seq(client, wording_style="literal")
    assert r["source"] == "card"
    assert not IDIOM_RE.search(r["next_step"])
    assert "literal" in ollama.requests[1]["messages"][-1]["content"].lower()


def test_literal_mode_idiom_fixed_on_retry(client, ollama):
    ollama.script = [j(next_step="Dip your toe in.", lead=None),
                     j(next_step="Open the file DBMS_Assignment.pdf. Read question 1 only.", lead=None)]
    r = seq(client, wording_style="literal")
    assert r["source"] == "ollama"
    assert r["next_step"].startswith("Open the file DBMS_Assignment.pdf")
    assert r["lead"] in (None, "Next step:", "Step:") or not r["lead"].endswith("?")


def test_warm_idioms_are_fine(client, ollama):
    ollama.script = [j(next_step="Want to dip your toe in by opening the PDF?")]
    assert seq(client)["source"] == "ollama"


def test_validation_when_overwhelmed(client, ollama):
    ollama.script = [j(validation=None)]
    r = seq(client, state="overwhelmed", transcript="there's too much and I can't think")
    assert r["validation"]
    ollama.script = [j(validation="That sounds like so much at once. Here is a very long second sentence.")]
    r = seq(client, state="overwhelmed")
    assert r["validation"] == "That sounds like so much at once."


def test_low_energy_forces_tiny_and_rest(client, ollama):
    ollama.script = [j(size="small", suggest_rest=False)]
    r = seq(client, energy=1)
    assert r["size"] == "tiny" and r["suggest_rest"] is True


def test_slow_model_times_out_to_card_quickly(client, ollama, monkeypatch):
    monkeypatch.setenv("NUDGE_LLM_TIMEOUT", "1")
    ollama.script = [{"content": j(), "delay": 3}]
    t0 = time.perf_counter()
    r = seq(client)
    elapsed = time.perf_counter() - t0
    assert r["source"] == "card"
    assert elapsed < 2.5, elapsed


def test_no_retry_when_time_is_nearly_up(client, ollama, monkeypatch):
    monkeypatch.setenv("NUDGE_LLM_TIMEOUT", "1")
    ollama.script = [{"content": j(next_step="You should open the PDF."), "delay": 0.8}, j()]
    r = seq(client)
    assert len(ollama.requests) == 1  # soft rewrite instead of a second slow call
    assert r["next_step"] == "You could open the PDF."


def test_offramp_and_braindump_via_ollama(client, ollama):
    ollama.script = [json.dumps({"note_to_future_self": "I opened the PDF. Next: read question 1.", "rest_suggestion": "Maybe some water?"})]
    r = client.post("/offramp", json={"task": "DBMS", "progress": ["Opened the PDF"]}).json()
    assert r["source"] == "ollama" and "question 1" in r["note_to_future_self"]

    ollama.script = ["```json\n" + json.dumps({
        "groups": [{"label": "Uni", "items": ["DBMS assignment"]}, {"label": "People", "items": ["email prof"]}],
        "pick": {"item": "email prof", "why": "It's quickest.", "first_step": "Open your email."},
        "alternatives": ["DBMS assignment"]}) + "\n```"]
    r = client.post("/braindump", json={"transcript": "DBMS assignment and email prof"}).json()
    assert r["source"] == "ollama" and r["pick"]["item"] == "email prof"


def test_braindump_literal_idioms_fall_back(client, ollama):
    ollama.script = [json.dumps({
        "groups": [{"label": "Uni", "items": ["essay"]}],
        "pick": {"item": "essay", "why": "Low-hanging fruit.", "first_step": "Dip your toe in."},
        "alternatives": []})]
    r = client.post("/braindump", json={"transcript": "essay and laundry", "wording_style": "literal"}).json()
    assert r["source"] == "card"


def test_health_reports_local(client, ollama):
    h = client.get("/health").json()
    assert h["llm"] == "ollama" and h["llm_location"] == "local"


# ------------------------------------------------------------------ gemini ---


@pytest.fixture
def gemini(monkeypatch):
    """Route the Gemini client through httpx.MockTransport."""
    from app import llm

    calls = []
    replies = []

    def handler(request: httpx.Request):
        if request.url.host != "generativelanguage.googleapis.com":
            # Not Gemini (e.g. the fake Ollama): pass straight through.
            real_resp = httpx.request(request.method, str(request.url), content=request.content,
                                      headers={"content-type": "application/json"}, timeout=10)
            return httpx.Response(real_resp.status_code, content=real_resp.content)
        calls.append(request)
        text = replies.pop(0) if replies else j()
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})

    real = httpx.AsyncClient

    def client_factory(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)

    monkeypatch.setattr(llm.httpx, "AsyncClient", client_factory)
    return calls, replies


def test_gemini_not_used_without_opt_in(client, gemini, monkeypatch):
    calls, _ = gemini
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")  # key alone is not enough
    assert seq(client)["source"] == "card"
    monkeypatch.setenv("NUDGE_ALLOW_CLOUD", "1")
    monkeypatch.delenv("GEMINI_API_KEY")  # opt-in alone is not enough
    assert seq(client)["source"] == "card"
    assert calls == []


def test_gemini_used_with_opt_in_and_key(client, gemini, monkeypatch):
    calls, replies = gemini
    monkeypatch.setenv("NUDGE_ALLOW_CLOUD", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    replies.append("```json\n" + j(next_step="Open the PDF and read the title.") + "\n```")
    r = seq(client)
    assert r["source"] == "gemini" and r["next_step"] == "Open the PDF and read the title."
    assert calls[0].headers["x-goog-api-key"] == "test-key"
    body = json.loads(calls[0].content)
    assert "ONE micro-step" in body["systemInstruction"]["parts"][0]["text"]
    h = client.get("/health").json()
    assert h["llm"] == "gemini" and h["llm_location"] == "cloud"


def test_ollama_preferred_over_gemini(client, ollama, gemini, monkeypatch):
    calls, _ = gemini
    monkeypatch.setenv("NUDGE_ALLOW_CLOUD", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    ollama.script = [j()]
    assert seq(client)["source"] == "ollama"
    assert calls == []
