"""Keeps every word Nudge says inside the copy rules.

Never: "should", "overdue", "deadline", "streak", "fail*", or pressure/shame
language. Unfinished work is "saved for later".

Flow for LLM text: check -> (caller retries once with a reminder) ->
soft_rewrite -> if still not clean, caller falls back to a pre-written card.
"""

from __future__ import annotations

import re

BANNED_RE = re.compile(r"\b(should(?:n'?t)?|overdue|deadlines?|streaks?|fail\w*)\b", re.I)

# Pressure / shame language. Not in the hard banned list from the spec, but
# just as unwelcome for someone with rejection sensitivity.
SHAME_RE = re.compile(
    r"\b(lazy|laziness|procrastinat\w*|no excuses?|just do it|you must|you need to|you have to|"
    r"hurry( up)?|asap|urgent(ly)?|immediately|right now!|come on|get it together|disappoint\w*|behind schedule|"
    r"late again|wasted?|wasting)\b",
    re.I,
)

_REWRITES: list[tuple[str, str]] = [
    (r"\byou should(?:n'?t)? (?:probably |really )?", "you could "),
    (r"\bshouldn'?t\b", "don't have to"),
    (r"\bshould\b", "could"),
    (r"\boverdue\b", "saved for later"),
    (r"\bdeadlines\b", "hand-in dates"),
    (r"\bdeadline\b", "hand-in date"),
    (r"\bstreaks\b", "wins"),
    (r"\bstreak\b", "run of wins"),
    (r"\bfailures?\b", "pause"),
    (r"\bfailed\b", "paused"),
    (r"\bfailing\b", "finding it hard"),
    (r"\bfails?\b", "doesn't work out"),
    (r"\bfail\w*\b", "pause"),
    (r"\byou must\b", "you could"),
    (r"\byou need to\b", "you could"),
    (r"\byou have to\b", "you could"),
    (r"\bno excuses?\b", ""),
    (r"\bjust do it\b", "try a tiny bit"),
    (r"\bstop procrastinating\b", ""),
    (r"\bprocrastinat\w*\b", "feeling stuck"),
    (r"\blaziness\b", "low energy"),
    (r"\blazy\b", "low on energy"),
    (r"\bhurry(?: up)?\b", "take your time"),
    (r"\b(?:asap|urgent(?:ly)?|immediately)\b", "when you're ready"),
    (r"\bcome on\b", ""),
    (r"\bget it together\b", ""),
]
_REWRITES_RE = [(re.compile(p, re.I), r) for p, r in _REWRITES]


def find_banned(text: str) -> list[str]:
    t = text or ""
    return [m.group(0) for m in BANNED_RE.finditer(t)] + [m.group(0) for m in SHAME_RE.finditer(t)]


def is_clean(text: str) -> bool:
    return not find_banned(text)


def tidy(text: str) -> str:
    """Calm punctuation and whitespace."""
    t = re.sub(r"!{2,}", "!", text or "")
    # At most one exclamation mark per message.
    first = t.find("!")
    if first != -1:
        t = t[: first + 1] + t[first + 1 :].replace("!", ".")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\s+([,.!?])", r"\1", t)
    t = re.sub(r"([,.])\1+", r"\1", t)
    return t.strip(" ,")


def soft_rewrite(text: str) -> str:
    t = text or ""
    for rx, repl in _REWRITES_RE:
        t = rx.sub(repl, t)
    t = tidy(t)
    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    return t


REMINDER = (
    "Rewrite your answer. It used words that break Nudge's copy rules: {words}. "
    "Never use 'should', 'overdue', 'deadline', 'streak', 'fail', or pressure words like "
    "'must', 'need to', 'lazy', 'hurry'. Offer choices gently. Same JSON format."
)
