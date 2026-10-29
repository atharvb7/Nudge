import { onDeviceAvailability, speechCtor } from '../lib/speech';

// Optional wake phrase "Nudge, I'm stuck". Runs ONLY with on-device speech
// recognition (processLocally). If the browser can't do that, it does nothing.
// No audio or transcript is stored or sent anywhere.

const WAKE = /\bnudge\b[\s,.!]*(i['’]?m|i am)\s+stuck\b/i;

async function main() {
  if ((await onDeviceAvailability()) !== 'available') return;
  const SR = speechCtor();
  if (!SR) return;
  let lastFire = 0;
  const start = () => {
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.processLocally = true;
    rec.onresult = (ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (WAKE.test(t) && Date.now() - lastFire > 10_000) {
          lastFire = Date.now();
          void chrome.runtime.sendMessage({ kind: 'wakeHeard' });
        }
      }
    };
    rec.onerror = (ev: { error: string }) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'language-not-supported') stopped = true;
    };
    rec.onend = () => {
      if (!stopped) setTimeout(start, 1000); // keep listening, gently
    };
    try {
      rec.start();
    } catch {
      /* already running */
    }
  };
  let stopped = false;
  start();
}

void main();
