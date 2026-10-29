import type { BridgeRequest, CheckIn, SimulateKind } from '@nudge/shared';

// Messages between content scripts, the side panel, the offscreen document and
// the service worker. Content scripts only ever send *counts*, never values.

export type OverlayActionId =
  | 'help'
  | 'break'
  | 'fine'
  | 'still_going'
  | 'stuck_again'
  | 'taking_break'
  | 'come_back'
  | 'call_it_day'
  | 'checkin'
  | 'dismiss'
  | 'open_panel';

export type ToBackground =
  | { kind: 'interact'; keys: number; scrolls: number; clicks: number }
  | { kind: 'fullscreen'; on: boolean }
  | { kind: 'overlayAction'; overlayId: string; action: OverlayActionId; value?: CheckIn['feeling'] }
  | { kind: 'bridge'; request: BridgeRequest }
  | { kind: 'stepStarted'; index: number }
  | { kind: 'stepEnded' }
  | { kind: 'simulate'; sim: SimulateKind }
  | { kind: 'wakeHeard' }
  | { kind: 'syncWake' }
  | { kind: 'guardDayClosed' }
  | { kind: 'newSession' }
  | { kind: 'panelHeartbeat' }
  | { kind: 'pinTab'; tabId: number | null }
  | { kind: 'listTabs' };

export interface OverlayButton {
  id: OverlayActionId;
  label: string;
  value?: number;
  primary?: boolean;
  aria?: string;
}

export interface OverlaySpec {
  id: string;
  variant: 'nudge' | 'chip';
  text: string;
  sub?: string;
  buttons: OverlayButton[];
  autoFadeMs?: number;
  /** follow-up text shown in place after a button press (e.g. kind "off for today") */
  closeNote?: string;
}

export type ToContent =
  | { kind: 'showOverlay'; spec: OverlaySpec }
  | { kind: 'overlayNote'; overlayId: string; text: string }
  | { kind: 'hideOverlay'; overlayId?: string }
  | { kind: 'ping' };

export interface TabInfo {
  id: number;
  title: string;
  host: string;
  active: boolean;
}

export function sendToBackground<T = unknown>(msg: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
