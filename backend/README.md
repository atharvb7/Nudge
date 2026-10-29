# Nudge backend (FastAPI)

A small, **stateless** helper for the Nudge extension. It turns "I'm stuck on X"
into one tiny, kind next step, using a library of ~58 strategy cards
(`../shared/src/strategies.json`), semantic retrieval, the user's own
"what works for me" scores, and a local LLM.

The extension works without this server: if it's not running, the extension
serves the same strategy cards on its own.

## Run

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # core (keyword retrieval)
pip install -r requirements-ml.txt         # optional: MiniLM + ChromaDB semantic retrieval
uvicorn app.main:app --port 8000 --no-access-log
```

Optional local LLM: install [Ollama](https://ollama.com), then `ollama pull llama3.1:8b`.
Settings live in environment variables — see `.env.example`.

Tests: `pip install -r requirements-dev.txt && python -m pytest -q`
(`NUDGE_TEST_MINILM=1` also tests the embedding path; it downloads the model once).

## How a step is chosen

1. **Safety first.** Every text endpoint runs `app/safety.py` on the user's words
   before anything else. Crisis language → `mode: "safety"`, warm words and
   regional helplines (India: Tele-MANAS 14416 / 1-800-891-4416). No coaching,
   and the LLM never sees the message. Study idioms ("this is killing me",
   "dead tired", "kill this bug") don't trigger it.
2. **Retrieve.** `semantic match × state/energy filter × personal score`
   (`app/ranking.py`). Semantic = all-MiniLM-L6-v2 in ChromaDB, loaded in the
   background; until it's ready (or if it isn't installed) a TF-IDF retriever
   with student-vocabulary synonyms is used. Energy ≤ 2 → tiny cards only;
   energy 1 → rest-friendly cards. Personal scores are Thompson samples sent
   by the extension, so the backend stores nothing.
3. **Generate.** Ollama (local) with the spec's system prompt, grounded on the
   chosen card, JSON output. Gemini Flash only if `NUDGE_ALLOW_CLOUD=1` **and**
   `GEMINI_API_KEY` is set (`/health` then reports `llm_location: "cloud"`).
4. **Guard the copy.** `app/copy_guard.py` checks for "should", "overdue",
   "deadline", "streak", "fail*" and pressure words. It retries once with a
   reminder, then softly rewrites the reply, and falls back to the card if the
   reply still breaks the rules. The user's own task name is exempt.
5. **Fallback.** If no LLM is reachable or the reply is unusable, the
   pre-written card step is served (literal or warm wording, phrasing rotated
   so it doesn't repeat).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | LLM (`ollama`/`gemini`/`none`), location, embeddings (`minilm`/`keyword`), whisper |
| GET | `/strategies` | all strategy cards |
| POST | `/sequence` | next micro-step (`lead`, `next_step`, `why_one_line`, `size`, `buttons`, …) |
| POST | `/offramp` | note to future-self + gentle rest idea |
| POST | `/braindump` | groups a ramble, picks ONE item to start (swappable) |
| POST | `/safety/check` | crisis classifier + resources by region |
| POST | `/transcribe` | local whisper.cpp / faster-whisper, else `501` |

Full request/response shapes: `../docs/ARCHITECTURE.md`.

## Privacy

* No database, no user IDs, no analytics.
* Request bodies are never logged. Our loggers record only event names and
  exception types. Run uvicorn with `--no-access-log` if you don't want even paths logged.
* Crisis messages aren't stored or forwarded to any LLM.
* Audio for `/transcribe` stays in memory or in a temp file (in RAM-backed `/dev/shm`
  where available) that is deleted in `finally` as soon as transcription ends.
* The only thing written to disk is `.chroma/`, the embedding index of the
  public strategy cards.
