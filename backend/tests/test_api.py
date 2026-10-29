import re

from app.copy_guard import BANNED_RE
from app.strategies import cards_by_id

BUTTONS = ["done", "too_big", "smaller", "different", "rest"]


def seq(client, **body):
    body.setdefault("task", "DBMS assignment")
    body.setdefault("state", "stuck")
    body.setdefault("energy", 3)
    r = client.post("/sequence", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def assert_clean(text):
    assert not BANNED_RE.search(text or ""), text


def test_health(client):
    h = client.get("/health").json()
    assert h["ok"] is True
    assert h["llm"] == "none" and h["llm_location"] == "none"
    assert h["embeddings"] == "keyword"
    assert h["whisper"] is False
    assert h["strategies"] >= 50


def test_strategies_endpoint(client):
    cards = client.get("/strategies").json()
    assert len(cards) >= 50
    assert {"id", "name", "for_state", "min_energy", "modality", "steps", "why_it_works", "literal_version"} <= set(cards[0])


def test_all_cards_follow_copy_rules():
    for c in cards_by_id().values():
        for text in [c.name, c.why_it_works, *c.steps, *c.literal_version, *c.phrasings]:
            assert_clean(text)


def test_sequence_card_fallback_without_llm(client):
    r = seq(client)
    assert r["mode"] == "coach"
    assert r["source"] == "card"
    assert r["next_step"] and "{task}" not in r["next_step"]
    assert r["buttons"] == BUTTONS
    assert r["size"] in ("tiny", "small")
    assert r["strategy_id"] in cards_by_id()
    assert r["why_one_line"]
    assert_clean(r["next_step"])


def test_ollama_down_still_helps(client, monkeypatch):
    monkeypatch.setenv("NUDGE_USE_OLLAMA", "1")
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")  # nothing listens here
    r = seq(client)
    assert r["source"] == "card" and r["next_step"]


def test_literal_vs_warm_wording(client):
    common = dict(task="DBMS assignment", task_tab_title="DBMS_Assignment.pdf", exclude_ids=[])
    warm = seq(client, wording_style="warm", top_strategies=[{"id": "just_open_it", "score": 1.0}], **common)
    lit = seq(client, wording_style="literal", top_strategies=[{"id": "just_open_it", "score": 1.0}], **common)
    assert warm["strategy_id"] == lit["strategy_id"] == "just_open_it"
    assert lit["next_step"] == "Open the file DBMS_Assignment.pdf. You do not need to do anything else."
    assert lit["lead"] == "Next step:"
    assert warm["next_step"] != lit["next_step"]
    assert "DBMS assignment" in warm["next_step"]
    assert warm["lead"] and warm["lead"] != "Next step:"


def test_low_energy_only_tiny(client):
    by_id = cards_by_id()
    for energy in (1, 2):
        for task in ["essay", "exam revision", "lab report", "", "reply to emails"]:
            r = seq(client, task=task, energy=energy)
            assert r["size"] == "tiny"
            card = by_id[r["strategy_id"]]
            assert card.size == "tiny" and card.min_energy <= energy


def test_energy_one_suggests_rest(client):
    r = seq(client, energy=1, state="depleted")
    assert r["suggest_rest"] is True


def test_different_excludes_used_strategies(client):
    first = seq(client)
    used = [first["strategy_id"]]
    history = [{"step": first["next_step"], "outcome": "different", "strategy_id": first["strategy_id"]}]
    for _ in range(4):
        r = seq(client, action="different", history=history, exclude_ids=used)
        assert r["strategy_id"] not in used
        used.append(r["strategy_id"])
        history.append({"step": r["next_step"], "outcome": "different", "strategy_id": r["strategy_id"]})


def test_personal_score_influences_ranking(client):
    base = seq(client, task="essay")
    favourite = "music_cue" if base["strategy_id"] != "music_cue" else "phone_away"
    scores = [{"id": c, "score": 0.05} for c in cards_by_id() if c != favourite]
    scores.append({"id": favourite, "score": 1.0})
    r = seq(client, task="essay", top_strategies=scores)
    assert r["strategy_id"] == favourite


def test_next_continues_same_card(client):
    hist = [{"step": "x", "outcome": "done", "strategy_id": "ugly_first_draft"}]
    r = seq(client, action="next", history=hist, wording_style="literal")
    assert r["strategy_id"] == "ugly_first_draft"
    assert r["next_step"] == cards_by_id()["ugly_first_draft"].literal_version[1]


def test_smaller_shrinks(client):
    step = "Set a 2-minute timer and touch your essay until it rings."
    r = seq(client, action="smaller", history=[{"step": step, "outcome": "smaller", "strategy_id": "two_minute_start"}])
    assert "2-minute timer" in r["next_step"] and len(r["next_step"]) <= len(step) + 20
    again = seq(client, action="smaller", history=[{"step": r["next_step"], "outcome": "smaller", "strategy_id": "two_minute_start"}])
    assert again["strategy_id"] in {"first_physical_action", "just_open_it", "one_percent", "set_up_space"}


def test_overwhelm_validates_first(client):
    r = seq(client, state="overwhelmed", transcript="there's too much and I don't know where to start")
    assert r["validation"]
    calm = seq(client, state="stuck")
    assert calm["validation"] is None


def test_llm_path_used_and_shaped(client, mock_llm):
    mock_llm({"next_step": "Open DBMS_Assignment.pdf and look at the title.", "why_one_line": "Opening is the hardest part.",
              "size": "huge", "validation": None, "suggest_rest": False, "lead": "Tiny idea?"})
    r = seq(client, energy=2)
    assert r["source"] == "ollama"
    assert r["next_step"].startswith("Open DBMS_Assignment.pdf")
    assert r["size"] == "tiny"  # invalid size coerced, low energy forces tiny
    assert r["buttons"] == BUTTONS
    assert r["lead"] == "Tiny idea?"


def test_banned_words_trigger_retry_then_clean(client, mock_llm):
    calls = mock_llm(
        {"next_step": "You should open the file before the deadline.", "why_one_line": "x", "size": "tiny"},
        {"next_step": "Want to open the file? Just a peek.", "why_one_line": "Opening is a start.", "size": "tiny"},
    )
    r = seq(client)
    assert len(calls) == 2
    assert "copy rules" in calls[1][-1]["content"]
    assert r["next_step"] == "Want to open the file? Just a peek."


def test_banned_words_soft_rewrite_when_retry_still_bad(client, mock_llm):
    mock_llm(
        {"next_step": "You should open it now.", "why_one_line": "Fine.", "size": "tiny"},
        {"next_step": "You should open it.", "why_one_line": "Fine.", "size": "tiny"},
    )
    r = seq(client)
    assert_clean(r["next_step"])
    assert r["next_step"].startswith("You could open it")


def test_user_task_words_do_not_trip_guard(client, mock_llm):
    calls = mock_llm({"next_step": "Open the failing tests file and read the first error.", "why_one_line": "One error at a time.", "size": "tiny"})
    r = seq(client, task="failing tests")
    assert len(calls) == 1 and r["source"] == "ollama"


def test_llm_garbage_falls_back_to_card(client, mock_llm):
    mock_llm({"nope": 1})
    r = seq(client)
    assert r["source"] == "card" and r["next_step"]


def test_card_fallback_never_repeats_recent_lead(client):
    first = seq(client, top_strategies=[{"id": "two_minute_start", "score": 1.0}])
    second = seq(client, top_strategies=[{"id": "two_minute_start", "score": 1.0}], recent_phrasings=[first["lead"]])
    assert second["lead"] != first["lead"]


# --------------------------------------------------------------- safety ---

CRISIS = [
    "I want to kill myself",
    "honestly i wanna die",
    "I don't want to be alive anymore",
    "everyone would be better off without me",
    "I just want to disappear",
    "there's no point in living",
    "thinking about hurting myself again",
    "I've been self-harming",
    "this essay makes me want to end it all",
    "I feel so hopeless",
    "I’m suicidal",
]
NOT_CRISIS = [
    "this assignment is killing me",
    "I'm dead tired",
    "dying of boredom in this lecture",
    "I need to kill this bug before I can sleep",
    "how do I kill the process on port 3000",
    "I'm not suicidal, just really stressed about the exam",
    "my deadline anxiety is bad",
    "I'm dying to know how this ends",
    "you killed it in that presentation",
    "I'm gonna die if I have to read another page",
]


def test_safety_positive(client):
    for text in CRISIS:
        r = client.post("/safety/check", json={"text": text, "region": "IN"}).json()
        assert r["crisis"] is True, text
        phones = [res.get("phone") for res in r["resources"]]
        assert "14416" in phones


def test_safety_negative(client):
    for text in NOT_CRISIS:
        r = client.post("/safety/check", json={"text": text}).json()
        assert r == {"crisis": False}, text


def test_safety_regions(client):
    us = client.post("/safety/check", json={"text": "I want to die", "region": "US"}).json()
    assert any(res.get("phone") == "988" for res in us["resources"])
    other = client.post("/safety/check", json={"text": "I want to die", "region": "ZZ"}).json()
    assert any("findahelpline" in (res.get("url") or "") for res in other["resources"])


def test_sequence_stops_coaching_on_crisis(client, mock_llm):
    calls = mock_llm({"next_step": "should never be used"})
    r = seq(client, transcript="I don't want to live anymore")
    assert r["mode"] == "safety" and r["safety"]["crisis"] is True
    assert r["next_step"] == "" and r["buttons"] == []
    assert calls == []  # the LLM never saw it


def test_braindump_and_offramp_check_safety(client):
    b = client.post("/braindump", json={"transcript": "laundry, essay, and honestly I want to end my life"}).json()
    assert b["mode"] == "safety" and b["pick"] is None
    o = client.post("/offramp", json={"task": "x", "progress": ["I want to kill myself"]}).json()
    assert o["mode"] == "safety"


# ------------------------------------------------------------ braindump ---


def test_braindump_fallback_groups_and_picks(client):
    t = ("um so I need to finish the DBMS assignment and also email my prof about the lab, "
         "then do laundry, pay the hostel fee, and study for the maths quiz")
    r = client.post("/braindump", json={"transcript": t}).json()
    assert r["mode"] == "coach" and r["source"] == "card"
    items = [i for g in r["groups"] for i in g["items"]]
    assert len(items) >= 4
    labels = {g["label"] for g in r["groups"]}
    assert "Uni" in labels
    assert r["pick"]["item"] in items
    assert r["pick"]["item"] not in r["alternatives"]
    assert set(r["alternatives"]) | {r["pick"]["item"]} == set(items)
    assert_clean(r["pick"]["why"] + r["pick"]["first_step"])


def test_braindump_empty(client):
    r = client.post("/braindump", json={"transcript": "   "}).json()
    assert r["groups"] == [] and r["pick"] is None


def test_braindump_llm(client, mock_llm):
    mock_llm({"groups": [{"label": "Uni", "items": ["essay", "lab"]}],
              "pick": {"item": "lab", "why": "Quickest.", "first_step": "Open the lab sheet."},
              "alternatives": ["essay"]})
    r = client.post("/braindump", json={"transcript": "essay and lab"}).json()
    assert r["source"] == "ollama" and r["pick"]["item"] == "lab" and r["alternatives"] == ["essay"]


# -------------------------------------------------------------- offramp ---


def test_offramp_fallback(client):
    r = client.post("/offramp", json={"task": "DBMS assignment", "progress": ["Opened the file", "Wrote the title"]}).json()
    assert r["source"] == "card"
    assert "Wrote the title" in r["note_to_future_self"]
    assert r["rest_suggestion"]
    assert_clean(r["note_to_future_self"] + r["rest_suggestion"])


def test_offramp_no_progress_is_kind(client):
    r = client.post("/offramp", json={"task": "essay", "progress": []}).json()
    assert "saved for later" in r["note_to_future_self"]


def test_transcribe_unavailable(client):
    r = client.post("/transcribe", files={"audio": ("a.webm", b"123", "audio/webm")})
    assert r.status_code == 501


def test_energy_is_clamped(client):
    r = seq(client, energy=9)
    assert r["mode"] == "coach"
