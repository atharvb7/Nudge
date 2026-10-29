# Full-system end-to-end test

`e2e/full.cjs` runs Nudge the way a student would. It loads the real extension in Chromium, with the FastAPI backend and the Next.js dashboard running on localhost.

```bash
npm install
npm run build -w extension
npm run build -w dashboard
(cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt)   # optional
npm run e2e                                  # or: node e2e/full.cjs <screenshot-dir>
E2E_ONLY='grouped|literal' npm run e2e       # run a subset (regex on test names)
```

The script starts and stops everything it needs. Ports 3000 and 3001 must be free.

| Service | Address | Why |
|---|---|---|
| backend | `localhost:8000` | It's reused if it's already running. Tests that need it are skipped when `backend/.venv` is missing. |
| dashboard | `localhost:3000` | The bridge origin, so this one runs in connected mode. |
| dashboard | `localhost:3001` | Not a bridge origin, so this one runs in demo mode. |
| hostile page | `127.0.0.1:4000` | Tries to drive the bridge or fool the dashboard. |
| task page | `127.0.0.2:4100` | A pretend assignment. |
| slow helper | `127.0.0.1:8001` | Its `/health` never answers. |

## What it covers

**Connected mode**
- Status pill
- Real snapshot
- Loading the sample week, with a confirm step
- Energy dial changes reaching the extension and showing in the side panel
- Plan add, done and save-for-later
- Group "Wrong" feedback tuning sensitivity once
- "What works for me" ranking matching the extension's stats
- Literal-mode energy dial
- Bad-week state on "What works for me"
- Settings and theme syncing both ways, live
- Two tabs staying in sync
- Simulate buttons, including crisis, where nothing is stored

**Privacy**
- Health shown when the backend is up, down or slow
- Per-site exclusion
- Pause, verified across a real 30 s tick
- Export with no raw events and no URLs
- Delete everything, then back to onboarding

**Security**
- No bridge on other origins
- Messages posted from another window or a frame are ignored
- A fake "hello" can't switch demo mode to connected

**Robustness**
- 5,000 inferences and 5,000 wins
- The extension reloading mid-session
- localStorage blocked

**Accessibility**
- No horizontal scroll at 390 px
- Skip link and visible focus on every tab stop
- Dialog focus trap
- Reduced motion
- axe-core on every page, including dark mode, the side panel and onboarding

Screenshots and `axe-report.json` are written to the output folder.
