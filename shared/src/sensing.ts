import { classifyHost, type ClassifierLists } from './classifier';
import type { Baseline, BreakState, FeatureWindow, Inference, RawEvent, Sensitivity, UserState } from './types';
import { MIN, clamp, median, quantile, uid } from './util';

// Pure, on-device sensing logic. The service worker feeds raw metadata events
// in; every 30 s we turn them into a FeatureWindow and delete the raw events.

export const WINDOW_MS = 30_000;
export const AWAY_MS = 5 * MIN;

export interface SensingContext {
  activeTabId: number | null;
  activeHost: string;
  isTaskTab: boolean;
  idle: 'active' | 'idle' | 'locked';
  fullscreen: boolean;
  /** when the current idle stretch began (null if active) */
  idleSince: number | null;
}

export const EMPTY_CONTEXT: SensingContext = {
  activeTabId: null,
  activeHost: '',
  isTaskTab: false,
  idle: 'active',
  fullscreen: false,
  idleSince: null,
};

export function computeWindow(
  events: RawEvent[],
  ctx: SensingContext,
  from: number,
  to: number,
  lists: ClassifierLists,
): { window: FeatureWindow; ctx: SensingContext } {
  const sorted = events.filter((e) => e.t >= from - 1 && e.t <= to + 1).sort((a, b) => a.t - b.t);
  let c: SensingContext = { ...ctx };
  const w: FeatureWindow = {
    t: to,
    switches: 0,
    escapeSwitches: 0,
    workSwitches: 0,
    taskReturns: 0,
    taskInteractions: 0,
    escapeInteractions: 0,
    onTaskMs: 0,
    onEscapeMs: 0,
    idleMs: 0,
    activeHost: c.activeHost || null,
    activeCategory: null,
    fullscreen: c.fullscreen,
    hour: new Date(to).getHours(),
  };

  let cursor = from;
  const account = (until: number) => {
    const dt = Math.max(0, until - cursor);
    if (c.idle !== 'active') w.idleMs += dt;
    else {
      const cat = classifyHost(c.activeHost, lists);
      if (c.isTaskTab || cat === 'work') w.onTaskMs += dt;
      else if (cat === 'escape') w.onEscapeMs += dt;
    }
    cursor = until;
  };

  for (const e of sorted) {
    account(clamp(e.t, from, to));
    switch (e.kind) {
      case 'activate': {
        if (e.tabId === c.activeTabId) break;
        w.switches += 1;
        const cat = classifyHost(e.host, lists);
        if (cat === 'escape') w.escapeSwitches += 1;
        if (cat === 'work') w.workSwitches += 1;
        if (e.isTaskTab) w.taskReturns += 1;
        c = { ...c, activeTabId: e.tabId, activeHost: e.host, isTaskTab: e.isTaskTab };
        break;
      }
      case 'interact': {
        const n = e.keys + e.scrolls + e.clicks;
        const cat = classifyHost(e.host, lists);
        const onTask = e.tabId === c.activeTabId ? c.isTaskTab : false;
        if (onTask || cat === 'work') w.taskInteractions += n;
        else if (cat === 'escape') w.escapeInteractions += n;
        break;
      }
      case 'idle':
        c = { ...c, idle: e.state, idleSince: e.state === 'active' ? null : c.idleSince ?? e.t };
        break;
      case 'fullscreen':
        c = { ...c, fullscreen: e.on };
        w.fullscreen = w.fullscreen || e.on;
        break;
    }
  }
  account(to);
  w.activeHost = c.activeHost || null;
  w.activeCategory = c.activeHost ? classifyHost(c.activeHost, lists) : null;
  return { window: w, ctx: c };
}

// ---------- Baseline (learning mode) ----------

export const DEFAULT_BASELINE: Baseline = {
  switchesPerMinMedian: 1.5,
  switchesPerMinP75: 3,
  taskInteractionsPerMinMedian: 25,
  idleGapMinMedian: 1,
  typicalSessionMin: 75,
  samples: 0,
  updatedAt: 0,
};

/** Summarise a 5-minute block of windows into one baseline sample. Returns null when away. */
export function blockSample(windows: FeatureWindow[]): number[] | null {
  if (!windows.length) return null;
  const minutes = (windows.length * WINDOW_MS) / MIN;
  const idle = windows.reduce((a, w) => a + w.idleMs, 0);
  if (idle > 0.8 * windows.length * WINDOW_MS) return null; // mostly away: not informative
  const switches = windows.reduce((a, w) => a + w.switches, 0);
  const inter = windows.reduce((a, w) => a + w.taskInteractions, 0);
  return [switches / minutes, inter / minutes, idle / MIN];
}

export function computeBaseline(samples: number[][], typicalSessionMin = 75, now = Date.now()): Baseline {
  if (samples.length < 6) return { ...DEFAULT_BASELINE, samples: samples.length, updatedAt: now };
  const sw = samples.map((s) => s[0]);
  const ti = samples.map((s) => s[1]);
  const ig = samples.map((s) => s[2]);
  return {
    switchesPerMinMedian: Math.max(0.5, median(sw)),
    switchesPerMinP75: Math.max(1.5, quantile(sw, 0.75)),
    taskInteractionsPerMinMedian: Math.max(5, median(ti)),
    idleGapMinMedian: median(ig),
    typicalSessionMin,
    samples: samples.length,
    updatedAt: now,
  };
}

export const DEFAULT_SENSITIVITY: Sensitivity = { stuck: 1, depleted: 1, flow: 1 };

/** "Wrong" makes Nudge need more evidence next time; "Right" relaxes it a touch. */
export function adjustSensitivity(s: Sensitivity, state: string, feedback: 'right' | 'wrong'): Sensitivity {
  const key: keyof Sensitivity | null =
    state === 'stuck' || state === 'restuck' ? 'stuck' : state === 'depleted' ? 'depleted' : state === 'flow' ? 'flow' : null;
  if (!key) return s;
  const factor = feedback === 'wrong' ? 1.2 : 0.97;
  return { ...s, [key]: Number(clamp(s[key] * factor, 0.7, 2.5).toFixed(3)) };
}

// ---------- State inference ----------

export interface InferInput {
  windows: FeatureWindow[]; // chronological, most recent last
  baseline: Baseline | null;
  sensitivity: Sensitivity;
  sessionStartedAt: number | null;
  idleSince: number | null;
  taskLabel: string | null; // e.g. "DBMS.pdf"
  now: number;
}

export interface InferResult {
  state: UserState;
  reason: string;
}

function sum(ws: FeatureWindow[], k: keyof FeatureWindow): number {
  return ws.reduce((a, w) => a + (w[k] as number), 0);
}

function lastMinutes(ws: FeatureWindow[], minutes: number, now: number): FeatureWindow[] {
  return ws.filter((w) => w.t > now - minutes * MIN);
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function inferState(input: InferInput): InferResult {
  const { windows, sensitivity: sens, now } = input;
  const b = input.baseline ?? DEFAULT_BASELINE;
  const task = input.taskLabel || 'your work tabs';

  // AWAY — idle > 5 min. No nudges.
  if (input.idleSince && now - input.idleSince >= AWAY_MS) {
    const m = Math.round((now - input.idleSince) / MIN);
    return { state: 'away', reason: `No keyboard or mouse activity for about ${plural(m, 'minute')}.` };
  }

  const last5 = lastMinutes(windows, 5, now);
  const last10 = lastMinutes(windows, 10, now);
  if (last5.length < 4) return { state: 'neutral', reason: 'Not enough recent activity to say anything yet.' };

  const switches5 = sum(last5, 'switches');
  const returns5 = sum(last5, 'taskReturns');
  const escape5 = sum(last5, 'escapeSwitches');
  const inter5 = sum(last5, 'taskInteractions');
  const mins5 = (last5.length * WINDOW_MS) / MIN;
  const switchesPerMin = switches5 / mins5;
  const interPerMin = inter5 / mins5;

  // STUCK — ≥3 returns to task tab in 5 min + escape switching + near-zero task activity,
  // all scaled to the user's own baseline and "Wrong"-feedback sensitivity.
  const needReturns = Math.ceil(3 * sens.stuck);
  const needEscape = Math.ceil(2 * sens.stuck);
  const switchyForYou = switchesPerMin >= b.switchesPerMinP75 * sens.stuck;
  const nearZero = interPerMin <= Math.max(3, b.taskInteractionsPerMinMedian * 0.2) / sens.stuck;
  if (returns5 >= needReturns && escape5 >= needEscape && nearZero && switchyForYou) {
    return {
      state: 'stuck',
      reason: `Switched tabs ${switches5} times in 5 min, came back to ${task} ${plural(returns5, 'time')}, with very little typing or scrolling there.`,
    };
  }

  // DEPLETED — long session + growing idle gaps + late hour.
  if (input.sessionStartedAt) {
    const sessionMin = (now - input.sessionStartedAt) / MIN;
    const longFor = Math.max(90, b.typicalSessionMin * 1.3) * sens.depleted;
    const recent = lastMinutes(windows, 20, now);
    const earlier = windows.filter((w) => w.t <= now - 20 * MIN && w.t > now - 40 * MIN);
    const idleRecent = sum(recent, 'idleMs') / Math.max(1, recent.length);
    const idleEarlier = sum(earlier, 'idleMs') / Math.max(1, earlier.length);
    const growingIdle = recent.length >= 10 && idleRecent > Math.max(4000, idleEarlier * 1.5);
    const hour = new Date(now).getHours();
    const late = hour >= 22 || hour < 5;
    if (sessionMin >= longFor && growingIdle && (late || sessionMin >= longFor * 1.5)) {
      const h = Math.floor(sessionMin / 60);
      const m = Math.round(sessionMin % 60);
      const len = h ? `${h}h ${m}m` : `${m} min`;
      return {
        state: 'depleted',
        reason: `Session has run ${len}${late ? `, it's past ${hour >= 22 ? '10 pm' : 'midnight'}` : ''}, and the pauses between activity are getting longer.`,
      };
    }
  }

  // FLOW / HYPERFOCUS — steady on-task activity, few switches. Never interrupt.
  if (last10.length >= 16) {
    const onTask = sum(last10, 'onTaskMs');
    const total = last10.length * WINDOW_MS;
    const sw10 = sum(last10, 'switches') / ((last10.length * WINDOW_MS) / MIN);
    const steady = last10.filter((w) => w.taskInteractions > 0 || w.onTaskMs > 25_000).length / last10.length;
    if (onTask / total >= 0.75 / sens.flow && sw10 <= Math.max(1.5, b.switchesPerMinMedian) * sens.flow && steady >= 0.7) {
      return { state: 'flow', reason: `Steady activity on ${task} for 10+ minutes with few tab switches.` };
    }
  }

  return { state: 'neutral', reason: 'Nothing unusual — just regular browsing.' };
}

/**
 * Mid-task re-stuck: after a step starts, if task activity drops and escape
 * switching rises within the 10–15 min watch window.
 */
export function detectRestuck(windows: FeatureWindow[], stepStartedAt: number, now: number, sens: Sensitivity): InferResult | null {
  const since = now - stepStartedAt;
  if (since < 4 * MIN || since > 15 * MIN) return null;
  const after = windows.filter((w) => w.t > stepStartedAt);
  const recent = after.filter((w) => w.t > now - 3 * MIN);
  const earlier = after.filter((w) => w.t <= now - 3 * MIN);
  if (recent.length < 4 || earlier.length < 2) return null;
  const rate = (ws: FeatureWindow[]) => sum(ws, 'taskInteractions') / ws.length;
  const dropped = rate(recent) <= rate(earlier) * 0.3 / sens.stuck;
  const escapes = sum(recent, 'escapeSwitches');
  const escapeTime = sum(recent, 'onEscapeMs') / (recent.length * WINDOW_MS);
  if (dropped && (escapes >= Math.ceil(2 * sens.stuck) || escapeTime > 0.5 * sens.stuck)) {
    return {
      state: 'stuck',
      reason: `Typing and scrolling on the task dropped off, and ${plural(escapes, 'switch', 'switches')} to other sites in the last 3 minutes.`,
    };
  }
  return null;
}

/** Break ran long on escape sites → one soft return prompt. */
export function breakRanLong(br: BreakState, windows: FeatureWindow[], now: number): boolean {
  if (br.returnPromptShown) return false;
  if (now - br.startedAt < (br.plannedMin + 3) * MIN) return false;
  const recent = lastMinutes(windows, 2, now);
  if (recent.length < 3) return false;
  const escape = sum(recent, 'onEscapeMs');
  return escape / (recent.length * WINDOW_MS) > 0.6;
}

export function makeInference(state: Inference['state'], reason: string, now = Date.now(), acted: Inference['acted'] = 'none', silencedBecause?: string): Inference {
  return { id: uid('inf_'), t: now, state, reason, acted, silencedBecause };
}
