import { describe, expect, it } from 'vitest';
import { adoptPinned, forgetClosedTab, isTaskTab, refreshPinned } from '../src/background/pinned';
import { isLocalBackend, normalizeBackendUrl } from '../src/lib/backendUrl';
import { stuckNudge, depletedNudge, restuckChip, longBreakChip, hydrationChip, checkinChip, wakeNudge, timeAnchorChip } from '../src/background/overlays';
import { findBannedWords } from '@nudge/shared';

const pinned = { tabId: 7, host: 'docs.google.com', title: 'DBMS notes' };

describe('pinned task tab', () => {
  it('counts the pinned tab only while it stays on its site', () => {
    expect(isTaskTab(pinned, 7, 'docs.google.com')).toBe(true);
    expect(isTaskTab(pinned, 7, 'instagram.com')).toBe(false); // navigated away
    expect(isTaskTab(pinned, 9, 'docs.google.com')).toBe(true); // same site in another tab
    expect(isTaskTab(null, 7, 'docs.google.com')).toBe(false);
    expect(isTaskTab(pinned, 7, 'excluded')).toBe(false);
  });
  it('keeps the title fresh, but never takes the title of a site it navigated to', () => {
    expect(refreshPinned(pinned, 7, 'docs.google.com', 'DBMS notes v2')?.title).toBe('DBMS notes v2');
    expect(refreshPinned(pinned, 7, 'instagram.com', 'Instagram')).toBe(pinned);
    expect(refreshPinned(pinned, 8, 'docs.google.com', 'Other doc')).toBe(pinned);
  });
  it('closed then reopened: the new tab is adopted', () => {
    const closed = forgetClosedTab(pinned, 7);
    expect(closed?.tabId).toBeNull();
    expect(isTaskTab(closed, 12, 'docs.google.com')).toBe(true);
    expect(adoptPinned(closed, 12, 'docs.google.com', 'DBMS notes')?.tabId).toBe(12);
    expect(adoptPinned(closed, 12, 'reddit.com', 'r/all')).toBe(closed);
    expect(forgetClosedTab(pinned, 99)).toBe(pinned);
  });
});

describe('backend address', () => {
  it('normalizes and rejects non-web addresses', () => {
    expect(normalizeBackendUrl('localhost:8000')).toBe('http://localhost:8000');
    expect(normalizeBackendUrl(' http://127.0.0.1:8000/ ')).toBe('http://127.0.0.1:8000');
    expect(normalizeBackendUrl('https://nudge.example.com/api/')).toBe('https://nudge.example.com/api');
    expect(normalizeBackendUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBackendUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeBackendUrl('')).toBeNull();
    expect(normalizeBackendUrl('http://')).toBeNull();
  });
  it('knows which addresses keep words on this computer', () => {
    expect(isLocalBackend('http://localhost:8000')).toBe(true);
    expect(isLocalBackend('http://127.0.0.1:8000')).toBe(true);
    expect(isLocalBackend('http://my-laptop.local:8000')).toBe(true);
    expect(isLocalBackend('https://nudge.example.com')).toBe(false);
  });
});

describe('overlay copy', () => {
  it('every overlay is gentle in both wording styles', () => {
    for (const style of ['warm', 'literal'] as const) {
      const all = [stuckNudge(style), depletedNudge(style), restuckChip(style), longBreakChip(style), hydrationChip(style), checkinChip(style), wakeNudge(style), timeAnchorChip(30)];
      for (const o of all) {
        expect(findBannedWords(JSON.stringify(o))).toEqual([]);
        expect(o.buttons.length).toBeGreaterThan(0);
        expect(o.text.length).toBeLessThan(110); // short
      }
    }
  });
});
