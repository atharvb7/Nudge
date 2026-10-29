import type { Settings } from '@nudge/shared';
import { getHealth, transcribe } from './api';

// Push-to-talk speech. Privacy order of preference:
//   1. On-device Web Speech (processLocally = true) — audio never leaves the device.
//   2. Local Whisper via our own backend on localhost — audio held in memory, never stored.
//   3. Chrome's cloud speech — ONLY if the user explicitly opted in (audio goes to Google).
// Otherwise we gently suggest buttons-only.

export type EngineKind = 'on-device' | 'local-whisper' | 'chrome-cloud' | 'none';

export interface EngineStatus {
  engine: EngineKind;
  label: string;
  /** on-device pack can be downloaded with SpeechRecognition.install */
  downloadable?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type SRCtor = (new () => any) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally?: boolean }) => Promise<boolean>;
};

export function speechCtor(): SRCtor | null {
  const w = globalThis as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as SRCtor | null;
}

export async function onDeviceAvailability(lang = 'en-US'): Promise<'available' | 'downloadable' | 'unavailable'> {
  const SR = speechCtor();
  if (!SR || typeof SR.available !== 'function') return 'unavailable';
  try {
    const s = await SR.available({ langs: [lang], processLocally: true });
    if (s === 'available') return 'available';
    if (s === 'downloadable' || s === 'downloading') return 'downloadable';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function installOnDevice(lang = 'en-US'): Promise<boolean> {
  const SR = speechCtor();
  if (!SR || typeof SR.install !== 'function') return false;
  try {
    return !!(await SR.install({ langs: [lang], processLocally: true }));
  } catch {
    return false;
  }
}

export async function detectEngine(settings: Settings): Promise<EngineStatus> {
  const pref = settings.speechEngine;
  let downloadable = false;
  if (pref === 'auto' || pref === 'on-device') {
    const s = await onDeviceAvailability();
    if (s === 'available') return { engine: 'on-device', label: 'On-device speech (audio stays on this computer)' };
    downloadable = s === 'downloadable';
    if (pref === 'on-device') return { engine: 'none', label: 'On-device speech isn’t ready in this browser yet.', downloadable };
  }
  if (pref === 'auto' || pref === 'local-whisper') {
    const h = await getHealth(settings.backendUrl);
    if (h?.whisper) return { engine: 'local-whisper', label: 'Local Whisper (audio goes only to your own computer)', downloadable };
    if (pref === 'local-whisper') return { engine: 'none', label: 'Local Whisper isn’t running right now.', downloadable };
  }
  if (pref === 'chrome-cloud' && speechCtor()) {
    return { engine: 'chrome-cloud', label: 'Cloud speech — audio goes to Google (you chose this)' };
  }
  return { engine: 'none', label: 'Voice isn’t available privately right now — buttons work just as well.', downloadable };
}

export type ListenError = 'mic-denied' | 'no-speech' | 'unavailable' | 'network';

export interface Listener {
  stop(): Promise<string>;
  cancel(): void;
}

export interface ListenOptions {
  engine: EngineKind;
  whisperMode: boolean;
  backendUrl: string;
  onInterim?: (text: string) => void;
  onLevel?: (level: number) => void;
  onError?: (e: ListenError) => void;
}

export async function startListening(o: ListenOptions): Promise<Listener> {
  if (o.engine === 'on-device' || o.engine === 'chrome-cloud') return webSpeech(o);
  if (o.engine === 'local-whisper') return whisperRecorder(o);
  throw Object.assign(new Error('unavailable'), { code: 'unavailable' as ListenError });
}

function webSpeech(o: ListenOptions): Listener {
  const SR = speechCtor();
  if (!SR) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
  const rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  if (o.engine === 'on-device') rec.processLocally = true;
  let finalText = '';
  let interim = '';
  let resolveEnd: (() => void) | null = null;
  const ended = new Promise<void>((r) => (resolveEnd = r));
  rec.onresult = (ev: any) => {
    interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += t + ' ';
      else interim += t;
    }
    o.onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (ev: any) => {
    const code: ListenError = ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'mic-denied' : ev.error === 'no-speech' ? 'no-speech' : ev.error === 'network' ? 'network' : 'unavailable';
    if (ev.error !== 'aborted') o.onError?.(code);
  };
  rec.onend = () => resolveEnd?.();
  rec.start();
  return {
    async stop() {
      try {
        rec.stop();
      } catch {
        /* not started */
      }
      await Promise.race([ended, new Promise((r) => setTimeout(r, 2500))]);
      return (finalText + interim).trim();
    },
    cancel() {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

async function whisperRecorder(o: ListenOptions): Promise<Listener> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: true, noiseSuppression: true, echoCancellation: true },
    });
  } catch {
    throw Object.assign(new Error('mic-denied'), { code: 'mic-denied' as ListenError });
  }
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const gain = ac.createGain();
  gain.gain.value = o.whisperMode ? 3 : 1; // whisper mode: listen closer
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  const dest = ac.createMediaStreamDestination();
  src.connect(gain);
  gain.connect(analyser);
  gain.connect(dest);
  const levels = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(levels);
    let peak = 0;
    for (const v of levels) peak = Math.max(peak, Math.abs(v - 128));
    o.onLevel?.(peak / 128);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const chunks: Blob[] = [];
  const mr = new MediaRecorder(dest.stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start();
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    void ac.close();
  };
  return {
    async stop() {
      const done = new Promise<void>((r) => (mr.onstop = () => r()));
      if (mr.state !== 'inactive') mr.stop();
      await done;
      cleanup();
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks.length = 0; // drop audio from memory as soon as it's sent
      if (blob.size < 1200) {
        o.onError?.('no-speech');
        return '';
      }
      const text = await transcribe(o.backendUrl, blob);
      if (text === null) {
        o.onError?.('network');
        return '';
      }
      if (!text) o.onError?.('no-speech');
      return text;
    },
    cancel() {
      if (mr.state !== 'inactive') mr.stop();
      chunks.length = 0;
      cleanup();
    },
  };
}

/** Open a full tab to request mic permission (side panels can't reliably show the prompt). */
export function openMicPermissionTab(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
}

export async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return p.state;
  } catch {
    return 'unknown';
  }
}
