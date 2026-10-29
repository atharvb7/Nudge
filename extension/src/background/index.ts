import {
  EMPTY_CONTEXT,
  type RawEvent,
  applyBridgeRequest,
  blockSample,
  breakRanLong,
  canAutoNudge,
  canShowChip,
  computeBaseline,
  computeWindow,
  dayKey,
  defaultStorage,
  detectRestuck,
  hostOf,
  inferState,
  isCallHost,
  isExcluded,
  isLearning,
  makeInference,
  markDismissed,
  markNudged,
  rollover,
  seedDemoData,
  snapshotOf,
  copy,
  uid,
  HYDRATION_AFTER_FLOW_MIN,
  MIN,
  type BridgeRequest,
  type GuardContext,
  type Inference,
  type Settings,
  type StorageShape,
  type UserState,
} from '@nudge/shared';
import { getSession, getStore, mutate, replaceAll, setKeys, setSession, type PanelIntent, type SessionState } from '../lib/storage';
import type { OverlayActionId, OverlaySpec, ToBackground, ToContent } from '../lib/messages';
import { checkinChip, depletedNudge, hydrationChip, longBreakChip, restuckChip, stuckNudge, timeAnchorChip, wakeNudge } from './overlays';

// ───────────────────────── Service worker ─────────────────────────
// MV3 workers are short-lived: every listener is registered synchronously at
// top level and all state lives in chrome.storage (local = data, session =
// transient, memory-only). A 30 s alarm computes features and deletes raw events.

const TICK = 'nudge-tick';
const WINDOW_ID_NONE_HOST = 'elsewhere';
const FEATURE_KEEP_MS = 2 * 60 * MIN;
const BLOCK_MS = 5 * MIN;
const MAX_SAMPLES = 3000;
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
  await ensureRuntime();
});

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

function isTaskTab(settings: Settings, tabId: number, host: string): boolean {
  const pinned = settings.taskTab;
  if (!pinned) return false;
  if (pinned.tabId !== null && pinned.tabId === tabId) return true;
  // pinned tab closed or reopened: treat the same site as the task
  return !!pinned.host && pinned.host === host;
}

async function recordActivation(tabId: number, url: string | undefined): Promise<void> {
  const { settings } = await getStore();
  if (settings.trackingPaused) return;
  let host = hostOf(url);
  if (isExcluded(host, settings.excludedSites)) host = 'excluded';
  await pushEvent({ t: Date.now(), kind: 'activate', tabId, host, isTaskTab: host !== 'excluded' && isTaskTab(settings, tabId, host) });
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  lastFocusedWindowId = windowId;
  void chrome.tabs.get(tabId).then((t) => recordActivation(tabId, t.url ?? t.pendingUrl), () => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && !info.title) return;
  void (async () => {
    const { settings } = await getStore();
    // keep the pinned task tab's title fresh (the only title we ever store, chosen by the user)
    if (settings.taskTab?.tabId === tabId && info.title) {
      await mutate('settings', (s) => ({ ...s, taskTab: s.taskTab ? { ...s.taskTab, title: info.title!, host: hostOf(tab.url) || s.taskTab.host } : s.taskTab }));
    }
    if (info.url && tab.active) await recordActivation(tabId, info.url);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void mutate('settings', (s) => (s.taskTab?.tabId === tabId ? { ...s, taskTab: { ...s.taskTab, tabId: null } } : s));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // browser unfocused: not on task, not on escape — just "elsewhere"
    void pushEvent({ t: Date.now(), kind: 'activate', tabId: -1, host: WINDOW_ID_NONE_HOST, isTaskTab: false });
    return;
  }
  lastFocusedWindowId = windowId;
  void chrome.tabs.query({ active: true, windowId }).then(([t]) => {
    if (t?.id !== undefined) void recordActivation(t.id, t.url);
  });
});

chrome.idle.onStateChanged.addListener((state) => {
  const t = state === 'active' ? Date.now() : Date.now() - 60_000; // idle fires after the 60 s detection interval
  void pushEvent({ t, kind: 'idle', state });
});

// ───────────── the 30 s tick ─────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) void serial(tick);
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

async function guardContext(state: UserState, store: StorageShape, ses: SessionState, now: number): Promise<GuardContext> {
  return {
    now,
    state,
    fullscreen: !!ses.ctx?.fullscreen || (await windowFullscreen()),
    onCall: await onCallNow(),
    onBreak: !!store.breakState,
    panelOpen: (ses.panelOpenUntil ?? 0) > now,
  };
}

async function tick(): Promise<void> {
  const now = Date.now();
  const store = await getStore();
  const ses = await getSession();
  const settings = store.settings;
  if (settings.trackingPaused) {
    await setSession({ rawEvents: [], windowStart: now });
    return;
  }
  const from = ses.windowStart ?? now - 30_000;
  const { window, ctx } = computeWindow(ses.rawEvents ?? [], ses.ctx ?? { ...EMPTY_CONTEXT }, from, now, settings);
  const features = [...store.features, window].filter((w) => w.t > now - FEATURE_KEEP_MS);
  // raw events are deleted right after features are computed
  const sessionPatch: Partial<SessionState> = { rawEvents: [], ctx, windowStart: now };

  // learning: one baseline sample per 5-minute block
  const patch: Partial<StorageShape> = { features };
  if (!ses.lastBlockAt || now - ses.lastBlockAt >= BLOCK_MS) {
    const sample = blockSample(features.filter((w) => w.t > now - BLOCK_MS));
    sessionPatch.lastBlockAt = now;
    if (sample) {
      const samples = [...store.baselineSamples, sample].slice(-MAX_SAMPLES);
      patch.baselineSamples = samples;
      patch.baseline = computeBaseline(samples, store.baseline?.typicalSessionMin ?? 75, now);
    }
  }

  // activity session (for "depleted"): resets after 30+ min away
  let activityStart = ses.activityStart ?? null;
  if (ctx.idleSince && now - ctx.idleSince >= 30 * MIN) activityStart = null;
  else if (!ctx.idleSince && !activityStart) activityStart = now;
  sessionPatch.activityStart = activityStart;

  const taskLabel = settings.taskTab?.title || null;
  const result = inferState({
    windows: features,
    baseline: store.baseline,
    sensitivity: settings.sensitivity,
    sessionStartedAt: activityStart,
    idleSince: ctx.idleSince,
    taskLabel,
    now,
  });

  let guard = rollover(store.guard, now);
  if (guard.day !== store.guard.day) {
    // a new day: start fresh, nothing carried over
    patch.guard = guard;
  }
  const gctx = await guardContext(result.state, store, { ...ses, ctx }, now);
  const inferences: Inference[] = [];
  const style = settings.wordingStyle;
  const excludedHere = ctx.activeHost === 'excluded';

  // flow / hyperfocus: never interrupt, only a tiny chip after 90 min
  let flowSince = ses.flowSince ?? null;
  if (result.state === 'flow') {
    if (!flowSince) flowSince = now;
    if (
      settings.hydrationChip &&
      now - flowSince >= HYDRATION_AFTER_FLOW_MIN * MIN &&
      now - guard.lastHydrationChipAt >= HYDRATION_AFTER_FLOW_MIN * MIN &&
      canShowChip(guard, settings, gctx) &&
      !excludedHere
    ) {
      if (await showOverlay(hydrationChip(style))) {
        guard = { ...guard, lastHydrationChipAt: now };
        inferences.push(makeInference('flow', `Steady focus for ${Math.round((now - flowSince) / MIN)} min — showed the tiny "Water? Stretch?" chip.`, now, 'nudged'));
      }
    }
  } else if (result.state !== 'neutral') flowSince = null;
  sessionPatch.flowSince = flowSince;

  // log state changes with their plain-English reason
  const changed = result.state !== ses.lastState;
  sessionPatch.lastState = result.state;

  if (result.state === 'stuck' || result.state === 'depleted') {
    const decision = canAutoNudge(guard, settings, gctx);
    const learning = isLearning(settings, now);
    if (decision.ok && !excludedHere) {
      const spec = result.state === 'stuck' ? stuckNudge(style) : depletedNudge(style);
      if (await showOverlay(spec)) {
        guard = markNudged(guard, now);
        inferences.push(makeInference(result.state, result.reason, now, 'nudged'));
        await setSession({ panelIntent: null });
      }
    } else if (changed) {
      inferences.push(makeInference(result.state, result.reason, now, learning ? 'learning' : 'silenced', learning ? undefined : decision.why));
    }
  } else if (changed && (result.state === 'flow' || result.state === 'away')) {
    inferences.push(makeInference(result.state, result.reason, now, 'none'));
  }

  // mid-task re-stuck watch (10–15 min after a step starts)
  if (ses.stepStartedAt && ses.stepIndex !== undefined && guard.restuckChipShownForStep !== ses.stepIndex && !store.breakState) {
    const r = detectRestuck(features, ses.stepStartedAt, now, settings.sensitivity);
    if (r && canShowChip(guard, settings, gctx) && !excludedHere) {
      if (await showOverlay(restuckChip(style))) {
        guard = { ...guard, restuckChipShownForStep: ses.stepIndex };
        inferences.push(makeInference('restuck', r.reason, now, 'nudged'));
      }
    }
  }

  // break ran long on escape sites → one soft return prompt
  if (store.breakState && breakRanLong(store.breakState, features, now)) {
    const minutes = Math.round((now - store.breakState.startedAt) / MIN);
    if (canShowChip(guard, settings, { ...gctx, onBreak: false }) && (await showOverlay(longBreakChip(style)))) {
      patch.breakState = { ...store.breakState, returnPromptShown: true };
      inferences.push(makeInference('long_break', `Break planned for ${store.breakState.plannedMin} min ran to ${minutes} min, mostly on other sites.`, now, 'nudged'));
    }
  }

  // optional time-anchor chip every 30 min of an active Nudge session (off by default)
  if (settings.timeAnchor && store.session && !store.session.endedAt && canShowChip(guard, settings, gctx)) {
    const since = now - store.session.startedAt;
    const lastAnchor = Math.max(guard.lastTimeAnchorAt, store.session.startedAt);
    if (since >= 30 * MIN && now - lastAnchor >= 30 * MIN) {
      if (await showOverlay(timeAnchorChip(Math.round(since / MIN / 5) * 5))) guard = { ...guard, lastTimeAnchorAt: now };
    }
  }

  // learning mode: gentle 1-tap daily check-in in the evening
  const today = dayKey(now);
  if (
    isLearning(settings, now) &&
    settings.onboarded &&
    new Date(now).getHours() >= 18 &&
    ses.checkinChipDay !== today &&
    !store.checkins.some((c) => c.day === today) &&
    canShowChip(guard, settings, gctx) &&
    result.state !== 'flow'
  ) {
    if (await showOverlay(checkinChip(style))) sessionPatch.checkinChipDay = today;
  }

  if (inferences.length) patch.inferences = [...store.inferences, ...inferences].slice(-300);
  if (guard !== store.guard) patch.guard = guard;
  await setKeys(patch);
  await setSession(sessionPatch);
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

/** Show an overlay in the active tab. Falls back to a calm badge where content scripts can't run. */
async function showOverlay(spec: OverlaySpec): Promise<boolean> {
  const tab = await activeTab();
  if (tab?.id !== undefined) {
    try {
      const msg: ToContent = { kind: 'showOverlay', spec };
      await chrome.tabs.sendMessage(tab.id, msg);
      return true;
    } catch {
      /* chrome://, Web Store, PDF viewer, discarded tab… */
    }
  }
  await setCalmBadge(true);
  return true;
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
      await mutate('guard', (g) => ({ ...rollover(g, now), dayClosed: true }));
      await setSession({ stepStartedAt: null });
      return { ok: true };
    case 'newSession':
      await mutate('guard', (g) => ({ ...rollover(g, now), dayClosed: false }));
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
      const day = dayKey(now);
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
