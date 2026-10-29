import { useEffect, useRef, useState } from 'react';
import {
  dayKey,
  recordFeedback,
  recordShown,
  uid,
  unlockedFor,
  type Energy,
  type FutureNote,
  type Settings,
  type StorageShape,
  type Win,
} from '@nudge/shared';
import { getSession, getStore, mutate, setSession, type PanelIntent } from '../lib/storage';
import { sendToBackground } from '../lib/messages';

/** Live view of chrome.storage.local for the panel. */
export function useNudgeStore(): StorageShape | null {
  const [store, setStore] = useState<StorageShape | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = 0;
    const load = () => {
      void getStore().then((s) => alive && setStore(s));
    };
    load();
    const onChange = (_c: unknown, area: string) => {
      if (area !== 'local') return;
      clearTimeout(pending);
      pending = window.setTimeout(load, 60);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);
  return store;
}

/** Intents left by the service worker (e.g. user tapped "Help me start" in a page). */
export function usePanelIntent(onIntent: (i: PanelIntent) => void): void {
  const cb = useRef(onIntent);
  cb.current = onIntent;
  useEffect(() => {
    const check = async () => {
      const s = await getSession();
      if (s.panelIntent && Date.now() - s.panelIntent.t < 10 * 60_000) {
        const intent = s.panelIntent;
        await setSession({ panelIntent: null });
        cb.current(intent);
      }
    };
    void check();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes.panelIntent?.newValue) void check();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
}

/** Lets the worker know the panel is open (so it never auto-nudges on top of it). */
export function useHeartbeat(): void {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === 'visible') void sendToBackground({ kind: 'panelHeartbeat' }).catch(() => undefined);
    };
    beat();
    const t = setInterval(beat, 20_000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', beat);
    };
  }, []);
}

export const actions = {
  async updateSettings(patch: Partial<Settings>) {
    await mutate('settings', (s) => ({ ...s, ...patch }));
  },
  async addWin(kind: Win['kind'], label: string, strategyId?: string) {
    const wins = await mutate('wins', (w) => [...w, { id: uid('w_'), t: Date.now(), kind, label: label.slice(0, 160), strategyId }]);
    // themes unlock by total attempts — never lost
    await mutate('settings', (s) => ({ ...s, unlockedThemes: Array.from(new Set([...s.unlockedThemes, ...unlockedFor(wins.length)])) }));
  },
  async feedback(strategyId: string, fb: 'up' | 'down' | 'skip') {
    if (!strategyId) return;
    await mutate('stats', (st) => recordFeedback(st, strategyId, fb));
  },
  async shown(strategyId: string) {
    if (!strategyId) return;
    await mutate('stats', (st) => recordShown(st, strategyId));
  },
  async setEnergy(energy: Energy) {
    await mutate('energyToday', () => ({ day: dayKey(), energy }));
  },
  async saveNote(note: FutureNote) {
    await mutate('notes', (n) => [...n, note].slice(-50));
  },
  async checkin(feeling: 1 | 2 | 3 | 4 | 5) {
    const day = dayKey();
    await mutate('checkins', (c) => [...c.filter((x) => x.day !== day), { t: Date.now(), day, feeling }]);
    await actions.addWin('checkin', 'Checked in with myself');
  },
};
