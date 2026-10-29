import { DASHBOARD_ORIGINS, DASHBOARD_SOURCE, EXTENSION_SOURCE, type BridgeEnvelope, type BridgeReply } from '@nudge/shared';

// Dashboard bridge. Injected ONLY on the local dashboard (localhost:3000).
// Relays window.postMessage ⇄ service worker so the dashboard can read and
// edit your on-device data. Nothing leaves your computer.

(() => {
  if (!DASHBOARD_ORIGINS.includes(location.origin)) return;
  const version = chrome.runtime.getManifest().version;

  const post = (msg: BridgeReply) => window.postMessage(msg, location.origin);

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Partial<BridgeEnvelope> | null;
    if (!data || data.source !== DASHBOARD_SOURCE || typeof data.id !== 'string' || !data.request) return;
    if ((data.request as { type?: string }).type === 'ping') {
      post({ source: EXTENSION_SOURCE, type: 'hello', version });
      return;
    }
    chrome.runtime
      .sendMessage({ kind: 'bridge', request: data.request })
      .then((res) => {
        if (res && typeof res === 'object' && 'ok' in res && res.ok === false && 'error' in res) {
          post({ source: EXTENSION_SOURCE, id: data.id, type: 'reply', ok: false, error: String((res as { error: unknown }).error) });
        } else post({ source: EXTENSION_SOURCE, id: data.id, type: 'reply', ok: true, data: res });
      })
      .catch((e: unknown) => post({ source: EXTENSION_SOURCE, id: data.id, type: 'reply', ok: false, error: String(e) }));
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') post({ source: EXTENSION_SOURCE, type: 'changed' });
  });

  post({ source: EXTENSION_SOURCE, type: 'hello', version });
  // in case the dashboard's listener attached after us
  window.addEventListener('DOMContentLoaded', () => post({ source: EXTENSION_SOURCE, type: 'hello', version }));
  window.addEventListener('load', () => post({ source: EXTENSION_SOURCE, type: 'hello', version }));
})();
