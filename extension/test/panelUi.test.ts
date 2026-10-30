import { describe, expect, it } from 'vitest';
import { wakingDayKey } from '@nudge/shared';
import { PANEL_UI_MAX_AGE_MS, isFresh, type PanelUi } from '../src/lib/panelUi';

const ui = (savedAt: number, screen: PanelUi['screen'] = 'step'): PanelUi => ({ screen, resp: null, dump: null, bodyDouble: null, savedAt, day: wakingDayKey(savedAt) });

describe('panel restore', () => {
  it('restores what was on screen within 3 h of the same waking day', () => {
    const now = new Date(2026, 9, 29, 15, 0).getTime();
    expect(isFresh(ui(now - 60_000), now)).toBe(true);
    expect(isFresh(ui(now - PANEL_UI_MAX_AGE_MS - 1), now)).toBe(false);
  });
  it('drops it on a new waking day (05:00), but not at midnight', () => {
    const late = new Date(2026, 9, 29, 23, 50).getTime();
    expect(isFresh(ui(late), new Date(2026, 9, 30, 0, 20).getTime())).toBe(true);
    const beforeFive = new Date(2026, 9, 30, 4, 50).getTime();
    expect(isFresh(ui(beforeFive), new Date(2026, 9, 30, 5, 10).getTime())).toBe(false);
  });
  it('never restores a screen that isn\'t restorable (e.g. safety)', () => {
    expect(isFresh({ ...ui(Date.now()), screen: 'safety' as never })).toBe(false);
  });
});
