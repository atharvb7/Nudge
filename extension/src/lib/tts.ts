// Text-to-speech: off by default and never auto-plays. Only runs when the user
// presses "Read aloud". Prefers on-device voices (localService).

export function ttsAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined';
}

export function calmVoices(): SpeechSynthesisVoice[] {
  if (!ttsAvailable()) return [];
  const all = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  return [...all.filter((v) => v.localService), ...all.filter((v) => !v.localService)];
}

export function speak(text: string, rate = 0.9, voiceURI: string | null = null): void {
  if (!ttsAvailable() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = Math.min(1.4, Math.max(0.6, rate));
  u.pitch = 0.95;
  const voices = calmVoices();
  const v = voices.find((x) => x.voiceURI === voiceURI) ?? voices[0];
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (ttsAvailable()) speechSynthesis.cancel();
}
