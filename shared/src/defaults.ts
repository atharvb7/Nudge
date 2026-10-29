import { freshGuard } from './guard';
import { DEFAULT_SENSITIVITY } from './sensing';
import type { Settings, StorageShape } from './types';

export function defaultSettings(now = Date.now()): Settings {
  return {
    onboarded: false,
    installedAt: now,
    learningDays: 3,
    wordingStyle: 'warm',
    inputStyle: 'voice',
    explainWhy: false,
    taskTab: null,
    tts: { enabled: false, rate: 0.9, voiceURI: null },
    whisperMode: false,
    wakePhrase: false,
    speechEngine: 'auto',
    quietHours: { enabled: false, start: '23:00', end: '08:00' },
    dndUntil: null,
    timeAnchor: false,
    hydrationChip: true,
    bodyDoubleSound: 'off',
    stillHereMessages: true,
    a11y: { font: 'default', textScale: 1, highContrast: false, reducedMotion: 'system' },
    region: 'IN',
    backendUrl: 'http://localhost:8000',
    trackingPaused: false,
    excludedSites: [],
    researchSites: [],
    escapeSites: [],
    sensitivity: { ...DEFAULT_SENSITIVITY },
    demoMode: false,
    theme: 'meadow',
    unlockedThemes: ['meadow'],
    winSounds: false,
  };
}

export function defaultStorage(now = Date.now()): StorageShape {
  return {
    settings: defaultSettings(now),
    baseline: null,
    features: [],
    rawEvents: [],
    inferences: [],
    stats: {},
    wins: [],
    checkins: [],
    plan: [],
    energyToday: null,
    session: null,
    breakState: null,
    guard: freshGuard(now),
    notes: [],
    baselineSamples: [],
  };
}

/** Merge stored partial settings over defaults (handles upgrades adding new fields). */
export function withDefaults(partial: Partial<Settings> | undefined, now = Date.now()): Settings {
  const d = defaultSettings(now);
  if (!partial) return d;
  return {
    ...d,
    ...partial,
    tts: { ...d.tts, ...(partial.tts ?? {}) },
    quietHours: { ...d.quietHours, ...(partial.quietHours ?? {}) },
    a11y: { ...d.a11y, ...(partial.a11y ?? {}) },
    sensitivity: { ...d.sensitivity, ...(partial.sensitivity ?? {}) },
  };
}
