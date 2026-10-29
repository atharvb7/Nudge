# Nudge — architecture & contracts

This is the source of truth for how the three apps talk to each other. Keep it
in sync when you change a contract.

```
/shared     @nudge/shared — TypeScript types + pure logic + strategies.json (used by extension & dashboard; backend reads strategies.json)
/extension  Chrome MV3 (React + Vite + TS) — sensing, nudges, side panel, all personal data
/backend    FastAPI — stateless LLM + RAG helper. Stores nothing about the user.
/dashboard  Next.js 14 (App Router) + Tailwind — reads/writes extension data through a postMessage bridge
```

## Privacy model (non-negotiable)

* All personal data lives in `chrome.storage.local` inside the extension.
* Raw sensing events are deleted as soon as features are computed (every 30 s).
* Tracked: tab switches/min, returns to pinned task tab, **counts** of key/scroll/click per tab, idle gaps (`chrome.idle`), session length, hour of day, **domain** of active tab.
* Never tracked: page content, URLs beyond the hostname, keystroke values, webcam, audio (mic audio is transcribed then dropped; never written to disk).
* Backend is stateless: no DB of users, request bodies are never logged. Crisis messages are never stored anywhere (not in extension history either).
* LLM: Ollama local by default. Gemini Flash only if `NUDGE_ALLOW_CLOUD=1` **and** `GEMINI_API_KEY` set; `/health` reports `llm_location: "cloud"` so the privacy center can label it.
* Dashboard talks to the extension only via `window.postMessage` ↔ bridge content script on `http://localhost:3000` / `http://127.0.0.1:3000`. No server-side storage.

## Copy rules (enforced by `shared/src/copy.ts` `findBannedWords`, backend `copy_guard.py`)

Never: "should", "overdue", "deadline", "streak", "fail*", red/warning colours.
Unfinished work = "saved for later". Gentle, choice-based, short.

## Backend HTTP API (default `http://localhost:8000`)

All bodies JSON. CORS allows `chrome-extension://*`, `http://localhost:3000`, `http://127.0.0.1:3000`.

### `GET /health`
```json
{ "ok": true, "llm": "ollama" | "gemini" | "none", "llm_location": "local" | "cloud" | "none",
  "embeddings": "minilm" | "keyword", "whisper": true | false, "strategies": 58 }
```

### `POST /sequence`
Request:
```jsonc
{
  "task": "DBMS assignment",            // user words; may be ""
  "task_tab_title": "DBMS_Assignment.pdf", // optional, concrete object name for literal mode
  "state": "stuck" | "restuck" | "depleted" | "overwhelmed" | "neutral",
  "energy": 1-5,
  "history": [ { "step": "...", "outcome": "done"|"too_big"|"smaller"|"different"|"rest", "strategy_id": "..." } ],  // this session only, last <= 6
  "transcript": "optional voice/typed text from user",
  "top_strategies": [ { "id": "two_minute_start", "score": 0.71 } ], // Thompson samples from the extension (personal score, 0..1)
  "exclude_ids": ["..."],                // strategies to avoid now (e.g. "different idea")
  "action": "start" | "too_big" | "smaller" | "different" | "next",
  "wording_style": "warm" | "literal",
  "explain_why": false,
  "recent_phrasings": ["..."]            // last few step texts so the LLM avoids repeating
}
```
Response:
```jsonc
{
  "mode": "coach" | "safety",
  "lead": "Just two minutes with DBMS_Assignment.pdf, then you get to decide." | null, // rotating soft invitation; literal mode: "Next step:"-style or null
  "next_step": "Open the file DBMS_Assignment.pdf.",
  "why_one_line": "Opening it is often the hardest part.",   // always present; UI shows when explain_why or tapped
  "size": "tiny" | "small",
  "buttons": ["done","too_big","smaller","different","rest"],
  "strategy_id": "just_open_it",
  "strategy_name": "Just open it",
  "validation": "That sounds like a lot." | null,          // one-sentence validation when overwhelmed
  "suggest_rest": false,
  "source": "ollama" | "gemini" | "card" | "safety",        // card = pre-written fallback
  "safety": null | SafetyPayload
}
```
On safety, `buttons` is `[]` and `next_step` is `""`. Every text endpoint
(`/sequence`, `/offramp`, `/braindump`, `/safety/check`) accepts an optional
`region` (`IN` | `US` | `UK` | `AU` | `OTHER`, default env `NUDGE_REGION`=IN).
If the task text is a feeling ("this is killing me") rather than a task name,
it is never quoted back as the task — the pinned tab title or "your task" is used.
Ranking = `semantic_similarity(task+transcript, card) × state/energy filter × personal_score` (personal_score defaults to 0.5 for unseen cards). Energy ≤ 2 → only tiny steps; energy 1 or `action=too_big` at energy 2 → rest-capable cards preferred and `suggest_rest: true`.

### `POST /offramp`
`{ task, progress: string[] , wording_style, energy, region? }` → `{ note_to_future_self, rest_suggestion, source, mode, safety }`

### `POST /braindump`
`{ transcript, wording_style, energy }` →
```json
{ "groups": [ { "label": "Uni", "items": ["DBMS assignment", "email prof"] } ],
  "pick": { "item": "email prof", "why": "It's the quickest to start.", "first_step": "Open your email." },
  "alternatives": ["DBMS assignment", "..."], "source": "ollama"|"gemini"|"card", "mode": "coach"|"safety", "safety": null }
```

### `POST /safety/check`
`{ text, region }` → `SafetyPayload | { crisis: false }`
```json
{ "crisis": true, "message": "warm text", "resources": [ { "name": "Tele-MANAS", "phone": "14416", "alt": "1-800-891-4416", "note": "Free, 24x7, many languages" } ] }
```
Every endpoint that accepts free text runs this first; on crisis it returns `mode: "safety"` and does no coaching. Text is never logged.

### `POST /transcribe` (multipart `audio` file, optional `lang`)
Local whisper.cpp / faster-whisper if configured, else `501`. Audio is held in memory / a temp file deleted in `finally`.
→ `{ "text": "..." }` (413 if audio > 25 MB)

### `GET /strategies` → the cards (for dashboard names).

## Extension ↔ backend fallback

If the backend is unreachable or returns an error the extension uses
`@nudge/shared` `localSequence()` with the same input shape — help never breaks.
Crisis detection also runs locally first (`detectCrisis`) so it works offline.

## Dashboard ↔ extension bridge (`shared/src/bridge.ts`)

Dashboard posts `{ source: "nudge-dashboard", id, request: BridgeRequest }` to `window`.
Bridge content script (only on localhost:3000 / 127.0.0.1:3000) forwards to the
service worker and posts back `{ source: "nudge-extension", type: "reply", id, ok, data | error }`.
`getSnapshot` replies with a `DashboardSnapshot` (`snapshotOf(store, "extension")`).
On load the bridge posts `{ source: "nudge-extension", type: "hello", version }`.
If no hello arrives within ~800 ms the dashboard runs in **demo mode** using
`seedDemoData()` stored in `localStorage` (clearly labelled).

Request types: see `BridgeRequest` in `shared/src/bridge.ts`.

## Storage keys (`chrome.storage.local`)

See `StorageShape` in `shared/src/types.ts`.
