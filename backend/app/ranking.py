"""Strategy ranking: semantic match x state/energy filter x personal score.

The personal score comes from the extension (Thompson samples over the
user's own 👍/👎 history), so the backend never needs to store anything.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass

from .models import SequenceRequest
from . import retrieval
from .strategies import Card, cards_by_id, load_cards
from .taskkind import card_fits, clean_tab_title, task_kind

DEFAULT_PERSONAL = 0.5

# How well a card written for one state fits another.
_RELATED: dict[str, set[str]] = {
    "stuck": {"restuck", "overwhelmed"},
    "restuck": {"stuck"},
    "overwhelmed": {"stuck", "depleted"},
    "depleted": {"overwhelmed"},
}


@dataclass
class Ranked:
    card: Card
    score: float
    semantic: float
    personal: float


def state_fit(card: Card, state: str) -> float:
    target = "stuck" if state == "neutral" else state
    if "any" in card.for_state or target in card.for_state:
        return 1.0
    if card.for_state and set(card.for_state) & _RELATED.get(target, set()):
        return 0.55
    return 0.25


def build_query(req: SequenceRequest) -> str:
    parts = [req.task, req.task_tab_title or "", req.transcript]
    return " ".join(p for p in parts if p).strip()


def _seed(req: SequenceRequest) -> int:
    key = f"{build_query(req)}|{len(req.history)}|{req.action}|{len(req.recent_phrasings)}|{','.join(req.exclude_ids)}"
    return int(hashlib.sha1(key.encode()).hexdigest()[:8], 16)


def declined_rest(req: SequenceRequest) -> bool:
    """A rest card was already offered this session and the student asked for a step anyway."""
    by_id = cards_by_id()
    return any(h.strategy_id in by_id and by_id[h.strategy_id].is_rest for h in req.history)


def wants_rest(req: SequenceRequest) -> bool:
    """Rest-first when depleted or running on empty — but never twice over the student's choice."""
    if declined_rest(req):
        return False
    if req.energy <= 1 or (req.energy <= 2 and req.action == "too_big"):
        return True
    return req.state == "depleted" and req.action == "start"


def kind_of(req: SequenceRequest) -> str:
    kind = task_kind(req.task)
    return kind if kind != "unknown" else task_kind(clean_tab_title(req.task_tab_title))


def rank(req: SequenceRequest, limit: int = 5) -> list[Ranked]:
    cards = load_cards()
    sims = retrieval.similarities(build_query(req))
    top = max(sims.values(), default=0.0)
    personal = {p.id: p.score for p in req.top_strategies}
    rng = random.Random(_seed(req))

    explicit_excluded = set(req.exclude_ids)
    history_excluded: set[str] = set()
    if req.action in ("different", "too_big"):
        history_excluded = {h.strategy_id for h in req.history if h.strategy_id}
    recently_used = {h.strategy_id for h in req.history if h.strategy_id}
    rest_mode = wants_rest(req)
    kind = kind_of(req)

    # relax 0: every filter; 1: allow cards used earlier this session;
    # 2: allow explicitly excluded cards; 3: allow "small" cards at low energy;
    # 4: allow cards written for other kinds of task.
    def candidates(relax: int) -> list[Ranked]:
        out: list[Ranked] = []
        for c in cards:
            if relax < 4 and not card_fits(c.task_kinds, kind):
                continue
            if relax < 1 and c.id in history_excluded:
                continue
            if relax < 2 and c.id in explicit_excluded:
                continue
            if c.min_energy > req.energy:
                continue
            if req.energy <= 2 and c.size != "tiny" and relax < 3:
                continue
            semantic = 1.0 if top <= 0 else 0.4 + 0.6 * (sims.get(c.id, 0.0) / top)
            p = max(0.05, personal.get(c.id, DEFAULT_PERSONAL))
            score = semantic * state_fit(c, req.state) * p
            if rest_mode:
                score *= 1.6 if c.is_rest else (1.15 if c.min_energy == 1 else 0.8)
            elif c.is_rest and req.state not in ("depleted", "overwhelmed"):
                score *= 0.35  # don't jump to "rest" when the user asked for help starting
            if req.action == "start" and c.id in recently_used:
                score *= 0.7
            score *= rng.uniform(0.96, 1.04)
            out.append(Ranked(c, score, semantic, p))
        return out

    ranked: list[Ranked] = []
    for relax in range(5):
        ranked = candidates(relax)
        if ranked:
            break
    ranked.sort(key=lambda r: r.score, reverse=True)
    return ranked[:limit]
