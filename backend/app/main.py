"""Nudge backend: a stateless helper for the extension.

* No user database, no request-body logging, nothing written to disk except
  the (non-personal) strategy embedding index.
* Every text endpoint runs the crisis check first.
* If the LLM is unavailable, a pre-written strategy card is served.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    await audio.close()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is a bit long. Try a shorter one?")
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
