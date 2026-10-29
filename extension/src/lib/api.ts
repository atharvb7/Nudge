import {
  detectCrisis,
  localBrainDump,
  localOfframp,
  localSequence,
  safetyPayload,
  type BrainDumpResponse,
  type HealthResponse,
  type OfframpResponse,
  type Region,
  type SafetyPayload,
  type SequenceRequest,
  type SequenceResponse,
  type Settings,
  type WordingStyle,
  type Energy,
} from '@nudge/shared';
import { truncate } from './session';

// Backend client. Every call has a timeout and an offline fallback built from
// the pre-written strategy cards, so help never breaks.

const SEQUENCE_TIMEOUT_MS = 25_000;

async function post<T>(base: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export type WithOffline<T> = T & { offline: boolean };

/** Crisis check that runs on-device before anything leaves the browser. */
export function localSafety(text: string, region: Region): SafetyPayload | null {
  const level = detectCrisis(text);
  return level === 'none' ? null : safetyPayload(region, level);
}

export async function requestSequence(req: SequenceRequest, settings: Settings): Promise<WithOffline<SequenceResponse>> {
  const clean: SequenceRequest = { ...req, transcript: req.transcript ? truncate(req.transcript) : undefined, task: truncate(req.task, 300) };
  const safety = localSafety(`${clean.task} ${clean.transcript ?? ''}`, settings.region);
  if (safety) return { ...localSequence(clean, settings.region), offline: true };
  try {
    const r = await post<SequenceResponse>(settings.backendUrl, '/sequence', { ...clean, region: settings.region }, SEQUENCE_TIMEOUT_MS);
    if (r.mode !== 'safety' && (!r.next_step || !r.strategy_id)) throw new Error('empty step');
    return { ...r, buttons: r.mode === 'safety' ? [] : r.buttons?.length ? r.buttons : ['done', 'too_big', 'smaller', 'different', 'rest'], offline: false };
  } catch {
    return { ...localSequence(clean, settings.region), offline: true };
  }
}

export async function requestOfframp(
  task: string,
  progress: string[],
  style: WordingStyle,
  energy: Energy,
  settings: Settings,
): Promise<WithOffline<OfframpResponse>> {
  try {
    const r = await post<OfframpResponse & { mode?: string }>(settings.backendUrl, '/offramp', { task, progress, wording_style: style, energy, region: settings.region }, 15_000);
    if (!r.note_to_future_self) throw new Error('empty');
    return { ...r, offline: false };
  } catch {
    return { ...localOfframp(task, progress, style), offline: true };
  }
}

export async function requestBrainDump(transcript: string, style: WordingStyle, energy: Energy, settings: Settings): Promise<WithOffline<BrainDumpResponse>> {
  const text = truncate(transcript);
  const safety = localSafety(text, settings.region);
  if (safety) return { ...localBrainDump(text, style, settings.region), offline: true };
  try {
    const r = await post<BrainDumpResponse>(settings.backendUrl, '/braindump', { transcript: text, wording_style: style, energy, region: settings.region }, 25_000);
    if (r.mode !== 'safety' && !r.pick) throw new Error('no pick');
    return { ...r, offline: false };
  } catch {
    return { ...localBrainDump(text, style, settings.region), offline: true };
  }
}

export async function getHealth(base: string): Promise<HealthResponse | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/health', { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Local Whisper transcription. Audio is sent only to the local backend and never stored. */
export async function transcribe(base: string, audio: Blob): Promise<string | null> {
  const fd = new FormData();
  fd.append('audio', audio, 'speech.webm');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/transcribe', { method: 'POST', body: fd, signal: ctrl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: string };
    return (j.text ?? '').trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
