import { describe, expect, it } from 'vitest';
import { defaultStorage, freshGuard, markDismissed, type FeatureWindow, type StorageShape } from '@nudge/shared';
import { FEATURE_KEEP_MS, planTick, type TickEnv } from '../src/background/plan';
import type { SessionState } from '../src/lib/storage';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = new Date('2026-10-29T15:00:00').getTime();

function win(t: number, p: Partial<FeatureWindow> = {}): FeatureWindow {
  return {
    t,
    switches: 0,
    escapeSwitches: 0,
    workSwitches: 0,
    taskReturns: 0,
    taskInteractions: 0,
    escapeInteractions: 0,
    onTaskMs: 0,
    onEscapeMs: 0,
    idleMs: 0,
    activeHost: null,
    activeCategory: null,
    fullscreen: false,
    hour: new Date(t).getHours(),
    ...p,
  };
}

/** 9 windows of classic "stuck" bouncing ending just before `now`. */
function stuckFeatures(now: number): FeatureWindow[] {
  return Array.from({ length: 9 }, (_, i) => {
    const k = 9 - i;
    return win(now - k * 30_000, { switches: 2, escapeSwitches: 1, taskReturns: k % 2, onTaskMs: 4000, onEscapeMs: 26000, escapeInteractions: 8 });
  });
}

function flowFeatures(now: number, minutes = 12): FeatureWindow[] {
  return Array.from({ length: minutes * 2 }, (_, i) => win(now - (minutes * 2 - i) * 30_000, { onTaskMs: 30000, taskInteractions: 20, activeHost: 'docs.google.com', activeCategory: 'work' }));
}

function store(over: Partial<StorageShape> = {}, now = T0): StorageShape {
  const s = defaultStorage(now - 10 * DAY);
  return { ...s, settings: { ...s.settings, onboarded: true }, guard: freshGuard(now), ...over };
}

const escapeCtx = { activeTabId: 2, activeHost: 'instagram.com', isTaskTab: false, idle: 'active' as const, fullscreen: false, idleSince: null };
const taskCtx = { activeTabId: 1, activeHost: 'docs.google.com', isTaskTab: true, idle: 'active' as const, fullscreen: false, idleSince: null };

function env(st: StorageShape, ses: SessionState = {}, now = T0, extra: Partial<TickEnv> = {}): TickEnv {
  return { now, store: st, ses: { windowStart: now - 30_000, ctx: escapeCtx, rawEvents: [], ...ses }, windowFullscreen: false, onCall: false, ...extra };
}

/** Apply a plan's patches, like the service worker does. */
function apply(st: StorageShape, ses: SessionState, plan: ReturnType<typeof planTick>): [StorageShape, SessionState] {
  return [{ ...st, ...plan.patch } as StorageShape, { ...ses, ...plan.sessionPatch }];
}

describe('anti-nag rules', () => {
  it('nudges when stuck, then never twice within 20 minutes — even after a worker restart', () => {
    const st = store({ features: stuckFeatures(T0) });
    const p1 = planTick(env(st));
    expect(p1.overlay?.variant).toBe('nudge');
    expect(p1.clearIntent).toBe(true);
    expect(p1.patch.inferences?.at(-1)?.acted).toBe('nudged');
    // "restart": the next tick only sees what was persisted
    const [st2, ses2] = apply(st, {}, p1);
    const p2 = planTick(env({ ...st2, features: stuckFeatures(T0 + 30_000) }, ses2, T0 + 30_000));
    expect(p2.overlay).toBeNull();
    expect(p2.patch.inferences).toBeUndefined(); // no duplicate log either
    // 21 minutes later it may gently try again
    const later = T0 + 21 * MIN;
    const p3 = planTick(env({ ...st2, features: stuckFeatures(later) }, { ...ses2, lastState: 'neutral' }, later));
    expect(p3.overlay?.variant).toBe('nudge');
  });

  it('"I\'m fine" doubles the quiet time; the third turns auto-nudges off until tomorrow', () => {
    let guard = { ...freshGuard(T0), lastAutoNudgeAt: T0 - 25 * MIN };
    guard = markDismissed(guard, T0 - 25 * MIN).guard; // cooldown 40
    const st = store({ guard, features: stuckFeatures(T0) });
    expect(planTick(env(st)).overlay).toBeNull();
    const at45 = T0 + 20 * MIN;
    expect(planTick(env({ ...st, features: stuckFeatures(at45) }, {}, at45)).overlay?.variant).toBe('nudge');

    let g3 = freshGuard(T0);
    for (let i = 0; i < 3; i++) g3 = markDismissed(g3, T0).guard;
    expect(g3.offUntilTomorrow).toBe(true);
    const off = store({ guard: g3, features: stuckFeatures(T0) });
    const quiet = planTick(env(off));
    expect(quiet.overlay).toBeNull();
    expect(quiet.patch.inferences?.at(-1)?.silencedBecause).toMatch(/resting until tomorrow/);
    // a new day starts fresh — nothing carried over
    const tomorrow = T0 + DAY;
    expect(planTick(env({ ...off, features: stuckFeatures(tomorrow) }, {}, tomorrow)).overlay?.variant).toBe('nudge');
  });

  const silences: Array<[string, (st: StorageShape) => StorageShape, Partial<TickEnv>, SessionState, RegExp]> = [
    ['learning mode', (st) => ({ ...st, settings: { ...st.settings, installedAt: T0 - DAY } }), {}, {}, /./],
    ['quiet hours across midnight', (st) => ({ ...st, settings: { ...st.settings, quietHours: { enabled: true, start: '14:00', end: '08:00' } } }), {}, {}, /Quiet hours/],
    ['do not disturb', (st) => ({ ...st, settings: { ...st.settings, dndUntil: T0 + 60 * MIN } }), {}, {}, /Do not disturb/],
    ['browser fullscreen', (st) => st, { windowFullscreen: true }, {}, /fullscreen/],
    ['page fullscreen', (st) => st, {}, { ctx: { ...escapeCtx, fullscreen: true } }, /fullscreen/],
    ['video call', (st) => st, { onCall: true }, {}, /video call/],
    ['panel already open', (st) => st, {}, { panelOpenUntil: T0 + 30_000 }, /already open/],
    ['called it a day', (st) => ({ ...st, guard: { ...st.guard, dayClosed: true } }), {}, {}, /called it a day/],
    ['on a break', (st) => ({ ...st, breakState: { startedAt: T0 - 2 * MIN, plannedMin: 15, returnPromptShown: false } }), {}, {}, /break/],
    ['excluded site', (st) => st, {}, { ctx: { ...escapeCtx, activeHost: 'excluded' } }, /excluded/],
  ];
  for (const [name, mod, extra, ses, why] of silences) {
    it(`stays quiet: ${name}`, () => {
      const st = mod(store({ features: stuckFeatures(T0) }));
      const p = planTick(env(st, ses, T0, extra));
      expect(p.overlay).toBeNull();
      const inf = p.patch.inferences?.at(-1);
      expect(inf?.acted === 'learning' || why.test(inf?.silencedBecause ?? '')).toBe(true);
    });
  }

  it('never interrupts flow', () => {
    const st = store({ features: flowFeatures(T0) });
    const p = planTick(env(st, { ctx: taskCtx }));
    expect(p.overlay).toBeNull();
    expect(p.patch.inferences?.at(-1)?.state).toBe('flow');
  });

  it('paused tracking: no sensing at all, raw events dropped', () => {
    const st = store({ features: stuckFeatures(T0), settings: { ...store().settings, trackingPaused: true } });
    const p = planTick(env(st, { rawEvents: [{ t: T0 - 1000, kind: 'interact', tabId: 1, host: 'a.com', keys: 3, scrolls: 0, clicks: 0 }] }));
    expect(p.overlay).toBeNull();
    expect(p.sessionPatch.rawEvents).toEqual([]);
    expect(p.patch.features).toBeUndefined();
  });

  it('raw events are deleted every tick and features are capped to 2 hours', () => {
    const old = win(T0 - FEATURE_KEEP_MS - MIN);
    const st = store({ features: [old, ...flowFeatures(T0, 3)] });
    const p = planTick(env(st, { rawEvents: [{ t: T0 - 1000, kind: 'interact', tabId: 1, host: 'docs.google.com', keys: 3, scrolls: 0, clicks: 0 }] }));
    expect(p.sessionPatch.rawEvents).toEqual([]);
    expect(p.patch.features?.some((f) => f.t === old.t)).toBe(false);
    expect(p.patch.features?.at(-1)?.taskInteractions).toBe(3);
  });
});

describe('chips', () => {
  it('shows at most one overlay per tick (the re-stuck chip wins over a fresh nudge)', () => {
    const stepAt = T0 - 8 * MIN;
    const before = Array.from({ length: 8 }, (_, i) => win(stepAt + (i + 1) * 30_000, { taskInteractions: 25, onTaskMs: 30000 }));
    const st = store({ features: [...before, ...stuckFeatures(T0)] });
    const p = planTick(env(st, { stepStartedAt: stepAt, stepIndex: 0 }));
    expect(p.overlay?.text).toMatch(/Still going/);
    expect(p.patch.guard?.restuckChipShownForStep).toBe(stepAt);
  });

  it('re-stuck chip: once per step, and again for a new step even with the same index', () => {
    const stepAt = T0 - 8 * MIN;
    const before = Array.from({ length: 8 }, (_, i) => win(stepAt + (i + 1) * 30_000, { taskInteractions: 25, onTaskMs: 30000 }));
    const st = store({ features: [...before, ...stuckFeatures(T0)], guard: { ...freshGuard(T0), restuckChipShownForStep: stepAt, lastAutoNudgeAt: T0 - MIN } });
    expect(planTick(env(st, { stepStartedAt: stepAt, stepIndex: 1 })).overlay).toBeNull();
    // resumed after "stuck again": new step, same index 1, new start time
    const newStep = T0 - 7 * MIN;
    const before2 = Array.from({ length: 6 }, (_, i) => win(newStep + (i + 1) * 30_000, { taskInteractions: 25, onTaskMs: 30000 }));
    const st2 = { ...st, features: [...before2, ...stuckFeatures(T0)] };
    expect(planTick(env(st2, { stepStartedAt: newStep, stepIndex: 1 })).overlay?.text).toMatch(/Still going/);
  });

  it('hydration chip after 90 min of continuous flow, then not again for 90 min, never in learning mode', () => {
    const st = store({ features: flowFeatures(T0) });
    const ses: SessionState = { ctx: taskCtx, flowSince: T0 - 91 * MIN, flowSeenAt: T0 - 30_000, lastState: 'flow' };
    const p = planTick(env(st, ses));
    expect(p.overlay?.text).toMatch(/Water\? Stretch\?/);
    const [st2, ses2] = apply(st, ses, p);
    expect(planTick(env({ ...st2, features: flowFeatures(T0 + 30_000) }, ses2, T0 + 30_000)).overlay).toBeNull();
    const learning = { ...st, settings: { ...st.settings, installedAt: T0 - DAY } };
    expect(planTick(env(learning, ses)).overlay).toBeNull();
  });

  it('a long gap in flow restarts the 90-minute count', () => {
    const st = store({ features: flowFeatures(T0) });
    const p = planTick(env(st, { ctx: taskCtx, flowSince: T0 - 120 * MIN, flowSeenAt: T0 - 15 * MIN }));
    expect(p.overlay).toBeNull();
    expect(p.sessionPatch.flowSince).toBe(T0);
  });

  it('time anchor only when switched on, every 30 min of activity', () => {
    const st = store({ features: flowFeatures(T0, 3) });
    const ses: SessionState = { ctx: taskCtx, activityStart: T0 - 31 * MIN };
    expect(planTick(env(st, ses)).overlay).toBeNull();
    const on = { ...st, settings: { ...st.settings, timeAnchor: true } };
    const p = planTick(env(on, ses));
    expect(p.overlay?.text).toMatch(/30 min have passed/);
    const [st2, ses2] = apply(on, ses, p);
    expect(planTick(env(st2, ses2, T0 + MIN)).overlay).toBeNull();
  });

  it('learning-mode check-in: once per day, in the evening', () => {
    const eve = new Date('2026-10-29T19:00:00').getTime();
    const st = store({ settings: { ...store().settings, installedAt: eve - DAY } }, eve);
    const p = planTick(env(st, { ctx: taskCtx }, eve));
    expect(p.overlay?.text).toMatch(/How did today feel/);
    const [st2, ses2] = apply(st, { ctx: taskCtx }, p);
    expect(planTick(env(st2, ses2, eve + 30 * MIN)).overlay).toBeNull();
    const afternoon = new Date('2026-10-29T15:00:00').getTime();
    expect(planTick(env({ ...st, guard: freshGuard(afternoon) }, { ctx: taskCtx }, afternoon)).overlay).toBeNull();
  });

  it('long break: one soft prompt per break; a forgotten break is closed quietly', () => {
    const escape = Array.from({ length: 6 }, (_, i) => win(T0 - (6 - i) * 30_000, { onEscapeMs: 30000 }));
    const brk = { startedAt: T0 - 25 * MIN, plannedMin: 15, returnPromptShown: false };
    const st = store({ features: escape, breakState: brk });
    const p = planTick(env(st));
    expect(p.overlay?.text).toMatch(/come back, or call it a day/);
    expect(p.patch.breakState?.returnPromptShown).toBe(true);
    const [st2, ses2] = apply(st, {}, p);
    expect(planTick(env(st2, ses2, T0 + MIN)).overlay).toBeNull();

    const forgotten = store({ breakState: { startedAt: T0 - 4 * 60 * MIN, plannedMin: 15, returnPromptShown: true } });
    expect(planTick(env(forgotten)).patch.breakState).toBeNull();
  });

  it('flapping states are not logged over and over', () => {
    let st = store({ features: stuckFeatures(T0), guard: { ...freshGuard(T0), dayClosed: true } });
    let ses: SessionState = {};
    let logs = 0;
    for (let k = 0; k < 8; k++) {
      const now = T0 + k * MIN;
      // alternate between stuck-looking and calm windows
      const feats = k % 2 ? flowFeatures(now, 2) : stuckFeatures(now);
      const p = planTick(env({ ...st, features: feats }, ses, now));
      logs += p.patch.inferences ? p.patch.inferences.length - st.inferences.length : 0;
      [st, ses] = apply(st, ses, p);
    }
    expect(logs).toBe(1);
  });
});
