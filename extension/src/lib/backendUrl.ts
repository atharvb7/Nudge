// The backend URL decides where your words go, so it is checked carefully.

const LOCAL_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|[\w-]+\.local)$/i;

/** "localhost:8000" → "http://localhost:8000". Returns null for anything that isn't http(s). */
export function normalizeBackendUrl(raw: string): string | null {
  let v = (raw || '').trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'http://' + v;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Is this backend on the user's own machine (or local network name)? */
export function isLocalBackend(url: string): boolean {
  try {
    return LOCAL_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
