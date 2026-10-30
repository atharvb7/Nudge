"""Loads the shared strategy cards (shared/src/strategies.json)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .config import get_settings


@dataclass(frozen=True)
class Card:
    id: str
    name: str
    for_state: tuple[str, ...]
    min_energy: int
    modality: str
    size: str
    steps: tuple[str, ...]
    literal_version: tuple[str, ...]
    phrasings: tuple[str, ...]
    why_it_works: str
    tags: tuple[str, ...] = field(default_factory=tuple)
    is_rest: bool = False
    task_kinds: tuple[str, ...] = ("any",)

    def document(self) -> str:
        """Text used for embedding / keyword retrieval."""
        return " ".join(
            [
                self.name,
                " ".join(self.steps),
                self.why_it_works,
                " ".join(self.tags),
                " ".join(self.for_state),
                self.modality,
            ]
        ).replace("{task}", "task")

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "for_state": list(self.for_state),
            "min_energy": self.min_energy,
            "modality": self.modality,
            "size": self.size,
            "steps": list(self.steps),
            "literal_version": list(self.literal_version),
            "phrasings": list(self.phrasings),
            "why_it_works": self.why_it_works,
            "tags": list(self.tags),
            "is_rest": self.is_rest,
            "task_kinds": list(self.task_kinds),
        }


def _parse(raw: dict) -> Card:
    steps = tuple(raw.get("steps") or [])
    literal = tuple(raw.get("literal_version") or steps)
    return Card(
        id=raw["id"],
        name=raw.get("name", raw["id"]),
        for_state=tuple(raw.get("for_state") or ["stuck"]),
        min_energy=int(raw.get("min_energy", 1)),
        modality=raw.get("modality", "thinking"),
        size=raw.get("size", "tiny") if raw.get("size") in ("tiny", "small") else "tiny",
        steps=steps,
        literal_version=literal,
        phrasings=tuple(raw.get("phrasings") or []),
        why_it_works=raw.get("why_it_works", ""),
        tags=tuple(raw.get("tags") or []),
        is_rest=bool(raw.get("is_rest", False)),
        task_kinds=tuple(raw.get("task_kinds") or ["any"]),
    )


@lru_cache(maxsize=4)
def _load(path: str) -> tuple[Card, ...]:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(
            f"Nudge strategy cards not found at {path}. Run from the repo (shared/src/strategies.json) "
            "or set NUDGE_STRATEGIES_PATH."
        )
    data = json.loads(p.read_text(encoding="utf-8"))
    cards = tuple(_parse(c) for c in data if c.get("id") and c.get("steps"))
    if not cards:
        raise ValueError(f"No strategy cards found in {path}")
    return cards


def load_cards() -> tuple[Card, ...]:
    return _load(str(get_settings().strategies_path))


def cards_by_id() -> dict[str, Card]:
    return {c.id: c for c in load_cards()}
