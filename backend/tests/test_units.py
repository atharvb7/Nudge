import os

import pytest

from app.copy_guard import find_banned, soft_rewrite, tidy
from app.fallback import split_items, task_label
from app.retrieval import KeywordRetriever
from app.strategies import load_cards


def test_soft_rewrite():
    assert soft_rewrite("You should start before the deadline!!!") == "You could start before the hand-in date!"
    assert not find_banned(soft_rewrite("Don't fail your streak, it's overdue"))


def test_tidy_limits_exclamations():
    assert tidy("Great! Nice! Wow!!") == "Great! Nice. Wow."


def test_task_label():
    assert task_label("DBMS assignment", "DBMS_Assignment.pdf", literal=True) == "the file DBMS_Assignment.pdf"
    assert task_label("DBMS assignment", None, literal=False) == "your DBMS assignment"
    assert task_label("email prof", None, literal=False) == "“email prof”"
    assert task_label("", None, literal=False) == "your task"
    assert task_label("my essay", None, literal=False) == "my essay"


def test_split_items_handles_fillers():
    items = split_items("uh I need to do laundry\nalso email mum; and um revise chapter 3")
    assert items == ["Do laundry", "Email mum", "Revise chapter 3"]


def test_keyword_retrieval_relevance():
    r = KeywordRetriever(load_cards())
    s = r.similarities("everything is so loud and overwhelming, sensory overload")
    top = sorted(s, key=s.get, reverse=True)[:5]
    assert {"sensory_reset", "sound_bubble", "deep_pressure", "brain_dump"} & set(top)
    s = r.similarities("blank page essay perfectionism")
    top = sorted(s, key=s.get, reverse=True)[:5]
    assert "ugly_first_draft" in top


@pytest.mark.skipif(os.getenv("NUDGE_TEST_MINILM") != "1", reason="set NUDGE_TEST_MINILM=1 to test MiniLM + Chroma")
def test_minilm_retrieval(monkeypatch, tmp_path):
    monkeypatch.setenv("NUDGE_EMBEDDINGS", "auto")
    monkeypatch.setenv("NUDGE_CHROMA_DIR", str(tmp_path))
    from app import retrieval

    retrieval.warm_up(blocking=True)
    r = retrieval.get_retriever()
    assert r.name == "minilm"
    s = r.similarities("everything is too loud and I feel overloaded")
    top = sorted(s, key=s.get, reverse=True)[:4]
    assert {"sensory_reset", "sound_bubble", "deep_pressure"} & set(top)


def test_feelings_are_not_quoted_back_as_the_task():
    from app.fallback import task_label

    assert task_label("this assignment is killing me", "DBMS_Assignment.pdf", False) == "DBMS_Assignment.pdf"
    assert task_label("I'm so stuck", None, False) == "your task"
    assert task_label("DBMS assignment", None, False) == "your DBMS assignment"
