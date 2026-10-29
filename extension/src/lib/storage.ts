import { defaultStorage, withDefaults, freshGuard, type StorageShape } from '@nudge/shared';

// Typed access to chrome.storage.local. All personal data lives here, on-device.
// Raw sensing events live in chrome.storage.session instead (memory only) and
// are deleted every 30 s after features are computed.

export type Key = keyof StorageShape;

export async function getStore(): Promise<StorageShape> {
  const raw = (await chrome.storage.local.get(null)) as Partial<StorageShape>;
  const d = defaultStorage();
  return {
    ...d,
    ...raw,
    settings: withDefaults(raw.settings),
    guard: { ...freshGuard(), ...(raw.guard ?? {}) },
    rawEvents: [],
  };
}

export async function getKeys<K extends Key>(...keys: K[]): Promise<Pick<StorageShape, K>> {
  const store = await getStore();
  const out = {} as Pick<StorageShape, K>;
  for (const k of keys) out[k] = store[k];
  return out;
}

export async function setKeys(patch: Partial<StorageShape>): Promise<void> {
  const { rawEvents: _ignored, ...rest } = patch;
  await chrome.storage.local.set(rest);
}

/** Read-modify-write a single key. Keeps the race window tiny. */
export async function mutate<K extends Key>(key: K, fn: (v: StorageShape[K]) => StorageShape[K]): Promise<StorageShape[K]> {
  const store = await getStore();
  const next = fn(store[key]);
  await chrome.storage.local.set({ [key]: next });
  return next;
}

export async function replaceAll(store: StorageShape): Promise<void> {
  await chrome.storage.local.clear();
  await setKeys(store);
}

/** Transient (memory-only) state shared by SW + panel. */
export interface SessionState {
  ctx?: import('@nudge/shared').SensingContext;
  rawEvents?: import('@nudge/shared').RawEvent[];
  windowStart?: number;
  lastState?: string;
  flowSince?: number | null;
  activityStart?: number | null;
  panelOpenUntil?: number; // heartbeat from the panel
  panelIntent?: PanelIntent | null;
  stepStartedAt?: number | null;
  stepIndex?: number;
  lastBlockAt?: number;
  lastActiveAt?: number;
  checkinChipDay?: string;
  focusedWindowId?: number | null;
}

export type PanelIntent =
  | { screen: 'stuck'; state: 'stuck' | 'depleted' | 'restuck'; t: number }
  | { screen: 'break'; t: number }
  | { screen: 'resume'; t: number }
  | { screen: 'offramp'; t: number }
  | { screen: 'safety-demo'; t: number }
  | { screen: 'checkin'; t: number };

export async function getSession(): Promise<SessionState> {
  return (await chrome.storage.session.get(null)) as SessionState;
}

export async function setSession(patch: Partial<SessionState>): Promise<void> {
  await chrome.storage.session.set(patch);
}
