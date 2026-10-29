'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BUTTON_LABELS,
  COPY,
  REST_IDEAS,
  TRUSTED_PERSON_LINE,
  localSequence,
  thompsonScores,
  STRATEGIES,
  type SafetyPayload,
  type SequenceResponse,
  type StrategyStats,
  type WordingStyle,
} from '@nudge/shared';

export type PreviewKind = 'stuck' | 'restuck' | 'depleted' | 'long_break' | 'crisis';

type View =
  | { v: 'bubble' }
  | { v: 'step'; step: SequenceResponse }
  | { v: 'break' }
  | { v: 'resting'; min: number | 'day' }
  | { v: 'bye'; text: string }
  | { v: 'safety'; payload: SafetyPayload };

function makeStep(style: WordingStyle, stats: StrategyStats, action: 'start' | 'next', energy: 1 | 2 | 3 | 4 | 5): SequenceResponse {
  return localSequence({
    task: 'DBMS assignment',
    task_tab_title: 'DBMS_Assignment.pdf',
    state: action === 'next' ? 'restuck' : 'stuck',
    energy,
    history: action === 'next' ? [{ step: 'Open DBMS_Assignment.pdf', strategy_id: 'just_open_it', outcome: 'done' }] : [],
    top_strategies: thompsonScores(STRATEGIES, stats).slice(0, 12),
    action,
    wording_style: style,
    explain_why: false,
  });
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`${primary ? 'n-btn-primary' : 'n-btn-soft'} min-h-tap px-4 text-sm`}>
      {children}
    </button>
  );
}

export function NudgePreview({
  kind,
  nonce,
  style,
  stats,
  safety,
  onClose,
}: {
  kind: PreviewKind;
  nonce: number;
  style: WordingStyle;
  stats: StrategyStats;
  safety: SafetyPayload | null;
  onClose: () => void;
}) {
  const c = COPY[style];
  const [view, setView] = useState<View>({ v: 'bubble' });
  const labels = BUTTON_LABELS[style];

  useEffect(() => {
    setView(kind === 'crisis' && safety ? { v: 'safety', payload: safety } : { v: 'bubble' });
  }, [kind, nonce, safety]);

  const startStep = (action: 'start' | 'next', energy: 1 | 2 | 3 | 4 | 5 = 3) => setView({ v: 'step', step: makeStep(style, stats, action, energy) });

  const bubbleText = useMemo(() => {
    if (kind === 'restuck') return c.restuckQ;
    if (kind === 'long_break') return c.longBreakQ;
    if (kind === 'depleted')
      return style === 'literal' ? 'You have been working for a long time. Do you want to rest?' : "You've been at this a long while. Want to ease off a little?";
    return c.nudgeText;
  }, [kind, c, style]);

  let body: React.ReactNode = null;
  if (view.v === 'safety') {
    body = (
      <div>
        <p className="font-semibold text-ink">{view.payload.message}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {view.payload.resources.map((r) => (
            <li key={r.name} className="rounded-soft bg-calm-soft p-3">
              <p className="font-semibold text-ink">{r.name}</p>
              {r.phone ? (
                <a href={`tel:${r.phone.replace(/[^0-9+]/g, '')}`} className="text-lg font-bold text-ink underline underline-offset-4">
                  {r.phone}
                </a>
              ) : null}
              {r.alt ? <span className="text-sm text-muted"> · {r.alt}</span> : null}
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-4">
                  {r.url.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
              {r.note ? <p className="text-sm text-muted">{r.note}</p> : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink">{TRUSTED_PERSON_LINE}</p>
        <div className="mt-3">
          <Btn onClick={onClose}>I&apos;m okay — back to Nudge</Btn>
        </div>
      </div>
    );
  } else if (view.v === 'bubble') {
    body = (
      <div>
        <p className="font-semibold text-ink">{bubbleText}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {kind === 'restuck' ? (
            <>
              <Btn primary onClick={() => setView({ v: 'bye', text: style === 'literal' ? 'Okay. Continue.' : 'Lovely. I’m right here.' })}>
                {c.stillGoing}
              </Btn>
              <Btn onClick={() => startStep('next')}>{c.stuckAgain}</Btn>
              <Btn onClick={() => setView({ v: 'break' })}>{c.takingBreak}</Btn>
            </>
          ) : kind === 'long_break' ? (
            <>
              <Btn primary onClick={() => startStep('next', 2)}>
                Come back
              </Btn>
              <Btn onClick={() => setView({ v: 'resting', min: 'day' })}>Call it a day</Btn>
            </>
          ) : kind === 'depleted' ? (
            <>
              <Btn primary onClick={() => setView({ v: 'break' })}>
                {c.nudgeBreak}
              </Btn>
              <Btn onClick={() => startStep('start', 1)}>{c.nudgeHelp}</Btn>
              <Btn onClick={() => setView({ v: 'bye', text: 'Okay! I’ll give you more space.' })}>{c.nudgeFine}</Btn>
            </>
          ) : (
            <>
              <Btn primary onClick={() => startStep('start')}>
                {c.nudgeHelp}
              </Btn>
              <Btn onClick={() => setView({ v: 'break' })}>{c.nudgeBreak}</Btn>
              <Btn onClick={() => setView({ v: 'bye', text: 'Okay! I’ll give you more space.' })}>{c.nudgeFine}</Btn>
            </>
          )}
        </div>
      </div>
    );
  } else if (view.v === 'step') {
    const st = view.step;
    body = (
      <div>
        {st.validation ? <p className="text-sm text-muted">{st.validation}</p> : null}
        {st.lead ? <p className="text-sm text-muted">{st.lead}</p> : null}
        <p className="mt-1 text-lg font-semibold text-ink">{st.next_step}</p>
        <span className="mt-2 inline-flex rounded-full bg-accent-soft px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-ink">{st.size}</span>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn primary onClick={() => setView({ v: 'bye', text: c.celebrate })}>
            {labels.done}
          </Btn>
          <Btn onClick={() => startStep('start', 2)}>{labels.too_big}</Btn>
          <Btn onClick={() => setView({ v: 'step', step: localSequence({ ...stepReq(style), action: 'smaller', history: [{ step: st.next_step, strategy_id: st.strategy_id, outcome: 'smaller' }] }) })}>
            {labels.smaller}
          </Btn>
          <Btn onClick={() => setView({ v: 'step', step: localSequence({ ...stepReq(style), action: 'different', history: [{ step: st.next_step, strategy_id: st.strategy_id, outcome: 'different' }] }) })}>
            {labels.different}
          </Btn>
          <Btn onClick={() => setView({ v: 'break' })}>{labels.rest}</Btn>
        </div>
        <p className="mt-2 text-xs text-muted">Idea: {st.strategy_name} · built-in card</p>
      </div>
    );
  } else if (view.v === 'break') {
    body = (
      <div>
        <p className="font-semibold text-ink">{c.breakQ}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn primary onClick={() => setView({ v: 'resting', min: 5 })}>
            5 min
          </Btn>
          <Btn onClick={() => setView({ v: 'resting', min: 15 })}>15 min</Btn>
          <Btn onClick={() => setView({ v: 'resting', min: 'day' })}>Done for today</Btn>
        </div>
      </div>
    );
  } else if (view.v === 'resting') {
    body =
      view.min === 'day' ? (
        <p className="font-semibold text-ink">{c.dayClosed}</p>
      ) : (
        <div>
          <p className="font-semibold text-ink">{view.min} minutes, all yours. Maybe:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {REST_IDEAS.slice(0, 4).map((r) => (
              <li key={r.id} className="rounded-full bg-surface2 px-3 py-1 text-sm text-ink" title={r.detail}>
                {r.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Totally optional.</p>
        </div>
      );
  } else {
    body = <p className="font-semibold text-ink">{view.text}</p>;
  }

  return (
    <aside
      aria-label="Nudge preview"
      aria-live="polite"
      className="n-rise fixed bottom-4 right-4 z-40 max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),23rem)] overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-card"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-muted">
          <span aria-hidden="true">🌿</span> Nudge
        </span>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface2 hover:text-ink" aria-label="Close preview">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {body}
    </aside>
  );
}

function stepReq(style: WordingStyle) {
  return {
    task: 'DBMS assignment',
    task_tab_title: 'DBMS_Assignment.pdf',
    state: 'stuck' as const,
    energy: 3 as const,
    top_strategies: [],
    wording_style: style,
    explain_why: false,
  };
}
