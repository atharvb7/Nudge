export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Local calendar day key, e.g. "2026-10-29". */
export function dayKey(t: number = Date.now()): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Small deterministic PRNG (mulberry32) so tests and demo data are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "22:30" -> minutes since midnight */
export function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

export function isWithinQuietHours(t: number, start: string, end: string): boolean {
  const d = new Date(t);
  const now = d.getHours() * 60 + d.getMinutes();
  const s = hhmmToMin(start);
  const e = hhmmToMin(end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e; // wraps midnight
}

export function hostOf(url: string | undefined | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'local-file';
    if (u.protocol === 'chrome-extension:') return 'extension';
    if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'about:') return 'browser';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
