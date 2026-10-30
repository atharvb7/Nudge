# Research notes behind Nudge's design

These are the notes behind the main design choices. We tried to be honest about how strong the evidence is: several ideas are popular in ADHD and autistic communities but have only thin formal research. We treat them as **options to try**, and Nudge's personal learning (Thompson sampling) decides what actually works for each user.

## 1. Task paralysis is a "wall", not laziness

* Starting a task depends on executive function: getting going, planning, and switching between tasks. ADHD and autistic students often get stuck at the start of a task even when they care about it a lot.
* **Design consequences:**
  * Every reply is one micro-step under 2 minutes ("small enough to feel almost silly").
  * There are always buttons for *Make it smaller* and *I need rest*.
  * Copy never moralises. "should", "overdue", "deadline", "streak" and "failed" are banned and enforced by `scripts/copy-lint.mjs` and `backend/app/copy_guard.py`.

## 2. Body doubling

* Body doubling means working alongside someone else, which lowers the "activation energy" to start. Explanations draw on social facilitation theory (Allport 1924, Zajonc 1965).
* **Evidence:** the formal research is thin and much of the evidence is anecdotal. It also doesn't suit everyone or every task, so it's one card among many and personal 👍/👎 decides how often it comes up.
* Comparison with others can trigger shame, so Nudge's body-double mode has no leaderboard and no other people. It's just a calm timer and "still here with you".
* Sources: [Healthline](https://www.healthline.com/health/adhd/body-double-adhd), [Super Productivity](https://super-productivity.com/blog/adhd-body-doubling/), [Life Skills Advocate](https://lifeskillsadvocate.com/blog/how-to-use-body-doubling/), [Tiimo – task initiation](https://tiimoapp.com/blog/task-initiation-tactics)

## 3. Rejection sensitivity: anti-nag by design

* Many ADHD folks describe intense emotional reactions to perceived criticism. A nagging tool quickly becomes one more voice saying "you're behind".
* **Design consequences:**
  * At most one auto-nudge every 20 minutes.
  * Each "I'm fine" doubles the cooldown, and 3 dismissals turn auto-nudges off until tomorrow with a kind message.
  * Nudges are never shown during flow, fullscreen or calls.
  * Nudges never use red, never make sound by default, and never mention missed steps.
  * The first three days are a learning mode with no auto-nudges at all.

## 4. Thresholds relative to *you*

* "Lots of tab switching" means different things for different people: research work often involves 20 tabs.
* **Design consequences:**
  * Nudge only classifies the domain of the active tab.
  * Moving between work sites never counts as stuck.
  * Thresholds are scaled to the user's own baseline from the learning period.
  * Tapping *Wrong* in "What I noticed" raises the bar for that state (`adjustSensitivity`).

## 5. Time blindness

* Shrinking rings and colour fades instead of countdown numbers; numbers are optional.
* Steps are labelled "tiny" or "small", not by minutes.
* An optional "~30 min have passed" chip, off by default.

## 6. Autistic users: literal wording and sensory load

* **Clear & literal mode** uses exact names and actions. It says "Open the file DBMS_Assignment.pdf", not "dip your toe in". Every card has a hand-written `literal_version`.
* Sensory-reset and grounding cards cover overload. They're offered first when the user says it's loud or overwhelming, or when energy is at 1.
* Predictable flows: the same five buttons are always shown in the same place.

## 7. Privacy as accessibility

* Many students won't use a tool that "watches" them, so Nudge only collects counts and metadata.
* Raw events are deleted every 30 seconds. There's no page content and no keystroke values.
* Audio is never stored. The AI runs locally by default (Ollama), and the cloud option is clearly labelled.

### Speech recognition: honest constraints

* Chrome's standard Web Speech API sends audio to a cloud service.
* Newer Chrome builds support **on-device** recognition (`SpeechRecognition.available({ langs, processLocally: true })` / `SpeechRecognition.install(...)`, `recognition.processLocally = true`). Language packs (SODA) are downloaded first.
* Nudge picks a speech engine in this order:
  1. On-device Web Speech.
  2. Local whisper.cpp through the backend.
  3. Chrome's cloud speech, **only with explicit opt-in and a clear label**.
  4. Otherwise, buttons only.
* The wake phrase only runs when on-device recognition is available.
* Sources: [MDN – SpeechRecognition.available()](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/available_static), [MDN – processLocally](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally), [Chromium AI dev preview thread](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/Rlyc2uAsFCY), [Microsoft Edge docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api)

### Side panel + hotkey

* `chrome.sidePanel.open()` must be called in response to a user gesture.
* Developers report that the keyboard-command gesture can expire after an `await`, so Nudge calls `open()` synchronously at the top of the command handler.
* If opening fails (for example from an in-page bubble), Nudge falls back to a calm badge on the toolbar icon.
* Sources: [chrome.sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/qi2Hyi23uoE)

## 8. Safety layer

* Every free-text input is checked for crisis language on-device first, then again on the backend.
* Common hyperbole doesn't trigger it ("this assignment is killing me", "dead tired", "kill the process").
* Explicit self-harm language always triggers it, even when it might be hyperbole. We err towards care.
* When it triggers, task coaching stops, the reply is warm, and resources are shown. The text is never stored.
* **Why it isn't just the LLM:** the safety check never depends on an LLM. It has to work offline, instantly, and the same way every time, even when no model is running. It uses three layers:
  1. **On-device phrase patterns** (`shared/src/crisis.ts`). These run before anything leaves the browser.
  2. **The same patterns on the backend** (`backend/app/safety.py`). The two are kept identical by a shared test set of 120+ phrases, including Hinglish and typos.
  3. **A meaning-based safety net** on the backend, used when MiniLM is installed. It compares each sentence with crisis examples and with study-stress examples, so paraphrases no pattern lists can still be caught ("I can't do life anymore", "the world is better without me").
* **What a real tester found:** "i am done with my life, i am so bad" slipped past the first version and got a coaching step. It and its variants are now regression tests, and the meaning-based layer was added because fixed phrase lists will always miss some wording.
* **Limits we state honestly:** no automatic check is perfect. The safety screen always offers resources, and Settings shows the helpline numbers, so help is reachable even when detection misses.
* India default: **Tele-MANAS 14416 / 1-800-891-4416**. It's free, 24×7 and available in 20+ languages, run under NIMHANS for the Ministry of Health & Family Welfare. The region can be changed in settings.
* Sources: [IIT Kanpur counselling – Tele-MANAS](https://iitk.ac.in/counsel/TeleManas.php), [JIPMER – Tele-MANAS](https://jipmer.edu.in/Tele-MANAS), [Vikaspedia](https://en.vikaspedia.in/viewcontent/health/mental-health/tele-manas?lgn=en)

## 9. Learning what works: Thompson sampling

* Each strategy keeps a Beta(1 + 👍, 1 + 👎) posterior. At suggestion time, Nudge samples from every posterior and ranks by the samples.
* This mostly picks what has worked for this user while still sometimes trying new ideas.
* A mild "fatigue" discount for cards shown in the last 24 hours fights the novelty decay common with ADHD, where a favourite trick stops working once it's routine.

## Limits we state openly

* Browser only: phone distractions aren't seen. A phone companion with the same privacy model is on the roadmap.
* Nudge is a support tool, **not medical treatment**.
