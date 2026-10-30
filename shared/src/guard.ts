import type { NudgeGuard, Settings, UserState } from './types';
import { DAY, HOUR, MIN, isWithinQuietHours, wakingDayKey } from './util';

// Anti-nag safeguards, designed with rejection sensitivity in mind:
// at most one auto-nudge per 20 min, "I'm fine" doubles the cooldown, and
// three dismissals in a day turn auto-nudges off until tomorrow.

export const BASE_COOLDOWN_MIN = 20;
export const MAX_DISMISSALS_PER_DAY = 3;
export const HYDRATION_AFTER_FLOW_MIN = 90;

export function freshGuard(now = Date.now()): NudgeGuard {
  return {
    day: wakingDayKey(now),
    lastAutoNudgeAt: 0,
    cooldownMin: BASE_COOLDOWN_MIN,
    dismissalsToday: 0,
    offUntilTomorrow: false,
    dayClosed: false,
    lastHydrationChipAt: 0,
    lastTimeAnchorAt: 0,
    restuckChipShownForStep: -1,
  };
}

/** Quiet choices last at least this long, even across the 05:00 rollover. */
export const MIN_QUIET_MS = 4 * HOUR;

/**
 * New *waking* day (05:00, not midnight — night owls are our users): the
 * counters reset and nothing carries over as a penalty. A quiet choice the user
 * made ("Done for today", three "I'm fine"s) is honoured for at least 4 h, so
 * 23:50 or 04:30 doesn't suddenly start nudging again.
 */
export function rollover(g: NudgeGuard, now = Date.now()): NudgeGuard {
  if (g.day === wakingDayKey(now)) return g;
  const keepClosed = g.dayClosed && !!g.dayClosedAt && now - g.dayClosedAt < MIN_QUIET_MS;
  const keepOff = g.offUntilTomorrow && !!g.offAt && now - g.offAt < MIN_QUIET_MS;
  return {
    ...freshGuard(now),
    lastHydrationChipAt: g.lastHydrationChipAt,
    dayClosed: keepClosed,
    dayClosedAt: keepClosed ? g.dayClosedAt : undefined,
    offUntilTomorrow: keepOff,
    offAt: keepOff ? g.offAt : undefined,
  };
}

/** "Done for today": quiet until the user starts a session themselves (or the rollover after ≥ 4 h). */
export function markDayClosed(g: NudgeGuard, now = Date.now()): NudgeGuard {
  return { ...rollover(g, now), dayClosed: true, dayClosedAt: now };
}

/** The user opened Nudge and started something: they chose to come back. */
export function markSessionStarted(g: NudgeGuard, now = Date.now()): NudgeGuard {
  return { ...rollover(g, now), dayClosed: false, dayClosedAt: undefined };
}

export function isLearning(s: Settings, now = Date.now()): boolean {
  if (s.demoMode) return false;
  return now - s.installedAt < s.learningDays * DAY;
}

export function learningDaysLeft(s: Settings, now = Date.now()): number {
  return Math.max(0, Math.ceil((s.installedAt + s.learningDays * DAY - now) / DAY));
}

export interface GuardContext {
  now: number;
  state: UserState;
  fullscreen: boolean;
  onCall: boolean;
  onBreak: boolean;
  panelOpen?: boolean;
}

export interface GuardDecision {
  ok: boolean;
  why: string; // plain English, shown in "What I noticed"
}

/** Silences that apply to every kind of popup, including gentle chips. */
export function silenceReason(g: NudgeGuard, s: Settings, c: GuardContext): string | null {
  if (s.trackingPaused) return 'Tracking is paused.';
  if (s.dndUntil && c.now < s.dndUntil) return 'Do not disturb is on.';
  if (s.quietHours.enabled && isWithinQuietHours(c.now, s.quietHours.start, s.quietHours.end)) return 'Quiet hours.';
  if (c.fullscreen) return 'You were in fullscreen.';
  if (c.onCall) return 'You looked like you were on a video call.';
  if (g.dayClosed) return 'You called it a day.';
  if (c.state === 'away') return 'You were away.';
  return null;
}

export function canAutoNudge(g0: NudgeGuard, s: Settings, c: GuardContext): GuardDecision {
  const g = rollover(g0, c.now);
  const silent = silenceReason(g, s, c);
  if (silent) return { ok: false, why: silent };
  if (c.state === 'flow') return { ok: false, why: 'You were in flow — never interrupting that.' };
  if (isLearning(s, c.now)) return { ok: false, why: 'Learning mode: no automatic nudges for the first few days.' };
  if (g.offUntilTomorrow) return { ok: false, why: 'Auto-nudges are resting until tomorrow.' };
  if (c.onBreak) return { ok: false, why: 'You were on a break.' };
  if (c.panelOpen) return { ok: false, why: 'Nudge was already open.' };
  const since = (c.now - g.lastAutoNudgeAt) / MIN;
  if (g.lastAutoNudgeAt && since < g.cooldownMin) {
    return { ok: false, why: `A nudge was shown ${Math.round(since)} min ago (waiting at least ${g.cooldownMin} min).` };
  }
  return { ok: true, why: 'Showed a gentle nudge.' };
}

export function markNudged(g: NudgeGuard, now = Date.now()): NudgeGuard {
  return { ...rollover(g, now), lastAutoNudgeAt: now };
}

export function markDismissed(g0: NudgeGuard, now = Date.now()): { guard: NudgeGuard; turnedOff: boolean } {
  const g = rollover(g0, now);
  const dismissals = g.dismissalsToday + 1;
  const turnedOff = dismissals >= MAX_DISMISSALS_PER_DAY;
  return {
    guard: {
      ...g,
      dismissalsToday: dismissals,
      cooldownMin: g.cooldownMin * 2,
      offUntilTomorrow: g.offUntilTomorrow || turnedOff,
      offAt: turnedOff && !g.offUntilTomorrow ? now : g.offAt,
    },
    turnedOff,
  };
}

/** Chips (hydration / time anchor / re-stuck) are smaller than nudges but still respect silences. */
export function canShowChip(g: NudgeGuard, s: Settings, c: GuardContext): boolean {
  return silenceReason(rollover(g, c.now), s, c) === null;
}
