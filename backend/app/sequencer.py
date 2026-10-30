"""Orchestration for the text endpoints: safety -> plan -> LLM -> copy guard -> card fallback."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from . import copy_guard, llm, prompts
from .config import get_settings
from .fallback import (
    braindump_reply,
    card_reply,
    is_overwhelmed,
    offramp_reply,
    plan,
    validation_for,
)
from .models import (
    BUTTONS,
    BrainDumpGroup,
    BrainDumpPick,
    BrainDumpRequest,
    BrainDumpResponse,
    OfframpRequest,
    OfframpResponse,
    SequenceRequest,
    SequenceResponse,
)
from .ranking import wants_rest
from .safety import classify, safety_payload

log = logging.getLogger("nudge.sequencer")

MAX_STEP_WORDS = 45


def _region(r: str | None) -> str:
    return (r or get_settings().default_region).upper()


def _crisis(*texts: str | None) -> bool:
    return any(classify(t or "") for t in texts)


def _without_user_terms(text: str, terms: list[str | None]) -> str:
    """The user's own task names may contain words like 'failing'; don't hold those against the LLM."""
    out = text or ""
    for t in terms:
        if t and t.strip():
            out = out.replace(t.strip(), " ")
    return out


def _str(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


async def _guarded_llm(
    messages: list[dict], fields: list[str], user_terms: list[str | None], literal: bool = False
) -> tuple[dict, str]:
    """Call the LLM; if the reply breaks the copy rules (or uses idioms in literal mode) retry once,
    then soft-rewrite banned words. Idioms that survive the retry mean the card is used instead.

    Raises llm.LLMUnavailable or ValueError when nothing usable came back.
    """
    started = time.monotonic()
    settings = get_settings()
    budget = min(settings.llm_budget_s, settings.llm_timeout)

    async def within_budget(msgs: list[dict], prefer: str | None = None) -> tuple[dict, str]:
        remaining = budget - (time.monotonic() - started)
        if remaining <= 0.2:
            raise llm.LLMUnavailable("budget spent")
        try:
            return await asyncio.wait_for(llm.chat_json(msgs, prefer=prefer), timeout=remaining)
        except asyncio.TimeoutError:
            raise llm.LLMUnavailable("over budget") from None

    data, source = await within_budget(messages)
    first_call = time.monotonic() - started

    def scan(d: dict, finder) -> list[str]:
        words: list[str] = []
        for f in fields:
            v = d.get(f)
            if isinstance(v, str):
                words += finder(_without_user_terms(v, user_terms))
        return words

    def idioms(d: dict) -> list[str]:
        return scan(d, copy_guard.find_idioms) if literal else []

    words, vague = scan(data, copy_guard.find_banned), idioms(data)
    # Only retry if a second call of the same length still fits the budget.
    if (words or vague) and (time.monotonic() - started) + first_call * 1.1 + 0.3 < budget:
        reminder = (
            copy_guard.REMINDER.format(words=", ".join(sorted(set(words))))
            if words
            else copy_guard.IDIOM_REMINDER.format(words=", ".join(sorted(set(vague))))
        )
        retry = messages + [
            {"role": "assistant", "content": json.dumps(data, ensure_ascii=False)},
            {"role": "user", "content": reminder},
        ]
        try:
            data, source = await within_budget(retry, prefer=source)
        except llm.LLMUnavailable:
            pass
    if scan(data, copy_guard.find_banned):
        for f in fields:
            if isinstance(data.get(f), str):
                data[f] = copy_guard.soft_rewrite(data[f])
        if scan(data, copy_guard.find_banned):
            raise ValueError("LLM reply kept breaking copy rules")
    if idioms(data):
        raise ValueError("LLM reply was not literal")
    for f in fields:
        if isinstance(data.get(f), str):
            data[f] = copy_guard.tidy(data[f])
    return data, source


# A second step sneaking in: numbered lists, "Then…", "After that…", new lines.
_MULTI_STEP_RE = re.compile(
    r"(?:\n+|(?:^|\s)(?:2[.)]|step 2\b)|[.!?]\s+(?:then|after that|afterwards|next|once (?:that'?s|you'?ve) done)\b)",
    re.I,
)


def _one_step(step: str) -> str | None:
    """Keep exactly one micro-step. Returns None if what's left isn't a usable step."""
    s = re.sub(r"^\s*(?:1[.)]|step 1[:.)]?|-|\*)\s*", "", step.strip(), flags=re.I)
    m = _MULTI_STEP_RE.search(s)
    if m:
        s = s[: m.start()].strip()
        if s and s[-1] not in ".!?":
            s += "."
    if len(s.split()) < 3:
        return None
    if s.count("?") > 1:  # at most one question
        return None
    return s


def _first_sentence(text: str | None, max_words: int) -> str | None:
    if not text:
        return None
    m = re.match(r"(.+?[.!?])(?:\s|$)", text.strip(), re.S)
    out = (m.group(1) if m else text).strip()
    return out if len(out.split()) <= max_words else None


def _truthy(v: Any) -> bool:
    return v is True or (isinstance(v, str) and v.strip().lower() == "true")


# ---------------------------------------------------------------- sequence ---


async def sequence(req: SequenceRequest) -> SequenceResponse:
    if _crisis(req.task, req.transcript, req.task_tab_title):
        return SequenceResponse(mode="safety", source="safety", buttons=[], safety=safety_payload(_region(req.region)))

    p = plan(req)
    fallback = card_reply(req, p)
    grounding = [p.card] + list(p.alternatives or [])
    literal = req.wording_style == "literal"
    try:
        data, source = await _guarded_llm(
            prompts.sequence_messages(req, grounding),
            ["next_step", "why_one_line", "validation", "lead"],
            [req.task, req.task_tab_title],
            literal=literal,
        )
    except Exception as exc:  # LLMUnavailable, ValueError, odd shapes — help never breaks
        log.info("Serving card fallback (%s)", type(exc).__name__)
        return fallback

    step = _str(data.get("next_step"))
    step = _one_step(step) if step else None
    if not step or len(step.split()) > MAX_STEP_WORDS:
        return fallback

    size_raw = data.get("size")
    size = size_raw.strip().lower() if isinstance(size_raw, str) else ""
    size = size if size in ("tiny", "small") else fallback.size
    if req.energy <= 2:
        size = "tiny"
    lead = fallback.lead
    llm_lead = _first_sentence(_str(data.get("lead")), 15)
    if not literal and llm_lead and llm_lead.lower() != step.lower():
        lead = llm_lead
    validation = None
    if is_overwhelmed(req):
        validation = _first_sentence(_str(data.get("validation")), 25) or validation_for(req)
    suggest_rest = _truthy(data.get("suggest_rest")) or p.card.is_rest or wants_rest(req)

    return SequenceResponse(
        mode="coach",
        lead=lead,
        next_step=step,
        why_one_line=_first_sentence(_str(data.get("why_one_line")), 30) or fallback.why_one_line,
        size=size,  # type: ignore[arg-type]
        buttons=list(BUTTONS),
        strategy_id=p.card.id,
        strategy_name=p.card.name,
        validation=validation,
        suggest_rest=suggest_rest,
        source=source,  # type: ignore[arg-type]
    )


# ----------------------------------------------------------------- offramp ---


async def offramp(req: OfframpRequest) -> OfframpResponse:
    if _crisis(req.task, *req.progress):
        return OfframpResponse(mode="safety", source="safety", safety=safety_payload(_region(req.region)))
    literal = req.wording_style == "literal"
    note, rest = offramp_reply(req.task, req.progress, literal)
    try:
        data, source = await _guarded_llm(
            prompts.offramp_messages(req),
            ["note_to_future_self", "rest_suggestion"],
            [req.task, *req.progress],
            literal=literal,
        )
        llm_note, llm_rest = _str(data.get("note_to_future_self")), _str(data.get("rest_suggestion"))
        if llm_note and llm_rest and len(llm_note.split()) <= 45 and len(llm_rest.split()) <= 40:
            return OfframpResponse(note_to_future_self=llm_note, rest_suggestion=llm_rest, source=source)  # type: ignore[arg-type]
    except Exception:  # help never breaks
        pass
    return OfframpResponse(note_to_future_self=note, rest_suggestion=rest, source="card")


# --------------------------------------------------------------- braindump ---


def _clean_items(v: Any) -> list[str]:
    if not isinstance(v, list):
        return []
    return [s.strip() for s in v if isinstance(s, str) and s.strip()][:12]


async def braindump(req: BrainDumpRequest) -> BrainDumpResponse:
    if _crisis(req.transcript):
        return BrainDumpResponse(mode="safety", source="safety", safety=safety_payload(_region(req.region)))
    groups, pick, alternatives = braindump_reply(req)
    if not req.transcript.strip():
        return BrainDumpResponse(groups=[], pick=None, alternatives=[], source="card")
    try:
        data, source = await _guarded_llm(prompts.braindump_messages(req), [], [req.transcript])
        llm_groups = [
            BrainDumpGroup(label=str(g.get("label", "Things"))[:30], items=_clean_items(g.get("items")))
            for g in data.get("groups", [])
            if isinstance(g, dict)
        ]
        llm_groups = [g for g in llm_groups if g.items]
        pk = data.get("pick") or {}
        if llm_groups and isinstance(pk, dict) and _str(pk.get("item")) and _str(pk.get("first_step")):
            texts = [pk.get("why", ""), pk.get("first_step", ""), *(g.label for g in llm_groups)]
            if any(copy_guard.find_banned(_without_user_terms(t, [req.transcript])) for t in texts if t):
                raise ValueError("copy rules")
            if req.wording_style == "literal" and any(
                copy_guard.find_idioms(t) for t in (pk.get("why", ""), pk.get("first_step", "")) if isinstance(t, str)
            ):
                raise ValueError("not literal")
            item = _str(pk.get("item")) or ""
            alts = _clean_items(data.get("alternatives")) or [
                i for g in llm_groups for i in g.items if i != item
            ]
            return BrainDumpResponse(
                groups=llm_groups,
                pick=BrainDumpPick(
                    item=item,
                    why=copy_guard.tidy(_str(pk.get("why")) or "It looks like the easiest one to start."),
                    first_step=copy_guard.tidy(_str(pk.get("first_step")) or ""),
                ),
                alternatives=[a for a in alts if a != item],
                source=source,  # type: ignore[arg-type]
            )
    except Exception:  # help never breaks
        pass
    return BrainDumpResponse(groups=groups, pick=pick, alternatives=alternatives, source="card")
