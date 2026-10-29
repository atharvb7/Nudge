"""Orchestration for the text endpoints: safety -> plan -> LLM -> copy guard -> card fallback."""

from __future__ import annotations

import logging
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


async def _guarded_llm(messages: list[dict], fields: list[str], user_terms: list[str | None]) -> tuple[dict, str]:
    """Call the LLM; if the reply breaks the copy rules retry once, then soft-rewrite.

    Raises llm.LLMUnavailable or ValueError when nothing usable came back.
    """
    data, source = await llm.chat_json(messages)

    def banned(d: dict) -> list[str]:
        words: list[str] = []
        for f in fields:
            v = d.get(f)
            if isinstance(v, str):
                words += copy_guard.find_banned(_without_user_terms(v, user_terms))
        return words

    words = banned(data)
    if words:
        retry = messages + [
            {"role": "assistant", "content": str(data)},
            {"role": "user", "content": copy_guard.REMINDER.format(words=", ".join(sorted(set(words))))},
        ]
        try:
            data, source = await llm.chat_json(retry, prefer=source)
        except llm.LLMUnavailable:
            pass
        if banned(data):
            for f in fields:
                if isinstance(data.get(f), str):
                    data[f] = copy_guard.soft_rewrite(data[f])
            if banned(data):
                raise ValueError("LLM reply kept breaking copy rules")
    for f in fields:
        if isinstance(data.get(f), str):
            data[f] = copy_guard.tidy(data[f])
    return data, source


# ---------------------------------------------------------------- sequence ---


async def sequence(req: SequenceRequest) -> SequenceResponse:
    if _crisis(req.task, req.transcript, req.task_tab_title):
        return SequenceResponse(mode="safety", source="safety", buttons=[], safety=safety_payload(_region(req.region)))

    p = plan(req)
    fallback = card_reply(req, p)
    grounding = [p.card] + list(p.alternatives or [])
    try:
        data, source = await _guarded_llm(
            prompts.sequence_messages(req, grounding),
            ["next_step", "why_one_line", "validation", "lead"],
            [req.task, req.task_tab_title],
        )
    except (llm.LLMUnavailable, ValueError, KeyError, TypeError) as exc:
        log.info("Serving card fallback (%s)", type(exc).__name__)
        return fallback

    step = _str(data.get("next_step"))
    if not step or len(step.split()) > MAX_STEP_WORDS:
        return fallback

    size = data.get("size") if data.get("size") in ("tiny", "small") else fallback.size
    if req.energy <= 2:
        size = "tiny"
    literal = req.wording_style == "literal"
    lead = fallback.lead
    llm_lead = _str(data.get("lead"))
    if not literal and llm_lead and len(llm_lead.split()) <= 15:
        lead = llm_lead
    validation = None
    if is_overwhelmed(req):
        v = _str(data.get("validation"))
        validation = v if v and len(v.split()) <= 25 else validation_for(req)
    suggest_rest = bool(data.get("suggest_rest")) or p.card.is_rest or wants_rest(req)

    return SequenceResponse(
        mode="coach",
        lead=lead,
        next_step=step,
        why_one_line=_str(data.get("why_one_line")) or fallback.why_one_line,
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
            prompts.offramp_messages(req), ["note_to_future_self", "rest_suggestion"], [req.task, *req.progress]
        )
        llm_note, llm_rest = _str(data.get("note_to_future_self")), _str(data.get("rest_suggestion"))
        if llm_note and llm_rest and len(llm_note.split()) <= 45:
            return OfframpResponse(note_to_future_self=llm_note, rest_suggestion=llm_rest, source=source)  # type: ignore[arg-type]
    except (llm.LLMUnavailable, ValueError, KeyError, TypeError):
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
    except (llm.LLMUnavailable, ValueError, KeyError, TypeError, AttributeError):
        pass
    return BrainDumpResponse(groups=groups, pick=pick, alternatives=alternatives, source="card")
