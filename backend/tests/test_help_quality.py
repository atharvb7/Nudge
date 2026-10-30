"""Help quality: steps fit the kind of task, labels are grammatical, nothing
the student said in distress is ever echoed back as a task name."""

import re
import time

import pytest

from app.fallback import braindump_reply, card_reply, fill, sanitize_task, split_items, task_label
from app.models import BrainDumpRequest, SequenceRequest
from app.ranking import rank
from app.strategies import load_cards
from app.taskkind import card_fits, clean_tab_title, task_kind

TASKS = [
    ("essay", None),
    ("laundry", None),
    ("call mom", None),
    ("email prof rao", None),
    ("pay mess fees", None),
    ("", "DBMS_Assignment.pdf"),
    ("", "Google Docs - Untitled document"),
    ("", None),
    ("study for DBMS exam", None),
    ("The OS lab report", None),
]

BAD = [
    (r"\byour\s+your\b", "your your"),
    (r"\bthe\s+(?:finished\s+|whole\s+|first\s+)?(?:your|my)\b", "article + your"),
    (r"\byour\s+(?:call|email|text|message|reply|do|pay)\s+(?!with\b|to\b)\w", "your + verb phrase"),
    (r"\byour\s+(?:Call|Email|Laundry|Pay)\b", "your + capitalised verb"),
    (r"“[^”]*$|^[^“]*”", "dangling quote"),
    (r"\{task\}", "unfilled placeholder"),
    (r"Google Docs|Untitled document", "raw tab title"),
    (r"\bjust what'?s\b|Even smaller: just (?:what|which|how|here|before)\b", "shrunk question"),
    (r"\s[,.!?]", "space before punctuation"),
]


@pytest.mark.parametrize("task,tab", TASKS)
@pytest.mark.parametrize("literal", [False, True])
def test_every_card_renders_grammatically(task, tab, literal):
    label = task_label(task, tab, literal)
    for card in load_cards():
        for step in (card.literal_version if literal else card.steps) + (() if literal else card.phrasings):
            out = fill(step, label)
            for rx, why in BAD:
                assert not re.search(rx, out), f"{why}: {card.id} → {out!r}"
            assert out[0].isupper() or out[0] in "“\"'", f"capitalisation: {card.id} → {out!r}"


@pytest.mark.parametrize(
    "task,kind,forbidden",
    [
        ("laundry", "chore", {"empty_headings", "read_one_paragraph", "rubric_checkbox", "ugly_first_draft", "copy_the_prompt"}),
        ("call mom", "message", {"rubric_checkbox", "empty_headings", "read_one_paragraph", "worked_example"}),
        ("do the dishes", "chore", {"write_the_title", "highlight_one", "start_from_end"}),
    ],
)
def test_cards_fit_the_kind_of_task(task, kind, forbidden):
    assert task_kind(task) == kind
    for energy in (2, 3, 5):
        for action in ("start", "different", "smaller", "next"):
            req = SequenceRequest(task=task, state="stuck", energy=energy, action=action, wording_style="warm")
            ids = {r.card.id for r in rank(req, limit=20)}
            assert not ids & forbidden, (energy, action, ids & forbidden)
            assert card_reply(req).strategy_id not in forbidden


def test_task_kind_rules_match_the_doc():
    assert task_kind("email prof about the assignment") == "message"  # first rule wins
    assert task_kind("clean my room") == "chore"
    assert task_kind("pay hostel fees") == "admin"
    assert task_kind("debug my code") == "code"
    assert task_kind("read chapter 4") == "reading"
    assert task_kind("revise for the quiz") == "study"
    assert task_kind("write the essay") == "doc"
    assert task_kind("DBMS_notes.pdf") == "reading"
    assert task_kind("xyz") == "unknown"
    assert card_fits(("message",), "unknown") is False
    assert card_fits(("doc", "message"), "unknown") is True


def test_tab_titles_are_cleaned():
    assert clean_tab_title("Google Docs - Untitled document") == ""
    assert clean_tab_title("(2) DBMS notes - Google Docs") == "DBMS notes"
    assert clean_tab_title("Essay draft — Mozilla Firefox") == "Essay draft"
    req = SequenceRequest(task="", task_tab_title="Copy of Lab 3 - Google Docs", state="stuck", energy=3, action="start", wording_style="literal")
    assert "Google Docs" not in card_reply(req).next_step


@pytest.mark.parametrize(
    "text",
    ["I want to end it", "this assignment is killing me lol", "i feel like such a burden", "I'm so stuck and tired of everything here",
     "one two three four five six seven eight nine words long task"],
)
def test_distress_or_rambles_are_never_used_as_the_task_name(text):
    assert sanitize_task(text) in ("", "this assignment")  # at most the task noun hiding inside
    for style in ("warm", "literal"):
        req = SequenceRequest(task=text, state="stuck", energy=3, action="start", wording_style=style)
        r = card_reply(req)
        assert text.lower() not in (r.next_step + " " + (r.lead or "")).lower()


def test_the_finished_your_is_fixed():
    assert fill("Jot down what the finished {task} would say.", "your essay") == "Jot down what your finished essay would say."
    assert fill("Open the {task}.", "the laundry") == "Open the laundry."


def test_smaller_never_shrinks_a_question():
    req = SequenceRequest(
        task="essay", state="stuck", energy=3, action="smaller", wording_style="warm",
        history=[{"step": "What's the very first physical move for your essay — a click, a scroll, picking up a pen? Do only that move.",
                  "strategy_id": "first_physical_action", "outcome": "smaller"}],
    )
    out = card_reply(req).next_step
    assert "what's" not in out.lower() and "just what" not in out.lower()


def test_ugh_gets_a_kind_word():
    req = SequenceRequest(task="essay", transcript="ugh I can't start my essay", state="stuck", energy=3, action="start", wording_style="warm")
    assert card_reply(req).validation


def test_depleted_is_rest_first_but_respects_a_second_ask():
    req = SequenceRequest(task="essay", state="depleted", energy=3, action="start", wording_style="warm")
    r = card_reply(req)
    assert r.suggest_rest is True
    assert r.strategy_id in {c.id for c in load_cards() if c.is_rest} or "rest" in (r.lead or "").lower()
    rest_id = next(c.id for c in load_cards() if c.is_rest)
    again = SequenceRequest(task="essay", state="depleted", energy=3, action="different", wording_style="warm",
                            history=[{"step": "rest", "strategy_id": rest_id, "outcome": "different"}])
    r2 = card_reply(again)
    assert r2.suggest_rest is False
    assert r2.strategy_id not in {c.id for c in load_cards() if c.is_rest}


@pytest.mark.parametrize(
    "dump,expected",
    [
        ("1. ML quiz 2. resume 3. laundry", ["ML quiz", "Resume", "Laundry"]),
        ("- ML quiz\n- resume\n• call mom", ["ML quiz", "Resume", "Call mom"]),
        ("idk, stuff, ML quiz lol and laundry", ["ML quiz", "Laundry"]),
    ],
)
def test_brain_dump_lists_and_filler(dump, expected):
    assert split_items(dump) == expected


def test_brain_dump_pick_fits_its_kind_and_prefers_uni_work():
    _, pick, _ = braindump_reply(BrainDumpRequest(transcript="laundry, dishes, ML quiz", wording_style="warm", energy=3))
    assert pick.item == "ML quiz"
    _, pick, _ = braindump_reply(BrainDumpRequest(transcript="call mom", wording_style="warm", energy=3))
    assert "open whatever" not in pick.first_step.lower() and "mom" in pick.first_step
    _, pick, _ = braindump_reply(BrainDumpRequest(transcript="laundry", wording_style="warm", energy=3))
    assert "one item" in pick.first_step
    _, pick, _ = braindump_reply(BrainDumpRequest(transcript="email prof rao", wording_style="literal", energy=3))
    assert pick.first_step.startswith("Open a new message to")


def _slow_llm(monkeypatch, delay, reply):
    import asyncio

    from app import llm

    calls = []

    async def fake(messages, prefer=None):
        calls.append(1)
        await asyncio.sleep(delay)
        return dict(reply), "ollama"

    monkeypatch.setattr(llm, "chat_json", fake)
    return calls


def test_a_hung_llm_falls_back_to_a_card_within_the_budget(client, monkeypatch):
    monkeypatch.setenv("NUDGE_USE_OLLAMA", "1")
    _slow_llm(monkeypatch, 60, {"next_step": "x"})
    t0 = time.monotonic()
    r = client.post("/sequence", json={"task": "essay", "state": "stuck", "energy": 3, "action": "start", "wording_style": "warm"})
    took = time.monotonic() - t0
    assert r.status_code == 200 and r.json()["source"] == "card"
    assert took <= 8.5, took


def test_no_retry_when_it_would_blow_the_budget(client, monkeypatch):
    monkeypatch.setenv("NUDGE_USE_OLLAMA", "1")
    calls = _slow_llm(monkeypatch, 5, {"next_step": "You should open your essay deadline now.", "why_one_line": "It helps.", "size": "tiny"})
    t0 = time.monotonic()
    r = client.post("/sequence", json={"task": "essay", "state": "stuck", "energy": 3, "action": "start", "wording_style": "warm"})
    took = time.monotonic() - t0
    assert r.status_code == 200
    assert len(calls) == 1, "a 5 s first call must not be retried inside an 8 s budget"
    assert took <= 8.5, took
    assert "should" not in r.json()["next_step"].lower()


def test_task_noun_is_kept_from_a_feeling():
    assert sanitize_task("ugh I can't start my essay") == "my essay"
    assert task_label("ugh I can't start my essay", None, False) == "your essay"
    assert task_label("this assignment is killing me", "DBMS_Assignment.pdf", False) == "DBMS_Assignment.pdf"
