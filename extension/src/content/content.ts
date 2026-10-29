import type { OverlaySpec, ToBackground, ToContent } from '../lib/messages';
import { OVERLAY_CSS } from './overlay-css';

// Runs on every page. It ONLY counts key / scroll / click events (never which
// key, never what was clicked, never page content) and notices fullscreen.
// It also renders Nudge's small, calm overlays in a closed shadow DOM.

(() => {
  // May be injected twice (manifest + on-install injection). After an extension
  // update the old copy is orphaned, so only a *living* copy blocks a new one.
  const w = window as unknown as { __nudgeAlive?: () => boolean };
  if (window.top !== window) return;
  try {
    if (w.__nudgeAlive?.()) return;
  } catch {
    /* orphaned copy from before an update */
  }
  w.__nudgeAlive = () => alive();

  let keys = 0;
  let scrolls = 0;
  let clicks = 0;
  let lastScroll = 0;

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  const send = (msg: ToBackground): Promise<unknown> => {
    if (!alive()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  // counts only — the event object is never read beyond its existence
  addEventListener('keydown', () => void (keys += 1), { capture: true, passive: true });
  addEventListener('pointerdown', () => void (clicks += 1), { capture: true, passive: true });
  addEventListener(
    'scroll',
    () => {
      const now = Date.now();
      if (now - lastScroll > 400) {
        scrolls += 1;
        lastScroll = now;
      }
    },
    { capture: true, passive: true },
  );
  addEventListener('wheel', () => {
    const now = Date.now();
    if (now - lastScroll > 400) {
      scrolls += 1;
      lastScroll = now;
    }
  }, { capture: true, passive: true });

  const flush = () => {
    if (!alive()) {
      clearInterval(timer);
      return;
    }
    if (document.visibilityState !== 'visible') return;
    if (keys + scrolls + clicks === 0) return;
    void send({ kind: 'interact', keys, scrolls, clicks });
    keys = scrolls = clicks = 0;
  };
  const timer = setInterval(flush, 10_000);

  document.addEventListener('fullscreenchange', () => {
    void send({ kind: 'fullscreen', on: !!document.fullscreenElement });
    if (document.fullscreenElement) hideAll();
  });

  // ───────────── overlays ─────────────

  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  const fadeTimers = new Map<string, number>();

  function ensureRoot(): ShadowRoot {
    if (root && host?.isConnected) return root;
    host = document.createElement('nudge-overlay');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; pointer-events: none;';
    root = host.attachShadow({ mode: 'closed' });
    // Constructed stylesheets aren't blocked by strict page CSPs; <style> is the fallback.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(OVERLAY_CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = OVERLAY_CSS;
      root.appendChild(style);
    }
    const stack = document.createElement('div');
    stack.className = 'stack';
    root.appendChild(stack);
    document.documentElement.appendChild(host);
    return root;
  }

  function stack(): HTMLElement {
    return ensureRoot().querySelector('.stack') as HTMLElement;
  }

  function hide(id: string) {
    const el = root?.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.add('leaving');
    window.setTimeout(() => el.remove(), 220);
    const t = fadeTimers.get(id);
    if (t) clearTimeout(t);
    fadeTimers.delete(id);
  }

  function hideAll() {
    root?.querySelectorAll<HTMLElement>('.card').forEach((el) => hide(el.dataset.id!));
  }

  function note(id: string, text: string, closeAfter = 6000) {
    const el = root?.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!el) return;
    const body = el.querySelector('.text') as HTMLElement;
    body.textContent = text;
    el.querySelector('.sub')?.remove();
    el.querySelector('.actions')?.remove();
    window.setTimeout(() => hide(id), closeAfter);
  }

  function enableDrag(card: HTMLElement, handle: HTMLElement) {
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const m = /translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\)/.exec(card.style.transform);
      ox = m ? parseFloat(m[1]) : 0;
      oy = m ? parseFloat(m[2]) : 0;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      card.style.transform = `translate(${ox + e.clientX - sx}px, ${oy + e.clientY - sy}px)`;
    });
    handle.addEventListener('pointerup', () => (dragging = false));
  }

  function render(spec: OverlaySpec) {
    if (document.fullscreenElement) return; // never over fullscreen video / slides
    const s = stack();
    // only one nudge at a time; chips can stack (max 2)
    s.querySelectorAll<HTMLElement>(spec.variant === 'nudge' ? '.card.nudge' : '.card.chip').forEach((el, i, all) => {
      if (spec.variant === 'nudge' || all.length - i >= 2) hide(el.dataset.id!);
    });
    const card = document.createElement('section');
    const d = spec.display;
    card.className = `card ${spec.variant}${d?.reduceMotion ? ' rm' : ''}${d?.highContrast ? ' hc' : ''}${d?.dyslexic ? ' dys' : ''}`;
    if (d?.scale && d.scale !== 1) card.style.fontSize = `${Math.round((spec.variant === 'chip' ? 14 : 15) * d.scale)}px`;
    card.dataset.id = spec.id;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', 'Nudge');

    const head = document.createElement('div');
    head.className = 'head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.className = 'text';
    text.setAttribute('aria-live', 'polite');
    text.textContent = spec.text;
    const tools = document.createElement('div');
    tools.className = 'tools';
    const min = document.createElement('button');
    min.className = 'icon';
    min.type = 'button';
    min.setAttribute('aria-label', 'Minimise');
    min.title = 'Minimise';
    min.textContent = '–';
    min.addEventListener('click', () => {
      const isMin = card.classList.toggle('min');
      min.setAttribute('aria-label', isMin ? 'Expand' : 'Minimise');
      min.setAttribute('aria-expanded', String(!isMin));
    });
    const close = document.createElement('button');
    close.className = 'icon';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close (Esc)';
    close.textContent = '×';
    close.addEventListener('click', () => {
      // Closing a stuck nudge is read as "I'm fine": Nudge backs off (longer
      // quiet time, and after 3 it rests until tomorrow). That's not a penalty —
      // it's Nudge listening. Any kind follow-up note still gets shown.
      if (spec.variant === 'nudge' && spec.buttons.some((b) => b.id === 'fine')) void act('fine');
      else hide(spec.id);
    });
    tools.append(min, close);
    head.append(dot, text, tools);
    card.appendChild(head);

    if (spec.sub) {
      const sub = document.createElement('p');
      sub.className = 'sub';
      sub.textContent = spec.sub;
      card.appendChild(sub);
    }

    const actions = document.createElement('div');
    actions.className = 'actions' + (spec.buttons.length > 3 ? ' many' : '');
    async function act(id: OverlaySpec['buttons'][number]['id'], value?: number) {
      const res = (await send({ kind: 'overlayAction', overlayId: spec.id, action: id, value: value as 1 | 2 | 3 | 4 | 5 | undefined })) as {
        note?: string;
        opened?: boolean;
      } | null;
      if (res?.note) note(spec.id, res.note, res.opened === false ? 9000 : 6000);
      else hide(spec.id);
    }
    for (const b of spec.buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.primary ? 'btn primary' : 'btn';
      btn.textContent = b.label;
      if (b.aria) btn.setAttribute('aria-label', b.aria);
      btn.addEventListener('click', () => void act(b.id, b.value));
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close.click();
    });
    enableDrag(card, head);
    s.appendChild(card);
    if (spec.autoFadeMs) fadeTimers.set(spec.id, window.setTimeout(() => hide(spec.id), spec.autoFadeMs));
  }

  chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
    if (msg.kind === 'showOverlay') render(msg.spec);
    else if (msg.kind === 'overlayNote') note(msg.overlayId, msg.text);
    else if (msg.kind === 'hideOverlay') (msg.overlayId ? hide(msg.overlayId) : hideAll());
    sendResponse({ ok: true });
  });
})();
