import raw from './strategies.json';
import type { StrategyCard } from './types';

export const STRATEGIES: StrategyCard[] = raw as StrategyCard[];

export const STRATEGY_BY_ID: Record<string, StrategyCard> = Object.fromEntries(
  STRATEGIES.map((c) => [c.id, c]),
);

export function strategyName(id: string): string {
  return STRATEGY_BY_ID[id]?.name ?? id.replace(/_/g, ' ');
}
