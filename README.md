# 🌿 Nudge

**A privacy-first executive-function companion for neurodivergent (ADHD / autistic) university students experiencing task paralysis.**

You are never lazy. Nudge lowers the wall to starting, stays with you through the task, and makes rest guilt-free.

> Nudge is a support tool, not medical treatment.

```
/shared     @nudge/shared — strategy cards, types and all the core logic (sensing, anti-nag guard,
            Thompson sampling, offline sequencer, crisis check, demo history, dashboard bridge)
/extension  Chrome MV3 extension (React + Vite + TS): side panel, sensing, nudges, voice, rest, demo mode
/backend    FastAPI: RAG over 58 strategy cards + local LLM (Ollama), opt-in cloud LLM, card fallback, safety layer
/dashboard  Next.js 14 + Tailwind: energy plan, What I noticed, What works for me, wins, privacy center, demo, insights
/docs       ARCHITECTURE.md (contracts), RESEARCH.md (design research + sources), PITCH.md (demo script + insights slide)
```

## Quick start (about 5 minutes)

**Fastest:** `./scripts/run-local.sh` (macOS/Linux) or `scripts\\run-local.ps1` (Windows) does all of the below. See [`docs/TRY_IT.md`](docs/TRY_IT.md) for a guided tour of every feature.

```bash
# 1. JS workspaces (shared + extension + dashboard)
npm install

# 2. Backend (optional: everything still works offline with built-in cards)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # add -r requirements-ml.txt for MiniLM + ChromaDB
.venv/bin/uvicorn app.main:app --port 8000 --no-access-log
# Optional local LLM: `ollama pull llama3.1:8b` and keep Ollama running.
# Optional cloud fallback (clearly labelled as cloud): NUDGE_ALLOW_CLOUD=1 GEMINI_API_KEY=...
cd ..

# 3. Extension
npm run build -w extension
# chrome://extensions → Developer mode → Load unpacked → extension/dist
# Open with Ctrl+Shift+Space (⌘+Shift+Space on Mac) or the toolbar icon.

# 4. Dashboard (must be on port 3000 for the extension bridge)
npm run dev -w dashboard   # http://localhost:3000
```

**Demo for judges:** in the extension go to **Settings ▸ Demo ▸ Load 1-week sample history**, then use the *Simulate stuck / re-stuck / depleted / long break / crisis phrase* buttons. The dashboard's **Demo** page has the same buttons. Without the extension installed, the dashboard runs on clearly labelled sample data. See [`docs/PITCH.md`](docs/PITCH.md) for the full script.

## How it works

1. **Onboarding (< 60 s).** Pin a task tab (or skip), pick a wording style (*Warm & casual* / *Clear & literal*) and an input style (*Voice + buttons* / *Buttons only*). For the first 3 days Nudge is in **learning mode**: no auto-nudges, just a 1-tap "How did today feel?".
2. **You open it first.** Use the hotkey or toolbar button to open the **I'm stuck** panel. Passive detection is only a fallback.
3. **One micro-step at a time.** Every reply ends with **Done · Too big · Make it smaller · Different idea · I need rest**. Typing is always optional.
4. **Sensing is metadata only.** Nudge records tab switches, returns to the task tab, *counts* of keys, scrolls and clicks, idle gaps and the domain category. Raw events are deleted every 30 s, and states (flow, stuck, depleted, away) are judged against *your* baseline.
5. **Anti-nag by design.**
   - At most one auto-nudge every 20 min, and each "I'm fine" doubles the gap.
   - 3 dismissals turn auto-nudges off until tomorrow.
   - No nudges during flow, quiet hours, do-not-disturb, fullscreen or video calls.
6. **It stays with you.**
   - Body-double mode: a calm ring timer, optional brown noise and "still here with you".
   - Re-stuck chip: "Still going, or stuck again?" Choosing *stuck again* resumes from the last finished step.
7. **Rest that is actually rest.**
   - *I need a break* offers 5 min, 15 min or Done for today.
   - Done for today writes a note to future-self, and your next visit opens with "Welcome back. Want to start fresh?"
8. **It learns what works for you.** Tap 👍/👎 after a strategy. Thompson sampling ranks strategies by what has worked for you while still trying new ideas now and then.
9. **Safety layer.** Crisis language is checked on-device first, then on the backend. If it's detected, coaching stops, you get a warm message and resources (India: Tele-MANAS **14416**), and the text is never stored.

## Privacy

- Data lives in `chrome.storage.local`, and the backend is stateless.
- The AI runs locally by default, and any cloud use is labelled.
- **Not tracked:** webcam, page content, keystroke values, audio.
- Only hostnames are kept.
- The dashboard has export, delete-everything, a pause switch and per-site exclusions.
- Browser-only: phone distractions are not tracked (a phone companion is on the roadmap).

## Checks

```bash
npm run test -w shared                     # core logic (28 tests)
npm run typecheck -w extension && npm run test -w extension && npm run build -w extension
npm run typecheck -w dashboard && npm run lint -w dashboard && npm run build -w dashboard
(cd backend && .venv/bin/python -m pytest -q)
node scripts/copy-lint.mjs                 # no "should / overdue / deadline / streak / fail" in UI text
node extension/scripts/smoke.cjs <outdir> [--backend]   # loads the built extension in Chromium, 20 end-to-end checks
```

## Known limits

- Real microphone input, on-device speech and the wake phrase can't be exercised in headless CI.
- The hotkey can't be tested headless either.
- These all have fallbacks: local Whisper, then buttons-only.
- The dashboard can't open the side panel itself: Chrome needs a click.
