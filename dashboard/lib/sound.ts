// Tiny synthesized sounds — no audio files, nothing downloaded. Only ever
// played on an explicit tap (never autoplay).

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx ?? new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, peak = 0.12) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

export function playWinSound(id: string): void {
  const ac = audio();
  if (!ac) return;
  void ac.resume();
  const t = ac.currentTime + 0.01;
  if (id === 'wood') {
    tone(ac, 520, t, 0.18, 'triangle', 0.18);
    tone(ac, 780, t + 0.09, 0.16, 'triangle', 0.12);
  } else if (id === 'bell') {
    tone(ac, 1046, t, 1.2, 'sine', 0.08);
    tone(ac, 1568, t, 0.9, 'sine', 0.04);
  } else {
    tone(ac, 660, t, 0.6, 'sine', 0.1);
    tone(ac, 880, t + 0.12, 0.7, 'sine', 0.08);
  }
}
