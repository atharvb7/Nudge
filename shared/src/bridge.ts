import { recordFeedback } from './thompson';
import { adjustSensitivity } from './sensing';
import { learningDaysLeft } from './guard';
import { reshufflePlan, weightFor } from './plan';
import { unlockedFor } from './themes';
import { withDefaults, defaultStorage } from './defaults';
import type { Energy, PlanItem, Settings, StorageShape } from './types';
import { uid, wakingDayKey } from './util';

// Dashboard ⇄ extension protocol. The dashboard posts messages to its own
// window; a bridge content script (only on localhost dashboards) relays them
// to the service worker. The same reducer powers the dashboard's demo mode.

export const DASHBOARD_SOURCE = 'nudge-dashboard';
export const EXTENSION_SOURCE = 'nudge-extension';
export const DASHBOARD_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export type SimulateKind = 'stuck' | 'restuck' | 'depleted' | 'long_break' | 'crisis';

export type BridgeRequest =
  | { type: 'getSnapshot' }
  | { type: 'setEnergy'; energy: Energy }
  | { type: 'planAdd'; title: string; size: PlanItem['size'] }
  | { type: 'planUpdate'; id: string; patch: Partial<Pick<PlanItem, 'title' | 'size' | 'status'>> }
  | { type: 'planRemove'; id: string }
  | { type: 'planMove'; ids: string[]; status: PlanItem['status'] }
  | { type: 'inferenceFeedback'; id: string; feedback: 'right' | 'wrong' }
  | { type: 'strategyFeedback'; id: string; feedback: 'up' | 'down' | 'skip' }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'exportData' }
  | { type: 'deleteAll' }
  | { type: 'simulate'; kind: SimulateKind }
  | { type: 'loadDemoData' };

export interface DashboardSnapshot {
  settings: Settings;
  baseline: StorageShape['baseline'];
  inferences: StorageShape['inferences'];
  stats: StorageShape['stats'];
  wins: StorageShape['wins'];
  checkins: StorageShape['checkins'];
  plan: StorageShape['plan'];
  energyToday: StorageShape['energyToday'];
  notes: StorageShape['notes'];
  session: StorageShape['session'];
  guard: StorageShape['guard'];
  learningDaysLeft: number;
  source: 'extension' | 'demo';
}

export interface BridgeEnvelope {
  source: typeof DASHBOARD_SOURCE;
  id: string;
  request: BridgeRequest;
}

export interface BridgeReply {
  source: typeof EXTENSION_SOURCE;
  id?: string;
  type?: 'hello' | 'reply' | 'changed';
  ok?: boolean;
  data?: unknown;
  error?: string;
  version?: string;
}

export function snapshotOf(s: StorageShape, source: DashboardSnapshot['source'], now = Date.now()): DashboardSnapshot {
  return {
    settings: s.settings,
    baseline: s.baseline,
    inferences: s.inferences,
    stats: s.stats,
    wins: s.wins,
    checkins: s.checkins,
    plan: s.plan,
    energyToday: s.energyToday,
    notes: s.notes,
    session: s.session,
    guard: s.guard,
    learningDaysLeft: learningDaysLeft(s.settings, now),
    source,
  };
}

/** Exported file never includes raw events (there shouldn't be any older than 30 s anyway). */
export function exportable(s: StorageShape): Omit<StorageShape, 'rawEvents'> & { exportedAt: string; note: string } {
  const { rawEvents: _raw, ...rest } = s;
  return {
    ...rest,
    exportedAt: new Date().toISOString(),
    note: 'Everything Nudge knows about you. Metadata only: no page content, no keystrokes, no audio.',
  };
}

const SIM_REASONS: Record<Exclude<SimulateKind, 'crisis'>, string> = {
  stuck: '[Demo] Switched tabs 14 times in 5 min, came back to DBMS_Assignment.pdf 4 times, with very little typing or scrolling there.',
  restuck: '[Demo] Typing and scrolling on the task dropped off, and 3 switches to other sites in the last 3 minutes.',
  depleted: "[Demo] Session has run 2h 35m, it's past 10 pm, and the pauses between activity are getting longer.",
  long_break: '[Demo] Break planned for 5 min ran to 21 min, mostly on instagram.com.',
};

/**
 * Pure reducer for every request that only touches storage. Returns the new
 * store and the reply payload. Side effects (showing a nudge, opening the
 * panel) are handled by the caller for `simulate`.
 */
export function applyBridgeRequest(store: StorageShape, req: BridgeRequest, now = Date.now()): { store: StorageShape; data: unknown } {
  switch (req.type) {
    case 'getSnapshot':
      return { store, data: null };
    case 'setEnergy': {
      const energyToday = { day: wakingDayKey(now), energy: req.energy };
      return { store: { ...store, energyToday }, data: reshufflePlan(store.plan, req.energy) };
    }
    case 'planAdd': {
      const title = req.title.trim().slice(0, 140);
      if (!title) return { store, data: null };
      const item: PlanItem = { id: uid('p_'), title, size: req.size, weight: weightFor(req.size), status: 'today', createdAt: now };
      return { store: { ...store, plan: [...store.plan, item] }, data: item };
    }
    case 'planUpdate':
      return {
        store: {
          ...store,
          plan: store.plan.map((p) =>
            p.id === req.id ? { ...p, ...req.patch, weight: req.patch.size ? weightFor(req.patch.size) : p.weight } : p,
          ),
        },
        data: null,
      };
    case 'planRemove':
      return { store: { ...store, plan: store.plan.filter((p) => p.id !== req.id) }, data: null };
    case 'planMove':
      return { store: { ...store, plan: store.plan.map((p) => (req.ids.includes(p.id) ? { ...p, status: req.status } : p)) }, data: null };
    case 'inferenceFeedback': {
      const target = store.inferences.find((i) => i.id === req.id);
      if (!target) return { store, data: null };
      const already = target.feedback;
      let sensitivity = store.settings.sensitivity;
      // Undo previous feedback effect isn't tracked precisely; only apply on change.
      if (already !== req.feedback) sensitivity = adjustSensitivity(sensitivity, target.state, req.feedback);
      return {
        store: {
          ...store,
          settings: { ...store.settings, sensitivity },
          inferences: store.inferences.map((i) => (i.id === req.id ? { ...i, feedback: req.feedback } : i)),
        },
        data: sensitivity,
      };
    }
    case 'strategyFeedback':
      return { store: { ...store, stats: recordFeedback(store.stats, req.id, req.feedback) }, data: null };
    case 'updateSettings': {
      const settings = withDefaults({ ...store.settings, ...req.patch });
      settings.unlockedThemes = Array.from(new Set([...settings.unlockedThemes, ...unlockedFor(store.wins.length)]));
      if (!settings.unlockedThemes.includes(settings.theme)) settings.theme = 'meadow';
      return { store: { ...store, settings }, data: settings };
    }
    case 'exportData':
      return { store, data: exportable(store) };
    case 'deleteAll': {
      const fresh = defaultStorage(now);
      return { store: fresh, data: null };
    }
    case 'simulate': {
      if (req.kind === 'crisis') return { store, data: null }; // never stored
      const inference = {
        id: uid('inf_'),
        t: now,
        state: req.kind,
        reason: SIM_REASONS[req.kind],
        acted: 'nudged' as const,
      };
      return { store: { ...store, inferences: [...store.inferences, inference].slice(-300) }, data: inference };
    }
    case 'loadDemoData':
      return { store, data: null }; // caller replaces store with seedDemoData()
  }
}
