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

const FEELING = /\b(i['’]?m|i am|i feel|feeling|killing me|stuck|can['’]?t|cannot|overwhelm\w*|tired|exhausted|hate|ugh|so much|too much)\b/i;

/** "this assignment is killing me" is a feeling, not a task name to quote back. */
export function looksLikeFeeling(text: string): boolean {
  const t = (text || '').trim();
  return !!t && (t.length > 70 || t.split(/\s+/).length > 10 || FEELING.test(t));
}

/**
 * Words that must never end up as a task name, even when the crisis check
 * misses the sentence ("I want to end it" must never become "your I want to end it").
 */
const NOT_A_TASK = /\b(end\s+it|ending|die|dying|dead|death|kill\w*|hurt\w*|harm\w*|pills?|overdos\w*|jump\w*|cut(?:ting)?|disappear\w*|burden|worthless|useless|hopeless|pointless|empty|alone|life|living|alive|exist\w*|suicid\w*|hang\w*|bridge|rope|gone|anymore|nobody|no\s+one|myself|my\s*self|hate\s+me|tired\s+of|done\s+with)\b/i;

/** A short, neutral name for a task — or false. Long sentences, feelings and anything worrying never qualify. */
export function isSafeTaskLabel(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length > 60 || t.split(/\s+/).length > 8) return false;
  if (looksLikeFeeling(t) || NOT_A_TASK.test(t)) return false;
  return /[a-z0-9]/i.test(t);
}

/** Strip browser/app noise from a tab title ("Essay - Google Docs" → "Essay"; "Untitled document" → ""). */
export function cleanTabTitle(title: string | null | undefined): string {
  let t = (title || '').trim();
  t = t.replace(/^\(\d+\)\s+/, '');
  t = t.replace(/^(Google\s+(Docs|Sheets|Slides|Drive)|Microsoft\s+(Word|Excel|PowerPoint)|Notion|Overleaf)\s+[-–—|:]\s+/i, '');
  for (let i = 0; i < 2; i++) {
    t = t
      .replace(/\s+[-–—|]\s+(Google\s+(Docs|Sheets|Slides|Drive)|Microsoft\s+(Word|Excel|PowerPoint)|Word|Excel|PowerPoint|Notion|YouTube|Mozilla Firefox|Google Chrome)\s*$/i, '')
      .replace(/\s+[-–—|]\s+Overleaf.*$/i, '')
      .trim();
  }
  if (/^(untitled\s+(document|spreadsheet|presentation|form)|new tab|untitled)$/i.test(t)) return '';
  return t;
}

export type TaskKindName = 'doc' | 'reading' | 'study' | 'code' | 'admin' | 'message' | 'chore' | 'unknown';

const KIND_RULES: Array<[Exclude<TaskKindName, 'unknown' | 'reading'> | 'reading', RegExp]> = [
  ['message', /\b(email|e-mail|mail|text|message|reply|call|ring|whatsapp|dm|ping|phone)\b/i],
  ['chore', /\b(laundry|clean|dishes|wash|tidy|cook|groceries|shopping|trash|vacuum|room|shower|iron|fold|bed)\b/i],
  ['admin', /\b(pay|fees?|bill|form|bank|apply|application|register|book|appointment|renew|passport|scholarship)\b/i],
  ['code', /\b(code|coding|bug|debug|program|script|leetcode|github|function|compile)\b/i],
  ['reading', /\b(read|reading|chapter|article|textbook)\b/i],
  ['study', /\b(study|revise|revision|exam|quiz|test|flashcards|lecture|practice)\b/i],
  ['doc', /\b(essay|write|writing|report|assignment|draft|thesis|presentation|slides|doc|document|resume|cv|letter)\b/i],
];

/** Which kind of task this is (see docs/ARCHITECTURE.md "Task kinds"). */
export function taskKind(text: string): TaskKindName {
  const t = (text || '').replace(/[_]/g, ' ');
  for (const [kind, re] of KIND_RULES) if (re.test(t)) return kind;
  if (/\.pdf\b/i.test(t)) return 'reading';
  return 'unknown';
}

// Noun phrases — mirrors noun_phrase() in backend/app/taskkind.py.
const STRIP_VERBS = /^(?:(?:i\s+)?(?:need|have|want|gotta|got)\s+to\s+)?(?:do|finish|start|complete|get|work\s+on|get\s+started\s+on|begin|continue|write|make|prepare|submit|draft|study\s+for|revise\s+for|revise|study|read|practice|practise|fix|debug)\s+/i;
const MSG = /^(?:email|e-mail|mail|text|message|whatsapp|dm|ping)\s+(?:to\s+)?(.+)$/i;
const REPLY = /^reply\s+(?:to\s+)?(.+)$/i;
const CALL = /^(?:call|ring|phone)\s+(?:back\s+)?(.+?)(?:\s+back)?$/i;
const CHORE = /^(?:do|clean|tidy|wash|fold|iron|cook|vacuum|take\s+out|buy|get)\s+(?:up\s+)?(.+)$/i;
const ADMIN = /^(?:pay|fill(?:\s+out|\s+in)?|book|renew|apply\s+for|register\s+for|submit)\s+(.+)$/i;
const DETERMINER = /^(?:my|your|the|a|an|this|that|our|his|her|their)\b/i;

function you(s: string): string {
  return s.replace(/\bmy\b/gi, 'your').replace(/\bmyself\b/gi, 'yourself').replace(/\bme\b/gi, 'you');
}

function withDet(obj: string, def = 'your'): string {
  const o = you(obj.trim().replace(/[.!?]+$/, ''));
  if (DETERMINER.test(o)) return o.charAt(0).toLowerCase() + o.slice(1);
  if (o.includes('_') || /\.\w{2,5}$/.test(o)) return o;
  return `${def} ${o}`;
}

/** "call mom" → "your call with mom"; "do laundry" → "the laundry"; "write my essay" → "your essay". */
export function nounPhrase(task: string, kind: TaskKindName = taskKind(task)): string {
  const t = task.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!t) return '';
  let m: RegExpMatchArray | null;
  if ((m = t.match(MSG))) return `your message to ${you(m[1])}`;
  if ((m = t.match(REPLY))) return `your reply to ${you(m[1])}`;
  if ((m = t.match(CALL))) return `your call with ${you(m[1])}`;
  if (kind === 'chore' && (m = t.match(CHORE))) return withDet(m[1], 'the');
  if (kind === 'admin' && (m = t.match(ADMIN))) return withDet(m[1], 'the');
  const stripped = t.replace(STRIP_VERBS, '');
  return withDet(stripped, kind === 'chore' ? 'the' : 'your');
}

/** @deprecated use nounPhrase */
export const taskLabel = (task: string) => nounPhrase(task);

/**
 * Pull the task out of a feeling sentence: "ugh I can't start my essay" →
 * "essay". Returns '' when no safe task name is in there.
 */
export function extractTask(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (isSafeTaskLabel(t)) return t;
  const patterns = [
    /\b(?:can['’]?t|cannot|don['’]?t want to|need to|have to|gotta|trying to|want to|supposed to|struggling to)\s+(?:even\s+)?(?:start(?:ing)?|begin|do|finish|write|read|study(?:\s+for)?|revise(?:\s+for)?|focus on|work on|get (?:to|into)|deal with|face|open)\s+(?:on\s+)?(?:my|the|this|that|our|an?)?\s*([a-z0-9][\w'’ -]{1,48}?)\s*(?=$|[.,!?;]|\s+(?:because|but|and|cause|cuz|lol|rn|right now|today|tonight|at all|anymore)\b)/i,
    /\bstuck\s+(?:on|with)\s+(?:my|the|this|that)?\s*([a-z0-9][\w'’ -]{1,48}?)\s*(?=$|[.,!?;]|\s+(?:because|but|and|lol)\b)/i,
    /\b(?:my|the|this)\s+([a-z0-9][\w'’ -]{1,40}?)\s+is\s+(?:killing me|so hard|too much|impossible|so boring|a lot)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    const cand = m?.[1]?.trim().replace(/^(?:my|the|this|that)\s+/i, '');
    if (cand && cand.split(/\s+/).length <= 4 && !/^(it|this|that|anything|everything|things|stuff|at all|any of it|work)$/i.test(cand) && isSafeTaskLabel(cand)) return cand;
  }
  return '';
}

const ARTICLE_BEFORE_TASK = /\b(?:the|a|an)\s+((?:finished|whole|first|next|actual)\s+)?\{task\}/gi;
const LABEL_DET = /^(your|the|my|this|that)\s+(.+)$/i;
const FILE_RE = /\.(pdf|docx?|pptx?|xlsx?|txt|md|ipynb|py|java|c|cpp|js|ts|csv|odt|key|pages|tex)\b/i;

/**
 * How to name the task in a step — mirrors task_label() in backend/app/fallback.py.
 * Never uses text the crisis check flags; a feeling keeps only the task noun inside
 * it (or nothing); a pinned tab's cleaned title is preferred for anything dug out of a feeling.
 */
export function labelFor(rawTask: string, tabTitle: string | undefined, style: WordingStyle): string {
  const raw = (rawTask || '').replace(/[{}]/g, '').trim();
  let task = isSafeTaskLabel(raw) ? raw : extractTask(raw);
  const title = cleanTabTitle(tabTitle);
  if (title && task && task.toLowerCase() !== raw.replace(/[.!?]+$/, '').toLowerCase()) task = ''; // dug out of a feeling
  const kind = task ? taskKind(task) : taskKind(title);
  if (task && title && task.toLowerCase() === title.toLowerCase()) task = '';
  const untitled = /untitled\s+(document|spreadsheet|presentation)/i.exec(tabTitle ?? '');
  const fallback = untitled ? `your ${untitled[1] === 'presentation' ? 'slides' : untitled[1]}` : 'your task';
  if (style === 'literal') {
    if (task && (kind === 'message' || kind === 'chore' || kind === 'admin')) return nounPhrase(task, kind);
    if (title) return FILE_RE.test(title) ? `the file ${title}` : title;
    return task ? nounPhrase(task, kind) : fallback;
  }
  if (task) return nounPhrase(task, kind);
  return title || fallback;
}

/** Put a label into a step, with the grammar repair from backend fill(). */
export function fillWithLabel(text: string, label: string): string {
  const m = LABEL_DET.exec(label);
  let t = text;
  if (m) {
    // "the finished {task}" + "your essay" → "your finished essay", never "the finished your essay"
    const [, det, rest] = m;
    t = t.replace(ARTICLE_BEFORE_TASK, (_a, adj: string | undefined) => `${det} ${adj ?? ''}${rest}`);
  }
  let out = t.replace(/\{task\}/g, label);
  out = out.replace(/\b(your|the)\s+\1\b/gi, '$1').replace(/\s+([,.!?])/g, '$1');
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return out;
}

/** Replace {task} placeholders (see labelFor / fillWithLabel). */
export function fillTask(text: string, task: string, taskTabTitle: string | undefined, style: WordingStyle): string {
  return fillWithLabel(text, labelFor(task, taskTabTitle, style));
}
