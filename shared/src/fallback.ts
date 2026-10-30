import { CELEBRATIONS, OPENERS, VALIDATIONS, cleanTabTitle, fillTask, isSafeTaskLabel, looksLikeFeeling, pick, softenCopy, findBannedWords, taskKind, taskLabel, type TaskKindName } from './copy';
import { detectCrisis, safetyPayload } from './crisis';
import { STRATEGIES, STRATEGY_BY_ID } from './strategies';
import type {
  BrainDumpResponse,
  OfframpResponse,
  Region,
  SequenceRequest,
  SequenceResponse,
  StrategyCard,
  WordingStyle,
} from './types';
import { ACTION_BUTTONS } from './types';

// Offline sequencer: same contract as POST /sequence, built only from the
// pre-written strategy cards. Used whenever the backend / LLM is unavailable,
// so help never breaks.

const STOP = new Set('a an the to of and or i im i\'m my me it is in on for with at this that be just so do get can cant can\'t want need'.split(' '));

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

const KEYWORD_HINTS: Array<[RegExp, string[]]> = [
  [/\b(essay|write|writing|report|draft|paper|blog|thesis|dissertation)\b/i, ['writing', 'draft', 'blank page']],
  [/\b(read|reading|chapter|pdf|notes|article|textbook|lecture)\b/i, ['reading', 'study']],
  [/\b(code|coding|bug|program|lab|assignment|project|github)\b/i, ['concrete', 'example', 'assignment']],
  [/\b(study|exam|revise|revision|test|quiz)\b/i, ['study', 'reading', 'timer']],
  [/\b(email|message|reply|call|text)\b/i, ['social', 'smallest']],
  [/\b(overwhelm|too much|so many|everything|all of it)\b/i, ['overwhelm', 'brain dump', 'choice']],
  [/\b(loud|noisy|bright|overstim|sensory|meltdown|shutdown)\b/i, ['sensory', 'calm', 'autism']],
  [/\b(tired|exhausted|drained|sleepy|no energy)\b/i, ['rest', 'body', 'care']],
  [/\b(bored|boring)\b/i, ['interest', 'novelty', 'gamify']],
  [/\b(phone|scroll|instagram|youtube|reels)\b/i, ['distraction', 'phone']],
];

function similarity(card: StrategyCard, text: string): number {
  if (!text.trim()) return 0.3;
  const q = new Set(tokens(text));
  for (const [re, tags] of KEYWORD_HINTS) if (re.test(text)) tags.forEach((t) => q.add(t));
  const hay = new Set(tokens([card.name, ...card.tags, card.modality, card.why_it_works, ...card.steps].join(' ')));
  card.tags.forEach((t) => hay.add(t.toLowerCase()));
  let hit = 0;
  q.forEach((w) => {
    if (hay.has(w)) hit += 1;
  });
  return Math.min(1, 0.3 + hit / Math.max(3, q.size));
}

/** Steps that only make sense for something you open on a screen ("Open {task}", "the title of {task}"). */
const SCREEN_ONLY = /\b(open|skim|scroll|highlight|title of|copy the|rubric|paragraph of|font|window)\b[^.]*\{task\}|\{task\}[^.]*\b(into its own window|at the top of the page|looks)\b/i;

/** Does this card fit this kind of task? (docs/ARCHITECTURE.md "Task kinds") */
export function cardFitsKind(c: StrategyCard, kind: TaskKindName, task = ''): boolean {
  const kinds = (c.task_kinds ?? ['any']) as string[];
  if (kind === 'unknown') return kinds.includes('any') || kinds.some((k) => k !== 'message' && k !== 'chore');
  if (!kinds.includes('any') && !kinds.includes(kind)) return false;
  // a call or a chore can't be "opened": skip screen-only wording even on general cards
  const callish = kind === 'message' && /^(call|ring|phone)\b/i.test(task.trim());
  if ((kind === 'chore' || callish) && SCREEN_ONLY.test(c.steps[0])) return false;
  return true;
}

/** What the task is about: the user's words if they name one safely, else the cleaned tab title. */
function taskText(req: SequenceRequest): string {
  return isSafeTaskLabel(req.task) ? req.task : cleanTabTitle(req.task_tab_title);
}

export function rankCards(req: SequenceRequest, rand: () => number = Math.random): StrategyCard[] {
  const used = new Set(req.history.map((h) => h.strategy_id));
  const exclude = new Set(req.exclude_ids ?? []);
  if (req.action === 'different' || req.action === 'too_big') used.forEach((id) => exclude.add(id));
  const state = req.state === 'neutral' ? 'stuck' : req.state;
  const personal = new Map(req.top_strategies.map((s) => [s.id, s.score]));
  const named = taskText(req);
  const kind = taskKind(named);
  const text = `${named} ${req.transcript ?? ''}`;

  const filter = (strictState: boolean) =>
    STRATEGIES.filter((c) => {
      if (exclude.has(c.id)) return false;
      if (!cardFitsKind(c, kind, named)) return false;
      if (c.id === 'brain_dump') return false; // brain dump is its own button
      if (c.min_energy > req.energy) return false;
      if (req.energy <= 2 && c.size !== 'tiny') return false;
      if (strictState && !c.for_state.includes(state as StrategyCard['for_state'][number])) return false;
      return true;
    });
  let pool = filter(true);
  if (!pool.length) pool = filter(false);
  if (!pool.length) pool = STRATEGIES.filter((c) => c.min_energy <= 1 && c.size === 'tiny' && cardFitsKind(c, kind, named));
  if (!pool.length) pool = STRATEGIES.filter((c) => c.min_energy <= 1 && c.size === 'tiny' && (c.task_kinds ?? ['any']).includes('any'));

  const scored = pool.map((c) => {
    let s = similarity(c, text) * (personal.get(c.id) ?? 0.5);
    if (req.energy <= 1 && (c.is_rest || c.modality === 'sensory' || c.modality === 'rest')) s *= 1.6;
    if (req.state === 'overwhelmed' && /overwhelm|sensory|calm|choice|self-compassion/.test(c.tags.join(' '))) s *= 1.4;
    if (req.energy >= 3 && c.is_rest && req.state !== 'depleted') s *= 0.4; // don't push rest on someone with energy, but keep it possible
    if (req.state === 'depleted' && (c.is_rest || c.modality === 'rest' || c.modality === 'body')) s *= 1.8; // depleted: rest first
    if (kind !== 'unknown' && (c.task_kinds ?? []).includes(kind as never)) s *= 1.3; // made for this kind of task
    s *= 0.9 + rand() * 0.2; // gentle jitter so ties rotate
    return { c, s };
  });
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}

/** Words that mean "this is a lot right now" → validate first, in one sentence. */
export const OVERWHELM = /\b(overwhelm\w*|too much|can['’]?t do|can['’]?t even|can['’]?t (?:start|begin|focus|get started)|so much|everything|killing me|so hard|ugh+|argh+|hate this|drowning|piling up|stressed|panic\w*)\b/i;

const SMALLEST = ['just_open_it', 'one_item_only', 'first_line_only', 'one_percent', 'first_physical_action', 'write_the_title', 'read_one_paragraph', 'gather_what_you_need', 'set_up_space'];

function stepText(card: StrategyCard, i: number, style: WordingStyle): string {
  const list = style === 'literal' ? card.literal_version : card.steps;
  return list[Math.min(i, list.length - 1)];
}

function leadFor(card: StrategyCard, req: SequenceRequest, rotation: number): string | null {
  if (req.wording_style === 'literal') return null;
  const options = [...card.phrasings, ...OPENERS.warm];
  const recent = new Set((req.recent_phrasings ?? []).map((p) => p.toLowerCase()));
  for (let k = 0; k < options.length; k++) {
    const candidate = fillTask(pick(options, rotation + k), req.task, req.task_tab_title, 'warm');
    if (!recent.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

export function localSequence(req: SequenceRequest, region: Region = 'IN', rand: () => number = Math.random): SequenceResponse {
  const level = detectCrisis(`${req.task} ${req.transcript ?? ''}`);
  if (level !== 'none') {
    return {
      mode: 'safety',
      lead: null,
      next_step: '',
      why_one_line: '',
      size: 'tiny',
      buttons: [],
      strategy_id: '',
      strategy_name: '',
      validation: null,
      suggest_rest: false,
      source: 'card',
      safety: safetyPayload(region, level),
    };
  }

  const last = req.history[req.history.length - 1];
  let card: StrategyCard | undefined;
  let index = 0;
  let prefix = '';

  if (req.action === 'next' && last && STRATEGY_BY_ID[last.strategy_id] && !(req.exclude_ids ?? []).includes(last.strategy_id)) {
    const prev = STRATEGY_BY_ID[last.strategy_id];
    const usedSteps = req.history.filter((h) => h.strategy_id === prev.id).length;
    if (usedSteps < prev.steps.length && !prev.is_rest) {
      card = prev;
      index = usedSteps;
    }
  }

  const named = taskText(req);
  const kind = taskKind(named);
  if (!card && req.action === 'smaller') {
    const used = new Set(req.history.map((h) => h.strategy_id));
    const fits = (id: string) => {
      const c = STRATEGY_BY_ID[id];
      return !!c && !used.has(id) && c.min_energy <= Math.max(1, req.energy) && cardFitsKind(c, kind, named);
    };
    const id = SMALLEST.find(fits) ?? SMALLEST.find((x) => STRATEGY_BY_ID[x] && cardFitsKind(STRATEGY_BY_ID[x], kind, named)) ?? 'one_percent';
    card = STRATEGY_BY_ID[id];
    // said as a lead ("Even smaller, then."), never glued onto a step that may be a question
    prefix = req.wording_style === 'literal' ? '' : 'Even smaller, then.';
  }

  if (!card) card = rankCards(req, rand)[0];

  const rotation = req.history.length + Math.floor(rand() * 3);
  const taskForText = isSafeTaskLabel(req.task) ? req.task : '';
  let next = fillTask(stepText(card, index, req.wording_style), taskForText, cleanTabTitle(req.task_tab_title) || undefined, req.wording_style);
  if (findBannedWords(next).length) next = softenCopy(next);

  const depleted = req.state === 'depleted';
  const overwhelmed = req.state === 'overwhelmed' || OVERWHELM.test(`${req.transcript ?? ''} ${looksLikeFeeling(req.task) ? req.task : ''}`);
  const restLead =
    req.wording_style === 'literal'
      ? 'You have been working for a long time. Resting is a good option. If you want one small step instead:'
      : "You've been at it a while — resting is a real option. If you'd still like one tiny thing:";
  const lead = depleted ? restLead : prefix || leadFor(card, { ...req, task: taskForText }, rotation);
  return {
    mode: 'coach',
    lead,
    next_step: next,
    why_one_line: card.why_it_works,
    size: req.energy <= 2 ? 'tiny' : card.size,
    buttons: [...ACTION_BUTTONS],
    strategy_id: card.id,
    strategy_name: card.name,
    validation: overwhelmed ? pick(VALIDATIONS, rotation) : null,
    suggest_rest: depleted || req.energy <= 1 || (req.energy <= 2 && req.action === 'too_big') || !!card.is_rest,
    source: 'card',
    safety: null,
  };
}

/** First sentence of a step, without the encouragement ("That's real progress."). */
export function stepGist(step: string): string {
  const first = (step || '').split(/(?<=[.!?])\s+/)[0] ?? '';
  const g = first.replace(/[.!?]+$/, '').trim();
  return g.length > 90 ? g.slice(0, 87).trimEnd() + '…' : g;
}

export function localOfframp(task: string, progress: string[], style: WordingStyle): OfframpResponse {
  const t = looksLikeFeeling(task) ? 'your task' : task.trim() || 'your task';
  const did = progress.filter(Boolean);
  const lastStep = stepGist(did[did.length - 1] ?? '');
  const note =
    style === 'literal'
      ? did.length
        ? `You worked on ${t}. Last step: ${lastStep}. Next time, start by reading where you stopped.`
        : `You opened ${t} today. Next time, start by opening it again.`
      : did.length
        ? `Hey future-me: we got ${did.length === 1 ? 'a step' : `${did.length} steps`} into ${t} (last one: "${lastStep}"). Start by peeking at where we left off — that's all.`
        : `Hey future-me: ${t} is saved for later. Just opening it is a perfectly good first step.`;
  const rest =
    style === 'literal'
      ? 'Close the laptop. Drink water. Do something restful.'
      : 'You showed up today, and that counts. Maybe some water, a stretch, or something cosy?';
  return { note_to_future_self: note, rest_suggestion: rest, source: 'card' };
}

const GROUP_RULES: Array<[string, RegExp]> = [
  ['Uni & study', /\b(assignment|essay|exam|study|lecture|lab|project|class|homework|quiz|thesis|dbms|maths?|notes|report|reading|chapter|submit|course)\b/i],
  ['People & messages', /\b(email|e-mail|mail|text|call|message|reply|prof|professor|mom|mum|dad|friend|ta\b|teacher|whatsapp)\b/i],
  ['Home & body', /\b(laundry|clean|dishes|cook|groceries|shower|sleep|eat|room|gym|walk|doctor|meds|medicine|appointment)\b/i],
  ['Admin & money', /\b(pay|fees?|bill|rent|form|bank|scholarship|register|application|apply|book|ticket|documents?)\b/i],
];

/** Fragments that are only a feeling ("honestly it's too much") — validated, not listed as tasks. */
const FEELING_ONLY = /^(honestly\s+|and\s+|but\s+|also\s+|like\s+)*(it'?s|this is|that'?s|everything'?s|everything is|i'?m|i am|i feel|feeling|so|just|ugh|omg|idk)\b.*\b(too much|a lot|overwhelm\w*|stressed|tired|exhausted|so much|killing me|hard|awful|messy|chaos|panick\w*|anxious|scared|stuck)\b[.!?]*$|^(ugh+|argh+|omg|help|idk)[.!?]*$/i;
const LEAD_IN = /^\s*(?:and\s+|but\s+|also\s+|plus\s+|then\s+|so\s+|um+\s+|uh+\s+|like\s+|honestly\s+|oh\s+and\s+)*(?:i\s+)?(?:still\s+)?(?:really\s+)?(?:need\s+to|have\s+to|has\s+to|gotta|got\s+to|should|must|ought\s+to|want\s+to|have|haven'?t\s+(?:even\s+)?started(?:\s+on)?|didn'?t\s+(?:even\s+)?start(?:\s+on)?|am\s+supposed\s+to|i'?m\s+supposed\s+to|to)\s+/i;
const TRAIL = /\s+(?:(?:is|are)\s+)?(?:due(?:\s+(?:tomorrow|today|soon|on\s+\w+|by\s+\w+))?|is\s+piling\s+up|are\s+piling\s+up|piling\s+up|tomorrow|today|tonight|asap|soon|already|too|as\s+well|again|lol|haha)\s*$/i;
const ACTION = /^(email|reply|text|call|message|write|read|finish|start|submit|pay|book|send|open|print|fill|study|revise|review|clean|wash|do|make|buy|cook|fix|apply|register|prepare|practice|practise|complete|draft|edit|plan|ask|return|upload|check|sort|tidy)\b/i;

function cleanItem(raw: string): string {
  let s = raw.trim().replace(/^[-*•\d.)\s]+/, '');
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(LEAD_IN, '').replace(TRAIL, '').trim();
    if (s === before) break;
  }
  s = s.replace(/[.!?,;:]+$/, '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function itemKey(s: string): string {
  return s.toLowerCase().replace(/\b(the|a|an|my|our|this|that)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Filler that isn't a task at all. */
const FILLER = /^(?:idk|i\s+dunno|dunno|i\s+don['’]?t\s+know|lol|lmao|whatever|stuff|things|etc|and\s+stuff|yeah|ok(?:ay)?|hmm+|um+|uh+|so\s+yeah|like|you\s+know|i\s+guess|nothing|idek)[.!?]*$/i;

export function splitDump(text: string): string[] {
  return text
    // numbered / bulleted lists: "1. ML quiz 2. resume", "- laundry", "(3) email prof"
    .replace(/(?:^|\s)\(?\d{1,2}[.):]\s+/g, '\n')
    .replace(/(?:^|\s)[-*•–]\s+/g, '\n')
    .split(/\n|[,;•]|\.\s|\balso\b|\band then\b|\bplus\b|\band\b(?=\s+(?:i|need|have|gotta|got|to|the|my|haven'?t|mum|mom|dad)\b)/i)
    .map((s) => s.trim().replace(/\s+(?:idk|lol|lmao|and\s+stuff|or\s+something|etc)\.?$/i, '').trim())
    .filter((s) => s.length > 2 && !FILLER.test(s));
}

/** Split, drop feeling-only fragments, tidy each item and remove near-duplicates. */
export function dumpItems(text: string): { items: string[]; feelings: string[] } {
  const items: string[] = [];
  const feelings: string[] = [];
  const seen = new Set<string>();
  for (const frag of splitDump(text)) {
    if (FEELING_ONLY.test(frag.trim()) || looksLikeFeeling(frag) && !ACTION.test(cleanItem(frag))) {
      feelings.push(frag.trim());
      continue;
    }
    const item = softenCopy(cleanItem(frag));
    if (item.length < 3) continue;
    const key = itemKey(item);
    if ([...seen].some((k) => k === key || (k.length > 6 && (k.includes(key) || key.includes(k))))) continue;
    seen.add(key);
    items.push(item);
  }
  return { items, feelings };
}

const UNI_KINDS: TaskKindName[] = ['doc', 'reading', 'study', 'code'];

/** A first step that fits what the item is (you can't "open" laundry or a phone call). */
export function firstStepFor(item: string, style: WordingStyle): string {
  const kind = taskKind(item);
  const name = taskLabel(item);
  const lit = style === 'literal';
  if (kind === 'message' && /^(call|ring|phone)\b/i.test(item)) {
    return lit ? `Write three words you want to say during ${name}.` : `Jot three words you want to say on ${name}. That's your whole script.`;
  }
  if (kind === 'message') return lit ? `Open a new message and type only the greeting for ${name}.` : `Write just the first line of ${name} — "Hi," counts.`;
  if (kind === 'chore') return lit ? `Do one item of "${item}". Then stop or continue.` : `Do just one item of "${item}" — one dish, one sock. That's the whole first step.`;
  if (kind === 'admin') return lit ? `Gather what you need for "${item}" in one place. Do not start yet.` : `Just gather what "${item}" needs into one spot. Starting can wait.`;
  return lit ? `Open what you need for "${item}". Do only that.` : `Just open whatever "${item}" lives in. That's the whole first step.`;
}

export function localBrainDump(transcript: string, style: WordingStyle, region: Region = 'IN', energy = 3): BrainDumpResponse & { validation?: string | null } {
  const level = detectCrisis(transcript);
  if (level !== 'none') {
    return { mode: 'safety', groups: [], pick: null, alternatives: [], source: 'card', safety: safetyPayload(region, level) };
  }
  const { items, feelings } = dumpItems(transcript);
  const validation = feelings.length ? (style === 'literal' ? 'You said this feels like a lot. That is understandable.' : 'That sounds like a lot to hold at once — it makes sense it feels heavy.') : null;
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const label = GROUP_RULES.find(([, re]) => re.test(it))?.[0] ?? 'Other bits';
    groups.set(label, [...(groups.get(label) ?? []), it]);
  }
  if (!items.length) return { mode: 'coach', groups: [], pick: null, alternatives: [], source: 'card', safety: null, validation };
  // Pick something concrete and quick: an action verb first, quick verbs next, then the shortest.
  const quick = /\b(email|reply|text|call|pay|book|send|open|print|submit|message|form)\b/i;
  // uni items come first unless energy is low — a chore isn't "the quickest" just because it's short
  const score = (s: string) => {
    const k = taskKind(s);
    let v = (ACTION.test(s) ? 2 : 0) + (quick.test(s) ? 1 : 0);
    if (energy > 2 && UNI_KINDS.includes(k)) v += 2;
    if (energy > 2 && k === 'chore') v -= 2;
    if (energy <= 2 && (k === 'chore' || k === 'message')) v += 1;
    return v;
  };
  const ranked = [...items].sort((a, b) => score(b) - score(a) || a.length - b.length);
  const chosen = ranked[0];
  const first = firstStepFor(chosen, style);
  return {
    mode: 'coach',
    groups: Array.from(groups.entries()).map(([label, its]) => ({ label, items: its })),
    pick: {
      item: chosen,
      why: style === 'literal' ? 'It looks like the quickest item to start.' : 'It sounds like the quickest one to get moving on.',
      first_step: first,
    },
    alternatives: ranked.slice(1, 6),
    source: 'card',
    safety: null,
    validation,
  };
}

export function celebration(style: WordingStyle, i: number): string {
  return pick(CELEBRATIONS[style], i);
}
