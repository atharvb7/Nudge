# Nudge dashboard

Next.js 14 (App Router) + Tailwind + TypeScript. A calm, private view of what
Nudge has learned. All personal data stays in the browser: the dashboard reads
and writes it through the Nudge extension, never through a server.

## Run

From the repo root (npm workspaces):

```bash
npm install
npm run dev -w dashboard        # http://localhost:3000
# or
npm run build -w dashboard && npm run start -w dashboard
```

Port 3000 matters: the extension's bridge content script only runs on
`http://localhost:3000` and `http://127.0.0.1:3000`.

Checks: `npm run typecheck -w dashboard`, `npm run lint -w dashboard`, `npm run build -w dashboard`.

## How data flows

`lib/bridge.ts` has two interchangeable sources:

- **ExtensionSource**: posts `{ source: 'nudge-dashboard', id, request }` to
  `window`. The bridge content script relays it to the service worker and
  posts back `{ source: 'nudge-extension', id, ok, data }`. Replies are only
  accepted from the same window and origin. If nothing answers within ~800 ms,
  either a `hello` or a reply to a `getSnapshot` ping, the dashboard switches
  to demo mode.
- **DemoSource**: a sample week (`seedDemoData()`) kept in this browser's
  `localStorage` and changed by the same `applyBridgeRequest` reducer the
  extension uses. If storage is blocked (private window), it keeps the data
  in memory.

The header pill always shows which source is active: "Connected to your Nudge
extension" or "Sample data (demo mode)". If the extension stops answering
mid-session, a soft banner offers **Try again** or **Use sample data**, and
the last snapshot stays on screen.

`lib/nudge-context.tsx` exposes `useNudge()`, which returns the snapshot, `send`,
`updateSettings`, `reconnect`, and the AI-helper health check
(`GET {backendUrl}/health`, with a 2.5 s timeout).

## Pages

| Route | What it does |
|---|---|
| `/` Today | Energy dial (1–5 spoons, arrow keys) reshapes the plan with `reshufflePlan`. Items that don't fit are only *offered* for "saved for later". The page also adds, completes and moves items, shows the latest note from past-you, a learning-mode banner, and an in-progress session. |
| `/noticed` | Every guess, newest first and grouped by day: state chip, plain-English reason, what Nudge did (or why it stayed quiet), and Right / Wrong. Wrong raises the user's own sensitivity. A filter and paging are included. |
| `/works` | Strategies ranked by personal success (posterior mean of 👍/👎), with "why it works" and ideas not tried yet. |
| `/wins` | Total attempts (paused starts and rests count too), a 7-day bar chart where zero days look neutral, the wins log, unlockable themes, and opt-in synthesized win sounds. Unlocks never expire. |
| `/privacy` | What is and isn't tracked, where the AI runs (local / cloud / built-in cards), a pause toggle, site lists (excluded / counts as work / escape), export as JSON, delete everything (native modal, focus trapped, Esc closes), honest limits (browser only, no phone), and crisis resources by region. |
| `/settings` | Font (Atkinson Hyperlegible / Lexend dyslexia-friendly, both bundled locally), text size, high contrast, motion, wording style, explain-why, time anchors, water chip, region, quiet hours, do-not-disturb, helper address. Applied through `data-*` attributes from `@nudge/shared/tokens.css`. |
| `/demo` | Simulate stuck, re-stuck, depleted, long break and crisis phrase, plus loading a 1-week sample history (asks first when connected to real data). In demo mode a live preview appears in the corner. The crisis phrase is never stored. |
| `/insights` | A pitch slide with **placeholder** quote cards (fill them with real, consented interview quotes; never invented ones), a needs → features map, and an interview guide. |

## Design notes

- Calm tokens only, with no red or warning colours. "Attention" uses lavender or sand.
- Tap targets are at least 48 px. Focus rings are visible, there is a skip link, landmarks are labelled, and radiogroups and switches have proper roles.
- Motion is gentle and turns off with reduced motion (either the OS setting or the in-app setting).
- Copy rules apply here too: no "should / overdue / deadline / streak / fail".
