import { defaultStorage } from './defaults';
import { freshGuard } from './guard';
import { STRATEGY_BY_ID } from './strategies';
import type { CheckIn, Inference, PlanItem, StorageShape, StrategyStats, Win } from './types';
import { DAY, HOUR, MIN, dayKey, seededRandom } from './util';

// Preloaded 1-week history for demo / judging, so personal learning,
// "What works for me" and "What I noticed" look real. Deterministic.

const TASKS = ['DBMS assignment', 'OS lab report', 'Linear algebra problem set', 'Research reading for HCI', 'Email to Prof. Rao'];

const STAT_PROFILE: Record<string, [number, number, number]> = {
  // id: [up, down, skip]
  body_doubling: [7, 1, 1],
  two_minute_start: [6, 1, 2],
  music_cue: [4, 0, 1],
  just_open_it: [5, 1, 0],
  sensory_reset: [3, 0, 0],
  interest_hook: [3, 1, 1],
  ugly_first_draft: [2, 3, 1],
  change_location: [1, 2, 0],
  focus_round_10: [1, 3, 1],
  beat_the_timer: [2, 2, 0],
  permission_to_rest: [3, 0, 0],
  read_one_paragraph: [2, 0, 1],
};

export function seedDemoData(now = Date.now(), seed = 7): StorageShape {
  const rand = seededRandom(seed);
  const base = defaultStorage(now);
  const start = now - 7 * DAY;
  const day = (d: number, h: number, m = 0) => {
    const t = new Date(start + d * DAY);
    t.setHours(h, m, 0, 0);
    return t.getTime();
  };

  const stats: StrategyStats = {};
  for (const [id, [up, down, skip]] of Object.entries(STAT_PROFILE)) {
    stats[id] = { up, down, skip, shown: up + down + skip + 1, lastShown: now - Math.floor(rand() * 5) * DAY - 3 * HOUR, phrasingIndex: up + down };
  }

  const checkins: CheckIn[] = [
    { t: day(0, 22), day: dayKey(day(0, 22)), feeling: 2 },
    { t: day(1, 21, 30), day: dayKey(day(1, 21)), feeling: 3 },
    { t: day(2, 22, 10), day: dayKey(day(2, 22)), feeling: 4 },
    { t: day(4, 21), day: dayKey(day(4, 21)), feeling: 2 },
    { t: day(5, 20, 45), day: dayKey(day(5, 20)), feeling: 4 },
  ];

  const wins: Win[] = [];
  const pushWin = (t: number, kind: Win['kind'], label: string, strategyId?: string) =>
    wins.push({ id: `w_${wins.length}`, t, kind, label, strategyId });
  for (let d = 0; d < 7; d++) {
    const task = TASKS[d % TASKS.length];
    pushWin(day(d, 10 + (d % 3), 15), 'started', `Started ${task}`, 'two_minute_start');
    pushWin(day(d, 10 + (d % 3), 22), 'step_done', `Opened ${task} and read the first part`, 'just_open_it');
    if (d % 2 === 0) pushWin(day(d, 15, 40), 'step_done', `Body-doubled through 15 min of ${task}`, 'body_doubling');
    if (d % 3 === 1) pushWin(day(d, 17, 5), 'paused_start', `Gave ${task} a go — saved for later`, 'ugly_first_draft');
    if (d % 2 === 1) pushWin(day(d, 19, 30), 'rested', 'Took a real break (15 min)');
    if (d === 3) pushWin(day(d, 18), 'brain_dump', 'Emptied my head: 7 things → picked 1');
    if (d === 5) pushWin(day(d, 23, 10), 'day_closed', 'Called it a day kindly, left a note for future-me');
  }
  pushWin(now - 2 * HOUR, 'came_back', 'Came back after a break');

  const inf = (t: number, state: Inference['state'], reason: string, acted: Inference['acted'], feedback?: Inference['feedback'], silencedBecause?: string): Inference => ({
    id: `inf_${t}`,
    t,
    state,
    reason,
    acted,
    feedback,
    silencedBecause,
  });
  const inferences: Inference[] = [
    inf(day(0, 11, 5), 'stuck', 'Switched tabs 14 times in 5 min, came back to DBMS_Assignment.pdf 4 times, with very little typing or scrolling there.', 'learning', 'right'),
    inf(day(1, 14, 20), 'flow', 'Steady activity on OS_Lab_Report.docx for 10+ minutes with few tab switches.', 'none', 'right'),
    inf(day(2, 23, 15), 'depleted', "Session has run 2h 40m, it's past 10 pm, and the pauses between activity are getting longer.", 'learning', 'right'),
    inf(day(3, 16, 2), 'stuck', 'Switched tabs 9 times in 5 min, came back to LinearAlgebra_PS3.pdf 3 times, with very little typing or scrolling there.', 'nudged', 'right'),
    inf(day(3, 16, 40), 'stuck', 'Switched tabs 11 times in 5 min, came back to arxiv.org 3 times, with very little typing or scrolling there.', 'nudged', 'wrong'),
    inf(day(4, 12, 10), 'flow', 'Steady activity on github.com for 10+ minutes with few tab switches.', 'none'),
    inf(day(4, 13, 45), 'flow', 'Hyperfocus for 95 min — showed the tiny "Water? Stretch?" chip.', 'nudged', 'right'),
    inf(day(5, 10, 30), 'stuck', 'Switched tabs 12 times in 5 min, came back to DBMS_Assignment.pdf 5 times, with very little typing or scrolling there.', 'silenced', undefined, 'You looked like you were on a video call.'),
    inf(day(5, 17, 25), 'restuck', 'Typing and scrolling on the task dropped off, and 4 switches to other sites in the last 3 minutes.', 'nudged', 'right'),
    inf(day(6, 15, 5), 'long_break', 'Break planned for 15 min ran to 34 min, mostly on youtube.com.', 'nudged'),
    inf(day(6, 21, 50), 'stuck', 'Switched tabs 10 times in 5 min, came back to HCI_Reading.pdf 3 times, with very little typing or scrolling there.', 'silenced', undefined, 'A nudge was shown 8 min ago (waiting at least 40 min).'),
    inf(now - 40 * MIN, 'away', 'No keyboard or mouse activity for about 12 minutes.', 'none'),
  ];

  const plan: PlanItem[] = [
    { id: 'p1', title: 'DBMS assignment — Q3 normalisation', size: 'big', weight: 3, status: 'today', createdAt: now - 3 * HOUR },
    { id: 'p2', title: 'Reply to Prof. Rao', size: 'tiny', weight: 1, status: 'today', createdAt: now - 3 * HOUR + 1 },
    { id: 'p3', title: 'Read HCI paper (first 2 pages)', size: 'small', weight: 2, status: 'today', createdAt: now - 3 * HOUR + 2 },
    { id: 'p4', title: 'Pay hostel mess fees', size: 'tiny', weight: 1, status: 'today', createdAt: now - 3 * HOUR + 3 },
    { id: 'p5', title: 'OS lab report — write results section', size: 'big', weight: 3, status: 'today', createdAt: now - 3 * HOUR + 4 },
    { id: 'p6', title: 'Linear algebra problem set', size: 'big', weight: 3, status: 'later', createdAt: now - 2 * DAY },
  ];

  return {
    ...base,
    settings: {
      ...base.settings,
      onboarded: true,
      installedAt: start - DAY,
      demoMode: true,
      taskTab: { tabId: null, host: 'local-file', title: 'DBMS_Assignment.pdf' },
      unlockedThemes: ['meadow', 'dusk', 'tide'],
      sensitivity: { stuck: 1.2, depleted: 1, flow: 1 },
    },
    baseline: {
      switchesPerMinMedian: 1.8,
      switchesPerMinP75: 3.4,
      taskInteractionsPerMinMedian: 31,
      idleGapMinMedian: 0.8,
      typicalSessionMin: 85,
      samples: 212,
      updatedAt: day(3, 0),
    },
    stats,
    wins: wins.sort((a, b) => a.t - b.t),
    checkins,
    inferences: inferences.sort((a, b) => a.t - b.t),
    plan,
    energyToday: { day: dayKey(now), energy: 3 },
    notes: [
      {
        t: day(5, 23, 10),
        task: 'OS lab report',
        note: 'Hey future-me: the graphs are done. Start by writing one sentence about Figure 2 — that\'s all.',
        progress: ['Opened the report', 'Made the graphs'],
      },
    ],
    guard: freshGuard(now),
  };
}

export function strategyLabel(id: string): string {
  return STRATEGY_BY_ID[id]?.name ?? id;
}
