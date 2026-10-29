"""Request/response schemas. Mirrors docs/ARCHITECTURE.md."""

from __future__ import annotations

import math
from typing import Any, Literal, Optional, get_args

from pydantic import BaseModel, Field, field_validator

State = Literal["stuck", "restuck", "depleted", "overwhelmed", "neutral"]
Outcome = Literal["done", "too_big", "smaller", "different", "rest"]
Action = Literal["start", "too_big", "smaller", "different", "next"]
WordingStyle = Literal["warm", "literal"]
Size = Literal["tiny", "small"]

BUTTONS: list[str] = ["done", "too_big", "smaller", "different", "rest"]

# Input limits. Help must never break, so oversized or sloppy input is
# trimmed / coerced instead of rejected (crisis checks still see the long text).
MAX_TASK = 300
MAX_TEXT = 20_000
MAX_ITEM = 500
MAX_LIST = 100


def _text(v: Any, limit: int) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        v = str(v) if isinstance(v, (int, float)) else ""
    return v.replace("\x00", "")[:limit]


def _opt_text(v: Any, limit: int) -> Optional[str]:
    t = _text(v, limit)
    return t if t.strip() else None


def _choice(v: Any, allowed: tuple, default: str) -> str:
    return v if isinstance(v, str) and v in allowed else default


def _energy(v: Any) -> int:
    try:
        f = float(v)
        if math.isnan(f):
            return 3
        return max(1, min(5, int(round(f))))
    except (TypeError, ValueError, OverflowError):
        return 3


def _list(v: Any, limit: int = MAX_LIST) -> list:
    if v is None:
        return []
    return list(v)[-limit:] if isinstance(v, (list, tuple)) else []


def _str_list(v: Any, limit: int = MAX_LIST, item: int = MAX_ITEM) -> list[str]:
    return [_text(x, item) for x in _list(v, limit) if isinstance(x, str)]


def _region_code(v: Any) -> Optional[str]:
    t = _text(v, 8).strip().upper()
    return t or None


class HistoryItem(BaseModel):
    step: str = ""
    outcome: Optional[Outcome] = None
    strategy_id: Optional[str] = None

    @field_validator("step", mode="before")
    @classmethod
    def _step(cls, v):
        return _text(v, MAX_ITEM)

    @field_validator("outcome", mode="before")
    @classmethod
    def _outcome(cls, v):
        return v if v in get_args(Outcome) else None

    @field_validator("strategy_id", mode="before")
    @classmethod
    def _sid(cls, v):
        return _opt_text(v, 80)


class PersonalScore(BaseModel):
    id: str
    score: float = 0.5

    @field_validator("id", mode="before")
    @classmethod
    def _id(cls, v):
        return _text(v, 80)

    @field_validator("score", mode="before")
    @classmethod
    def _score(cls, v):
        # Thompson samples live in 0..1; clamp anything else (NaN/None → neutral).
        try:
            f = float(v)
        except (TypeError, ValueError):
            return 0.5
        if math.isnan(f):
            return 0.5
        return max(0.0, min(1.0, f))


class Resource(BaseModel):
    name: str
    phone: Optional[str] = None
    alt: Optional[str] = None
    url: Optional[str] = None
    note: Optional[str] = None


class SafetyPayload(BaseModel):
    crisis: bool = True
    message: str
    resources: list[Resource]
    reach_out: str = ""


class NotCrisis(BaseModel):
    crisis: bool = False


class SequenceRequest(BaseModel):
    task: str = ""
    task_tab_title: Optional[str] = None
    state: State = "stuck"
    energy: int = Field(3, ge=1, le=5)
    history: list[HistoryItem] = Field(default_factory=list)
    transcript: str = ""
    top_strategies: list[PersonalScore] = Field(default_factory=list)
    exclude_ids: list[str] = Field(default_factory=list)
    action: Action = "start"
    wording_style: WordingStyle = "warm"
    explain_why: bool = False
    recent_phrasings: list[str] = Field(default_factory=list)
    region: Optional[str] = None

    @field_validator("energy", mode="before")
    @classmethod
    def _clamp_energy(cls, v):  # be forgiving: clamp instead of 422 for a UI slider
        return _energy(v)

    @field_validator("task", mode="before")
    @classmethod
    def _task(cls, v):
        return _text(v, MAX_TASK)

    @field_validator("task_tab_title", mode="before")
    @classmethod
    def _title(cls, v):
        return _opt_text(v, MAX_TASK)

    @field_validator("transcript", mode="before")
    @classmethod
    def _transcript(cls, v):
        return _text(v, MAX_TEXT)

    @field_validator("state", mode="before")
    @classmethod
    def _state(cls, v):
        return _choice(v, get_args(State), "stuck")

    @field_validator("action", mode="before")
    @classmethod
    def _action(cls, v):
        return _choice(v, get_args(Action), "start")

    @field_validator("wording_style", mode="before")
    @classmethod
    def _style(cls, v):
        return _choice(v, get_args(WordingStyle), "warm")

    @field_validator("explain_why", mode="before")
    @classmethod
    def _why(cls, v):
        return v is True or (isinstance(v, str) and v.lower() == "true")

    @field_validator("history", mode="before")
    @classmethod
    def _cap_history(cls, v):
        return [h for h in _list(v, 6) if isinstance(h, dict)]

    @field_validator("top_strategies", mode="before")
    @classmethod
    def _cap_top(cls, v):
        return [p for p in _list(v, 200) if isinstance(p, dict) and p.get("id")]

    @field_validator("exclude_ids", mode="before")
    @classmethod
    def _cap_exclude(cls, v):
        return _str_list(v, 200, 80)

    @field_validator("recent_phrasings", mode="before")
    @classmethod
    def _cap_recent(cls, v):
        return _str_list(v, 10, MAX_ITEM)

    @field_validator("region", mode="before")
    @classmethod
    def _region(cls, v):
        return _region_code(v)


class SequenceResponse(BaseModel):
    mode: Literal["coach", "safety"] = "coach"
    lead: Optional[str] = None  # short rotating invitation shown above the step
    next_step: str = ""
    why_one_line: str = ""
    size: Size = "tiny"
    buttons: list[str] = Field(default_factory=lambda: list(BUTTONS))
    strategy_id: Optional[str] = None
    strategy_name: Optional[str] = None
    validation: Optional[str] = None
    suggest_rest: bool = False
    source: Literal["ollama", "gemini", "card", "safety"] = "card"
    safety: Optional[SafetyPayload] = None


class OfframpRequest(BaseModel):
    task: str = ""
    progress: list[str] = Field(default_factory=list)
    wording_style: WordingStyle = "warm"
    energy: int = Field(3, ge=1, le=5)
    region: Optional[str] = None

    @field_validator("energy", mode="before")
    @classmethod
    def _clamp_energy(cls, v):
        return _energy(v)

    @field_validator("task", mode="before")
    @classmethod
    def _task(cls, v):
        return _text(v, MAX_TASK)

    @field_validator("progress", mode="before")
    @classmethod
    def _progress(cls, v):
        return _str_list(v, 20, MAX_ITEM)

    @field_validator("wording_style", mode="before")
    @classmethod
    def _style(cls, v):
        return _choice(v, get_args(WordingStyle), "warm")

    @field_validator("region", mode="before")
    @classmethod
    def _region(cls, v):
        return _region_code(v)


class OfframpResponse(BaseModel):
    mode: Literal["coach", "safety"] = "coach"
    note_to_future_self: str = ""
    rest_suggestion: str = ""
    source: Literal["ollama", "gemini", "card", "safety"] = "card"
    safety: Optional[SafetyPayload] = None


class BrainDumpRequest(BaseModel):
    transcript: str = ""
    wording_style: WordingStyle = "warm"
    energy: int = Field(3, ge=1, le=5)
    region: Optional[str] = None

    @field_validator("energy", mode="before")
    @classmethod
    def _clamp_energy(cls, v):
        return _energy(v)

    @field_validator("transcript", mode="before")
    @classmethod
    def _transcript(cls, v):
        return _text(v, MAX_TEXT)

    @field_validator("wording_style", mode="before")
    @classmethod
    def _style(cls, v):
        return _choice(v, get_args(WordingStyle), "warm")

    @field_validator("region", mode="before")
    @classmethod
    def _region(cls, v):
        return _region_code(v)


class BrainDumpGroup(BaseModel):
    label: str
    items: list[str]


class BrainDumpPick(BaseModel):
    item: str
    why: str
    first_step: str


class BrainDumpResponse(BaseModel):
    mode: Literal["coach", "safety"] = "coach"
    groups: list[BrainDumpGroup] = Field(default_factory=list)
    pick: Optional[BrainDumpPick] = None
    alternatives: list[str] = Field(default_factory=list)
    source: Literal["ollama", "gemini", "card", "safety"] = "card"
    safety: Optional[SafetyPayload] = None


class SafetyCheckRequest(BaseModel):
    text: str = ""
    region: Optional[str] = None

    @field_validator("text", mode="before")
    @classmethod
    def _t(cls, v):
        return _text(v, MAX_TEXT * 5)

    @field_validator("region", mode="before")
    @classmethod
    def _region(cls, v):
        return _region_code(v)
