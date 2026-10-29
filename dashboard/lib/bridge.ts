import {
  DASHBOARD_SOURCE,
  EXTENSION_SOURCE,
  applyBridgeRequest,
  defaultStorage,
  seedDemoData,
  snapshotOf,
  type BridgeEnvelope,
  type BridgeReply,
  type BridgeRequest,
  type DashboardSnapshot,
  type StorageShape,
} from '@nudge/shared';

// Two interchangeable data sources behind one interface:
//  * ExtensionSource — talks to the Nudge extension through window.postMessage
//    (a bridge content script relays to the service worker). Personal data
//    never leaves the browser.
//  * DemoSource — sample week stored in this browser's localStorage, using the
//    exact same reducer the extension uses.

export interface DataSource {
  kind: 'extension' | 'demo';
  request(req: BridgeRequest): Promise<unknown>;
  snapshot(): Promise<DashboardSnapshot>;
  onChanged(cb: () => void): () => void;
  dispose(): void;
}

const HELLO_WAIT_MS = 800;
const REQUEST_TIMEOUT_MS = 4000;

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isReply(data: unknown): data is BridgeReply {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === EXTENSION_SOURCE;
}

function toSnapshot(data: unknown, now = Date.now()): DashboardSnapshot {
  const d = data as Partial<DashboardSnapshot> & Partial<StorageShape>;
  if (d && typeof d === 'object' && 'learningDaysLeft' in d && d.settings) return { ...(d as DashboardSnapshot), source: 'extension' };
  if (d && typeof d === 'object' && d.settings) return snapshotOf(d as StorageShape, 'extension', now);
  throw new Error('The extension sent something unexpected.');
}

export class ExtensionSource implements DataSource {
  kind = 'extension' as const;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private changeListeners = new Set<() => void>();
  private helloListeners = new Set<() => void>();
  private onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!isReply(event.data)) return;
    const msg = event.data;
    if (msg.type === 'hello') {
      this.helloListeners.forEach((cb) => cb());
      return;
    }
    if (msg.type === 'changed') {
      this.changeListeners.forEach((cb) => cb());
      return;
    }
    if (!msg.id) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    window.clearTimeout(p.timer);
    // Any reply also proves the extension is there.
    this.helloListeners.forEach((cb) => cb());
    if (msg.ok === false) p.reject(new Error(msg.error || 'The extension could not do that.'));
    else p.resolve(msg.data);
  };

  constructor() {
    window.addEventListener('message', this.onMessage);
  }

  /** Resolves true if the extension answers within ~800 ms. */
  detect(): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        this.helloListeners.delete(onHello);
        window.clearTimeout(timer);
        resolve(v);
      };
      const onHello = () => finish(true);
      this.helloListeners.add(onHello);
      const timer = window.setTimeout(() => finish(false), HELLO_WAIT_MS);
      // The bridge may have said hello before we were listening — ping it.
      this.request({ type: 'getSnapshot' }, HELLO_WAIT_MS).catch(() => undefined);
    });
  }

  request(req: BridgeRequest, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = newId();
    const envelope: BridgeEnvelope & { type: string; payload: BridgeRequest } = {
      source: DASHBOARD_SOURCE,
      id,
      request: req,
      // Also send the flat form described in docs/ARCHITECTURE.md.
      type: req.type,
      payload: req,
    };
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      window.postMessage(envelope, window.location.origin);
    });
  }

  async snapshot(): Promise<DashboardSnapshot> {
    return toSnapshot(await this.request({ type: 'getSnapshot' }));
  }

  onChanged(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  dispose(): void {
    window.removeEventListener('message', this.onMessage);
    this.pending.forEach((p) => window.clearTimeout(p.timer));
    this.pending.clear();
  }
}

const DEMO_KEY = 'nudge-demo-store-v1';

function readDemo(): StorageShape | null {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StorageShape;
    return parsed && parsed.settings ? parsed : null;
  } catch {
    return null;
  }
}

function writeDemo(s: StorageShape): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(s));
  } catch {
    // Private window / storage blocked: keep working in memory.
  }
}

export class DemoSource implements DataSource {
  kind = 'demo' as const;
  private store: StorageShape;
  private listeners = new Set<() => void>();

  constructor() {
    this.store = readDemo() ?? seedDemoData();
    writeDemo(this.store);
  }

  async request(req: BridgeRequest): Promise<unknown> {
    if (req.type === 'loadDemoData') {
      this.store = seedDemoData();
    } else if (req.type === 'deleteAll') {
      this.store = { ...defaultStorage(), settings: { ...defaultStorage().settings, onboarded: true, demoMode: true } };
    } else {
      const { store, data } = applyBridgeRequest(this.store, req);
      this.store = store;
      if (req.type !== 'getSnapshot' && req.type !== 'exportData') writeDemo(this.store);
      if (req.type === 'getSnapshot') return snapshotOf(this.store, 'demo');
      this.emit();
      return data;
    }
    writeDemo(this.store);
    this.emit();
    return null;
  }

  async snapshot(): Promise<DashboardSnapshot> {
    return snapshotOf(this.store, 'demo');
  }

  onChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    this.listeners.forEach((cb) => cb());
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export async function connect(): Promise<DataSource> {
  const ext = new ExtensionSource();
  if (await ext.detect()) return ext;
  ext.dispose();
  return new DemoSource();
}
