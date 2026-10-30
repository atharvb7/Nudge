import { DASHBOARD_ORIGINS, DASHBOARD_SOURCE, EXTENSION_SOURCE, type BridgeEnvelope, type BridgeReply } from '@nudge/shared';

// Dashboard bridge. Injected ONLY on the local dashboard (localhost:3000).
// Relays window.postMessage ⇄ service worker so the dashboard can read and
// edit your on-device data. Nothing leaves your computer.

(() => {
  if (!DASHBOARD_ORIGINS.includes(location.origin)) return;

  // After the extension is reloaded or updated this copy is orphaned: chrome.*
  // calls then throw synchronously ("Extension context invalidated").
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  if (!alive()) return;
  const version = chrome.runtime.getManifest().version;

  const post = (msg: BridgeReply) => window.postMessage(msg, location.origin);

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Partial<BridgeEnvelope> | null;
    if (!data || data.source !== DASHBOARD_SOURCE || typeof data.id !== 'string' || !data.request) return;
    const id = data.id;
    if (!alive()) {
      // tell the dashboard so it can show its gentle "reload" banner, then stop listening
      window.removeEventListener('message', onMessage);
      post({ source: EXTENSION_SOURCE, id, type: 'reply', ok: false, error: 'extension-reloaded' });
      return;
    }
    if ((data.request as { type?: string }).type === 'ping') {
      post({ source: EXTENSION_SOURCE, type: 'hello', version });
      return;
    }
    let pending: Promise<unknown>;
    try {
      pending = chrome.runtime.sendMessage({ kind: 'bridge', request: data.request });
    } catch {
      window.removeEventListener('message', onMessage);
      post({ source: EXTENSION_SOURCE, id, type: 'reply', ok: false, error: 'extension-reloaded' });
      return;
    }
    pending
      .then((res) => {
        if (res && typeof res === 'object' && 'ok' in res && res.ok === false && 'error' in res) {
          post({ source: EXTENSION_SOURCE, id, type: 'reply', ok: false, error: String((res as { error: unknown }).error) });
        } else post({ source: EXTENSION_SOURCE, id, type: 'reply', ok: true, data: res });
      })
      .catch((e: unknown) => post({ source: EXTENSION_SOURCE, id, type: 'reply', ok: false, error: alive() ? String(e) : 'extension-reloaded' }));
  };
  window.addEventListener('message', onMessage);

  try {
    const onChanged = (_changes: unknown, area: string) => {
      if (!alive()) {
        try {
          chrome.storage.onChanged.removeListener(onChanged);
        } catch {
          /* already gone */
        }
        return;
      }
      if (area === 'local') post({ source: EXTENSION_SOURCE, type: 'changed' });
    };
    chrome.storage.onChanged.addListener(onChanged);
  } catch {
    /* context gone before we could listen */
  }

  const hello = () => alive() && post({ source: EXTENSION_SOURCE, type: 'hello', version });
  hello();
  // in case the dashboard's listener attached after us
  window.addEventListener('DOMContentLoaded', hello);
  window.addEventListener('load', hello);
})();
