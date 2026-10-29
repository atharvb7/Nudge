import type { ActionButton, WordingStyle } from './types';

// All user-facing words live here so the tone stays consistent:
// gentle, choice-based, short. Never: should / overdue / deadline / streak / fail.

export const BANNED_WORDS = /\b(should(?:n['’]t)?|overdue|deadlines?|streaks?|fail(?:ed|ing|s|ure|ures)?|lazy)\b/gi;

export function findBannedWords(text: string): string[] {
  return Array.from(new Set((text.match(BANNED_WORDS) ?? []).map((w) => w.toLowerCase())));
}

/** Last-resort soft rewrite for any generated text that slipped past the guard. */
export function softenCopy(text: string): string {
  return text
    .replace(/\byou should(?:n['’]t)?\b/gi, 'you could')
    .replace(/\bshould(?:n['’]t)?\b/gi, 'could')
    .replace(/\boverdue\b/gi, 'waiting')
    .replace(/\bdeadlines?\b/gi, 'hand-in date')
    .replace(/\bstreaks?\b/gi, 'run')
    .replace(/\bfail(?:ed|ing|s|ure|ures)?\b/gi, 'paused')
    .replace(/\blazy\b/gi, 'tired');
}

export const BUTTON_LABELS: Record<WordingStyle, Record<ActionButton, string>> = {
  warm: {
    done: 'Done',
    too_big: 'Too much right now',
    smaller: 'Make it smaller',
    different: 'Different idea',
    rest: 'I need rest',
  },
  literal: {
    done: 'Done',
    too_big: 'Too hard right now',
    smaller: 'Split this step',
    different: 'Different idea',
    rest: 'I need rest',
  },
};

export const BUTTON_HINTS: Record<ActionButton, string> = {
  done: 'I did this step',
  too_big: 'My energy is lower than this — go gentler',
  smaller: 'Same idea, cut into an even smaller piece',
  different: 'Try a different kind of idea',
  rest: 'Take a break, guilt-free',
};

type CopyKey =
  | 'stuckTitle'
  | 'stuckPrompt'
  | 'nudgeText'
  | 'nudgeHelp'
  | 'nudgeBreak'
  | 'nudgeFine'
  | 'hydration'
  | 'restuckQ'
  | 'stillGoing'
  | 'stuckAgain'
  | 'takingBreak'
  | 'breakQ'
  | 'longBreakQ'
  | 'welcomeBack'
  | 'dayClosed'
  | 'checkinQ'
  | 'offForToday'
  | 'disclaimer'
  | 'savedForLater'
  | 'stillHere'
  | 'celebrate'
  | 'didItHelp'
  | 'learningMode';

export const COPY: Record<WordingStyle, Record<CopyKey, string>> = {
  warm: {
    stuckTitle: "I'm stuck",
    stuckPrompt: 'What are you trying to start? Say it, tap it, or skip.',
    nudgeText: "Looks like this one's heavy. Want a hand?",
    nudgeHelp: 'Help me start',
    nudgeBreak: 'I need a break',
    nudgeFine: "I'm fine",
    hydration: 'Water? Stretch? (ignore me)',
    restuckQ: 'Still going, or stuck again?',
    stillGoing: 'Still going',
    stuckAgain: 'Stuck again',
    takingBreak: 'Taking a break',
    breakQ: 'How long would feel good?',
    longBreakQ: 'Want to come back, or call it a day? Both are fine.',
    welcomeBack: 'Welcome back. Want to start fresh?',
    dayClosed: "That's a wrap for today. Everything's saved for later. Rest well.",
    checkinQ: 'How did today feel?',
    offForToday: "Got it — I'll stay quiet for the rest of today. I'm here if you open me.",
    disclaimer: 'Nudge is a support tool, not medical treatment.',
    savedForLater: 'Saved for later',
    stillHere: 'Still here with you.',
    celebrate: 'You did a thing. That counts.',
    didItHelp: 'Did this help?',
    learningMode: "I'm getting to know your rhythm for a few days, so I won't pop up on my own yet.",
  },
  literal: {
    stuckTitle: "I'm stuck",
    stuckPrompt: 'Which task do you want to start? Speak, tap a button, or skip.',
    nudgeText: 'You switched tabs a lot. Do you want help starting?',
    nudgeHelp: 'Help me start',
    nudgeBreak: 'I need a break',
    nudgeFine: "I'm fine",
    hydration: 'You have worked for 90 minutes. Optional: drink water or stretch.',
    restuckQ: 'Are you still working, or are you stuck again?',
    stillGoing: 'Still going',
    stuckAgain: 'Stuck again',
    takingBreak: 'Taking a break',
    breakQ: 'Choose a break length.',
    longBreakQ: 'Your break time has ended. Do you want to continue, or stop for today? Both are okay.',
    welcomeBack: 'Welcome back. Do you want to start a new session?',
    dayClosed: 'Session ended. Your task and note are saved for later.',
    checkinQ: 'How did today feel?',
    offForToday: 'Automatic nudges are off until tomorrow. You can still open Nudge yourself.',
    disclaimer: 'Nudge is a support tool, not medical treatment.',
    savedForLater: 'Saved for later',
    stillHere: 'Nudge is still running with you.',
    celebrate: 'Step complete. It is recorded in your wins.',
    didItHelp: 'Did this strategy help?',
    learningMode: 'Learning mode: for 3 days, Nudge will not show automatic nudges. It is learning your normal patterns.',
  },
};

export function copy(style: WordingStyle, key: CopyKey): string {
  return COPY[style][key];
}

/** Rotating soft openers so suggestions don't feel repetitive. */
export const OPENERS: Record<WordingStyle, string[]> = {
  warm: ['Here’s a tiny one:', 'Maybe this:', 'Want to try this?', 'Small idea:', 'If it helps:', 'How about:'],
  literal: ['Next step:', 'Step:', 'Do this:'],
};

export const CELEBRATIONS: Record<WordingStyle, string[]> = {
  warm: [
    'You did a thing. That counts.',
    'Look at you, moving.',
    'Started is the hardest part — and you did it.',
    'Nice. That was real progress.',
    'Little step, real win.',
  ],
  literal: ['Step complete.', 'Done. This is recorded in your wins.', 'Step finished.'],
};

export const VALIDATIONS = [
  'That sounds like a lot to hold at once.',
  'It makes sense this feels heavy.',
  "Starting is genuinely hard sometimes. That's not a character flaw.",
  "Feeling stuck doesn't mean you're doing anything wrong.",
];

export const STILL_HERE = [
  'Still here with you.',
  "I'm right here. No rush.",
  'Keeping you company.',
  "You're doing it. I'm here.",
];

export const REST_IDEAS = [
  { id: 'stretch', label: 'Stretch', detail: 'Reach up, roll your shoulders, loosen your hands.' },
  { id: 'water', label: 'Water', detail: 'Grab a glass of water or a warm drink.' },
  { id: 'outside', label: 'Step outside', detail: 'A minute of fresh air or daylight.' },
  { id: 'music', label: 'Music', detail: 'One or two songs you love, eyes closed if you like.' },
  { id: 'eyes', label: 'Rest your eyes', detail: 'Look at something far away for a bit.' },
  { id: 'snack', label: 'Snack', detail: 'Something small to refuel.' },
];

export const CHECKIN_OPTIONS: Array<{ value: 1 | 2 | 3 | 4 | 5; label: string; emoji: string }> = [
  { value: 1, label: 'Heavy', emoji: '🌧️' },
  { value: 2, label: 'Foggy', emoji: '🌫️' },
  { value: 3, label: 'Okay', emoji: '⛅' },
  { value: 4, label: 'Steady', emoji: '🌤️' },
  { value: 5, label: 'Light', emoji: '☀️' },
];

export const ENERGY_LABELS: Record<number, string> = {
  1: 'Running on empty',
  2: 'Low battery',
  3: 'Some in the tank',
  4: 'Pretty good',
  5: 'Fully charged',
};

/** Clear & literal energy labels: no metaphors. */
export const ENERGY_LABELS_LITERAL: Record<number, string> = {
  1: '1 — Very low energy',
  2: '2 — Low energy',
  3: '3 — Medium energy',
  4: '4 — Good energy',
  5: '5 — High energy',
};

export function energyLabel(n: number, style: WordingStyle): string {
  return (style === 'literal' ? ENERGY_LABELS_LITERAL : ENERGY_LABELS)[n] ?? '';
}

/** Looks like a file or document name ("DBMS_Assignment.pdf", "OS_Lab_Report") — never prefix it with "your". */
export function looksLikeFileName(text: string): boolean {
  const t = (text || '').trim();
  return /\.[a-z0-9]{2,5}$/i.test(t) || (/[_]/.test(t) && !/\s/.test(t));
}

export function pick<T>(xs: T[], index: number): T {
  return xs[((index % xs.length) + xs.length) % xs.length];
}

/** Replace {task} placeholders. Literal mode prefers the exact object name. */
const FEELING = /\b(i['’]?m|i am|i feel|feeling|killing me|stuck|can['’]?t|cannot|overwhelm\w*|tired|exhausted|hate|ugh|so much|too much)\b/i;

/** "this assignment is killing me" is a feeling, not a task name to quote back. */
export function looksLikeFeeling(text: string): boolean {
  const t = (text || '').trim();
  return !!t && (t.length > 70 || t.split(/\s+/).length > 10 || FEELING.test(t));
}

export function fillTask(text: string, task: string, taskTabTitle: string | undefined, style: WordingStyle): string {
  const concrete = (taskTabTitle || '').trim();
  let said = looksLikeFeeling(task) ? '' : (task || '').trim();
  // the chip and the tab title are the same thing: use it once, as a name
  if (said && concrete && said.toLowerCase() === concrete.toLowerCase()) said = concrete;
  said = said.replace(/^your\s+(?=\S*[_.])/i, '');
  let label: string;
  if (style === 'literal') label = concrete || said || 'your task';
  else label = said || concrete || 'your task';
  return text.replace(/\{task\}/g, label);
}
