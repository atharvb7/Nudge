import type { Settings } from '@nudge/shared';

/** Apply accessibility + theme settings as data-* attributes (see shared tokens.css). */
export function applyDisplaySettings(s: Settings, root: HTMLElement = document.documentElement): void {
  root.dataset.font = s.a11y.font;
  root.dataset.contrast = s.a11y.highContrast ? 'high' : 'normal';
  // settings.reducedMotion 'on' = reduce motion → tokens data-motion="off"
  if (s.a11y.reducedMotion === 'system') delete root.dataset.motion;
  else root.dataset.motion = s.a11y.reducedMotion === 'on' ? 'off' : 'on';
  root.dataset.accent = s.theme;
  root.style.setProperty('--n-text-scale', String(s.a11y.textScale));
}

export function prefersReducedMotion(s: Settings): boolean {
  if (s.a11y.reducedMotion === 'on') return true;
  if (s.a11y.reducedMotion === 'off') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
