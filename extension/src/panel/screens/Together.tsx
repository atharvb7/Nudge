import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COPY,
  REST_IDEAS,
  STILL_HERE,
  TRUSTED_PERSON_LINE,
  pick,
  type BrainDumpResponse,
  type BreakState,
  type FutureNote,
  type SafetyPayload,
  type Settings,
} from '@nudge/shared';
import { RingTimer, Loading } from '../components/ui';
import { MicButton } from '../components/MicButton';
import { startAmbient, stopAmbient } from '../../lib/audio';

// ───────────── Body-double mode ─────────────

export function BodyDouble({
  settings,
  step,
  initialMinutes = 15,
  initialStartedAt,
  onTimerChange,
  onDone,
  onStuckAgain,
  onStop,
  onSound,
}: {
  settings: Settings;
  step: string | null;
  initialMinutes?: number;
  /** when the timer started — kept across panel close/reopen so time keeps running */
  initialStartedAt?: number;
  onTimerChange?: (minutes: number, startedAt: number) => void;
  onDone: () => void;
  onStuckAgain: () => void;
  onStop: () => void;
  onSound: (s: Settings['bodyDoubleSound']) => void;
}) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [startedAt, setStartedAt] = useState(initialStartedAt ?? Date.now());
  useEffect(() => {
    onTimerChange?.(minutes, startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, startedAt]);
  const [numbers, setNumbers] = useState(false);
  const [line, setLine] = useState(STILL_HERE[0]);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (settings.bodyDoubleSound !== 'off') startAmbient(settings.bodyDoubleSound);
    else stopAmbient();
    return () => stopAmbient();
  }, [settings.bodyDoubleSound]);

  useEffect(() => {
    if (!settings.stillHereMessages) return;
    let i = 1;
    const t = setInterval(() => setLine(pick(STILL_HERE, i++)), 8 * 60_000);
    return () => clearInterval(t);
  }, [settings.stillHereMessages]);

  const onTimerDone = useCallback(() => setFinished(true), []);

  return (
    <div className="stack fade-in center">
      <h1>Here with you</h1>
      {step && <p className="muted">{step}</p>}
      <RingTimer totalMs={minutes * 60_000} startedAt={startedAt} showNumbers={numbers} label="Body-double timer" onDone={onTimerDone} />
      {settings.stillHereMessages && (
        <p aria-live="polite" className="muted">
          {finished ? 'Timer’s done. You stayed with it — that’s real.' : line}
        </p>
      )}
      <div className="chips" style={{ justifyContent: 'center' }} role="radiogroup" aria-label="Timer length">
        {Array.from(new Set([initialMinutes, 10, 15, 25])).sort((a, b) => a - b).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            className="chip-btn"
            aria-checked={m === minutes}
            aria-pressed={m === minutes}
            onClick={() => {
              setMinutes(m);
              setStartedAt(Date.now());
              setFinished(false);
            }}
          >
            {m < 10 ? 'tiny' : m === 10 ? 'short' : m === 15 ? 'medium' : 'long'}
          </button>
        ))}
        <button type="button" className="chip-btn" aria-pressed={numbers} onClick={() => setNumbers(!numbers)}>
          {numbers ? 'Hide numbers' : 'Show numbers'}
        </button>
      </div>
      <div className="field" style={{ textAlign: 'left' }}>
        <label htmlFor="bd-sound">Background sound</label>
        <select id="bd-sound" className="input" value={settings.bodyDoubleSound} onChange={(e) => onSound(e.target.value as Settings['bodyDoubleSound'])}>
          <option value="off">Silence</option>
          <option value="brown">Brown noise (deep, soft)</option>
          <option value="pink">Pink noise (gentle)</option>
          <option value="rain">Rain-ish</option>
        </select>
      </div>
      <div className="stack">
        <button type="button" className="btn primary big" onClick={onDone}>
          I did it
        </button>
        <button type="button" className="btn soft" onClick={onStuckAgain}>
          Stuck again
        </button>
        <button type="button" className="btn ghost" onClick={onStop}>
          Stop for now
        </button>
      </div>
    </div>
  );
}

// ───────────── Brain dump ─────────────

export function BrainDump({
  settings,
  loading,
  result,
  onSubmit,
  onStartWith,
  onRest,
}: {
  settings: Settings;
  loading: boolean;
  result: (BrainDumpResponse & { offline: boolean }) | null;
  onSubmit: (text: string) => void;
  onStartWith: (item: string) => void;
  onRest?: () => void;
}) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const pickItem = chosen ?? result?.pick?.item ?? null;

  if (loading) return <Loading text="Sorting it gently…" />;

  if (result && result.pick) {
    const others = Array.from(new Set([result.pick.item, ...result.alternatives])).filter((x) => x !== pickItem).slice(0, 3);
    const total = result.groups.reduce((a, g) => a + g.items.length, 0);
    const validation = (result as { validation?: string | null }).validation;
    return (
      <div className="stack fade-in">
        {validation && <p className="validation">{validation}</p>}
        <section className="card soft" aria-live="polite">
          <p className="small muted" style={{ marginBottom: 4 }}>
            Just one to start with:
          </p>
          <h2>{pickItem}</h2>
          {!chosen && <p className="muted">{result.pick.why}</p>}
          <button type="button" className="btn primary big block" onClick={() => pickItem && onStartWith(pickItem)}>
            Start with this
          </button>
        </section>
        {others.length > 0 && (
          <>
            <p className="section-title">Or swap for</p>
            <div className="chips">
              {others.map((o) => (
                <button key={o} type="button" className="chip-btn" onClick={() => setChosen(o)} title={o}>
                  {o}
                </button>
              ))}
            </div>
          </>
        )}
        <details className="card disclosure">
          <summary>See everything I heard ({total})</summary>
          {result.groups.map((g) => (
            <section key={g.label} className="stack" style={{ gap: 4, marginTop: 10 }}>
              <h3 style={{ margin: 0 }}>{g.label}</h3>
              <ul className="list" style={{ gap: 4 }}>
                {g.items.map((i) => (
                  <li key={i} style={{ padding: '8px 12px' }}>
                    {i}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>All of it is saved for later. Nothing has to happen today.</p>
        </details>
        {onRest && (
          <button type="button" className="link" onClick={onRest}>
            Rest instead
          </button>
        )}
        {result.offline && <p className="small muted">Sorted on this device.</p>}
      </div>
    );
  }

  return (
    <div className="stack fade-in">
      <h1>Brain dump</h1>
      <p className="muted">Let it all out — messy is perfect. I’ll group it and pick just one thing to start.</p>
      {settings.inputStyle === 'voice' && (
        <MicButton settings={settings} prompt="Hold to talk, or tap once. Ramble as long as you like." onText={(t) => setText((x) => (x ? x + '. ' : '') + t)} />
      )}
      <div className="field">
        <label htmlFor="dump">Everything on your mind</label>
        <textarea id="dump" className="input" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="DBMS assignment, email prof, laundry, pay mess fees…" />
      </div>
      {result && !result.pick && <p className="muted">I couldn’t find separate things in that — want to add a few more words?</p>}
      <button type="button" className="btn primary big" disabled={!text.trim()} onClick={() => onSubmit(text)}>
        Sort it for me
      </button>
      {onRest && (
        <button type="button" className="link" onClick={onRest}>
          Rest instead
        </button>
      )}
    </div>
  );
}

// ───────────── Rest ─────────────

export function RestChoose({ settings, onChoose }: { settings: Settings; onChoose: (m: 5 | 15 | 'day') => void }) {
  const copy = COPY[settings.wordingStyle];
  return (
    <div className="stack fade-in">
      <h1>{copy.breakQ}</h1>
      <p className="muted">Rest is part of the work. Your task is saved for later.</p>
      <button type="button" className="btn soft big" onClick={() => onChoose(5)}>
        5 min
      </button>
      <button type="button" className="btn soft big" onClick={() => onChoose(15)}>
        15 min
      </button>
      <button type="button" className="btn calm big" onClick={() => onChoose('day')}>
        Done for today
      </button>
    </div>
  );
}

export function Resting({
  settings,
  breakState,
  onBack,
  onMore,
  onDayDone,
}: {
  settings: Settings;
  breakState: BreakState;
  onBack: () => void;
  onMore: () => void;
  onDayDone: () => void;
}) {
  const [over, setOver] = useState(Date.now() - breakState.startedAt >= breakState.plannedMin * 60_000);
  const [picked, setPicked] = useState<string | null>(null);
  const done = useCallback(() => setOver(true), []);
  useEffect(() => setOver(Date.now() - breakState.startedAt >= breakState.plannedMin * 60_000), [breakState]);
  return (
    <div className="stack fade-in center">
      <h1>{over ? 'Break’s done whenever you are' : 'Resting'}</h1>
      <RingTimer totalMs={breakState.plannedMin * 60_000} startedAt={breakState.startedAt} showNumbers={false} label="Break timer" onDone={done} />
      {!over && <p className="muted">Nothing to do here. If you like, something restorative:</p>}
      {!over && (
        <div className="chips" style={{ justifyContent: 'center' }}>
          {REST_IDEAS.map((r) => (
            <button key={r.id} type="button" className="chip-btn" aria-pressed={picked === r.id} onClick={() => setPicked(picked === r.id ? null : r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {picked && <p className="small muted">{REST_IDEAS.find((r) => r.id === picked)?.detail}</p>}
      <div className="stack">
        <button type="button" className={`btn ${over ? 'primary' : 'soft'} big`} onClick={onBack}>
          {over ? 'I’m back' : 'I’m back early'}
        </button>
        {over && (
          <button type="button" className="btn soft" onClick={onMore}>
            A bit longer
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onDayDone}>
          {settings.wordingStyle === 'literal' ? 'Stop for today' : 'Call it a day'}
        </button>
      </div>
    </div>
  );
}

// ───────────── Off-ramp / day closed ─────────────

export function DayClosed({
  settings,
  note,
  rest,
  loading,
  onHome,
}: {
  settings: Settings;
  note: FutureNote | null;
  rest: string | null;
  loading: boolean;
  onHome: () => void;
}) {
  if (loading) return <Loading text="Saving everything for later…" />;
  return (
    <div className="stack fade-in">
      <section className="card sun celebrate">
        <span className="burst" aria-hidden="true">
          🌙
        </span>
        <h2 style={{ marginTop: 8 }}>{COPY[settings.wordingStyle].dayClosed}</h2>
      </section>
      {note && (
        <section className="card" aria-labelledby="note-h">
          <h3 id="note-h">Note to future-you</h3>
          <p style={{ margin: 0 }}>{note.note}</p>
        </section>
      )}
      {rest && <p className="muted">{rest}</p>}
      <p className="small muted">No more nudges today. I’m here if you open me.</p>
      <button type="button" className="btn ghost" onClick={onHome}>
        Back to start
      </button>
    </div>
  );
}

export function Welcome({
  settings,
  note,
  onFresh,
  onPickUp,
  onRest,
}: {
  settings: Settings;
  note: FutureNote | null;
  onFresh: () => void;
  onPickUp: (() => void) | null;
  onRest?: () => void;
}) {
  return (
    <div className="stack fade-in">
      <h1>{COPY[settings.wordingStyle].welcomeBack}</h1>
      {note && (
        <section className="card soft">
          <p className="small muted" style={{ marginBottom: 4 }}>
            You left yourself a note:
          </p>
          <p style={{ margin: 0 }}>{note.note}</p>
        </section>
      )}
      <button type="button" className="btn primary big" onClick={onFresh}>
        Start fresh
      </button>
      {onPickUp && (
        <button type="button" className="btn soft" onClick={onPickUp}>
          Pick up where I left off
        </button>
      )}
      {onRest && (
        <button type="button" className="link" onClick={onRest}>
          Not today — rest instead
        </button>
      )}
    </div>
  );
}

// ───────────── Safety ─────────────

export function Safety({ payload, onBack, onFrustrated }: { payload: SafetyPayload; onBack: () => void; onFrustrated?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(phone);
    } catch {
      // older fallback (no clipboard permission needed)
      const ta = document.createElement('textarea');
      ta.value = phone;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      setCopied(ok ? phone : null);
    }
  };
  // move focus here so a screen-reader user hears the message straight away
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [payload]);
  return (
    <div className="stack fade-in" role="region" aria-labelledby="safety-heading">
      <h1 id="safety-heading" ref={headingRef} tabIndex={-1} style={{ outline: "none" }}>
        You matter
      </h1>
      <section className="card calm" role="status" aria-live="polite">
        <p style={{ fontSize: '1.1rem', margin: 0 }}>{payload.message}</p>
      </section>
      {payload.level === 'concern' && onFrustrated && (
        // Venting is allowed. Right under the message, big and kind — never a small link.
        <div className="stack" style={{ gap: 6 }}>
          <button type="button" className="btn soft block big" onClick={onFrustrated}>
            I’m safe — just really frustrated
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            That’s okay to say. I’ll stay with you, and the numbers below are here any time.
          </p>
        </div>
      )}
      <ul className="list" aria-label="People you can talk to right now">
        {payload.resources.map((r) => (
          <li key={r.name} className="resource">
            <div>
              <div style={{ fontWeight: 700 }}>{r.name}</div>
              {r.note && <div className="small muted">{r.note}</div>}
              {r.alt && <div className="small muted">Also: {r.alt}</div>}
            </div>
            {r.phone ? (
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <a className="btn primary" href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${r.name} at ${r.phone}`}>
                  {r.phone}
                </a>
                <button type="button" className="btn soft" onClick={() => void copy(r.phone!)} aria-label={`Copy ${r.name} number ${r.phone}`}>
                  {copied === r.phone ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : r.url ? (
              <a className="btn primary" href={r.url} target="_blank" rel="noreferrer">
                Open
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {copied ? `Number ${copied} copied` : ''}
      </p>
      <p>{TRUSTED_PERSON_LINE}</p>
      <p className="small muted">Nothing you typed or said here was saved.</p>
      <button type="button" className="link" onClick={onBack}>
        Back to Nudge
      </button>
    </div>
  );
}

/** "I'm safe — just really frustrated": believe them, validate, offer rest. */
export function Frustrated({ settings, onRest, onHome, onSupport }: { settings: Settings; onRest: () => void; onHome: () => void; onSupport: () => void }) {
  return (
    <div className="stack fade-in">
      <section className="card soft">
        <p style={{ margin: 0, fontSize: '1.05rem' }}>
          {settings.wordingStyle === 'literal'
            ? 'Thank you for telling me. Being frustrated with a task is understandable.'
            : 'Thank you for telling me. That much frustration makes total sense — this stuff is genuinely hard.'}
        </p>
      </section>
      <p className="muted">A break might help more than another step right now. Both are okay.</p>
      <button type="button" className="btn primary big" onClick={onRest}>
        Take a break
      </button>
      <button type="button" className="btn ghost" onClick={onHome}>
        Back to start
      </button>
      <button type="button" className="link" onClick={onSupport}>
        Show the support lines again
      </button>
    </div>
  );
}
