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


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.S | re.I)


def _parse_json(text: str) -> dict[str, Any]:
    """Pull the first JSON object out of a model reply.

    Small local models often wrap JSON in code fences or add prose before or
    after it ("Sure! Here you go: {...} Hope this helps {:)}").
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("empty LLM reply")
    candidates = [text]
    fence = _FENCE_RE.search(text)
    if fence:
        candidates.insert(0, fence.group(1).strip())
    decoder = json.JSONDecoder()
    for cand in candidates:
        try:
            data = json.loads(cand)
            if isinstance(data, dict):
                return data
        except ValueError:
            pass
        for m in re.finditer(r"\{", cand):
            try:
                data, _ = decoder.raw_decode(cand, m.start())
            except ValueError:
                continue
            if isinstance(data, dict):
                return data
    raise ValueError("LLM reply has no JSON object")


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
