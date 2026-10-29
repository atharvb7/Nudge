import {
  EMPTY_CONTEXT,
  blockSample,
  breakRanLong,
  canAutoNudge,
  canShowChip,
  computeBaseline,
  computeWindow,
  dayKey,
  detectRestuck,
  inferState,
  isLearning,
  makeInference,
  markNudged,
  rollover,
  HYDRATION_AFTER_FLOW_MIN,
  MIN,
  type GuardContext,
  type Inference,
  type StorageShape,
} from '@nudge/shared';
import type { OverlaySpec } from '../lib/messages';
import type { SessionState } from '../lib/storage';
import { checkinChip, depletedNudge, hydrationChip, longBreakChip, restuckChip, stuckNudge, timeAnchorChip } from './overlays';

// Pure planning for the 30 s tick. The service worker gathers state, calls
// planTick, shows at most ONE overlay, and persists the patches. Keeping this
// free of chrome.* makes every anti-nag rule unit-testable, and because all
// inputs come from storage a worker restart simply resumes where it left off.

export const FEATURE_KEEP_MS = 2 * 60 * MIN;
export const BLOCK_MS = 5 * MIN;
export const MAX_SAMPLES = 3000;
/** Same state isn't logged again within this window (unless Nudge acted on it). */
export const INFERENCE_DEDUPE_MS = 10 * MIN;
/** Flow interrupted by more than this many minutes of something else starts over. */
export const FLOW_GAP_MS = 10 * MIN;
/** A break nobody came back from is quietly closed this long after its planned end. */
export const STALE_BREAK_MS = 2 * 60 * MIN;

export interface TickEnv {
  now: number;
  store: StorageShape;
  ses: SessionState;
  /** browser window itself is fullscreen (F11, presentation) */
  windowFullscreen: boolean;
  onCall: boolean;
}

export interface TickPlan {
  overlay: OverlaySpec | null;
  patch: Partial<StorageShape>;
  sessionPatch: Partial<SessionState>;
  clearIntent: boolean;
}

function recentlyLogged(list: Inference[], state: Inference['state'], now: number): boolean {
  for (let i = list.length - 1; i >= 0; i--) {
    const inf = list[i];
    if (now - inf.t > INFERENCE_DEDUPE_MS) return false;
    if (inf.state === state) return true;
  }
  return false;
}

export function planTick(env: TickEnv): TickPlan {
  const { now, store, ses } = env;
  const settings = store.settings;
  if (settings.trackingPaused) {
    return { overlay: null, patch: {}, sessionPatch: { rawEvents: [], windowStart: now }, clearIntent: false };
  }

  const from = ses.windowStart ?? now - 30_000;
  const { window, ctx } = computeWindow(ses.rawEvents ?? [], ses.ctx ?? { ...EMPTY_CONTEXT }, from, now, settings);
  const features = [...store.features, window].filter((w) => w.t > now - FEATURE_KEEP_MS);
  // raw events are deleted right after features are computed
  const sessionPatch: Partial<SessionState> = { rawEvents: [], ctx, windowStart: now };
  const patch: Partial<StorageShape> = { features };

  // personal baseline: one sample per 5-minute block
  if (!ses.lastBlockAt || now - ses.lastBlockAt >= BLOCK_MS) {
    const sample = blockSample(features.filter((w) => w.t > now - BLOCK_MS));
    sessionPatch.lastBlockAt = now;
    if (sample) {
      const samples = [...store.baselineSamples, sample].slice(-MAX_SAMPLES);
      patch.baselineSamples = samples;
      patch.baseline = computeBaseline(samples, store.baseline?.typicalSessionMin ?? 75, now);
    }
  }

  // activity session (for "depleted" and time anchors): resets after 30+ min away
  let activityStart = ses.activityStart ?? null;
  if (ctx.idleSince && now - ctx.idleSince >= 30 * MIN) activityStart = null;
  else if (!ctx.idleSince && !activityStart) activityStart = now;
  sessionPatch.activityStart = activityStart;

  const result = inferState({
    windows: features,
    baseline: patch.baseline ?? store.baseline,
    sensitivity: settings.sensitivity,
    sessionStartedAt: activityStart,
    idleSince: ctx.idleSince,
    taskLabel: settings.taskTab?.title || null,
    now,
  });

  let guard = rollover(store.guard, now);

  // a break nobody came back from shouldn't silence Nudge forever
  let breakState = store.breakState;
  if (breakState && (now - breakState.startedAt > breakState.plannedMin * MIN + STALE_BREAK_MS || dayKey(breakState.startedAt) !== dayKey(now))) {
    breakState = null;
    patch.breakState = null;
  }

  const gctx: GuardContext = {
    now,
    state: result.state,
    fullscreen: !!ctx.fullscreen || env.windowFullscreen,
    onCall: env.onCall,
    onBreak: !!breakState,
    panelOpen: (ses.panelOpenUntil ?? 0) > now,
  };
  const excludedHere = ctx.activeHost === 'excluded';
  const chipOk = !excludedHere && canShowChip(guard, settings, gctx);
  const learning = isLearning(settings, now);
  const style = settings.wordingStyle;
  const inferences: Inference[] = [];
  const logged = () => [...store.inferences, ...inferences];
  let overlay: OverlaySpec | null = null;
  let clearIntent = false;

  // flow / hyperfocus bookkeeping (never interrupted)
  let flowSince = ses.flowSince ?? null;
  let flowSeenAt = ses.flowSeenAt ?? null;
  if (result.state === 'flow') {
    if (!flowSince || (flowSeenAt && now - flowSeenAt > FLOW_GAP_MS)) flowSince = now;
    flowSeenAt = now;
  } else if (result.state !== 'neutral' || (flowSeenAt && now - flowSeenAt > FLOW_GAP_MS)) {
    flowSince = null;
  }
  sessionPatch.flowSince = flowSince;
  sessionPatch.flowSeenAt = flowSeenAt;

  const changed = result.state !== ses.lastState;
  sessionPatch.lastState = result.state;

  // 1. break ran long on escape sites → one soft return prompt per break
  if (breakState && breakRanLong(breakState, features, now) && chipOk) {
    overlay = longBreakChip(style);
    patch.breakState = { ...breakState, returnPromptShown: true };
    const minutes = Math.round((now - breakState.startedAt) / MIN);
    inferences.push(makeInference('long_break', `Break planned for ${breakState.plannedMin} min ran to ${minutes} min, mostly on other sites.`, now, 'nudged'));
  }

  // 2. mid-task re-stuck watch, once per step (keyed by the step's start time)
  if (!overlay && ses.stepStartedAt && guard.restuckChipShownForStep !== ses.stepStartedAt && !breakState) {
    const r = detectRestuck(features, ses.stepStartedAt, now, settings.sensitivity);
    if (r && chipOk) {
      overlay = restuckChip(style);
      guard = { ...guard, restuckChipShownForStep: ses.stepStartedAt };
      inferences.push(makeInference('restuck', r.reason, now, 'nudged'));
    }
  }

  // 3. stuck / depleted → gentle nudge, within every anti-nag rule
  if (result.state === 'stuck' || result.state === 'depleted') {
    const decision = canAutoNudge(guard, settings, gctx);
    if (!overlay && decision.ok && !excludedHere) {
      overlay = result.state === 'stuck' ? stuckNudge(style) : depletedNudge(style);
      guard = markNudged(guard, now);
      clearIntent = true;
      inferences.push(makeInference(result.state, result.reason, now, 'nudged'));
    } else if (!overlay && changed && !recentlyLogged(logged(), result.state, now)) {
      const why = excludedHere ? 'You were on a site you excluded.' : decision.why;
      inferences.push(makeInference(result.state, result.reason, now, learning ? 'learning' : 'silenced', learning ? undefined : why));
    }
  } else if (changed && (result.state === 'flow' || result.state === 'away') && !recentlyLogged(logged(), result.state, now)) {
    inferences.push(makeInference(result.state, result.reason, now, 'none'));
  }

  // 4. hydration chip after 90 min of continuous flow (not in learning mode)
  if (
    !overlay &&
    result.state === 'flow' &&
    flowSince &&
    settings.hydrationChip &&
    !learning &&
    now - flowSince >= HYDRATION_AFTER_FLOW_MIN * MIN &&
    now - guard.lastHydrationChipAt >= HYDRATION_AFTER_FLOW_MIN * MIN &&
    chipOk
  ) {
    overlay = hydrationChip(style);
    guard = { ...guard, lastHydrationChipAt: now };
    inferences.push(makeInference('flow', `Steady focus for ${Math.round((now - flowSince) / MIN)} min — showed the tiny "Water? Stretch?" chip.`, now, 'nudged'));
  }

  // 5. optional time anchor every 30 min of continuous activity (off by default)
  if (!overlay && settings.timeAnchor && activityStart && result.state !== 'away' && chipOk) {
    const since = now - activityStart;
    const lastAnchor = Math.max(guard.lastTimeAnchorAt, activityStart);
    if (since >= 30 * MIN && now - lastAnchor >= 30 * MIN) {
      overlay = timeAnchorChip(Math.max(30, Math.round(since / MIN / 5) * 5));
      guard = { ...guard, lastTimeAnchorAt: now };
    }
  }

  // 6. learning mode: one gentle 1-tap check-in per day, in the evening
  const today = dayKey(now);
  if (
    !overlay &&
    learning &&
    settings.onboarded &&
    new Date(now).getHours() >= 18 &&
    guard.checkinChipDay !== today &&
    !store.checkins.some((c) => c.day === today) &&
    result.state !== 'flow' &&
    chipOk
  ) {
    overlay = checkinChip(style);
    guard = { ...guard, checkinChipDay: today };
  }

  if (inferences.length) patch.inferences = [...store.inferences, ...inferences].slice(-300);
  if (JSON.stringify(guard) !== JSON.stringify(store.guard)) patch.guard = guard;
  return { overlay, patch, sessionPatch, clearIntent };
}
