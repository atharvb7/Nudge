"""LLM access: Ollama (local, default) -> Gemini Flash (cloud, opt-in) -> raise.

Callers catch LLMUnavailable and serve a pre-written strategy card, so help
never breaks. Prompts and replies are never logged.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import httpx

from .config import get_settings

log = logging.getLogger("nudge.llm")


class LLMUnavailable(Exception):
    pass


def _parse_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    # Some models wrap JSON in code fences or add prose around it.
    fenced = re.search(r"\{.*\}", text, re.S)
    if fenced:
        text = fenced.group(0)
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("LLM reply is not a JSON object")
    return data


async def _ollama(messages: list[dict]) -> dict[str, Any]:
    s = get_settings()
    timeout = httpx.Timeout(s.llm_timeout, connect=2.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{s.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": s.ollama_model,
                "messages": messages,
                "format": "json",
                "stream": False,
                "options": {"temperature": 0.6, "num_predict": 300},
            },
        )
        r.raise_for_status()
        return _parse_json(r.json()["message"]["content"])


async def _gemini(messages: list[dict]) -> dict[str, Any]:
    s = get_settings()
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
        for m in messages
        if m["role"] != "system"
    ]
    async with httpx.AsyncClient(timeout=httpx.Timeout(s.llm_timeout, connect=4.0)) as client:
        r = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{s.gemini_model}:generateContent",
            headers={"x-goog-api-key": s.gemini_api_key},
            json={
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": contents,
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.6},
            },
        )
        r.raise_for_status()
        return _parse_json(r.json()["candidates"][0]["content"]["parts"][0]["text"])


async def chat_json(messages: list[dict], prefer: str | None = None) -> tuple[dict[str, Any], str]:
    """Return (parsed JSON, source). `prefer` pins a provider (used for the copy-rule retry)."""
    s = get_settings()
    order: list[str] = []
    if s.use_ollama:
        order.append("ollama")
    if s.cloud_enabled:
        order.append("gemini")
    if prefer in order:
        order = [prefer]
    for provider in order:
        try:
            data = await (_ollama(messages) if provider == "ollama" else _gemini(messages))
            return data, provider
        except Exception as exc:  # network, timeout, bad JSON — never log content
            log.info("LLM provider %s unavailable: %s", provider, type(exc).__name__)
    raise LLMUnavailable("no LLM available")


_health_cache: dict[str, Any] = {"at": 0.0, "value": None}


async def llm_status() -> tuple[str, str]:
    """(llm, llm_location) for /health. Cached briefly so the side panel can poll."""
    now = time.monotonic()
    if _health_cache["value"] and now - _health_cache["at"] < 15:
        return _health_cache["value"]
    s = get_settings()
    value = ("none", "none")
    if s.use_ollama:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(1.5, connect=1.0)) as client:
                r = await client.get(f"{s.ollama_url.rstrip('/')}/api/tags")
                if r.status_code == 200:
                    value = ("ollama", "local")
        except Exception:
            pass
    if value[0] == "none" and s.cloud_enabled:
        value = ("gemini", "cloud")
    _health_cache.update(at=now, value=value)
    return value
