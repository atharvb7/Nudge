import {
  EMPTY_CONTEXT,
  ELSEWHERE_HOST,
  type RawEvent,
  applyBridgeRequest,
  wakingDayKey,
  markDayClosed,
  markSessionStarted,
  defaultStorage,
  hostOf,
  isCallHost,
  isExcluded,
  markDismissed,
  markNudged,
  rollover,
  seedDemoData,
  snapshotOf,
  copy,
  uid,
  type BridgeRequest,
  type Settings,
} from '@nudge/shared';
import { getSession, getStore, mutate, replaceAll, setKeys, setSession, type PanelIntent } from '../lib/storage';
import type { OverlayActionId, OverlaySpec, ToBackground, ToContent } from '../lib/messages';
import { depletedNudge, longBreakChip, restuckChip, stuckNudge, wakeNudge } from './overlays';
import { planTick } from './plan';
import { adoptPinned, forgetClosedTab, isTaskTab, refreshPinned } from './pinned';

// ───────────────────────── Service worker ─────────────────────────
// MV3 workers are short-lived: every listener is registered synchronously at
// top level and all state lives in chrome.storage (local = data, session =
// transient, memory-only). A 30 s alarm computes features and deletes raw events.

const TICK = 'nudge-tick';
const PANEL_ACTIONS: OverlayActionId[] = ['help', 'break', 'stuck_again', 'taking_break', 'come_back', 'call_it_day', 'open_panel'];

let lastFocusedWindowId: number | null = null;

// Serialise read-modify-write of transient state inside this worker.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

// ───────────── install / startup ─────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  if (details.reason === 'install') {
    await replaceAll(defaultStorage(Date.now()));
    await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
  // tabs that were already open (including the task tab!) don't get content
  // scripts automatically — add them now so counting and nudges work right away
  await injectIntoOpenTabs();
  await ensureRuntime();
});

async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => [] as chrome.tabs.Tab[]);
  await Promise.all(
    tabs.map((t) =>
      t.id === undefined || t.discarded
        ? undefined
        : chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => undefined),
    ),
  );
}

chrome.runtime.onStartup.addListener(() => {
  void ensureRuntime();
});

async function ensureRuntime(): Promise<void> {
  chrome.idle.setDetectionInterval(60);
  const existing = await chrome.alarms.get(TICK);
  if (!existing) await chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  const s = await getSession();
  if (!s.windowStart) await setSession({ windowStart: Date.now(), ctx: { ...EMPTY_CONTEXT }, rawEvents: [] });
  const { settings } = await getStore();
  await syncWakeListener(settings);
}
void ensureRuntime();

// ───────────── sensing listeners (metadata only) ─────────────

async function pushEvent(ev: RawEvent): Promise<void> {
  await serial(async () => {
    const s = await getSession();
    const raw = s.rawEvents ?? [];
    raw.push(ev);
    await setSession({ rawEvents: raw.slice(-2000), lastActiveAt: ev.kind === 'idle' ? s.lastActiveAt : Date.now() });
  });
}

async function recordActivation(tabId: number, url: string | undefined, title?: string): Promise<void> {
  const { settings } = await getStore();
  if (settings.trackingPaused) return;
  let host = hostOf(url);
  if (isExcluded(host, settings.excludedSites)) host = 'excluded';
  // pinned tab was closed and the same site reopened: this is the task tab now
  const adopted = adoptPinned(settings.taskTab, tabId, host, title);
  if (adopted !== settings.taskTab) await mutate('settings', (s) => ({ ...s, taskTab: adoptPinned(s.taskTab, tabId, host, title) }));
  await pushEvent({ t: Date.now(), kind: 'activate', tabId, host, isTaskTab: isTaskTab(adopted, tabId, host) });
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  lastFocusedWindowId = windowId;
  void chrome.tabs.get(tabId).then((t) => recordActivation(tabId, t.url ?? t.pendingUrl, t.title), () => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && !info.title) return;
  void (async () => {
    const { settings } = await getStore();
    // keep the pinned task tab's title fresh (the only title we ever store, chosen
    // by the user) — but never adopt the title of a site it navigated away to
    const host = hostOf(tab.url);
    if (refreshPinned(settings.taskTab, tabId, host, info.title) !== settings.taskTab) {
      await mutate('settings', (s) => ({ ...s, taskTab: refreshPinned(s.taskTab, tabId, host, info.title) }));
    }
    // same-tab navigation (incl. single-page apps) can change the site you're on
    if (info.url && tab.active) await recordActivation(tabId, info.url, tab.title);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void mutate('settings', (s) => ({ ...s, taskTab: forgetClosedTab(s.taskTab, tabId) }));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // browser unfocused: not on task, not on escape — just "elsewhere"
    void pushEvent({ t: Date.now(), kind: 'activate', tabId: -1, host: ELSEWHERE_HOST, isTaskTab: false });
    return;
  }
  lastFocusedWindowId = windowId;
  void chrome.tabs.query({ active: true, windowId }).then(([t]) => {
    if (t?.id !== undefined) void recordActivation(t.id, t.url, t.title);
  });
});

chrome.idle.onStateChanged.addListener((state) => {
  const t = state === 'active' ? Date.now() : Date.now() - 60_000; // idle fires after the 60 s detection interval
  void pushEvent({ t, kind: 'idle', state });
});

// ───────────── the 30 s tick ─────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) void serial(safeTick);
  if (alarm.name === 'nudge-break-end') void onBreakAlarm();
});

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

async function onCallNow(): Promise<boolean> {
  const audible = await chrome.tabs.query({ audible: true });
  if (audible.some((t) => isCallHost(hostOf(t.url)))) return true;
  const t = await activeTab();
  return !!t && isCallHost(hostOf(t.url));
}

async function windowFullscreen(): Promise<boolean> {
  try {
    const w = await chrome.windows.getLastFocused();
    return w.state === 'fullscreen';
  } catch {
    return false;
  }
}

/** A tick must never wedge the queue: errors are noted (name only), slow work times out. */
async function safeTick(): Promise<void> {
  try {
    await Promise.race([tick(), new Promise((_, reject) => setTimeout(() => reject(new Error('tick timeout')), 20_000))]);
    await setSession({ lastTickError: null });
  } catch (e) {
    await setSession({ lastTickError: `${(e as Error)?.name ?? 'Error'}: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
  }
}

async function tick(): Promise<void> {
  const now = Date.now();
  const store = await getStore();
  const ses = await getSession();
  const plan = planTick({ now, store, ses, windowFullscreen: await windowFullscreen(), onCall: await onCallNow() });
  // persist first: if showing the overlay fails or the worker is stopped mid-way,
  // the cooldown is already recorded, so a restart never doubles up a nudge
  await setKeys(plan.patch);
  await setSession({ ...plan.sessionPatch, ...(plan.clearIntent ? { panelIntent: null } : {}) });
  if (plan.overlay) await showOverlay(plan.overlay, store.settings);
}

async function onBreakAlarm(): Promise<void> {
  // Break timer finished. Nothing is mandatory: the panel shows a gentle
  // "welcome back" if open; the long-break prompt only fires if escape-browsing continues.
  await chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
}

// ───────────── overlays ─────────────

async function setCalmBadge(on: boolean): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#4f7d66' }).catch(() => undefined);
  await chrome.action.setBadgeText({ text: on ? '•' : '' }).catch(() => undefined);
  await chrome.action
    .setTitle({ title: on ? 'Nudge has a gentle idea whenever you’re ready' : "Nudge — I'm stuck (Ctrl+Shift+Space)" })
    .catch(() => undefined);
}

async function sendToTab(tabId: number, msg: ToContent): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch {
    /* no content script yet (tab opened before install, or after an update) */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch {
    return false; // chrome://, Web Store, PDF viewer, discarded tab…
  }
}

/** Show an overlay in the active tab. Falls back to a calm badge where content scripts can't run. */
async function showOverlay(spec: OverlaySpec, settings?: Settings): Promise<boolean> {
  const s = settings ?? (await getStore()).settings;
  const withDisplay: OverlaySpec = {
    ...spec,
    display: {
      reduceMotion: s.a11y.reducedMotion === 'on',
      highContrast: s.a11y.highContrast,
      scale: s.a11y.textScale,
      dyslexic: s.a11y.font === 'dyslexic',
    },
  };
  const tab = await activeTab();
  if (tab?.id !== undefined && (await sendToTab(tab.id, { kind: 'showOverlay', spec: withDisplay }))) return true;
  await setCalmBadge(true);
  return false;
}

async function noteOverlay(tabId: number | undefined, overlayId: string, text: string): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'overlayNote', overlayId, text } satisfies ToContent);
  } catch {
    /* tab gone */
  }
}

async function setIntent(intent: PanelIntent): Promise<void> {
  await setSession({ panelIntent: intent });
  await setCalmBadge(false);
}

function intentFor(action: OverlayActionId, lastState: string | undefined): PanelIntent | null {
  const t = Date.now();
  switch (action) {
    case 'help':
    case 'open_panel':
      return { screen: 'stuck', state: lastState === 'depleted' ? 'depleted' : 'stuck', t };
    case 'break':
    case 'taking_break':
      return { screen: 'break', t };
    case 'stuck_again':
    case 'come_back':
      return { screen: 'resume', t };
    case 'call_it_day':
      return { screen: 'offramp', t };
    default:
      return null;
  }
}

// ───────────── messages ─────────────

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  // sidePanel.open must run synchronously inside the user-gesture window.
  let openedPromise: Promise<boolean> | null = null;
  if (msg.kind === 'overlayAction' && PANEL_ACTIONS.includes(msg.action) && sender.tab?.id !== undefined) {
    openedPromise = chrome.sidePanel.open({ tabId: sender.tab.id }).then(
      () => true,
      () => false,
    );
  }
  void handle(msg, sender, openedPromise).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
  return true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-stuck-panel') return;
  // call open() first, before any await, so the shortcut's user gesture still counts
  const windowId = tab?.windowId ?? lastFocusedWindowId ?? undefined;
  if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).catch(() => setCalmBadge(true));
  void setIntent({ screen: 'stuck', state: 'stuck', t: Date.now() });
});

async function handle(msg: ToBackground, sender: chrome.runtime.MessageSender, opened: Promise<boolean> | null): Promise<unknown> {
  const now = Date.now();
  switch (msg.kind) {
    case 'interact': {
      const { settings } = await getStore();
      if (settings.trackingPaused || !sender.tab?.id) return { ok: true };
      const host = hostOf(sender.tab.url);
      if (isExcluded(host, settings.excludedSites)) return { ok: true };
      await pushEvent({ t: now, kind: 'interact', tabId: sender.tab.id, host, keys: msg.keys | 0, scrolls: msg.scrolls | 0, clicks: msg.clicks | 0 });
      return { ok: true };
    }
    case 'fullscreen':
      await pushEvent({ t: now, kind: 'fullscreen', on: !!msg.on });
      return { ok: true };
    case 'overlayAction':
      return overlayAction(msg.action, msg.overlayId, msg.value, sender, opened);
    case 'bridge':
      return bridge(msg.request);
    case 'simulate':
      return simulate(msg.sim);
    case 'stepStarted':
      await setSession({ stepStartedAt: now, stepIndex: msg.index });
      return { ok: true };
    case 'stepEnded':
      await setSession({ stepStartedAt: null });
      return { ok: true };
    case 'guardDayClosed':
      await mutate('guard', (g) => markDayClosed(g, now));
      await setSession({ stepStartedAt: null });
      return { ok: true };
    case 'newSession':
      await mutate('guard', (g) => markSessionStarted(g, now));
      return { ok: true };
    case 'panelHeartbeat':
      await setSession({ panelOpenUntil: now + 45_000 });
      await setCalmBadge(false);
      return { ok: true };
    case 'wakeHeard': {
      const { settings } = await getStore();
      await showOverlay(wakeNudge(settings.wordingStyle));
      return { ok: true };
    }
    case 'syncWake': {
      const { settings } = await getStore();
      await syncWakeListener(settings);
      return { ok: true };
    }
    case 'pinTab': {
      if (msg.tabId === null) {
        await mutate('settings', (s) => ({ ...s, taskTab: null }));
        return { ok: true };
      }
      const t = await chrome.tabs.get(msg.tabId);
      await mutate('settings', (s) => ({ ...s, taskTab: { tabId: msg.tabId, host: hostOf(t.url), title: t.title ?? hostOf(t.url) } }));
      return { ok: true };
    }
    case 'listTabs': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return tabs
        .filter((t) => t.id !== undefined && t.url && !['browser', 'extension', ''].includes(hostOf(t.url)))
        .map((t) => ({ id: t.id!, title: t.title ?? '', host: hostOf(t.url), active: !!t.active }));
    }
  }
}

async function overlayAction(
  action: OverlayActionId,
  overlayId: string,
  value: number | undefined,
  sender: chrome.runtime.MessageSender,
  opened: Promise<boolean> | null,
): Promise<unknown> {
  const now = Date.now();
  const store = await getStore();
  const ses = await getSession();
  const style = store.settings.wordingStyle;
  const intent = intentFor(action, ses.lastState);
  if (intent) {
    await setIntent(intent);
    const ok = opened ? await opened : false;
    if (!ok) {
      await setCalmBadge(true);
      return { opened: false, note: style === 'literal' ? 'Click the Nudge icon in the toolbar to open the panel.' : 'Tap the Nudge icon (top right) and I’ll be there.' };
    }
    return { opened: true };
  }
  switch (action) {
    case 'fine': {
      const { guard, turnedOff } = markDismissed(store.guard, now);
      await setKeys({ guard });
      if (turnedOff) {
        await noteOverlay(sender.tab?.id, overlayId, copy(style, 'offForToday'));
        return { note: copy(style, 'offForToday') };
      }
      return { ok: true };
    }
    case 'still_going':
      return { ok: true };
    case 'checkin': {
      const feeling = (value ?? 3) as 1 | 2 | 3 | 4 | 5;
      const day = wakingDayKey(now);
      await setKeys({
        checkins: [...store.checkins.filter((c) => c.day !== day), { t: now, day, feeling }],
        wins: [...store.wins, { id: uid('w_'), t: now, kind: 'checkin', label: 'Checked in with myself' }],
      });
      return { note: 'Thank you. Noted.' };
    }
    default:
      return { ok: true };
  }
}

// ───────────── demo simulations ─────────────

async function simulate(kind: 'stuck' | 'restuck' | 'depleted' | 'long_break' | 'crisis'): Promise<unknown> {
  const store = await getStore();
  const now = Date.now();
  const style = store.settings.wordingStyle;
  const { store: next, data } = applyBridgeRequest(store, { type: 'simulate', kind }, now);
  if (kind === 'crisis') {
    // runs through the panel's safety flow; nothing is stored
    await setSession({ panelIntent: { screen: 'safety-demo', t: now } });
    return { ok: true };
  }
  await setKeys({ inferences: next.inferences });
  await setSession({ lastState: kind === 'depleted' ? 'depleted' : 'stuck' });
  const spec =
    kind === 'stuck' ? stuckNudge(style) : kind === 'depleted' ? depletedNudge(style) : kind === 'restuck' ? restuckChip(style) : longBreakChip(style);
  await showOverlay(spec);
  if (kind === 'stuck' || kind === 'depleted') await setKeys({ guard: markNudged(store.guard, now) });
  return { ok: true, inference: data };
}

// ───────────── dashboard bridge ─────────────

async function bridge(request: BridgeRequest): Promise<unknown> {
  const now = Date.now();
  if (request.type === 'simulate') return simulate(request.kind);
  if (request.type === 'loadDemoData') {
    await replaceAll(seedDemoData(now));
    return snapshotOf(await getStore(), 'extension', now);
  }
  if (request.type === 'deleteAll') {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    const fresh = defaultStorage(now);
    fresh.settings.onboarded = false;
    await replaceAll(fresh);
    await setSession({ windowStart: now, ctx: { ...EMPTY_CONTEXT }, rawEvents: [] });
    return snapshotOf(await getStore(), 'extension', now);
  }
  const store = await getStore();
  const { store: next, data } = applyBridgeRequest(store, request, now);
  if (next !== store) await setKeys(next);
  if (request.type === 'updateSettings') await syncWakeListener(next.settings);
  if (request.type === 'getSnapshot') return snapshotOf(next, 'extension', now);
  return data;
}

// ───────────── wake phrase (offscreen, on-device only) ─────────────

async function syncWakeListener(settings: Settings): Promise<void> {
  const want = settings.wakePhrase && !settings.trackingPaused;
  const has = await chrome.offscreen.hasDocument().catch(() => false);
  if (want && !has) {
    await chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Listens on-device for the optional wake phrase "Nudge, I\'m stuck". No audio is stored or sent anywhere.',
      })
      .catch(() => undefined);
  } else if (!want && has) {
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue as Settings | undefined;
  const after = changes.settings.newValue as Settings | undefined;
  if (after && before?.wakePhrase !== after.wakePhrase) void syncWakeListener(after);
  if (after?.trackingPaused) void setSession({ rawEvents: [] });
});
