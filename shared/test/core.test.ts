import { describe, expect, it } from 'vitest';
import {
  STRATEGIES,
  applyBridgeRequest,
  canAutoNudge,
  classifyHost,
  computeWindow,
  defaultSettings,
  defaultStorage,
  detectCrisis,
  detectRestuck,
  findBannedWords,
  freshGuard,
  inferState,
  localBrainDump,
  localOfframp,
  localSequence,
  markDismissed,
  recordFeedback,
  reshufflePlan,
  seedDemoData,
  seededRandom,
  thompsonScores,
  COPY,
  CELEBRATIONS,
  VALIDATIONS,
  STILL_HERE,
  REST_IDEAS,
  DEFAULT_SENSITIVITY,
  type FeatureWindow,
  type RawEvent,
  type SequenceRequest,
} from '../src';

const MIN = 60_000;

function req(p: Partial<SequenceRequest> = {}): SequenceRequest {
  return {
    task: 'DBMS assignment',
    task_tab_title: 'DBMS_Assignment.pdf',
    state: 'stuck',
    energy: 3,
    history: [],
    top_strategies: [],
    action: 'start',
    wording_style: 'warm',
    explain_why: false,
    ...p,
  };
}

describe('copy rules', () => {
  it('no banned words in strategy cards or UI copy', () => {
    const all = JSON.stringify([STRATEGIES, COPY, CELEBRATIONS, VALIDATIONS, STILL_HERE, REST_IDEAS]);
    expect(findBannedWords(all)).toEqual([]);
  });
  it('has ~50 cards with literal versions and required fields', () => {
    expect(STRATEGIES.length).toBeGreaterThanOrEqual(50);
    for (const c of STRATEGIES) {
      expect(c.steps.length).toBe(c.literal_version.length);
      expect(c.why_it_works.length).toBeGreaterThan(10);
      expect(['tiny', 'small']).toContain(c.size);
    }
    for (const id of ['two_minute_start', 'ugly_first_draft', 'body_doubling', 'interest_hook', 'implementation_intention', 'change_location', 'reframe_question', 'music_cue', 'just_open_it', 'transition_ritual', 'permission_to_rest', 'sensory_reset']) {
      expect(STRATEGIES.find((c) => c.id === id), id).toBeTruthy();
    }
  });
});

describe('domain classifier', () => {
  it('classifies by domain only', () => {
    expect(classifyHost('docs.google.com')).toBe('work');
    expect(classifyHost('stackoverflow.com')).toBe('work');
    expect(classifyHost('moodle.university.edu')).toBe('work');
    expect(classifyHost('instagram.com')).toBe('escape');
    expect(classifyHost('youtube.com')).toBe('neutral');
    expect(classifyHost('youtube.com', { researchSites: ['youtube.com'] })).toBe('work');
    expect(classifyHost('example.org')).toBe('neutral');
  });
});

describe('crisis detection', () => {
  it('catches explicit and hopeless language', () => {
    expect(detectCrisis('i want to kill myself')).toBe('high');
    expect(detectCrisis("honestly I don't want to be alive anymore")).toBe('high');
    expect(detectCrisis('everyone would be better off without me')).toBe('high');
    expect(detectCrisis('I feel so hopeless about everything')).toBe('concern');
    expect(detectCrisis('i want to disappear')).toBe('concern');
    expect(detectCrisis('honestly kms')).toBe('high');
    expect(detectCrisis('sometimes I wish I never wake up')).toBe('concern');
  });
  it('ignores common idioms', () => {
    expect(detectCrisis('this assignment is killing me')).toBe('none');
    expect(detectCrisis("I'm dead tired")).toBe('none');
    expect(detectCrisis('dying of boredom in this lecture')).toBe('none');
    expect(detectCrisis('need to kill the process on port 3000')).toBe('none');
    expect(detectCrisis("I'm hopeless at maths lol")).toBe('none');
  });
});

describe('thompson sampling', () => {
  it('prefers strategies that worked, but still explores', () => {
    let stats = {};
    for (let i = 0; i < 12; i++) stats = recordFeedback(stats, 'body_doubling', 'up');
    for (let i = 0; i < 6; i++) stats = recordFeedback(stats, 'focus_round_10', 'down');
    const rand = seededRandom(1);
    let wins = 0;
    let downTop = 0;
    const tops = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const ranked = thompsonScores(STRATEGIES, stats, rand);
      if (ranked[0].id === 'body_doubling') wins++;
      if (ranked[0].id === 'focus_round_10') downTop++;
      tops.add(ranked[0].id);
    }
    expect(wins).toBeGreaterThan(30); // far above the 1/58 chance
    expect(downTop).toBeLessThan(wins);
    expect(tops.size).toBeGreaterThan(5); // keeps exploring
  });
});

describe('sensing', () => {
  const lists = {};
  function stuckWindows(now: number): FeatureWindow[] {
    const ws: FeatureWindow[] = [];
    for (let i = 10; i > 0; i--) {
      ws.push({
        t: now - (i - 1) * 30_000,
        switches: 2,
        escapeSwitches: 1,
        workSwitches: 0,
        taskReturns: i % 2 ? 1 : 0,
        taskInteractions: 0,
        escapeInteractions: 10,
        onTaskMs: 5000,
        onEscapeMs: 25000,
        idleMs: 0,
        activeHost: 'instagram.com',
        activeCategory: 'escape',
        fullscreen: false,
        hour: 15,
      });
    }
    return ws;
  }

  it('computes features from raw metadata events', () => {
    const t0 = 1_000_000;
    const events: RawEvent[] = [
      { t: t0 + 1000, kind: 'activate', tabId: 2, host: 'instagram.com', isTaskTab: false },
      { t: t0 + 5000, kind: 'interact', tabId: 2, host: 'instagram.com', keys: 0, scrolls: 12, clicks: 1 },
      { t: t0 + 10000, kind: 'activate', tabId: 1, host: 'local-file', isTaskTab: true },
      { t: t0 + 12000, kind: 'interact', tabId: 1, host: 'local-file', keys: 3, scrolls: 0, clicks: 0 },
    ];
    const { window, ctx } = computeWindow(events, { activeTabId: 1, activeHost: 'local-file', isTaskTab: true, idle: 'active', fullscreen: false, idleSince: null }, t0, t0 + 30000, lists);
    expect(window.switches).toBe(2);
    expect(window.escapeSwitches).toBe(1);
    expect(window.taskReturns).toBe(1);
    expect(window.taskInteractions).toBe(3);
    expect(window.escapeInteractions).toBe(13);
    expect(window.onEscapeMs).toBe(9000);
    expect(ctx.activeTabId).toBe(1);
  });

  it('detects STUCK with a plain-English reason', () => {
    const now = Date.now();
    const r = inferState({ windows: stuckWindows(now), baseline: null, sensitivity: DEFAULT_SENSITIVITY, sessionStartedAt: now - 20 * MIN, idleSince: null, taskLabel: 'DBMS.pdf', now });
    expect(r.state).toBe('stuck');
    expect(r.reason).toMatch(/Switched tabs 20 times/);
    expect(r.reason).toMatch(/DBMS.pdf 5 times/);
  });

  it('switching between work sites is not stuck', () => {
    const now = Date.now();
    const ws = stuckWindows(now).map((w) => ({ ...w, escapeSwitches: 0, workSwitches: 2, onEscapeMs: 0, onTaskMs: 30000 }));
    expect(inferState({ windows: ws, baseline: null, sensitivity: DEFAULT_SENSITIVITY, sessionStartedAt: now - 20 * MIN, idleSince: null, taskLabel: null, now }).state).not.toBe('stuck');
  });

  it('"Wrong" feedback raises the bar', () => {
    const now = Date.now();
    const r = inferState({ windows: stuckWindows(now), baseline: null, sensitivity: { ...DEFAULT_SENSITIVITY, stuck: 2 }, sessionStartedAt: now - 20 * MIN, idleSince: null, taskLabel: null, now });
    expect(r.state).not.toBe('stuck');
  });

  it('AWAY after 5 idle minutes', () => {
    const now = Date.now();
    expect(inferState({ windows: [], baseline: null, sensitivity: DEFAULT_SENSITIVITY, sessionStartedAt: null, idleSince: now - 6 * MIN, taskLabel: null, now }).state).toBe('away');
  });

  it('detects re-stuck after a step starts', () => {
    const now = Date.now();
    const start = now - 8 * MIN;
    const ws: FeatureWindow[] = [];
    for (let t = start + 30_000; t <= now; t += 30_000) {
      const recent = t > now - 3 * MIN;
      ws.push({ t, switches: recent ? 1 : 0, escapeSwitches: recent ? 1 : 0, workSwitches: 0, taskReturns: 0, taskInteractions: recent ? 0 : 20, escapeInteractions: 0, onTaskMs: recent ? 0 : 30000, onEscapeMs: recent ? 30000 : 0, idleMs: 0, activeHost: null, activeCategory: null, fullscreen: false, hour: 14 });
    }
    expect(detectRestuck(ws, start, now, DEFAULT_SENSITIVITY)?.state).toBe('stuck');
  });
});

describe('anti-nag guard', () => {
  const now = new Date('2026-10-29T15:00:00').getTime();
  const settings = { ...defaultSettings(now - 10 * 24 * 60 * MIN), onboarded: true };
  const ctx = { now, state: 'stuck' as const, fullscreen: false, onCall: false, onBreak: false };

  it('never nudges during flow, learning mode, fullscreen or calls', () => {
    expect(canAutoNudge(freshGuard(now), settings, ctx).ok).toBe(true);
    expect(canAutoNudge(freshGuard(now), settings, { ...ctx, state: 'flow' }).ok).toBe(false);
    expect(canAutoNudge(freshGuard(now), { ...settings, installedAt: now - 60 * MIN }, ctx).ok).toBe(false);
    expect(canAutoNudge(freshGuard(now), settings, { ...ctx, fullscreen: true }).ok).toBe(false);
    expect(canAutoNudge(freshGuard(now), settings, { ...ctx, onCall: true }).ok).toBe(false);
  });

  it('cooldown doubles and 3 dismissals turn nudges off until tomorrow', () => {
    let g = { ...freshGuard(now), lastAutoNudgeAt: now - 25 * MIN };
    expect(canAutoNudge(g, settings, ctx).ok).toBe(true);
    g = markDismissed(g, now).guard;
    expect(g.cooldownMin).toBe(40);
    expect(canAutoNudge(g, settings, ctx).ok).toBe(false);
    g = markDismissed(g, now).guard;
    const third = markDismissed(g, now);
    expect(third.turnedOff).toBe(true);
    expect(canAutoNudge({ ...third.guard, lastAutoNudgeAt: 0 }, settings, ctx).ok).toBe(false);
    // next day: fresh start, no penalty carried over
    expect(canAutoNudge({ ...third.guard, lastAutoNudgeAt: 0 }, settings, { ...ctx, now: now + 24 * 60 * MIN }).ok).toBe(true);
  });

  it('respects quiet hours across midnight', () => {
    const late = new Date('2026-10-29T23:30:00').getTime();
    const s = { ...settings, quietHours: { enabled: true, start: '23:00', end: '08:00' } };
    expect(canAutoNudge(freshGuard(late), s, { ...ctx, now: late }).ok).toBe(false);
  });
});

describe('offline sequencer', () => {
  it('always returns a step with all five buttons', () => {
    const r = localSequence(req(), 'IN', seededRandom(3));
    expect(r.mode).toBe('coach');
    expect(r.next_step.length).toBeGreaterThan(5);
    expect(r.buttons).toEqual(['done', 'too_big', 'smaller', 'different', 'rest']);
    expect(findBannedWords(r.next_step)).toEqual([]);
  });
  it('literal mode uses the exact file name', () => {
    const r = localSequence(req({ wording_style: 'literal' }), 'IN', seededRandom(4));
    expect(r.lead).toBeNull();
    if (r.next_step.includes('DBMS')) expect(r.next_step).toContain('DBMS_Assignment.pdf');
  });
  it('energy <= 2 gives tiny steps only', () => {
    for (let i = 0; i < 20; i++) expect(localSequence(req({ energy: 2 }), 'IN', seededRandom(i)).size).toBe('tiny');
  });
  it('different idea avoids previous strategies', () => {
    const r = localSequence(req({ action: 'different', history: [{ step: 'x', strategy_id: 'two_minute_start', outcome: 'different' }] }), 'IN', seededRandom(5));
    expect(r.strategy_id).not.toBe('two_minute_start');
  });
  it('next continues the same strategy', () => {
    const r = localSequence(req({ action: 'next', history: [{ step: 'x', strategy_id: 'ugly_first_draft', outcome: 'done' }] }), 'IN', seededRandom(5));
    expect(r.strategy_id).toBe('ugly_first_draft');
  });
  it('switches to safety mode on crisis language', () => {
    const r = localSequence(req({ transcript: "I don't want to live anymore" }));
    expect(r.mode).toBe('safety');
    expect(r.safety?.resources[0].phone).toBe('14416');
  });
  it('brain dump groups and picks one', () => {
    const r = localBrainDump('I need to finish the DBMS assignment, email my prof, do laundry and also pay mess fees', 'warm');
    expect(r.pick?.item).toBeTruthy();
    expect(r.groups.length).toBeGreaterThan(1);
  });
  it('offramp writes a kind note', () => {
    const r = localOfframp('DBMS assignment', ['Opened the PDF'], 'warm');
    expect(r.note_to_future_self).toContain('DBMS assignment');
    expect(findBannedWords(r.note_to_future_self + r.rest_suggestion)).toEqual([]);
  });
});

describe('plan + bridge', () => {
  it('low energy keeps fewer, smaller items and only offers to move', () => {
    const s = seedDemoData(Date.now());
    const low = reshufflePlan(s.plan, 1);
    const high = reshufflePlan(s.plan, 5);
    expect(low.keep.length).toBeLessThan(high.keep.length);
    expect(low.keep[0].size).toBe('tiny');
    expect(low.message).not.toMatch(/should|overdue/i);
  });
  it('"Wrong" on an inference adjusts sensitivity', () => {
    const s = seedDemoData(Date.now());
    const target = s.inferences.find((i) => i.state === 'stuck' && !i.feedback)!;
    const before = s.settings.sensitivity.stuck;
    const { store } = applyBridgeRequest(s, { type: 'inferenceFeedback', id: target.id, feedback: 'wrong' });
    expect(store.settings.sensitivity.stuck).toBeGreaterThan(before);
  });
  it('crisis simulation is never stored', () => {
    const s = defaultStorage();
    const { store } = applyBridgeRequest(s, { type: 'simulate', kind: 'crisis' });
    expect(store.inferences.length).toBe(0);
  });
  it('seed has a week of believable history', () => {
    const s = seedDemoData(Date.now());
    expect(s.wins.length).toBeGreaterThan(15);
    expect(s.inferences.some((i) => i.feedback === 'wrong')).toBe(true);
    expect(findBannedWords(JSON.stringify(s))).toEqual([]);
  });
});

describe('task labels', () => {
  it('does not quote feelings back as the task', async () => {
    const { fillTask } = await import('../src');
    expect(fillTask('Open {task}.', 'this assignment is killing me', 'DBMS_Assignment.pdf', 'warm')).toBe('Open DBMS_Assignment.pdf.');
    expect(fillTask('Open {task}.', "I'm so stuck", undefined, 'warm')).toBe('Open your task.');
    expect(fillTask('Open {task}.', 'DBMS assignment', undefined, 'warm')).toBe('Open DBMS assignment.');
  });
});
