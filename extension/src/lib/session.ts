import type { ActionButton, Energy, SequenceResponse, Session, StepRecord } from '@nudge/shared';
import { uid } from '@nudge/shared';

// Pure session reducer for the step flow. Kept free of chrome.* so it is easy to test.

export function startSession(task: string, energy: Energy, taskTabTitle?: string, now = Date.now()): Session {
  return {
    id: uid('s_'),
    startedAt: now,
    lastActiveAt: now,
    task: task.trim().slice(0, 200),
    taskTabTitle,
    energy,
    steps: [],
    lastCompletedIndex: -1,
  };
}

export function addStep(s: Session, r: SequenceResponse, now = Date.now()): Session {
  const step: StepRecord = { step: r.next_step, strategy_id: r.strategy_id, size: r.size, t: now };
  return { ...s, steps: [...s.steps, step], lastActiveAt: now };
}

export function markOutcome(s: Session, outcome: ActionButton, now = Date.now()): Session {
  if (!s.steps.length) return s;
  const steps = s.steps.slice();
  const i = steps.length - 1;
  steps[i] = { ...steps[i], outcome };
  return {
    ...s,
    steps,
    lastActiveAt: now,
    lastCompletedIndex: outcome === 'done' ? i : s.lastCompletedIndex,
  };
}

export function lowerEnergy(s: Session): Session {
  return { ...s, energy: Math.max(1, s.energy - 1) as Energy };
}

/** History sent to the sequencer: last 6 steps of this session. */
export function historyFor(s: Session | null): Array<{ step: string; outcome?: ActionButton; strategy_id: string }> {
  if (!s) return [];
  return s.steps.slice(-6).map((x) => ({ step: x.step, outcome: x.outcome, strategy_id: x.strategy_id }));
}

/**
 * "Stuck again" resumes from the last completed step: steps after it that were
 * never finished are dropped from the active history (never mentioned again).
 */
export function resumeFromLastCompleted(s: Session): Session {
  const keep = s.steps.slice(0, s.lastCompletedIndex + 1);
  return { ...s, steps: keep };
}

export function doneCount(s: Session | null): number {
  return s ? s.steps.filter((x) => x.outcome === 'done').length : 0;
}

export function endSession(s: Session, kind: Session['endedKind'], now = Date.now()): Session {
  return { ...s, endedAt: now, endedKind: kind };
}

export const ABSENCE_FOR_WELCOME_MS = 2 * 60 * 60 * 1000;

/** Returning after ≥2 h or on a new day → zero-guilt welcome back. */
export function shouldWelcomeBack(s: Session | null, now = Date.now()): boolean {
  if (!s) return false;
  const last = s.endedAt ?? s.lastActiveAt;
  const newDay = new Date(last).toDateString() !== new Date(now).toDateString();
  return now - last >= ABSENCE_FOR_WELCOME_MS || newDay;
}

export function truncate(text: string, max = 2000): string {
  return text.length > max ? text.slice(0, max) : text;
}
