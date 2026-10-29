import { CELEBRATIONS, OPENERS, VALIDATIONS, fillTask, pick, softenCopy, findBannedWords } from './copy';
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

export function rankCards(req: SequenceRequest, rand: () => number = Math.random): StrategyCard[] {
  const used = new Set(req.history.map((h) => h.strategy_id));
  const exclude = new Set(req.exclude_ids ?? []);
  if (req.action === 'different' || req.action === 'too_big') used.forEach((id) => exclude.add(id));
  const state = req.state === 'neutral' ? 'stuck' : req.state;
  const personal = new Map(req.top_strategies.map((s) => [s.id, s.score]));
  const text = `${req.task} ${req.transcript ?? ''}`;

  const filter = (strictState: boolean) =>
    STRATEGIES.filter((c) => {
      if (exclude.has(c.id)) return false;
      if (c.id === 'brain_dump') return false; // brain dump is its own button
      if (c.min_energy > req.energy) return false;
      if (req.energy <= 2 && c.size !== 'tiny') return false;
      if (strictState && !c.for_state.includes(state as StrategyCard['for_state'][number])) return false;
      return true;
    });
  let pool = filter(true);
  if (!pool.length) pool = filter(false);
  if (!pool.length) pool = STRATEGIES.filter((c) => c.min_energy <= 1 && c.size === 'tiny');

  const scored = pool.map((c) => {
    let s = similarity(c, text) * (personal.get(c.id) ?? 0.5);
    if (req.energy <= 1 && (c.is_rest || c.modality === 'sensory' || c.modality === 'rest')) s *= 1.6;
    if (req.state === 'overwhelmed' && /overwhelm|sensory|calm|choice|self-compassion/.test(c.tags.join(' '))) s *= 1.4;
    if (req.energy >= 3 && c.is_rest) s *= 0.4; // don't push rest on someone with energy, but keep it possible
    s *= 0.9 + rand() * 0.2; // gentle jitter so ties rotate
    return { c, s };
  });
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}

const SMALLEST = ['just_open_it', 'one_percent', 'first_physical_action', 'write_the_title', 'read_one_paragraph', 'set_up_space'];

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

  if (req.action === 'next' && last && STRATEGY_BY_ID[last.strategy_id]) {
    const prev = STRATEGY_BY_ID[last.strategy_id];
    const usedSteps = req.history.filter((h) => h.strategy_id === prev.id).length;
    if (usedSteps < prev.steps.length && !prev.is_rest) {
      card = prev;
      index = usedSteps;
    }
  }

  if (!card && req.action === 'smaller') {
    const used = new Set(req.history.map((h) => h.strategy_id));
    const id = SMALLEST.find((s) => !used.has(s) && (STRATEGY_BY_ID[s]?.min_energy ?? 9) <= Math.max(1, req.energy)) ?? 'just_open_it';
    card = STRATEGY_BY_ID[id];
    prefix = req.wording_style === 'literal' ? '' : 'Even smaller: ';
  }

  if (!card) card = rankCards(req, rand)[0];

  const rotation = req.history.length + Math.floor(rand() * 3);
  let next = fillTask(stepText(card, index, req.wording_style), req.task, req.task_tab_title, req.wording_style);
  if (prefix) next = prefix + next.charAt(0).toLowerCase() + next.slice(1);
  if (findBannedWords(next).length) next = softenCopy(next);

  const overwhelmed = req.state === 'overwhelmed' || /\b(overwhelm|too much|can['’]?t do|so much|everything)\b/i.test(req.transcript ?? '');
  return {
    mode: 'coach',
    lead: leadFor(card, req, rotation),
    next_step: next,
    why_one_line: card.why_it_works,
    size: req.energy <= 2 ? 'tiny' : card.size,
    buttons: [...ACTION_BUTTONS],
    strategy_id: card.id,
    strategy_name: card.name,
    validation: overwhelmed ? pick(VALIDATIONS, rotation) : null,
    suggest_rest: req.energy <= 1 || (req.energy <= 2 && req.action === 'too_big') || !!card.is_rest,
    source: 'card',
    safety: null,
  };
}

export function localOfframp(task: string, progress: string[], style: WordingStyle): OfframpResponse {
  const t = task.trim() || 'your task';
  const did = progress.filter(Boolean);
  const lastStep = did[did.length - 1];
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

export function splitDump(text: string): string[] {
  return text
    .split(/\n|[,;•]|\.\s|\balso\b|\band then\b|\bplus\b|\band\b(?=\s+(?:i|need|have|gotta|got|to|the|my)\b)/i)
    .map((s) => s.replace(/^\s*(i\s+(need|have|gotta|got)\s+to|i\s+should|need\s+to|have\s+to|gotta|to|um+|uh+|like)\s+/i, '').trim())
    .map((s) => s.replace(/[.!?]+$/, '').trim())
    .filter((s) => s.length > 2);
}

export function localBrainDump(transcript: string, style: WordingStyle, region: Region = 'IN'): BrainDumpResponse {
  const level = detectCrisis(transcript);
  if (level !== 'none') {
    return { mode: 'safety', groups: [], pick: null, alternatives: [], source: 'card', safety: safetyPayload(region, level) };
  }
  const items = Array.from(new Set(splitDump(transcript).map((s) => softenCopy(s))));
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const label = GROUP_RULES.find(([, re]) => re.test(it))?.[0] ?? 'Other bits';
    groups.set(label, [...(groups.get(label) ?? []), it]);
  }
  if (!items.length) return { mode: 'coach', groups: [], pick: null, alternatives: [], source: 'card', safety: null };
  // Pick the item that sounds quickest: short + "quick" verbs score higher.
  const quick = /\b(email|reply|text|call|pay|book|send|open|print|submit|message|form)\b/i;
  const ranked = [...items].sort((a, b) => (quick.test(b) ? 1 : 0) - (quick.test(a) ? 1 : 0) || a.length - b.length);
  const chosen = ranked[0];
  const first =
    style === 'literal'
      ? `Open what you need for "${chosen}". Do only that.`
      : `Just open whatever "${chosen}" lives in. That's the whole first step.`;
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
  };
}

export function celebration(style: WordingStyle, i: number): string {
  return pick(CELEBRATIONS[style], i);
}
