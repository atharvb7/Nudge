"""Nudge backend: a stateless helper for the extension.

* No user database, no request-body logging, nothing written to disk except
  the (non-personal) strategy embedding index.
* Every text endpoint runs the crisis check first.
* If the LLM is unavailable, a pre-written strategy card is served.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import retrieval, sequencer, transcribe
from .config import get_settings
from .fallback import card_reply
from .llm import llm_status
from .models import (
    BrainDumpRequest,
    BrainDumpResponse,
    NotCrisis,
    OfframpRequest,
    OfframpResponse,
    SafetyCheckRequest,
    SafetyPayload,
    SequenceRequest,
    SequenceResponse,
)
from .safety import classify, safety_payload
from .strategies import load_cards

# Our own loggers only ever log event names / exception types, never user text.
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("nudge")

MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024  # text endpoints: 1 MB is far more than any real request
AUDIO_TYPES = ("audio/", "video/webm", "video/ogg", "application/octet-stream")


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_cards()  # fail fast if strategies.json is missing
    retrieval.warm_up()  # background thread; keyword retrieval serves meanwhile
    yield


app = FastAPI(title="Nudge backend", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """Reject oversized text bodies early (audio has its own, larger limit)."""
    if request.method == "POST" and request.url.path != "/transcribe":
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_JSON_BYTES:
            return JSONResponse({"detail": "That's a lot of text. Could you send a shorter version?"}, status_code=413)
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # Never log the body; only tell the client which fields were off (no input echo).
    fields = sorted({".".join(str(p) for p in e.get("loc", ())[1:]) or "body" for e in exc.errors()})
    log.info("validation error on %d field(s)", len(fields))
    return JSONResponse({"detail": "Some fields weren't understood.", "fields": fields}, status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception):
    log.warning("unexpected error %s", type(exc).__name__)  # type only — never user text
    return JSONResponse({"detail": "Something went wrong on our side. Nudge's built-in ideas still work."},
                        status_code=500)


@app.get("/health")
async def health() -> dict:
    llm, location = await llm_status()
    return {
        "ok": True,
        "llm": llm,
        "llm_location": location,
        "embeddings": retrieval.retriever_name(),
        "whisper": transcribe.available(),
        "strategies": len(load_cards()),
    }


@app.get("/strategies")
def strategies() -> list[dict]:
    return [c.to_public() for c in load_cards()]


@app.post("/sequence", response_model=SequenceResponse, response_model_exclude_none=False)
async def sequence(req: SequenceRequest) -> SequenceResponse:
    try:
        return await sequencer.sequence(req)
    except Exception as exc:  # help never breaks
        log.warning("sequence error %s; serving card", type(exc).__name__)
        if classify(f"{req.task} {req.transcript}"):
            return SequenceResponse(mode="safety", source="safety", buttons=[], safety=safety_payload(req.region))
        return card_reply(req)


@app.post("/offramp", response_model=OfframpResponse)
async def offramp(req: OfframpRequest) -> OfframpResponse:
    return await sequencer.offramp(req)


@app.post("/braindump", response_model=BrainDumpResponse)
async def braindump(req: BrainDumpRequest) -> BrainDumpResponse:
    return await sequencer.braindump(req)


@app.post("/safety/check", response_model=SafetyPayload | NotCrisis)
def safety_check(req: SafetyCheckRequest):
    if classify(req.text):
        return safety_payload(req.region or get_settings().default_region)
    return NotCrisis()


@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...), lang: str = Form("en")) -> dict:
    if not transcribe.available():
        raise HTTPException(status_code=501, detail="Local speech-to-text isn't set up on this machine.")
    ctype = (audio.content_type or "").lower()
    if ctype and not ctype.startswith(AUDIO_TYPES):
        raise HTTPException(status_code=415, detail="That doesn't look like audio.")
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    await audio.close()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is a bit long. Try a shorter one?")
    if not data:
        raise HTTPException(status_code=400, detail="I didn't catch any sound. Want to try again, or use the buttons?")
    suffix = "." + (audio.filename or "audio.webm").rsplit(".", 1)[-1][:5]
    try:
        text = await transcribe.transcribe_bytes(data, suffix=suffix, lang=(lang or "en")[:5])
    except transcribe.TranscriptionUnavailable as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from None
    except Exception as exc:
        log.warning("transcription error %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Couldn't hear that clearly. Buttons work too.") from None
    finally:
        del data  # drop the audio buffer right away
    return {"text": text}
