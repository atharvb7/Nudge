import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@nudge/shared';
import { detectEngine, installOnDevice, openMicPermissionTab, startListening, type EngineStatus, type Listener, type ListenError } from '../../lib/speech';
import { MicIcon } from './ui';

const ERR_TEXT: Record<ListenError, string> = {
  'mic-denied': 'I need microphone permission once.',
  'no-speech': "I didn't catch that — no rush. Try again, or type, or tap a button.",
  unavailable: 'Voice isn’t available right now — buttons work just as well.',
  network: 'The local voice helper isn’t answering. Typing or buttons work just as well.',
};

/**
 * Push-to-talk. Press and hold to talk, or tap once to start and tap again to
 * stop (easier for many hands). Space / Enter work when focused. No audio is stored.
 */
export function MicButton({ settings, onText, prompt }: { settings: Settings; onText: (t: string) => void; prompt?: string }) {
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<ListenError | null>(null);
  const [busy, setBusy] = useState(false);
  const listener = useRef<Listener | null>(null);
  const pressAt = useRef(0);
  const toggleMode = useRef(false);

  useEffect(() => {
    let alive = true;
    void detectEngine(settings).then((e) => alive && setEngine(e));
    return () => {
      alive = false;
      listener.current?.cancel();
    };
  }, [settings.speechEngine, settings.backendUrl]);

  async function start() {
    if (!engine || engine.engine === 'none' || listening) return;
    setError(null);
    setInterim('');
    try {
      listener.current = await startListening({
        engine: engine.engine,
        whisperMode: settings.whisperMode,
        backendUrl: settings.backendUrl,
        onInterim: setInterim,
        onLevel: setLevel,
        onError: (e) => {
          setError(e);
          if (e === 'mic-denied') {
            setListening(false);
            listener.current = null;
          }
        },
      });
      setListening(true);
    } catch (e) {
      const code = (e as { code?: ListenError }).code ?? 'unavailable';
      setError(code);
    }
  }

  async function stop() {
    const l = listener.current;
    listener.current = null;
    setListening(false);
    setLevel(0);
    if (!l) return;
    setBusy(true);
    const text = (await l.stop()).trim();
    setBusy(false);
    setInterim('');
    if (text) onText(text);
  }

  const onPointerDown = () => {
    pressAt.current = Date.now();
    if (listening) return; // second tap stops (handled in pointerup)
    toggleMode.current = false;
    void start();
  };
  const onPointerUp = () => {
    const held = Date.now() - pressAt.current;
    if (!listening && !listener.current) return;
    if (held < 350 && !toggleMode.current) {
      toggleMode.current = true; // quick tap → keep listening until tapped again
      return;
    }
    void stop();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (listening) void stop();
      else {
        toggleMode.current = true;
        void start();
      }
    }
  };

  if (!engine) return <p className="mic-hint">Checking voice…</p>;

  if (engine.engine === 'none') {
    return (
      <div className="mic-wrap">
        <p className="mic-hint">{engine.label}</p>
        {engine.downloadable && (
          <button
            type="button"
            className="btn soft"
            onClick={async () => {
              setBusy(true);
              const ok = await installOnDevice();
              setBusy(false);
              if (ok) setEngine(await detectEngine(settings));
            }}
            disabled={busy}
          >
            {busy ? 'Downloading voice pack…' : 'Set up private on-device voice'}
          </button>
        )}
      </div>
    );
  }

  const hint = listening
    ? settings.whisperMode
      ? 'Speak softly — I’m listening closely. Tap again when done.'
      : 'Listening… tap again (or let go) when you’re done.'
    : busy
      ? 'Turning that into words…'
      : prompt ?? 'Hold to talk, or tap once to start.';

  return (
    <div className="mic-wrap">
      <button
        type="button"
        className="mic"
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Talk to Nudge'}
        style={{ ['--level' as string]: Math.min(1, level * 3) }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => listening && !toggleMode.current && void stop()}
        onKeyDown={onKey}
        disabled={busy}
      >
        <MicIcon />
      </button>
      <p className="mic-hint" aria-live="polite">
        {hint}
      </p>
      {interim && <p className="transcript">“{interim}”</p>}
      {error && (
        <div className="stack center" role="status">
          <p className="mic-hint">{ERR_TEXT[error]}</p>
          {error === 'mic-denied' && (
            <button type="button" className="btn soft" onClick={openMicPermissionTab}>
              Allow microphone
            </button>
          )}
        </div>
      )}
      <p className="small muted center" style={{ margin: 0 }}>
        {engine.engine === 'chrome-cloud' ? '☁️ ' : '🔒 '}
        {engine.label}
      </p>
    </div>
  );
}
