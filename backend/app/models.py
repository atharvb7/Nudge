"""Request/response schemas. Mirrors docs/ARCHITECTURE.md."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

State = Literal["stuck", "restuck", "depleted", "overwhelmed", "neutral"]
Outcome = Literal["done", "too_big", "smaller", "different", "rest"]
Action = Literal["start", "too_big", "smaller", "different", "next"]
WordingStyle = Literal["warm", "literal"]
Size = Literal["tiny", "small"]

BUTTONS: list[str] = ["done", "too_big", "smaller", "different", "rest"]


class HistoryItem(BaseModel):
    step: str = ""
    outcome: Optional[Outcome] = None
    strategy_id: Optional[str] = None


class PersonalScore(BaseModel):
    id: str
    score: float = Field(0.5, ge=0.0, le=1.0)


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
        try:
            return max(1, min(5, int(v)))
        except (TypeError, ValueError):
            return 3

    @field_validator("history")
    @classmethod
    def _cap_history(cls, v):
        return v[-6:]


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
        try:
            return max(1, min(5, int(v)))
        except (TypeError, ValueError):
            return 3


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
        try:
            return max(1, min(5, int(v)))
        except (TypeError, ValueError):
            return 3


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
