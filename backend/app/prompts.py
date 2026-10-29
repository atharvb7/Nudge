"""Prompts. SYSTEM_PROMPT is the exact text from the product spec."""

from __future__ import annotations

import json

from .models import BrainDumpRequest, OfframpRequest, SequenceRequest
from .strategies import Card

SYSTEM_PROMPT = (
    "You are a calm executive-function companion for a neurodivergent student. Give exactly ONE micro-step "
    "under 2 minutes, small enough to feel almost silly. Ask at most one question. Offer choices, never "
    "commands. Celebrate every attempt. If energy <= 2, shrink steps further or suggest rest. If the user "
    "seems overwhelmed, validate first in one sentence, then offer the step. Never shame; never mention "
    "deadlines or consequences.\n"
    "If wording_style = literal: use exact, concrete instructions with specific names and actions. No "
    "metaphors, idioms, or vague phrases. Example: 'Open the file DBMS_Assignment.pdf', not 'dip your toe "
    "in'. If the user enables 'explain why', add one plain sentence explaining the reason for the step."
)

HOUSE_RULES = (
    "House rules: never use the words 'should', 'overdue', 'deadline', 'streak' or any form of 'fail'. "
    "No pressure words (must, need to, hurry, lazy). Unfinished work is 'saved for later'. "
    "Keep next_step under 30 words. At most one exclamation mark. Do not mention time pressure, grades or "
    "consequences. Do not repeat any of the recent phrasings. next_step is ONE action only: no lists, no "
    "'then', no second step. Ask at most one question, and only as a gentle choice."
)

STYLE_EXAMPLES = {
    "warm": (
        "Style: warm & casual. Good next_step: \"Want to just open DBMS_Assignment.pdf and look at the first "
        "question? That's the whole step.\" Bad next_step: \"You should finish question 1 now, then start "
        "question 2.\" (a command, two steps, pressure)."
    ),
    "literal": (
        "Style: clear & literal. Good next_step: \"Open the file DBMS_Assignment.pdf. Read question 1 only.\" "
        "Bad next_step: \"Dip your toe in and get the ball rolling on the assignment.\" (idioms, vague). "
        "In literal style, lead must be null."
    ),
}

SEQUENCE_SCHEMA = {
    "lead": "optional string or null; a short warm invitation shown above the step (null in literal style)",
    "next_step": "string, ONE micro-step, under 30 words",
    "why_one_line": "string, one plain sentence on why this step helps",
    "size": "'tiny' or 'small'",
    "validation": "string or null; one validating sentence ONLY if the user seems overwhelmed",
    "suggest_rest": "boolean; true if rest is the kinder option right now",
}

_ACTION_HINTS = {
    "start": "The user is about to start. Offer the first micro-step.",
    "next": "The user finished the previous step. Celebrate briefly (a few words) and offer the next micro-step "
            "that builds on what they did.",
    "smaller": "The user asked to make the last step smaller. Offer a noticeably smaller version of the same idea.",
    "too_big": "The last step felt too big. Offer something much smaller and lower-effort; rest is a fine option.",
    "different": "The user wants a different idea. Use a different approach from the history.",
}


def _card_brief(card: Card, literal: bool) -> dict:
    return {
        "id": card.id,
        "name": card.name,
        "steps": list(card.literal_version if literal else card.steps),
        "why_it_works": card.why_it_works,
        "size": card.size,
    }


def sequence_messages(req: SequenceRequest, cards: list[Card]) -> list[dict]:
    literal = req.wording_style == "literal"
    context = {
        "task": req.task or None,
        "task_tab_title": req.task_tab_title or None,
        "state": req.state,
        "energy_1_to_5": req.energy,
        "wording_style": req.wording_style,
        "explain_why": req.explain_why,
        "what_user_said": (req.transcript[-2000:] or None),
        "history_this_session": [h.model_dump() for h in req.history],
        "recent_phrasings_to_avoid": req.recent_phrasings[-5:],
        "instruction": _ACTION_HINTS.get(req.action, _ACTION_HINTS["start"]),
        "use_this_strategy": _card_brief(cards[0], literal),
        "other_options": [c.name for c in cards[1:3]],
    }
    user = (
        "Context (JSON):\n"
        + json.dumps(context, ensure_ascii=False)
        + "\n\nBase your step on use_this_strategy, adapted to the user's task. "
        + ("Name the exact file or item from task_tab_title/task. " if literal else "")
        + "Reply with ONLY a JSON object with these keys: "
        + json.dumps(SEQUENCE_SCHEMA)
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT + "\n" + HOUSE_RULES + "\n" + STYLE_EXAMPLES[req.wording_style]},
        {"role": "user", "content": user},
    ]


def offramp_messages(req: OfframpRequest) -> list[dict]:
    ctx = {
        "task": req.task or None,
        "progress_this_session": req.progress[-8:],
        "energy_1_to_5": req.energy,
        "wording_style": req.wording_style,
    }
    user = (
        "The user is ending their session (calling it a day). Context (JSON):\n"
        + json.dumps(ctx, ensure_ascii=False)
        + "\n\nWrite a kind one-line note_to_future_self (from the user to themselves, first person, saying where "
        "they got to and the tiniest next step for next time; if progress is empty, say the task is saved for "
        "later and the first step is just opening it). Then a rest_suggestion: one gentle, restorative idea, "
        "offered as a choice. No guilt. Reply with ONLY JSON: "
        '{"note_to_future_self": "string", "rest_suggestion": "string"}'
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT + "\n" + HOUSE_RULES},
        {"role": "user", "content": user},
    ]


def braindump_messages(req: BrainDumpRequest) -> list[dict]:
    user = (
        "The user did a brain dump (rambling, by voice). Here it is:\n<<<\n"
        + req.transcript[:4000]
        + "\n>>>\n"
        f"Energy: {req.energy}/5. Wording style: {req.wording_style}.\n"
        "Group the separate to-do items into 2-4 short groups (labels of 1-2 words). Keep each item short, in the "
        "user's own words. Then pick ONE item that is easiest to start right now (lowest effort, clearest first "
        "action) and give a one-sentence why and one micro first_step under 2 minutes. List the other items as "
        "alternatives. Reply with ONLY JSON: "
        '{"groups": [{"label": "string", "items": ["string"]}], '
        '"pick": {"item": "string", "why": "string", "first_step": "string"}, "alternatives": ["string"]}'
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT + "\n" + HOUSE_RULES},
        {"role": "user", "content": user},
    ]
