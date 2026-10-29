"""Pre-written, card-based replies. Used when no LLM is reachable (or the LLM
reply breaks the copy rules) so help never breaks.

Also decides *which* card and step we're on (`plan`), which the LLM path uses
as grounding too.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from .models import BUTTONS, BrainDumpGroup, BrainDumpPick, BrainDumpRequest, SequenceRequest, SequenceResponse
from .ranking import rank, wants_rest
from .strategies import Card, cards_by_id

# ----------------------------------------------------------------- wording ---

_FILE_RE = re.compile(r"\.(pdf|docx?|pptx?|xlsx?|txt|md|ipynb|py|java|c|cpp|js|ts|csv|odt|key|pages)\b", re.I)
_DETERMINERS = ("my ", "the ", "a ", "an ", "your ", "this ", "that ", "our ")
_VERBS = {
    "email", "write", "read", "study", "finish", "do", "start", "call", "submit", "revise", "fix", "clean",
    "make", "prepare", "review", "practice", "practise", "code", "reply", "book", "pay", "apply", "learn",
    "watch", "text", "message", "plan", "organise", "organize", "tidy", "wash", "cook", "buy", "send", "fill",
    "complete", "edit", "draft", "research", "outline", "solve", "debug", "go", "get", "update", "file",
}


_FEELING_RE = re.compile(
    r"\b(i['’]?m|i am|i feel|feeling|killing me|stuck|can['’]?t|cannot|overwhelm\w*|tired|exhausted|hate|ugh|so much|too much)\b",
    re.I,
)


def looks_like_feeling(text: str) -> bool:
    """'this assignment is killing me' is a feeling, not a task name to quote back."""
    t = (text or "").strip()
    return bool(t) and (len(t) > 70 or len(t.split()) > 10 or bool(_FEELING_RE.search(t)))


def task_label(req_task: str, tab_title: str | None, literal: bool) -> str:
    task = re.sub(r"[{}]", "", (req_task or "")).strip().rstrip(".")
    tab_title = re.sub(r"[{}]", "", tab_title or "")
    if looks_like_feeling(task):
        task = ""
    title = (tab_title or "").strip()
    if literal:
        if title:
            return f"the file {title}" if _FILE_RE.search(title) else title
        if task:
            return f"the file {task}" if _FILE_RE.search(task) else f"“{task}”"
        return "your task"
    if task:
        low = task.lower()
        if _FILE_RE.search(task) or low.startswith(_DETERMINERS):
            return task
        if low.split()[0] in _VERBS:
            return f"“{task}”"
        return f"your {task}"
    if title:
        return title
    return "your task"


def fill(text: str, label: str) -> str:
    out = text.replace("{task}", label)
    # Capitalise sentence starts that began with the placeholder.
    out = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)
    return out


def _pick(options: list[str], avoid: list[str], salt: str) -> str:
    """Rotate through options, skipping anything said recently."""
    if not options:
        return ""
    avoid_set = {a.strip().lower() for a in avoid}
    start = int(hashlib.sha1(salt.encode()).hexdigest()[:6], 16) % len(options)
    rotated = options[start:] + options[:start]
    for o in rotated:
        if o.strip().lower() not in avoid_set:
            return o
    return rotated[0]


_OVERWHELM_RE = re.compile(
    r"overwhelm|too much|so much|too many|everything|can'?t think|drowning|panic|anxious|anxiety|stressed|"
    r"freaking out|spiral|too big|no idea where|all at once|so many",
    re.I,
)

_VALIDATIONS_WARM = [
    "That sounds like a lot to hold at once.",
    "It makes complete sense to feel stuck with this much going on.",
    "This feels heavy, and that's okay.",
]
_VALIDATIONS_LITERAL = ["This is a lot. That is okay.", "Feeling stuck with a lot of work is common."]

_LEADS = {
    "next": (["Nice, that counts.", "You did it. Here's another tiny one, if you want it.", "That's a real start."],
             "Step done. Next step:"),
    "smaller": (["Even smaller, then.", "Let's shrink it right down."], "Smaller step:"),
    "too_big": (["Totally fair. Let's go lighter.", "No problem. Something gentler:"], "Easier step:"),
    "different": (["Sure, here's another idea.", "Let's try a different door."], "Different step:"),
}


def is_overwhelmed(req: SequenceRequest) -> bool:
    return req.state == "overwhelmed" or bool(_OVERWHELM_RE.search(f"{req.transcript} {req.task}"))


def validation_for(req: SequenceRequest) -> str | None:
    if not is_overwhelmed(req):
        return None
    pool = _VALIDATIONS_LITERAL if req.wording_style == "literal" else _VALIDATIONS_WARM
    return _pick(pool, req.recent_phrasings, f"v{len(req.history)}{req.task}")


# -------------------------------------------------------------------- plan ---

_SHRINK_TO = ["first_physical_action", "just_open_it", "one_percent", "set_up_space"]


@dataclass
class Plan:
    card: Card
    step_index: int
    shrink_of: str | None = None  # previous step text when action == "smaller"
    alternatives: list[Card] | None = None


def _current_card(req: SequenceRequest) -> tuple[Card | None, str | None]:
    by_id = cards_by_id()
    for h in reversed(req.history):
        if h.strategy_id and h.strategy_id in by_id:
            return by_id[h.strategy_id], h.step
    return None, None


def plan(req: SequenceRequest) -> Plan:
    by_id = cards_by_id()
    current, last_step = _current_card(req)

    if req.action == "next" and current is not None:
        done_here = sum(1 for h in req.history if h.strategy_id == current.id and h.outcome == "done")
        if done_here < len(current.steps):
            return Plan(current, done_here)
        # Finished this card: pick a fresh one, not used this session.
        exclude = list(req.exclude_ids) + [h.strategy_id for h in req.history if h.strategy_id]
        ranked = rank(req.model_copy(update={"exclude_ids": exclude, "action": "different"}))
        return Plan(ranked[0].card, 0, alternatives=[r.card for r in ranked[1:]])

    if req.action == "smaller" and current is not None:
        if last_step and _shrink(last_step, literal=False) is not None:
            return Plan(current, 0, shrink_of=last_step)
        used = {h.strategy_id for h in req.history}
        for cid in _SHRINK_TO:
            if cid in by_id and cid not in used and cid not in req.exclude_ids:
                return Plan(by_id[cid], 0)
        return Plan(by_id.get("just_open_it", current), 0)

    ranked = rank(req)
    return Plan(ranked[0].card, 0, alternatives=[r.card for r in ranked[1:]])


_CLAUSE_SPLIT = re.compile(r"(?:,\s*then\s+|\s+then\s+|\s+and\s+|,\s+|:\s+|\s+[—–-]\s+|;\s+|\.\s+)", re.I)


def _shrink(step: str, literal: bool) -> str | None:
    """Turn a step into a smaller one by keeping only its first action."""
    s = step.strip()
    for prefix in ("Even smaller: just ", "Smaller step: ", "Just "):
        if s.startswith(prefix):
            return None  # already shrunk once: switch card instead
    first = _CLAUSE_SPLIT.split(s, maxsplit=1)[0].strip().rstrip(".!?")
    words = first.split()
    if len(words) < 3 or first.lower() == s.lower().rstrip(".!?"):
        return None
    if literal:
        return f"Smaller step: {first[0].upper()}{first[1:]}. Only do this."
    return f"Even smaller: just {first[0].lower()}{first[1:]}. That's the whole step."


# ---------------------------------------------------------------- sequence ---


def card_reply(req: SequenceRequest, p: Plan | None = None) -> SequenceResponse:
    p = p or plan(req)
    literal = req.wording_style == "literal"
    label = task_label(req.task, req.task_tab_title, literal)
    card = p.card
    idx = min(p.step_index, len(card.steps) - 1)

    next_step = None
    if p.shrink_of:
        next_step = _shrink(p.shrink_of, literal)
    if not next_step:
        steps = card.literal_version if literal else card.steps
        next_step = fill(steps[min(idx, len(steps) - 1)], label)

    salt = f"{card.id}{len(req.history)}{req.action}"
    if req.action in _LEADS:
        warm, lit = _LEADS[req.action]
        lead = lit if literal else _pick(warm, req.recent_phrasings, salt)
    elif literal:
        lead = "Next step:"
    else:
        lead = _pick([fill(ph, label) for ph in card.phrasings], req.recent_phrasings, salt) or None

    rest = card.is_rest or wants_rest(req)
    return SequenceResponse(
        mode="coach",
        lead=lead,
        next_step=next_step,
        why_one_line=card.why_it_works,
        size="tiny" if req.energy <= 2 else card.size,  # type: ignore[arg-type]
        buttons=list(BUTTONS),
        strategy_id=card.id,
        strategy_name=card.name,
        validation=validation_for(req),
        suggest_rest=rest,
        source="card",
    )


# ----------------------------------------------------------------- offramp ---


def offramp_reply(task: str, progress: list[str], literal: bool) -> tuple[str, str]:
    label = task_label(task, None, literal)
    done = [p.strip().rstrip(".") for p in progress if p and p.strip()]
    if literal:
        note = (
            f"Last step done: {done[-1]}. Next time: open {label} and continue from there."
            if done
            else f"{fill('{task}', label)} is saved for later. Next time: open it."
        )
        rest = "Optional: drink water, stretch, or step outside for 10 minutes."
    else:
        note = (
            f"Hey future me: I got as far as “{done[-1]}”. Next time, just open {label} and pick up from there."
            if done
            else f"Hey future me: {label} is saved for later. Next time, the first step is just opening it."
        )
        rest = "If you like: some water, a stretch, a little music, or a few minutes outside. Whatever feels kind."
    return note, rest


# --------------------------------------------------------------- braindump ---

_SPLIT_RE = re.compile(
    r"(?:\n|;|,|\.\s|\bthen\b|\balso\b|\band then\b|\band also\b|\bplus\b|\band\b|\boh and\b|\bi need to\b|"
    r"\bi have to\b|\bi gotta\b|\bi've got to\b|\bi should\b|\bneed to\b|\bhave to\b)",
    re.I,
)
_FILLER_RE = re.compile(
    r"^(?:um+|uh+|like|so|okay|ok|well|basically|i mean|i guess|and|also|maybe|i think|i want to|i wanna|to|"
    r"i still|still|i|ugh|hmm+)\b[\s,]*",
    re.I,
)

_BUCKETS: list[tuple[str, tuple[str, ...]]] = [
    ("Uni", ("assignment", "essay", "lab", "lecture", "exam", "study", "revise", "homework", "project", "thesis",
             "dbms", "class", "course", "quiz", "report", "notes", "chapter", "paper", "submit", "professor",
             "prof", "tutorial", "code", "coding", "math", "maths", "presentation", "reading")),
    ("People", ("email", "call", "text", "message", "reply", "mom", "mum", "dad", "friend", "ask", "meet",
                "birthday", "whatsapp", "roommate", "sister", "brother")),
    ("Admin", ("pay", "bill", "fee", "form", "bank", "book", "appointment", "renew", "register", "apply",
               "application", "document", "passport", "scholarship", "rent", "print")),
    ("Home & body", ("laundry", "clean", "dishes", "cook", "groceries", "shop", "room", "shower", "sleep", "eat",
                     "gym", "walk", "water", "tidy", "wash", "doctor", "medicine", "meds")),
]

# Rough "how easy is it to start" heuristic: quick verbs score lower (better).
_QUICK = ("email", "text", "message", "reply", "call", "pay", "book", "print", "submit", "send", "drink", "eat")
_HEAVY = ("essay", "thesis", "project", "exam", "revise", "study", "report", "assignment", "lab", "presentation")


def split_items(transcript: str) -> list[str]:
    parts = _SPLIT_RE.split(transcript or "")
    items: list[str] = []
    seen: set[str] = set()
    for raw in parts:
        t = raw.strip(" .,!?-–—\t\r\n\"'")
        prev = None
        while prev != t:
            prev = t
            t = _FILLER_RE.sub("", t).strip(" .,!?-")
        if len(t.split()) < 1 or len(t) < 3:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(t[0].upper() + t[1:] if t else t)
    return items[:12]


def bucket_of(item: str) -> str:
    low = item.lower()
    for label, words in _BUCKETS:
        if any(re.search(rf"\b{re.escape(w)}", low) for w in words):
            return label
    return "Other"


def ease(item: str) -> float:
    low = item.lower()
    score = len(item.split())
    if any(re.search(rf"\b{w}", low) for w in _QUICK):
        score -= 4
    if any(re.search(rf"\b{w}", low) for w in _HEAVY):
        score += 4
    return score


def braindump_reply(req: BrainDumpRequest) -> tuple[list[BrainDumpGroup], BrainDumpPick | None, list[str]]:
    items = split_items(req.transcript)
    if not items:
        return [], None, []
    groups: dict[str, list[str]] = {}
    for it in items:
        groups.setdefault(bucket_of(it), []).append(it)
    order = [b for b, _ in _BUCKETS] + ["Other"]
    group_list = [BrainDumpGroup(label=g, items=groups[g]) for g in order if g in groups]
    pick_item = min(items, key=ease)
    literal = req.wording_style == "literal"
    if literal:
        why = "This item looks like the quickest one to start."
        first = f"Write down the first action for “{pick_item}”. Then do that action."
    else:
        why = "It looks like the quickest one to get moving on. You can swap it any time."
        first = f"Just open whatever you'd need for “{pick_item}”. That's the whole first step."
    alternatives = [i for i in items if i != pick_item]
    return group_list, BrainDumpPick(item=pick_item, why=why, first_step=first), alternatives
