import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@nudge/shared/tokens.css';
import '../panel/panel.css';

// A full tab is the reliable place to ask for microphone permission; side
// panels can't always show Chrome's prompt. Audio is not recorded here.

const root = document.getElementById('root')!;
root.innerHTML = `
  <main class="page narrow">
    <h1>Microphone for Nudge</h1>
    <p class="muted">Voice is optional. Audio is turned into text and then dropped — it is never stored.</p>
    <button class="btn primary big" id="ask" type="button">Allow microphone</button>
    <p id="status" class="muted" role="status" aria-live="polite"></p>
  </main>`;
const status = document.getElementById('status')!;
document.getElementById('ask')!.addEventListener('click', async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    status.textContent = 'All set. You can close this tab and go back to Nudge.';
    setTimeout(() => window.close(), 1800);
  } catch {
    status.textContent = 'No problem — buttons work just as well. You can change this any time in Chrome’s site settings.';
  }
});
