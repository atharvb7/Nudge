import type { StrategyCard, StrategyStat, StrategyStats } from './types';

// Thompson sampling over Beta(1 + 👍, 1 + 👎) per strategy.
// It learns what works for *this* user while still occasionally trying new
// ideas, which also counters novelty decay of a favourite strategy.

function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang gamma sampler (shape k > 0, scale 1). */
export function sampleGamma(k: number, rand: () => number = Math.random): number {
  if (k < 1) {
    const u = rand();
    return sampleGamma(1 + k, rand) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rand: () => number = Math.random): number {
  const x = sampleGamma(a, rand);
  const y = sampleGamma(b, rand);
  return x / (x + y);
}

export function emptyStat(): StrategyStat {
  return { up: 0, down: 0, skip: 0, shown: 0, phrasingIndex: 0 };
}

/** Posterior mean — used for "What works for me" display (stable, not random). */
export function successRate(s: StrategyStat | undefined): number {
  const st = s ?? emptyStat();
  return (1 + st.up) / (2 + st.up + st.down);
}

/**
 * Novelty decay: a strategy shown many times recently gets a gentle discount,
 * so even a favourite rotates out now and then.
 */
function fatigue(s: StrategyStat, now: number): number {
  if (!s.lastShown) return 1;
  const hoursSince = (now - s.lastShown) / 3_600_000;
  if (hoursSince > 24) return 1;
  return 0.85 + 0.15 * Math.min(1, hoursSince / 24);
}

export interface PersonalScore {
  id: string;
  score: number;
}

export function thompsonScores(
  cards: StrategyCard[],
  stats: StrategyStats,
  rand: () => number = Math.random,
  now: number = Date.now(),
): PersonalScore[] {
  return cards
    .map((c) => {
      const s = stats[c.id] ?? emptyStat();
      const sample = sampleBeta(1 + s.up, 1 + s.down, rand);
      return { id: c.id, score: Number((sample * fatigue(s, now)).toFixed(4)) };
    })
    .sort((a, b) => b.score - a.score);
}

/** "Different idea": not a 👎, but a gentle signal this card didn't fit (half a 👎). */
export function recordDifferent(stats: StrategyStats, id: string): StrategyStats {
  const s = { ...(stats[id] ?? emptyStat()) };
  s.skip += 1;
  s.down += 0.5;
  return { ...stats, [id]: s };
}

export function recordFeedback(
  stats: StrategyStats,
  id: string,
  feedback: 'up' | 'down' | 'skip',
): StrategyStats {
  const s = { ...(stats[id] ?? emptyStat()) };
  s[feedback] += 1;
  return { ...stats, [id]: s };
}

export function recordShown(stats: StrategyStats, id: string, now = Date.now()): StrategyStats {
  const s = { ...(stats[id] ?? emptyStat()) };
  s.shown += 1;
  s.lastShown = now;
  s.phrasingIndex = (s.phrasingIndex + 1) % 1000;
  return { ...stats, [id]: s };
}

export interface RankedStrategy {
  id: string;
  rate: number;
  tried: number;
  up: number;
  down: number;
}

export function rankForDisplay(stats: StrategyStats): RankedStrategy[] {
  return Object.entries(stats)
    .filter(([, s]) => s.up + s.down > 0)
    .map(([id, s]) => ({ id, rate: successRate(s), tried: s.up + s.down + s.skip, up: s.up, down: s.down }))
    .sort((a, b) => b.rate - a.rate || b.tried - a.tried);
}
