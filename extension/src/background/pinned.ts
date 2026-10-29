import type { Settings } from '@nudge/shared';

// The pinned "task tab" — the only tab whose title Nudge ever keeps, because
// the user chose it. Pure helpers so the edge cases are testable.

export type Pinned = Settings['taskTab'];

/**
 * Is this tab the task? The pinned tab counts while it stays on its site; if it
 * was closed (tabId null) the same site counts, so reopening the file just works.
 * A pinned tab that navigated somewhere else (e.g. to instagram.com) is not the task.
 */
export function isTaskTab(pinned: Pinned, tabId: number, host: string): boolean {
  if (!pinned || !host || host === 'excluded') return false;
  if (pinned.host) return host === pinned.host;
  return pinned.tabId !== null && pinned.tabId === tabId;
}

/** Keep the pinned title fresh (e.g. a renamed Google Doc) — but only while it's still on its site. */
export function refreshPinned(pinned: Pinned, tabId: number, host: string, title: string | undefined): Pinned {
  if (!pinned || pinned.tabId !== tabId || !title) return pinned;
  if (pinned.host && host && host !== pinned.host) return pinned;
  if (title === pinned.title) return pinned;
  return { ...pinned, title };
}

/** The pinned tab was closed and the same site was opened again: adopt the new tab. */
export function adoptPinned(pinned: Pinned, tabId: number, host: string, title: string | undefined): Pinned {
  if (!pinned || pinned.tabId !== null || !pinned.host || host !== pinned.host) return pinned;
  return { ...pinned, tabId, title: title || pinned.title };
}

export function forgetClosedTab(pinned: Pinned, tabId: number): Pinned {
  return pinned && pinned.tabId === tabId ? { ...pinned, tabId: null } : pinned;
}
