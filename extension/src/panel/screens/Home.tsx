import { useState } from 'react';
import {
  CHECKIN_OPTIONS,
  COPY,
  dayKey,
  isLearning,
  learningDaysLeft,
  type Energy,
  type StorageShape,
} from '@nudge/shared';
import { EnergyPicker } from '../components/ui';
import { MicButton } from '../components/MicButton';
import { actions } from '../store';

export function Home({
  store,
  energy,
  onEnergy,
  onStart,
  onBrainDump,
  onBreak,
}: {
  store: StorageShape;
  energy: Energy;
  onEnergy: (e: Energy) => void;
  onStart: (task: string, transcript?: string) => void;
  onBrainDump: () => void;
  onBreak: () => void;
}) {
  const s = store.settings;
  const copy = COPY[s.wordingStyle];
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const voice = s.inputStyle === 'voice';
  const learning = isLearning(s);
  const today = dayKey();
  const showCheckin = learning && !checked && !store.checkins.some((c) => c.day === today) && new Date().getHours() >= 17;

  const quick = [
    ...(s.taskTab?.title ? [s.taskTab.title] : []),
    ...store.plan.filter((p) => p.status === 'today').map((p) => p.title),
  ].slice(0, 5);

  const start = () => onStart(chosen ?? text.trim());

  return (
    <div className="stack fade-in">
      <h1>{copy.stuckTitle}</h1>
      <p className="muted">{copy.stuckPrompt}</p>

      {voice && (
        <MicButton
          settings={s}
          prompt="Hold to talk, or tap once — say what you’re trying to start, or how it feels."
          onText={(t) => {
            setText(t);
            onStart('', t);
          }}
        />
      )}

      <div className="field">
        <label htmlFor="task-input">{voice ? 'Or type it (optional)' : 'What is it? (optional)'}</label>
        <input
          id="task-input"
          className="input"
          value={text}
          placeholder="e.g. DBMS assignment"
          maxLength={300}
          onChange={(e) => {
            setText(e.target.value);
            setChosen(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
      </div>

      {quick.length > 0 && (
        <div className="chips" aria-label="Quick picks">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              className="chip-btn"
              aria-pressed={chosen === q}
              onClick={() => {
                setChosen(chosen === q ? null : q);
                setText('');
              }}
              title={q}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <EnergyPicker value={energy} onChange={onEnergy} style={s.wordingStyle} />

      <button type="button" className="btn primary big block" onClick={() => start()}>
        {copy.nudgeHelp}
      </button>
      <div className="row">
        <button type="button" className="btn soft" style={{ flex: 1 }} onClick={onBrainDump}>
          Brain dump
        </button>
        <button type="button" className="btn calm" style={{ flex: 1 }} onClick={onBreak}>
          {copy.nudgeBreak}
        </button>
      </div>

      {showCheckin && (
        <section className="card soft" aria-labelledby="checkin-q">
          <h3 id="checkin-q">{copy.checkinQ}</h3>
          <div className="chips" role="group" aria-label={copy.checkinQ}>
            {CHECKIN_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className="chip-btn"
                aria-label={`Today felt ${o.label}`}
                onClick={() => {
                  setChecked(true);
                  void actions.checkin(o.value);
                }}
              >
                {o.emoji} {o.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {checked && <p className="small muted" role="status">Thank you. Noted.</p>}

      {learning && (
        <div className="banner">
          <span aria-hidden="true">🌱</span>
          <span>
            {copy.learningMode} <span className="muted">({learningDaysLeft(s)} day{learningDaysLeft(s) === 1 ? '' : 's'} to go)</span>
          </span>
        </div>
      )}
    </div>
  );
}
