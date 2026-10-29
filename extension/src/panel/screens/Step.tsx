import { useEffect, useRef, useState } from 'react';
import {
  BUTTON_HINTS,
  BUTTON_LABELS,
  COPY,
  celebration,
  type ActionButton,
  type Settings,
  type SequenceResponse,
} from '@nudge/shared';
import { SizeBadge } from '../components/ui';
import { speak, stopSpeaking } from '../../lib/tts';
import { chime } from '../../lib/audio';
import { prefersReducedMotion } from '../../lib/a11y';

export type StepResp = SequenceResponse & { offline: boolean };

/** Strategies that come with a built-in timer: offer to start it right here. */
export const TIMER_STRATEGIES: Record<string, number> = {
  two_minute_start: 2,
  focus_round_10: 10,
  body_doubling: 15,
  sound_bubble: 15,
  timer_visible: 10,
};

export function StepView({
  resp,
  settings,
  onAction,
  onTimer,
  onBrainDump,
}: {
  resp: StepResp;
  settings: Settings;
  onAction: (a: ActionButton) => void;
  onTimer?: (minutes: number) => void;
  onBrainDump?: () => void;
}) {
  const [showWhy, setShowWhy] = useState(settings.explainWhy);
  const style = settings.wordingStyle;
  const labels = BUTTON_LABELS[style];
  const headingRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setShowWhy(settings.explainWhy);
    headingRef.current?.focus();
    return () => stopSpeaking();
  }, [resp.next_step, settings.explainWhy]);

  const spoken = [resp.validation, resp.lead, resp.next_step].filter(Boolean).join(' ');

  return (
    <div className="stack fade-in">
      <article className="card" aria-live="polite">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <SizeBadge size={resp.size} />
          <span className="row" style={{ gap: 6 }}>
            {resp.offline && <span className="pill" title="Made on this device from Nudge's strategy cards">offline idea</span>}
            {resp.source === 'gemini' && <span className="pill calm" title="Generated with the cloud model you enabled">cloud AI</span>}
          </span>
        </div>
        {resp.validation && <p className="validation">{resp.validation}</p>}
        {resp.lead && <p className="lead">{resp.lead}</p>}
        <p className="step-text" tabIndex={-1} ref={headingRef}>
          {resp.next_step}
        </p>
        {showWhy ? (
          <p className="why">{resp.why_one_line}</p>
        ) : (
          <button type="button" className="link" onClick={() => setShowWhy(true)}>
            Why this?
          </button>
        )}
        {onTimer && TIMER_STRATEGIES[resp.strategy_id] && (
          <button type="button" className="btn soft block" style={{ marginTop: 10 }} onClick={() => onTimer(TIMER_STRATEGIES[resp.strategy_id])}>
            {resp.strategy_id === 'two_minute_start' ? 'Start the 2-minute timer' : 'Start body-double mode'}
          </button>
        )}
        {onBrainDump && resp.strategy_id === 'brain_dump' && (
          <button type="button" className="btn soft block" style={{ marginTop: 10 }} onClick={onBrainDump}>
            Open brain dump
          </button>
        )}
        {settings.tts.enabled && (
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn ghost" onClick={() => speak(spoken, settings.tts.rate, settings.tts.voiceURI)} aria-label="Read this step aloud">
              🔈 Read aloud
            </button>
          </div>
        )}
        {resp.suggest_rest && (
          <p className="small muted" style={{ marginTop: 8 }}>
            {style === 'literal' ? 'Resting is also a valid choice right now.' : 'Resting is a perfectly good choice too.'}
          </p>
        )}
      </article>

      <div className="actions" role="group" aria-label="What next?">
        {resp.buttons.map((b) => (
          <button
            key={b}
            type="button"
            className={`btn ${b === 'done' ? 'primary done' : b === 'rest' ? 'calm' : 'soft'}`}
            onClick={() => onAction(b)}
            title={BUTTON_HINTS[b]}
            aria-label={`${labels[b]} — ${BUTTON_HINTS[b]}`}
          >
            {labels[b]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Celebrate({
  resp,
  settings,
  count,
  onFeedback,
  onNext,
  onBodyDouble,
  onEnough,
}: {
  resp: StepResp;
  settings: Settings;
  count: number;
  onFeedback: (f: 'up' | 'down' | 'skip') => void;
  onNext: () => void;
  onBodyDouble: () => void;
  onEnough: () => void;
}) {
  const [answered, setAnswered] = useState(false);
  const style = settings.wordingStyle;
  useEffect(() => {
    if (settings.winSounds) chime('chime');
  }, [settings.winSounds]);
  const reduced = prefersReducedMotion(settings);
  return (
    <div className="stack fade-in">
      <section className="card sun celebrate" aria-live="polite">
        <span className="burst" aria-hidden="true">
          {reduced ? '✓' : '🌼'}
        </span>
        <h2 style={{ marginTop: 8 }}>{celebration(style, count)}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {count === 1 ? 'Logged in your wins.' : `${count} steps so far this session — each one counts.`}
        </p>
      </section>

      {!answered ? (
        <section className="card" aria-labelledby="help-q">
          <h3 id="help-q" className="center">
            {COPY[style].didItHelp}
          </h3>
          <p className="small muted center">{resp.strategy_name}</p>
          <div className="feedback">
            <button type="button" className="btn soft" aria-label="Yes, it helped" onClick={() => (setAnswered(true), onFeedback('up'))}>
              👍
            </button>
            <button type="button" className="btn soft" aria-label="Not really" onClick={() => (setAnswered(true), onFeedback('down'))}>
              👎
            </button>
            <button type="button" className="btn ghost" onClick={() => (setAnswered(true), onFeedback('skip'))}>
              skip
            </button>
          </div>
        </section>
      ) : (
        <p className="small muted center" role="status">
          Thanks — I’ll remember what works for you.
        </p>
      )}

      <div className="stack">
        <button type="button" className="btn primary big" onClick={onNext}>
          Next tiny step
        </button>
        <button type="button" className="btn soft" onClick={onBodyDouble}>
          Body-double mode
        </button>
        <button type="button" className="btn ghost" onClick={onEnough}>
          That’s enough for now
        </button>
      </div>
    </div>
  );
}
