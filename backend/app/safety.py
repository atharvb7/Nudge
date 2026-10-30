"""Crisis-language classifier.

Runs on every free-text input before anything else. If it fires, coaching
stops and the user gets warmth + resources. Matched text is never logged
or stored.

Design choices:
* Err on the side of care: explicit self-harm language always triggers, even
  when it might be hyperbole ("this essay makes me want to kill myself").
* Common study idioms ("this is killing me", "dead tired", "kill this bug")
  are removed before matching so they don't trigger.
* A small negation guard handles "I'm not suicidal" / "I don't want to die",
  but never for phrases that are themselves negative ("don't want to live").
"""

from __future__ import annotations

import re

from .models import Resource, SafetyPayload

from . import crisis_patterns as P

_IDIOM_RE = [re.compile(p, re.I) for p in P.IDIOMS]
_EXPLICIT_RE = [re.compile(p, re.I) for p in P.HIGH]
_HOPELESS_RE = [re.compile(p, re.I) for p in P.CONCERN]
_NEGATABLE = re.compile(P.NEGATABLE, re.I)
_NEGATION_BEFORE = re.compile(P.NEGATION_BEFORE, re.I)


def _normalise(text: str) -> str:
    """Same steps as normalise() in shared/src/crisis.ts — keep them identical."""
    t = (text or "").replace("’", "'").replace("‘", "'").replace("`", "'")
    t = t.replace("'", "")
    t = re.sub(r"\s+", " ", t).strip()
    for rx in _IDIOM_RE:
        t = rx.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def _hit(patterns: list[re.Pattern[str]], text: str, allow_negation: bool) -> bool:
    for rx in patterns:
        for m in rx.finditer(text):
            if allow_negation and _NEGATABLE.match(m.group(0)):
                before = text[max(0, m.start() - 24) : m.start()]
                if _NEGATION_BEFORE.search(before):
                    continue
            return True
    return False


# Semantic safety net: phrase lists always miss some new wording, so when the
# MiniLM model is loaded we also compare the message's *meaning* against
# crisis examples vs. ordinary study-stress examples. It can only escalate to
# the gentler "hopeless" level (which offers "I'm safe — just frustrated").
_CRISIS_EXAMPLES = [
    "I want to die", "I want to end my life", "I don't want to live anymore", "I'm done with my life",
    "I want to kill myself", "there is no point in living", "everyone would be better off without me",
    "I want to disappear forever", "I can't go on anymore", "I'm thinking about suicide", "I want to hurt myself",
    "life isn't worth it", "I feel hopeless and empty", "I'm worthless and nobody cares", "I wish I wasn't alive",
    "I'm tired of being alive", "I want it all to be over", "I can't take this pain anymore",
    "I don't see a future for myself", "nobody would miss me if I was gone",
]
_STRESS_EXAMPLES = [
    "I'm stuck on my assignment", "this homework is so boring", "I'm tired and want to sleep",
    "I'm stressed about my exam", "I can't focus on this essay", "I'm done with this assignment",
    "I hate this subject", "I'm so bad at maths", "this code is killing me", "I'm overwhelmed with work",
    "I want to quit this course", "I'm exhausted after the lecture", "I give up on this problem", "I need a break",
    "I don't want to do this task", "I'm procrastinating again", "ugh I can't start", "I feel lazy today",
    "my brain is fried", "I want to disappear into a book",
]
SEMANTIC_MIN = 0.55  # similarity to the closest crisis example
SEMANTIC_MARGIN = 0.15  # ...and this much closer than to any study-stress example
_NEGATED_CRISIS = re.compile(r"\b(?:not|never)\s+(?:suicidal|going\s+to\s+hurt\s+myself)\b|\bdon'?t\s+want\s+to\s+die\b", re.I)
_example_vectors = None


def _semantic_hit(text: str) -> bool:
    global _example_vectors
    from . import retrieval  # local import: retrieval imports nothing from here

    model = getattr(retrieval.semantic_model(), "encode", None)
    if model is None or len(text) < 8 or _NEGATED_CRISIS.search(text):
        return False
    try:
        if _example_vectors is None:
            _example_vectors = (
                model(_CRISIS_EXAMPLES, normalize_embeddings=True),
                model(_STRESS_EXAMPLES, normalize_embeddings=True),
            )
        crisis, stress = _example_vectors
        # long rambles: check each sentence so one worrying line isn't diluted
        parts = [p for p in re.split(r"(?<=[.!?])\s+|\n+", text[:4000]) if len(p.strip()) >= 8] or [text]
        vecs = model(parts[:40], normalize_embeddings=True)
        for v in vecs:
            c, s = float((crisis @ v).max()), float((stress @ v).max())
            if c >= SEMANTIC_MIN and c - s >= SEMANTIC_MARGIN:
                return True
    except Exception:  # never let the safety net break a request
        return False
    return False


def classify(text: str) -> str | None:
    """Return "explicit", "hopeless" or None. Never logs the text."""
    t = _normalise(text)
    if not t:
        return None
    if _hit(_EXPLICIT_RE, t, allow_negation=True):
        return "explicit"
    if _hit(_HOPELESS_RE, t, allow_negation=False):
        return "hopeless"
    if _semantic_hit(t):
        return "hopeless"
    return None


RESOURCES: dict[str, list[Resource]] = {
    "IN": [
        Resource(name="Tele-MANAS", phone="14416", alt="1-800-891-4416",
                 note="Free, 24x7, government mental health helpline. Many Indian languages."),
        Resource(name="Emergency", phone="112", note="If you're in immediate danger."),
    ],
    "US": [
        Resource(name="988 Suicide & Crisis Lifeline", phone="988", note="Call or text, 24/7, free."),
        Resource(name="Emergency", phone="911", note="If you're in immediate danger."),
    ],
    "CA": [
        Resource(name="9-8-8 Suicide Crisis Helpline", phone="988", note="Call or text, 24/7, free."),
        Resource(name="Emergency", phone="911", note="If you're in immediate danger."),
    ],
    "UK": [
        Resource(name="Samaritans", phone="116 123", note="Free, 24/7, any time of day or night."),
        Resource(name="Emergency", phone="999", note="If you're in immediate danger."),
    ],
    "AU": [
        Resource(name="Lifeline", phone="13 11 14", note="24/7 crisis support."),
        Resource(name="Emergency", phone="000", note="If you're in immediate danger."),
    ],
    "OTHER": [
        Resource(name="Find A Helpline", url="https://findahelpline.com",
                 note="Free, confidential helplines in your country."),
        Resource(name="Emergency", note="Your local emergency number, if you're in immediate danger."),
    ],
}
RESOURCES["GB"] = RESOURCES["UK"]


def resources_for(region: str | None, default: str = "IN") -> list[Resource]:
    key = (region or default or "OTHER").upper()
    return RESOURCES.get(key, RESOURCES["OTHER"])


def safety_payload(region: str | None, default: str = "IN") -> SafetyPayload:
    return SafetyPayload(
        crisis=True,
        message=(
            "I'm really glad you told me. It sounds like you're carrying something very heavy right now, "
            "and you deserve real support with it. Let's put the task aside completely — it can wait. "
            "You don't have to go through this alone."
        ),
        resources=resources_for(region, default),
        reach_out=(
            "If you can, reach out to someone you trust — a friend, family member, or someone on campus — "
            "and tell them how you're feeling. Talking to one of the people above is also okay, any time."
        ),
    )


def check(*texts: str | None) -> bool:
    return any(classify(t or "") for t in texts)
