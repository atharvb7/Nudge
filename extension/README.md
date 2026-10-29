# Nudge — Chrome extension (MV3)

The part of Nudge that lives in your browser: sensing (metadata only), gentle
nudges, the “I’m stuck” side panel, body-double mode, guilt-free rest, and the
on-device personal learning. All personal data stays in `chrome.storage` on
your computer.

## Build & load

```bash
# from the repo root (npm workspaces)
npm install
npm run build -w extension        # → extension/dist
```

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose `extension/dist`.
3. The welcome tab opens: three steps, under a minute.
4. Optional: run the backend (`cd backend && .venv/bin/uvicorn app.main:app --port 8000 --no-access-log`).
   Without it, Nudge uses its on-device strategy cards. Help never breaks.

Needs Chrome 116+ (side panel API).

## Opening Nudge

| How | What happens |
| --- | --- |
| **Ctrl+Shift+Space** (⌘+Shift+Space on Mac) | Opens the “I’m stuck” panel (`_execute_action` + `openPanelOnActionClick`, so there's no user-gesture race). Change it at `chrome://extensions/shortcuts`. If another app already owns the shortcut, Chrome leaves it unassigned: pick one there, or bind the spare “open-stuck-panel” command. |
| Toolbar icon | Same panel. |
| “Nudge, I’m stuck” | Optional wake phrase, off by default. Only offered when Chrome supports **on-device** speech recognition (`processLocally`). Otherwise the toggle stays disabled. |
| Gentle nudge bubble | Only after learning mode, at most once per 20 min. Never in flow, fullscreen, on calls, in quiet hours or during DND. |

## Scripts

```bash
npm run build -w extension       # pages + service worker (ES module) + content scripts (IIFE)
npm run typecheck -w extension
npm run test -w extension        # vitest: session reducer, overlay copy, API fallback, crisis never sent
node extension/scripts/smoke.cjs <screenshotDir> [--backend]   # Playwright end-to-end (loads dist in Chromium)
```

## Layout

```
public/manifest.json         MV3 manifest
src/background/index.ts      service worker: sensing tick, inference, anti-nag guard, overlays, bridge, wake phrase
src/background/overlays.ts   wording-style-aware bubble / chip specs
src/content/content.ts       counts key/scroll/click events (never values), fullscreen, renders overlays (closed shadow DOM)
src/content/bridge.ts        dashboard bridge (localhost:3000 only)
src/offscreen/offscreen.ts   on-device wake phrase listener
src/lib/*                    storage, messages, API client + offline fallback, speech, TTS, ambient audio, a11y
src/panel/*                  React side panel (onboarding, I’m stuck, steps, body double, brain dump, rest, safety, settings, demo)
src/onboarding, src/mic      full-tab onboarding + microphone permission page
```

## Why each permission

| Permission | Used for |
| --- | --- |
| `storage` | All your data, on-device. Raw events go to `storage.session` (memory only) and are deleted every 30 s after features are computed. |
| `tabs` | The **hostname** of the active tab (for the work/escape classifier) and the title of the one tab *you* pin. No other URLs or titles are stored. |
| `idle` | Idle gaps and away detection (`chrome.idle`, 60 s interval). |
| `alarms` | The 30 s feature tick and break timers. MV3 workers sleep, so `setInterval` isn’t reliable. |
| `sidePanel` | The “I’m stuck” panel. |
| `offscreen` | Only for the optional on-device wake phrase. |
| `<all_urls>` content script | Counting key/scroll/click **events** (never which key, never what you clicked, never page content), noticing fullscreen, and showing the small nudge bubble. |

`incognito: "not_allowed"`: Nudge never runs in incognito windows.

## Privacy model

* **Sensed:** tab switches per minute, returns to the pinned task tab, key/scroll/click **counts** per tab, idle gaps, session length, hour of day, and the active tab's **domain**.
* **Never sensed:** page content, full URLs, keystroke values, webcam, audio.
* **Speech:** turned into text, then the audio is dropped. Nudge prefers on-device Web Speech first, then local Whisper on `localhost`, and uses Chrome's cloud speech only if you opt in (clearly labelled).
* **Exclusions and pause:** per-site exclusions mean no counting and no nudges there. “Pause all tracking” stops sensing entirely.
* **Crisis language** is checked **on-device before anything is sent**. It switches to a safety screen (Tele-MANAS 14416 / 1-800-891-4416 in India; region is configurable), and the text is never stored.
* **Phone distractions** aren't tracked. Nudge only sees the browser.

## Edge cases handled

* **Service worker restarts:** all state lives in storage and the alarms re-arm on startup. A break, a session or a step watch survives the restart.
* **Pinned task tab closed:** the host and title are kept, and the same site counts as the task. You can re-pin in Settings.
* **Browser unfocused or several windows open:** counted as "elsewhere", not as escape.
* **System sleep:** `idle: locked` counts as away, so no nudges. The activity session resets after 30 min away.
* **Pages that can't host content scripts** (`chrome://`, Web Store, PDF viewer): Nudge falls back to a calm toolbar badge. No notifications, no sound.
* **Panel already open:** the panel sends a heartbeat, so Nudge never auto-nudges on top of itself.
* **New day:** cooldowns and dismissals reset. Nothing carries over as a penalty.
* **Learning mode (3 days):** no auto-nudges, just a 1-tap evening check-in. Demo mode skips it.
* **Backend down or LLM slow** (25 s timeout): you get an on-device strategy card with a subtle "offline idea" label.
* **Mic access denied:** Nudge opens a full tab to ask, because side panels can't always show the prompt. No speech or an empty input still gets a step, and buttons-only mode works everywhere.
* **Very long transcripts:** capped at 2000 characters before anything is sent.
* **Feelings typed instead of a task name** ("this is killing me"): never quoted back as the task.
* **3 "I'm fine"s in a day:** auto-nudges rest until tomorrow, with a kind note. Closing a bubble with × counts as "I'm fine".

Nudge is a support tool, not medical treatment.
