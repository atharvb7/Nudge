'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BridgeRequest, DashboardSnapshot, HealthResponse, Settings } from '@nudge/shared';
import { DemoSource, connect, type DataSource } from './bridge';

export type ConnectionStatus = 'loading' | 'connected' | 'demo' | 'disconnected';

export type HealthState =
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'ok'; health: HealthResponse };

interface NudgeContextValue {
  status: ConnectionStatus;
  snapshot: DashboardSnapshot | null;
  send: (req: BridgeRequest) => Promise<unknown>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refresh: () => Promise<void>;
  reconnect: () => Promise<void>;
  switchToSampleData: () => Promise<void>;
  health: HealthState;
  recheckHealth: () => void;
}

const NudgeContext = createContext<NudgeContextValue | null>(null);

function applyAppearance(s: Settings | undefined) {
  const root = document.documentElement;
  if (!s) return;
  const a = s.a11y;
  root.dataset.font = a.font === 'dyslexic' ? 'dyslexic' : 'default';
  if (a.highContrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  // reducedMotion: 'on' = reduce motion, 'off' = allow motion, 'system' = follow OS
  if (a.reducedMotion === 'on') root.dataset.motion = 'off';
  else if (a.reducedMotion === 'off') root.dataset.motion = 'on';
  else delete root.dataset.motion;
  if (s.theme && s.theme !== 'meadow') root.dataset.accent = s.theme;
  else delete root.dataset.accent;
  root.style.fontSize = `${Math.round((a.textScale || 1) * 100)}%`;
}

export function NudgeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('loading');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [health, setHealth] = useState<HealthState>({ kind: 'checking' });
  const sourceRef = useRef<DataSource | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    const src = sourceRef.current;
    if (!src) return;
    try {
      const snap = await src.snapshot();
      setSnapshot(snap);
      if (src.kind === 'extension') setStatus('connected');
    } catch {
      if (src.kind === 'extension') setStatus('disconnected');
    }
  }, []);

  const attach = useCallback(
    async (src: DataSource) => {
      unsubRef.current?.();
      sourceRef.current?.dispose();
      sourceRef.current = src;
      setStatus(src.kind === 'extension' ? 'connected' : 'demo');
      unsubRef.current = src.onChanged(() => void load());
      await load();
    },
    [load],
  );

  useEffect(() => {
    let cancelled = false;
    connect().then((src) => {
      if (cancelled) src.dispose();
      else void attach(src);
    });
    return () => {
      cancelled = true;
      unsubRef.current?.();
      sourceRef.current?.dispose();
      sourceRef.current = null;
    };
  }, [attach]);

  useEffect(() => {
    applyAppearance(snapshot?.settings);
  }, [snapshot?.settings]);

  const send = useCallback(
    async (req: BridgeRequest) => {
      const src = sourceRef.current;
      if (!src) throw new Error('Still getting ready.');
      try {
        const data = await src.request(req);
        if (req.type !== 'getSnapshot' && req.type !== 'exportData') await load();
        return data;
      } catch (e) {
        if (src.kind === 'extension' && e instanceof Error && e.message === 'timeout') setStatus('disconnected');
        throw e;
      }
    },
    [load],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      // Optimistic, so toggles feel instant.
      setSnapshot((s) => (s ? { ...s, settings: { ...s.settings, ...patch } } : s));
      await send({ type: 'updateSettings', patch });
    },
    [send],
  );

  const reconnect = useCallback(async () => {
    setStatus('loading');
    const src = await connect();
    await attach(src);
  }, [attach]);

  const switchToSampleData = useCallback(async () => {
    await attach(new DemoSource());
  }, [attach]);

  const backendUrl = snapshot?.settings.backendUrl || 'http://localhost:8000';
  const [healthTick, setHealthTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2500);
    setHealth({ kind: 'checking' });
    fetch(`${backendUrl.replace(/\/$/, '')}/health`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h: HealthResponse) => {
        if (alive) setHealth({ kind: 'ok', health: h });
      })
      .catch(() => {
        if (alive) setHealth({ kind: 'offline' });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [backendUrl, healthTick]);

  const value = useMemo<NudgeContextValue>(
    () => ({
      status,
      snapshot,
      send,
      updateSettings,
      refresh: load,
      reconnect,
      switchToSampleData,
      health,
      recheckHealth: () => setHealthTick((n) => n + 1),
    }),
    [status, snapshot, send, updateSettings, load, reconnect, switchToSampleData, health],
  );

  return <NudgeContext.Provider value={value}>{children}</NudgeContext.Provider>;
}

export function useNudge(): NudgeContextValue {
  const ctx = useContext(NudgeContext);
  if (!ctx) throw new Error('useNudge must be used inside <NudgeProvider>');
  return ctx;
}

