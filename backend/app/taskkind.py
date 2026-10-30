"""What kind of task is this, and how do we name it in a sentence?

Implements the shared rule in docs/ARCHITECTURE.md ("Task kinds"), which the
extension mirrors in shared/src/fallback.ts. Cards carry `task_kinds`, so a
chore never gets "empty headings" and a phone call never gets "the rubric".
"""

from __future__ import annotations

import re

KINDS = ("doc", "reading", "study", "code", "admin", "message", "chore", "any")

_RULES: list[tuple[str, str]] = [
    ("message", r"email|e-mail|mail|text|message|reply|call|ring|whatsapp|dm|ping|phone"),
    ("chore", r"laundry|clean|dishes|wash|tidy|cook|groceries|shopping|trash|vacuum|room|shower|iron|fold|bed"),
    ("admin", r"pay|fees?|bill|form|bank|apply|application|register|book|appointment|renew|passport|scholarship"),
    ("code", r"code|coding|bug|debug|program|script|leetcode|github|function|compile"),
    ("reading", r"read|reading|chapter|article|textbook"),
    ("study", r"study|revise|revision|exam|quiz|test|flashcards|lecture|practice"),
    ("doc", r"essay|write|writing|report|assignment|draft|thesis|presentation|slides|doc|document|resume|cv|letter"),
]
_RULES_RE = [(k, re.compile(rf"\b(?:{w})\b", re.I)) for k, w in _RULES]
_DOC_WORD = re.compile(r"\b(?:essay|write|writing|report|assignment|draft|thesis|presentation|slides|doc|document|resume|cv|letter)\b", re.I)
_PDF = re.compile(r"\.pdf\b|\bpdf\b", re.I)


def task_kind(text: str | None) -> str:
    """'doc' | 'reading' | ... | 'unknown' — first matching rule wins."""
    t = (text or "").replace("_", " ")
    if not t.strip():
        return "unknown"
    for kind, rx in _RULES_RE:
        if rx.search(t):
            return kind
    if _PDF.search(t) and not _DOC_WORD.search(t):
        return "reading"
    return "unknown"


def card_fits(task_kinds: tuple[str, ...] | list[str], kind: str) -> bool:
    kinds = set(task_kinds or ("any",))
    if "any" in kinds or kind in kinds:
        return True
    if kind == "unknown":
        return not kinds <= {"message", "chore"}
    return False


_TITLE_SUFFIX = re.compile(
    r"\s*(?:[-–—|]\s*(?:Google\s+(?:Docs|Sheets|Slides|Drive)|Microsoft\s+(?:Word|Excel|PowerPoint)|Word|Excel|PowerPoint"
    r"|Notion|Overleaf.*|YouTube|Mozilla\s+Firefox|Google\s+Chrome))+\s*$",
    re.I,
)
_APPS = r"Google\s+(?:Docs|Sheets|Slides|Drive)|Microsoft\s+(?:Word|Excel|PowerPoint)|Notion|Overleaf"
_TITLE_PREFIX = re.compile(rf"^(?:\(\d+\)\s*|(?:{_APPS})\s*[-–—|:]\s*)", re.I)
_UNTITLED = re.compile(r"^(?:untitled(?:\s+(?:document|spreadsheet|presentation|form))?|new\s+tab|untitled-\d+)$", re.I)


def clean_tab_title(title: str | None) -> str:
    t = re.sub(r"[{}]", "", title or "").strip()
    prev = None
    while prev != t:
        prev = t
        t = _TITLE_PREFIX.sub("", _TITLE_SUFFIX.sub("", t)).strip()
    return "" if _UNTITLED.match(t) else t


# ------------------------------------------------------------ noun phrases ---

_STRIP_VERBS = re.compile(
    r"^(?:(?:i\s+)?(?:need|have|want|gotta|got)\s+to\s+)?(?:do|finish|start|complete|get|work\s+on|get\s+started\s+on|begin|continue|"
    r"write|make|prepare|submit|draft|study\s+for|revise\s+for|revise|study|read|practice|practise|fix|debug)\s+",
    re.I,
)
_MSG = re.compile(r"^(?:email|e-mail|mail|text|message|whatsapp|dm|ping)\s+(?:to\s+)?(.+)$", re.I)
_REPLY = re.compile(r"^reply\s+(?:to\s+)?(.+)$", re.I)
_CALL = re.compile(r"^(?:call|ring|phone)\s+(?:back\s+)?(.+?)(?:\s+back)?$", re.I)
_CHORE = re.compile(r"^(?:do|clean|tidy|wash|fold|iron|cook|vacuum|take\s+out|buy|get)\s+(?:up\s+)?(.+)$", re.I)
_ADMIN = re.compile(r"^(?:pay|fill(?:\s+out|\s+in)?|book|renew|apply\s+for|register\s+for|submit)\s+(.+)$", re.I)
_DETERMINER = re.compile(r"^(?:my|your|the|a|an|this|that|our|his|her|their)\b", re.I)


def _you(s: str) -> str:
    s = re.sub(r"\bmy\b", "your", s, flags=re.I)
    s = re.sub(r"\bmyself\b", "yourself", s, flags=re.I)
    return re.sub(r"\bme\b", "you", s, flags=re.I)


def _with_det(obj: str, default: str = "your") -> str:
    obj = _you(obj.strip().rstrip(".!?"))
    if _DETERMINER.match(obj):
        return obj[0].lower() + obj[1:]
    if "_" in obj or re.search(r"\.\w{2,5}$", obj):
        return obj
    return f"{default} {obj}"


def noun_phrase(task: str, kind: str) -> str:
    """'call mom' → 'your call with mom'; 'do laundry' → 'the laundry'; 'write my essay' → 'your essay'."""
    t = re.sub(r"\s+", " ", task).strip().rstrip(".!?")
    if not t:
        return ""
    if m := _MSG.match(t):
        return f"your message to {_you(m.group(1))}"
    if m := _REPLY.match(t):
        return f"your reply to {_you(m.group(1))}"
    if m := _CALL.match(t):
        return f"your call with {_you(m.group(1))}"
    if kind == "chore" and (m := _CHORE.match(t)):
        return _with_det(m.group(1), "the")
    if kind == "admin" and (m := _ADMIN.match(t)):
        return _with_det(m.group(1), "the")
    stripped = _STRIP_VERBS.sub("", t)
    if kind == "chore":
        return _with_det(stripped, "the")
    return _with_det(stripped)


_OBJECT_WORDS = "|".join(w for _, w in _RULES)
_OBJECT = re.compile(rf"\b((?:my|the|this|that|our)\s+(?:\w+\s+){{0,2}}?(?:{_OBJECT_WORDS})s?)\b", re.I)
_BARE_OBJECT = re.compile(rf"\b((?:\w+\s+)?(?:{_OBJECT_WORDS})s?)\b", re.I)


def object_in(text: str) -> str:
    """'ugh I can't start my essay' → 'my essay' (the task hiding inside a feeling), or ''."""
    m = _OBJECT.search(text or "")
    if m:
        return m.group(1)
    m = _BARE_OBJECT.search(text or "")
    if m:
        words = m.group(1).split()
        return words[-1] if len(words) > 1 and words[0].lower() in {"start", "do", "my", "this", "cant", "can't", "the"} else m.group(1)
    return ""
