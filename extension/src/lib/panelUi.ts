import { wakingDayKey, type BrainDumpResponse, type SequenceResponse } from '@nudge/shared';

// What the side panel was showing, so closing and reopening it (or the hotkey)
// never throws away a step or a running body-double timer. Never holds the
// safety screen or anything typed there. Dropped after 3 h or on a new waking day.

export type RestorableScreen = 'step' | 'celebrate' | 'bodydouble' | 'braindump';
export const RESTORABLE: RestorableScreen[] = ['step', 'celebrate', 'bodydouble', 'braindump'];

export interface PanelUi {
  screen: RestorableScreen;
  resp: (SequenceResponse & { offline: boolean }) | null;
  bodyDouble: { minutes: number; startedAt: number } | null;
  dump: (BrainDumpResponse & { offline: boolean }) | null;
  savedAt: number;
  day: string;
}

const KEY = 'panelUi';
export const PANEL_UI_MAX_AGE_MS = 3 * 3_600_000;

export function isFresh(ui: PanelUi | null | undefined, now = Date.now()): ui is PanelUi {
  return !!ui && RESTORABLE.includes(ui.screen) && now - ui.savedAt < PANEL_UI_MAX_AGE_MS && ui.day === wakingDayKey(now);
}

export async function loadPanelUi(now = Date.now()): Promise<PanelUi | null> {
  try {
    const got = (await chrome.storage.local.get(KEY))[KEY] as PanelUi | undefined;
    if (isFresh(got, now)) return got;
    if (got) await chrome.storage.local.remove(KEY);
  } catch {
    /* storage unavailable: start fresh */
  }
  return null;
}

export async function savePanelUi(ui: Omit<PanelUi, 'savedAt' | 'day'> | null): Promise<void> {
  try {
    if (!ui) await chrome.storage.local.remove(KEY);
    else await chrome.storage.local.set({ [KEY]: { ...ui, savedAt: Date.now(), day: wakingDayKey() } });
  } catch {
    /* best effort */
  }
}
