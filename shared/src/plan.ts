import type { Energy, PlanItem } from './types';

// Energy dial ("spoons") reshuffles today's plan. Low energy → fewer, smaller
// items, and an *offer* (never an automatic move) to save the rest for later.

export const CAPACITY: Record<Energy, number> = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 8 };

export interface Reshuffle {
  keep: PlanItem[];
  offerToMove: PlanItem[];
  message: string;
}

const MESSAGES: Record<Energy, string> = {
  1: 'Running on empty is real. Just one gentle thing — or none. Resting counts.',
  2: 'Low-battery day. Here are just the lightest bits; the rest can wait, no problem.',
  3: 'A middle sort of day. A few small things feel about right.',
  4: 'Some good energy today. Pick what feels right — no need to use it all.',
  5: 'Lots of energy! Remember breaks still count as part of the plan.',
};

export function reshufflePlan(items: PlanItem[], energy: Energy): Reshuffle {
  const today = items.filter((i) => i.status === 'today');
  const ordered = [...today].sort((a, b) => (energy <= 2 ? a.weight - b.weight : 0) || a.createdAt - b.createdAt);
  let budget = CAPACITY[energy];
  const keep: PlanItem[] = [];
  const offerToMove: PlanItem[] = [];
  for (const it of ordered) {
    const cost = energy <= 2 && it.size === 'big' ? it.weight + 1 : it.weight;
    if (cost <= budget || keep.length === 0) {
      keep.push(it);
      budget -= cost;
    } else offerToMove.push(it);
  }
  return { keep, offerToMove, message: MESSAGES[energy] };
}

export function weightFor(size: PlanItem['size']): PlanItem['weight'] {
  return size === 'tiny' ? 1 : size === 'small' ? 2 : 3;
}
