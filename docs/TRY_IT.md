# Run Nudge on your laptop and try everything

## 1. Start it (one command)

**You need:** Google Chrome, [Node.js 18+](https://nodejs.org), [Python 3.10+](https://python.org) and git.

```bash
git clone https://github.com/atharvb7/Vijaybhoomi-hackathon.git
cd Vijaybhoomi-hackathon
git checkout ccr-894fd7d6-h6imoz

# macOS / Linux
./scripts/run-local.sh            # add --ml for semantic search (downloads ~1 GB)

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1
```

The script:
1. installs everything;
2. builds the extension into `extension/dist`;
3. starts the **backend** on http://localhost:8000 and the **dashboard** on http://localhost:3000.

Leave that terminal open. Press Ctrl+C (or Enter on Windows) to stop.

**Load the extension once:**
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension/dist` folder.
3. Click the puzzle-piece icon and **pin** Nudge.
4. A welcome tab opens. That's onboarding.

After pulling new code, run the script again, then click **↻ reload** on the Nudge card in `chrome://extensions`.

**Optional local AI:** install [Ollama](https://ollama.com) and run `ollama pull llama3.1:8b`, then restart the script. Without it, Nudge uses its 58 built-in strategy cards and everything still works. Settings shows which mode it's in.

## 2. A 10-minute tour

| Try this | What you should see |
|---|---|
| **Onboarding:** pin a tab (open any PDF or doc first), pick a wording style and input style | Done in under a minute. The disclaimer is shown, and learning mode is explained. |
| Press **Ctrl+Shift+Space** (⌘+Shift+Space on Mac) or click the icon | The **I'm stuck** panel opens. |
| Type "DBMS assignment", pick an energy level, then **Help me start** | One tiny step, a tiny/small badge, and five buttons. |
| **Make it smaller**, **Different idea**, **Too big** | A smaller step, a different kind of idea, and a lower energy level (at 1, rest is offered). |
| **Done** | A gentle celebration, then **Did this help? 👍 / 👎 / skip**, then Next / Body double / Enough. |
| **Body-double mode** | A calm ring timer, optional brown noise or rain, and an occasional "Still here with you". |
| **Brain dump:** type or say "finish DBMS, email prof, laundry, pay mess fees" | Your items grouped, with ONE picked and the option to swap. |
| **I need a break**, then 5 min / 15 min / Done for today | A break timer with rest ideas. Done for today writes a note to future-you. |
| Type "this assignment is killing me" | A kind validation line, *not* the safety screen. |
| Switch to **Clear & literal** in Settings and ask again | Exact names and actions, with no metaphors. |
| Settings: dyslexia-friendly font, text size, high contrast, reduced motion | The panel changes immediately. |

## 3. Demo the automatic parts (no need to wait 3 days)

Open the panel and go to **⚙ Settings ▸ Demo mode**:

1. **Load 1-week sample history.** This fills in personal learning, "What I noticed" and wins.
2. Switch to a normal web page tab, then press:
   * **Simulate stuck**: a small bubble in the corner, "Looks like this one's heavy. Want a hand?"
     * Tap **I'm fine** 3 times on separate nudges and auto-nudges switch off until tomorrow, with a kind message.
   * **Simulate re-stuck**: the chip "Still going, or stuck again?". **Stuck again** picks up from your last step.
   * **Simulate depleted**: a rest-first nudge.
   * **Simulate long break**: "Want to come back, or call it a day? Both are fine."
   * **Simulate crisis phrase**: coaching stops, a warm message appears with **Tele-MANAS 14416**, and nothing is saved.

Real detection (no demo) starts after the 3-day learning mode. It needs real tab switching between your pinned task tab and sites like Instagram or YouTube.

## 4. Dashboard: http://localhost:3000

The top pill should say **Connected to your Nudge extension**. If it says *Sample data*, the extension isn't loaded, or the dashboard isn't on port 3000.

* **Today:** drag the energy dial to 1. The plan shrinks and you're *offered* to save the rest for later.
* **What I noticed:** every guess with a plain-English reason. Tap **Wrong** and Nudge waits for stronger signals next time.
* **What works for me:** strategies ranked by your 👍 / 👎.
* **Wins:** every attempt counts, including paused ones and rests. Themes unlock as you go and are never lost.
* **Privacy:** what is and isn't tracked, where the AI runs, pause, site exclusions, export and delete everything.
* **Demo:** the same simulate buttons. Changes show up live in the extension.
* **Insights:** a pitch slide with placeholders for your real interview quotes.

## 5. Run the automated tests yourself

```bash
npm run test -w shared && npm run test -w extension
(cd backend && .venv/bin/python -m pytest -q)            # Windows: backend\.venv\Scripts\python -m pytest -q
node scripts/copy-lint.mjs                                # gentle-language check
npm i --no-save playwright && npx playwright install chromium   # once, for the browser tests
npm run e2e                                               # whole system in Chromium (starts its own servers)
```

## Troubleshooting

* **The hotkey does nothing.** Set it at `chrome://extensions/shortcuts`; another app may own Ctrl+Shift+Space.
* **The mic doesn't work.** Allow it on the welcome tab. Chrome's normal speech recognition sends audio to Google, so Nudge only uses **on-device** speech, or local Whisper if you set it up. Otherwise it's buttons only, unless you opt in under Settings ▸ Speech.
* **No bubble on a page.** Chrome blocks extensions on `chrome://` pages, the Web Store and its built-in PDF viewer. Nudge shows a quiet badge on its icon instead.
* **Port already in use.** Stop other apps on 3000 or 8000. The dashboard must be on port 3000 to connect to the extension.
