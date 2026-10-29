import { useEffect, useState } from 'react';
import { COPY, type InputStyle, type Settings, type WordingStyle } from '@nudge/shared';
import { sendToBackground, type TabInfo } from '../../lib/messages';
import { actions } from '../store';
import { micPermissionState } from '../../lib/speech';
import { radioKeys } from '../components/ui';

/** Three quick steps, under a minute. Everything else uses smart defaults. */
export function Onboarding({ settings, inTab, onDone }: { settings: Settings; inTab?: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [pinned, setPinned] = useState<number | null>(settings.taskTab?.tabId ?? null);
  const [wording, setWording] = useState<WordingStyle>(settings.wordingStyle);
  const [input, setInput] = useState<InputStyle>(settings.inputStyle);
  const [micNote, setMicNote] = useState('');

  useEffect(() => {
    void sendToBackground<TabInfo[]>({ kind: 'listTabs' }).then((t) => setTabs(Array.isArray(t) ? t : []));
  }, []);

  const copy = COPY[wording];

  async function finish() {
    await sendToBackground({ kind: 'pinTab', tabId: pinned });
    await actions.updateSettings({ wordingStyle: wording, inputStyle: input, onboarded: true });
    onDone();
  }

  async function chooseVoice() {
    setInput('voice');
    if (!inTab) return;
    // in a full tab we can ask for the mic right away (side panels can't always show the prompt)
    if ((await micPermissionState()) === 'granted') return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicNote('Microphone ready. Audio is never stored.');
    } catch {
      setMicNote('No microphone for now — that’s fine, buttons work just as well.');
    }
  }

  return (
    <div className="stack fade-in">
      <div className="steps-dots" aria-label={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((i) => (
          <i key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <section className="stack" aria-labelledby="ob1">
          <h1 id="ob1">Hi, I’m Nudge.</h1>
          <p className="muted">I help make starting a little easier — and rest a little lighter.</p>
          <h2>Which tab is your task?</h2>
          <p className="muted small">I’ll notice when you keep coming back to it. Totally optional.</p>
          <div className="stack" role="radiogroup" aria-label="Task tab" onKeyDown={radioKeys(tabs.slice(0, 8).map((t) => t.id), pinned ?? tabs[0]?.id ?? -1, (v) => setPinned(v))}>
            {tabs.slice(0, 8).map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={pinned === t.id}
                className="choice"
                onClick={() => setPinned(pinned === t.id ? null : t.id)}
              >
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {t.title || t.host}
                </span>
                <small>{t.host}</small>
              </button>
            ))}
            {!tabs.length && <p className="muted small">No other tabs open right now — you can pin one later in settings.</p>}
          </div>
          <div className="row">
            <button type="button" className="btn primary big" style={{ flex: 1 }} onClick={() => setStep(1)}>
              {pinned ? 'Pin it & continue' : 'Continue'}
            </button>
            {pinned === null && (
              <button type="button" className="btn ghost" onClick={() => setStep(1)}>
                Skip
              </button>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="stack" aria-labelledby="ob2">
          <h1 id="ob2">How would you like me to talk?</h1>
          <div className="choice-grid" role="radiogroup" aria-label="Wording style" onKeyDown={radioKeys<WordingStyle>(['warm', 'literal'], wording, setWording)}>
            <button type="button" role="radio" aria-checked={wording === 'warm'} tabIndex={wording === 'warm' ? 0 : -1} className="choice" onClick={() => setWording('warm')}>
              <span style={{ fontWeight: 700 }}>Warm &amp; casual</span>
              <small>“Want to just peek at it?”</small>
            </button>
            <button type="button" role="radio" aria-checked={wording === 'literal'} tabIndex={wording === 'literal' ? 0 : -1} className="choice" onClick={() => setWording('literal')}>
              <span style={{ fontWeight: 700 }}>Clear &amp; literal</span>
              <small>“Open the file DBMS.pdf.”</small>
            </button>
          </div>
          <button type="button" className="btn primary big" onClick={() => setStep(2)}>
            Continue
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="stack" aria-labelledby="ob3">
          <h1 id="ob3">How do you like to answer?</h1>
          <div className="choice-grid" role="radiogroup" aria-label="Input style" onKeyDown={radioKeys<InputStyle>(['voice', 'buttons'], input, (v) => (v === 'voice' ? void chooseVoice() : setInput('buttons')))}>
            <button type="button" role="radio" aria-checked={input === 'voice'} tabIndex={input === 'voice' ? 0 : -1} className="choice" onClick={() => void chooseVoice()}>
              <span style={{ fontWeight: 700 }}>Voice + buttons</span>
              <small>Talk when typing feels like too much</small>
            </button>
            <button type="button" role="radio" aria-checked={input === 'buttons'} tabIndex={input === 'buttons' ? 0 : -1} className="choice" onClick={() => setInput('buttons')}>
              <span style={{ fontWeight: 700 }}>Buttons only</span>
              <small>Quiet, one tap at a time</small>
            </button>
          </div>
          {micNote && (
            <p className="small muted" role="status">
              {micNote}
            </p>
          )}
          <div className="banner">
            <span aria-hidden="true">🌱</span>
            <span>{copy.learningMode}</span>
          </div>
          <button type="button" className="btn primary big" onClick={() => void finish()}>
            All set
          </button>
        </section>
      )}

      <p className="small muted center" style={{ marginTop: 8 }}>
        {copy.disclaimer}
      </p>
    </div>
  );
}
