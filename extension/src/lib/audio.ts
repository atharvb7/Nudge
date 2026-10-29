// Ambient sound for body-double mode, synthesized with WebAudio — no audio
// files, nothing recorded. Plus an opt-in soft chime for wins.

export type Ambient = 'brown' | 'pink' | 'rain';

let ctx: AudioContext | null = null;
let nodes: AudioNode[] = [];
let master: GainNode | null = null;

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(ac: AudioContext, kind: Ambient): AudioBuffer {
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      // Paul Kellet's pink noise
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  return buf;
}

export function startAmbient(kind: Ambient, volume = 0.25): void {
  stopAmbient();
  const ac = audioCtx();
  master = ac.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(volume, ac.currentTime + 2); // fade in gently
  master.connect(ac.destination);
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, kind);
  src.loop = true;
  let out: AudioNode = src;
  if (kind === 'rain') {
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    src.connect(hp);
    hp.connect(lp);
    out = lp;
    nodes.push(hp, lp);
  }
  out.connect(master);
  src.start();
  nodes.push(src);
}

export function stopAmbient(): void {
  for (const n of nodes) {
    try {
      if (n instanceof AudioBufferSourceNode) n.stop();
      n.disconnect();
    } catch {
      /* already stopped */
    }
  }
  nodes = [];
  master?.disconnect();
  master = null;
}

/** Soft two-note chime (opt-in only). */
export function chime(kind: 'chime' | 'wood' | 'bell' = 'chime'): void {
  const ac = audioCtx();
  const notes = kind === 'wood' ? [520] : kind === 'bell' ? [880, 1320] : [660, 880];
  notes.forEach((f, i) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = kind === 'wood' ? 'triangle' : 'sine';
    o.frequency.value = f;
    const t = ac.currentTime + i * 0.12;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'wood' ? 0.25 : 0.9));
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + 1);
  });
}
