# Pitch & demo script

## One-liner
**Nudge lowers the wall to starting, stays with you through the task, and makes rest guilt-free.** It's a privacy-first executive-function companion for neurodivergent students.

## Story (90 seconds)
1. **Problem.** It's 10 pm and the student has opened `DBMS_Assignment.pdf` for the fourth time. Instagram, back again, YouTube. They aren't lazy: they're stuck, and every "productivity" app nags them in red.
2. **Starting is easier.** They press `Ctrl+Shift+Space` and say "I'm stuck on DBMS". Nudge gives *one* tiny step: *"Just open DBMS_Assignment.pdf. That's the whole step."* Then come five big buttons: Done · Too big · Make it smaller · Different idea · I need rest.
3. **It stays with them.** Body-double mode shows a calm ring and soft brown noise, with an occasional "still here with you". If they drift, a small chip asks *"Still going, or stuck again?"* and picks up from the last finished step, never mentioning the stall.
4. **Rest is real.** *I need a break* offers 5 min, 15 min or Done for today. Done for today writes a note to future-self, and the next day starts with "Welcome back. Want to start fresh?"
5. **It learns.** Thompson sampling learns that body doubling works for *this* student and ugly first drafts don't. "What I noticed" shows every inference in plain English with Right / Wrong buttons.
6. **Privacy.** Only counts and domains are collected. Raw events are deleted every 30 s. The AI runs locally by default, cloud use is clearly labelled, and there's an export button and a delete-everything button.

## Live demo checklist
* Run the backend (`uvicorn`), load the extension, and run the dashboard on port 3000.
* In the extension, go to **Settings ▸ Demo ▸ Load 1-week sample history**.
* Then, one by one:
  * **Simulate stuck**: the bubble appears, then *Help me start*, then a step, then *Done*, then 👍.
  * **Simulate re-stuck**: the chip appears, then *Stuck again*, which resumes from the last step.
  * **Simulate depleted**: a rest-first nudge.
  * **Simulate long break**: "Want to come back, or call it a day? Both are fine."
  * **Simulate crisis phrase**: coaching stops, a warm message appears with Tele-MANAS 14416, and nothing is stored.
* Dashboard:
  * Drop the energy dial to 1 spoon: the plan shrinks and moving the rest is offered, not forced.
  * "What works for me" ranking.
  * Wins counting paused starts.
  * Privacy center.

## Insights slide (fill with REAL interview quotes)
> ⚠️ Quotes must come from real interviews with neurodivergent students (ideally 3–5) who agreed to be quoted. Don't make them up. Use first names or "Student A" only with permission.

| # | Quote (verbatim) | Who (with consent) | Feature it shaped |
|---|---|---|---|
| 1 | _[paste quote]_ | _e.g. Student A, ADHD, 2nd-year CS_ | |
| 2 | _[paste quote]_ | | |
| 3 | _[paste quote]_ | | |
| 4 | _[paste quote]_ | | |
| 5 | _[paste quote]_ | | |

Likely mappings to check against what students actually say:
* Fear of being nagged or judged led to the **anti-nag safeguards** and the ban on red.
* "Metaphors confuse me" led to **Clear & literal** wording mode.
* "I lose track of time" led to **visual timers** and the optional time-anchor chip.
* "I need someone there" led to **body-double mode**.
* "Rest feels like cheating" led to **guilt-free rest**, **Done for today** and wins that count rests.
* "I don't want to be watched" led to **metadata-only sensing**, the local AI and the privacy center.

The dashboard has a ready slide at **/insights**.

### Interview guide (10 min, consented, no recording unless agreed)
1. Tell me about the last time you couldn't start something you wanted to do.
2. What usually helps you get going, even a little?
3. What do reminders or apps do that makes it *worse*?
4. How do you feel about rest when work is unfinished?
5. If a tool noticed you were stuck, how would you want it to say so, if at all?
6. What would make you trust it with your data?
