#!/usr/bin/env bash
# One command to set up and run Nudge locally (macOS / Linux).
#   ./scripts/run-local.sh          # install, build, start backend + dashboard
#   ./scripts/run-local.sh --ml     # also install MiniLM + ChromaDB for semantic search (~1 GB)
# Then load extension/dist in Chrome (instructions are printed at the end).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

say() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }

command -v node >/dev/null || { echo "Please install Node.js 18+ (https://nodejs.org)"; exit 1; }
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || { echo "Please install Python 3.10+ (https://python.org)"; exit 1; }

say "Installing JavaScript packages"
npm install --no-audit --no-fund

say "Building the Chrome extension → extension/dist"
npm run build -w extension

say "Setting up the backend (Python venv in backend/.venv)"
[ -d backend/.venv ] || "$PY" -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements-dev.txt
if [ "${1:-}" = "--ml" ]; then backend/.venv/bin/pip install -q -r backend/requirements-ml.txt; fi

say "Building the dashboard"
npm run build -w dashboard

cleanup() { kill "${BACK:-}" "${DASH:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

say "Starting backend on http://localhost:8000"
(cd backend && .venv/bin/uvicorn app.main:app --port 8000 --no-access-log) & BACK=$!
say "Starting dashboard on http://localhost:3000"
npm run start -w dashboard & DASH=$!

sleep 3
cat <<MSG

──────────────────────────────────────────────────────────────
 Nudge is running.
   Backend   http://localhost:8000/health
   Dashboard http://localhost:3000

 Load the extension (once):
   1. Open chrome://extensions
   2. Turn on "Developer mode" (top right)
   3. Click "Load unpacked" and choose:
      $ROOT/extension/dist
   4. Pin Nudge from the puzzle-piece menu. Press Ctrl+Shift+Space
      (⌘+Shift+Space on Mac) or click the icon to open it.

 Optional local AI: install Ollama, run  ollama pull llama3.1:8b
 (without it Nudge uses its built-in strategy cards — everything still works).

 Press Ctrl+C here to stop everything.
──────────────────────────────────────────────────────────────
MSG
wait
