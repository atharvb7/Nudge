// Styles for the in-page overlay (closed shadow DOM, so page CSS can't leak in
// and ours can't leak out). Calm, muted, no red, no sound, respects reduced motion.
export const OVERLAY_CSS = `
:host { all: initial; }
.stack {
  display: flex; flex-direction: column; gap: 10px; align-items: flex-end;
  font-family: 'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --bg: #ffffff; --text: #2d3833; --muted: #5f6b65; --border: #dedbd2;
  --accent: #4f7d66; --accent-soft: #e4efe8; --accent-text: #ffffff; --focus: #3b6fb0;
}
@media (prefers-color-scheme: dark) {
  .stack { --bg: #222826; --text: #e5ebe7; --muted: #a9b5ae; --border: #38413d;
    --accent: #86b79d; --accent-soft: #2b3b33; --accent-text: #12241a; --focus: #8fb7ee; }
}
@media (prefers-contrast: more) {
  .stack { --border: #1a1a1a; --muted: #262626; --text: #000; --bg: #fff; --accent: #1f5a3e; }
}
.card {
  pointer-events: auto;
  box-sizing: border-box;
  width: min(320px, calc(100vw - 32px));
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 16px;
  box-shadow: 0 1px 2px rgba(30,40,35,.06), 0 8px 28px rgba(30,40,35,.12);
  padding: 14px 14px 12px;
  font-size: 15px; line-height: 1.45;
  animation: in .28s ease-out;
}
.card.chip { width: min(300px, calc(100vw - 32px)); padding: 10px 12px; font-size: 14px; }
.card.leaving { opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
.head { display: flex; align-items: flex-start; gap: 10px; cursor: grab; touch-action: none; }
.dot { flex: none; width: 10px; height: 10px; margin-top: 6px; border-radius: 50%; background: var(--accent); opacity: .85; }
.text { margin: 0; flex: 1; font-weight: 600; letter-spacing: .005em; }
.chip .text { font-weight: 500; }
.sub { margin: 4px 0 0 20px; color: var(--muted); font-size: 13px; }
.tools { display: flex; gap: 2px; margin: -4px -6px 0 0; }
.icon {
  all: unset; box-sizing: border-box; width: 40px; height: 40px; border-radius: 10px;
  display: grid; place-items: center; color: var(--muted); font-size: 18px; cursor: pointer;
}
.icon:hover { background: var(--accent-soft); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.btn {
  all: unset; box-sizing: border-box; cursor: pointer;
  min-height: 48px; padding: 10px 14px; border-radius: 12px;
  background: var(--accent-soft); color: var(--text);
  font: inherit; font-size: 14px; font-weight: 600; text-align: center;
  flex: 1 1 auto;
}
.btn:hover { filter: brightness(.97); }
.btn.primary { background: var(--accent); color: var(--accent-text); }
.actions.many .btn { flex: 1 1 40%; font-weight: 500; }
.btn:focus-visible, .icon:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.card.min .actions, .card.min .sub { display: none; }
.card.min { width: auto; max-width: 240px; }
.card.min .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.card.rm, .card.rm.leaving { animation: none; transition: none; }
.card.hc { --border: #1a1a1a; --muted: #262626; --text: #000; --bg: #fff; --accent: #1f5a3e; --accent-soft: #dff0e6; border-width: 2px; }
.card.dys { letter-spacing: .02em; word-spacing: .08em; }
@media (max-height: 420px) { .card { max-height: calc(100vh - 32px); overflow: auto; } }
@keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
  .card.leaving { transition: none; }
}
`;
