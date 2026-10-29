import { describe, expect, it, vi } from 'vitest';
import { findBannedWords, localSequence, type SequenceRequest } from '@nudge/shared';
import { addStep, doneCount, historyFor, lowerEnergy, markOutcome, resumeFromLastCompleted, shouldWelcomeBack, startSession, truncate } from '../src/lib/session';
import * as overlays from '../src/background/overlays';

const req: SequenceRequest = {
  task: 'DBMS assignment',
  state: 'stuck',
  energy: 3,
  history: [],
  top_strategies: [],
  action: 'start',
  wording_style: 'warm',
  explain_why: false,
};

describe('session reducer', () => {
  it('tracks steps, outcomes and the last completed step', () => {
    let s = startSession('DBMS assignment', 3, 'DBMS.pdf', 1000);
    s = addStep(s, localSequence(req), 1100);
    s = markOutcome(s, 'done', 1200);
    s = addStep(s, localSequence({ ...req, action: 'next', history: historyFor(s) }), 1300);
    s = markOutcome(s, 'too_big', 1400);
    s = addStep(s, localSequence(req), 1500);
    expect(s.steps).toHaveLength(3);
    expect(s.lastCompletedIndex).toBe(0);
    expect(doneCount(s)).toBe(1);
    // "Stuck again" resumes from the last completed step and drops the stalled ones
    const r = resumeFromLastCompleted(s);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].outcome).toBe('done');
  });

  it('never lowers energy below 1', () => {
    let s = startSession('x', 1);
    s = lowerEnergy(s);
    expect(s.energy).toBe(1);
    expect(lowerEnergy(startSession('x', 3)).energy).toBe(2);
  });

  it('welcomes back after 2 h or a new day', () => {
    const now = new Date('2026-10-29T15:00:00').getTime();
    const s = { ...startSession('x', 3, undefined, now - 30 * 60_000) };
    expect(shouldWelcomeBack(s, now)).toBe(false);
    expect(shouldWelcomeBack({ ...s, lastActiveAt: now - 3 * 3_600_000 }, now)).toBe(true);
    expect(shouldWelcomeBack({ ...s, lastActiveAt: new Date('2026-10-28T23:50:00').getTime() }, new Date('2026-10-29T00:10:00').getTime())).toBe(true);
    expect(shouldWelcomeBack(null, now)).toBe(false);
  });

  it('truncates very long transcripts', () => {
    expect(truncate('a'.repeat(5000)).length).toBe(2000);
  });
});

describe('overlay copy', () => {
  it('uses gentle words in both styles, with the required buttons', () => {
    for (const style of ['warm', 'literal'] as const) {
      const all = [
        overlays.stuckNudge(style),
        overlays.depletedNudge(style),
        overlays.hydrationChip(style),
        overlays.restuckChip(style),
        overlays.longBreakChip(style),
        overlays.checkinChip(style),
        overlays.wakeNudge(style),
        overlays.timeAnchorChip(30),
      ];
      expect(findBannedWords(JSON.stringify(all))).toEqual([]);
    }
    expect(overlays.stuckNudge('warm').text).toBe("Looks like this one's heavy. Want a hand?");
    expect(overlays.stuckNudge('warm').buttons.map((b) => b.label)).toEqual(['Help me start', 'I need a break', "I'm fine"]);
    expect(overlays.restuckChip('warm').buttons.map((b) => b.id)).toEqual(['still_going', 'stuck_again', 'taking_break']);
    expect(overlays.checkinChip('warm').buttons).toHaveLength(5);
    expect(overlays.hydrationChip('warm').autoFadeMs).toBeGreaterThan(0);
  });
});

describe('api fallback', () => {
  it('falls back to an offline card when the backend is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { requestSequence } = await import('../src/lib/api');
    const { defaultSettings } = await import('@nudge/shared');
    const r = await requestSequence(req, defaultSettings());
    expect(r.offline).toBe(true);
    expect(r.mode).toBe('coach');
    expect(r.next_step.length).toBeGreaterThan(5);
    vi.unstubAllGlobals();
  });

  it('crisis language never reaches the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { requestSequence } = await import('../src/lib/api');
    const { defaultSettings } = await import('@nudge/shared');
    const r = await requestSequence({ ...req, transcript: 'I want to end my life' }, defaultSettings());
    expect(f).not.toHaveBeenCalled();
    expect(r.mode).toBe('safety');
    expect(r.safety?.resources[0].phone).toBe('14416');
    vi.unstubAllGlobals();
  });

  it('uses the backend reply when available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ mode: 'coach', lead: null, next_step: 'Open DBMS.pdf.', why_one_line: 'x', size: 'tiny', buttons: ['done', 'too_big', 'smaller', 'different', 'rest'], strategy_id: 'just_open_it', strategy_name: 'Just open it', validation: null, suggest_rest: false, source: 'ollama', safety: null }),
      }),
    );
    const { requestSequence } = await import('../src/lib/api');
    const { defaultSettings } = await import('@nudge/shared');
    const r = await requestSequence(req, defaultSettings());
    expect(r.offline).toBe(false);
    expect(r.next_step).toBe('Open DBMS.pdf.');
    vi.unstubAllGlobals();
  });
});
