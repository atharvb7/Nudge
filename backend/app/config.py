"""Runtime configuration, read from environment variables.

Nothing here is user data. The backend is stateless: it never stores
requests, transcripts or audio.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    strategies_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("NUDGE_STRATEGIES_PATH", str(REPO_ROOT / "shared" / "src" / "strategies.json"))
        )
    )
    # "auto" uses MiniLM + Chroma when installed, "keyword" forces the built-in TF-IDF retriever.
    embeddings: str = field(default_factory=lambda: os.getenv("NUDGE_EMBEDDINGS", "auto").lower())
    chroma_dir: Path = field(
        default_factory=lambda: Path(os.getenv("NUDGE_CHROMA_DIR", str(BACKEND_DIR / ".chroma")))
    )

    # Local LLM (default).
    use_ollama: bool = field(default_factory=lambda: _flag("NUDGE_USE_OLLAMA", "1"))
    ollama_url: str = field(default_factory=lambda: os.getenv("OLLAMA_URL", "http://localhost:11434"))
    ollama_model: str = field(default_factory=lambda: os.getenv("OLLAMA_MODEL", "llama3.1:8b"))
    llm_timeout: float = field(default_factory=lambda: float(os.getenv("NUDGE_LLM_TIMEOUT", "20")))
    # Total LLM time per request (first try + any copy-rule retry). Well under the
    # extension's client timeout, so a slow model never means a long spinner:
    # past this, the pre-written card is served instantly instead.
    llm_budget_s: float = field(default_factory=lambda: float(os.getenv("NUDGE_LLM_BUDGET_S", "8")))

    # Cloud fallback: off unless explicitly allowed AND a key is present.
    allow_cloud: bool = field(default_factory=lambda: _flag("NUDGE_ALLOW_CLOUD", "0"))
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-2.0-flash"))

    # Local speech-to-text.
    whisper_cpp_bin: str = field(default_factory=lambda: os.getenv("WHISPER_CPP_BIN", ""))
    whisper_model: str = field(default_factory=lambda: os.getenv("WHISPER_MODEL", ""))
    faster_whisper_model: str = field(default_factory=lambda: os.getenv("FASTER_WHISPER_MODEL", "base.en"))

    default_region: str = field(default_factory=lambda: os.getenv("NUDGE_REGION", "IN").upper())

    @property
    def cloud_enabled(self) -> bool:
        return self.allow_cloud and bool(self.gemini_api_key)


def get_settings() -> Settings:
    # Re-read every call so tests (and a restarted dev server) pick up env changes.
    return Settings()
