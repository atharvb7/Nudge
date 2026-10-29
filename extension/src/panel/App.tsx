import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STRATEGIES,
  STRATEGY_BY_ID,
  dayKey,
  looksLikeFeeling,
  thompsonScores,
  type ActionButton,
  type BrainDumpResponse,
  type Energy,
  type FutureNote,
  type SafetyPayload,
  type SequenceAction,
  type SequenceState,
  type Session,
  type StorageShape,
} from '@nudge/shared';
import { useHeartbeat, useNudgeStore, usePanelIntent, actions } from './store';
import { applyDisplaySettings } from '../lib/a11y';
import { localSafety, requestBrainDump, requestOfframp, requestSequence } from '../lib/api';
import { addStep, doneCount, endSession, historyFor, lowerEnergy, markOutcome, resumeFromLastCompleted, shouldWelcomeBack, startSession } from '../lib/session';
import { sendToBackground } from '../lib/messages';
import { mutate, type PanelIntent } from '../lib/storage';
import { GearIcon, Loading, MoonIcon } from './components/ui';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Celebrate, StepView, type StepResp } from './screens/Step';
import { BodyDouble, BrainDump, DayClosed, RestChoose, Resting, Safety, Welcome } from './screens/Together';
import { SettingsScreen } from './screens/Settings';
import { Demo } from './screens/Demo';

type Screen =
  | 'home'
  | 'loading'
  | 'step'
  | 'celebrate'
  | 'bodydouble'
  | 'braindump'
  | 'rest'
  | 'resting'
  | 'dayclosed'
  | 'welcome'
  | 'safety'
  | 'settings'
  | 'demo';

const CRISIS_DEMO_PHRASE = "honestly I don't want to be alive anymore";

function shortStep(t: string): string {
  return t.length > 70 ? t.slice(0, 67) + '…' : t;
}

export function App() {
  const store = useNudgeStore();
  useHeartbeat();
  const [screen, setScreen] = useState<Screen>('home');
  const [resp, setResp] = useState<StepResp | null>(null);
  const [energy, setEnergyState] = useState<Energy>(3);
  const [seqState, setSeqState] = useState<SequenceState>('stuck');
  const [safety, setSafety] = useState<SafetyPayload | null>(null);
  const [dump, setDump] = useState<(BrainDumpResponse & { offline: boolean }) | null>(null);
  const [dumpLoading, setDumpLoading] = useState(false);
  const [offramp, setOfframp] = useState<{ note: FutureNote | null; rest: string | null; loading: boolean }>({ note: null, rest: null, loading: false });
  const [loadingText, setLoadingText] = useState('Finding a tiny first step…');
  const [bdMinutes, setBdMinutes] = useState(15);
  const recent = useRef<string[]>([]);
  const sessionRef = useRef<Session | null>(null);
  const booted = useRef(false);
  /** session + win created by the latest "Help me start", undone if the reply turns out to be a safety one */
  const justStarted = useRef<{ sessionId: string; winId: string } | null>(null);

  // keep display settings applied
  useEffect(() => {
    if (store) applyDisplaySettings(store.settings);
  }, [store?.settings]);

  // first load: energy, break in progress, welcome back
  useEffect(() => {
    if (!store || booted.current) return;
    booted.current = true;
    sessionRef.current = store.session;
    // energy: today's choice, else a gentle 2 late at night, else whatever was chosen last
    if (store.energyToday?.day === dayKey()) setEnergyState(store.energyToday.energy);
    else if (new Date().getHours() >= 22 || new Date().getHours() < 5) setEnergyState(2);
    else if (store.energyToday) setEnergyState(store.energyToday.energy);
    const br = store.breakState;
    const staleBreak = !!br && (Date.now() - (br.startedAt + br.plannedMin * 60_000) > 2 * 3_600_000 || dayKey(br.startedAt) !== dayKey());
    if (staleBreak) {
      // a break from long ago is just… over. Welcome back, zero guilt.
      void mutate('breakState', () => null);
      void chrome.alarms.clear('nudge-break-end');
      setScreen('welcome');
    } else if (br) setScreen('resting');
    else if (store.session && shouldWelcomeBack(store.session)) setScreen('welcome');
  }, [store]);

  const persistSession = useCallback(async (s: Session | null) => {
    sessionRef.current = s;
    await mutate('session', () => s);
  }, []);

  const setEnergy = useCallback((e: Energy) => {
    setEnergyState(e);
    void actions.setEnergy(e);
  }, []);

  const showSafety = useCallback((p: SafetyPayload) => {
    // never store the message: nothing about it goes into session/history/wins
    setSafety(p);
    setResp(null);
    setScreen('safety');
    void sendToBackground({ kind: 'stepEnded' });
  }, []);

  const sequence = useCallback(
    async (action: SequenceAction, opts: { transcript?: string; state?: SequenceState; exclude?: string[]; energy?: Energy; avoidText?: string } = {}) => {
      if (!store) return;
      const s = sessionRef.current;
      if (!s) return;
      const st = opts.state ?? seqState;
      setLoadingText(action === 'smaller' ? 'Making it smaller…' : action === 'different' ? 'Finding a different idea…' : 'Finding a tiny step…');
      setScreen('loading');
      const ask = (act: SequenceAction, exclude?: string[]) =>
        requestSequence(
          {
            task: s.task,
            task_tab_title: s.taskTabTitle,
            state: st,
            energy: opts.energy ?? s.energy,
            history: historyFor(s),
            transcript: opts.transcript,
            top_strategies: thompsonScores(STRATEGIES, store.stats).slice(0, 12),
            exclude_ids: exclude,
            action: act,
            wording_style: store.settings.wordingStyle,
            explain_why: store.settings.explainWhy,
            recent_phrasings: recent.current.slice(-6),
          },
          store.settings,
        );
      let r = await ask(action, opts.exclude);
      // never hand back the exact step someone just got stuck on
      if (opts.avoidText && r.mode !== 'safety' && r.next_step.trim() === opts.avoidText.trim()) {
        r = await ask('different', [...(opts.exclude ?? []), r.strategy_id]);
      }
      if (r.mode === 'safety' && r.safety) {
        // The helper noticed something the on-device check missed. The words that
        // started this session must not be kept: undo the session and its win.
        const js = justStarted.current;
        const cur = sessionRef.current;
        if (js && cur && cur.id === js.sessionId && cur.steps.length === 0) {
          await persistSession(null);
          await actions.removeWin(js.winId);
        }
        justStarted.current = null;
        recent.current = [];
        showSafety(r.safety);
        return;
      }
      justStarted.current = null;
      const next = addStep(sessionRef.current ?? s, r);
      await persistSession(next);
      recent.current = [...recent.current, ...(r.lead ? [r.lead] : []), r.next_step].slice(-8);
      void actions.shown(r.strategy_id);
      void sendToBackground({ kind: 'stepStarted', index: next.steps.length - 1 });
      setResp(r);
      setScreen('step');
    },
    [store, seqState, persistSession, showSafety],
  );

  const closeSession = useCallback(async (kind: Session['endedKind']) => {
    const s = sessionRef.current;
    if (!s || s.endedAt) return;
    if (s.steps.length && doneCount(s) === 0) await actions.addWin('paused_start', `Gave ${s.task || 'it'} a go — saved for later`);
    await persistSession(endSession(s, kind));
  }, [persistSession]);

  const begin = useCallback(
    async (taskIn: string, transcript?: string, state: SequenceState = seqState, energyIn: Energy = energy) => {
      if (!store) return;
      const said = `${taskIn} ${transcript ?? ''}`;
      const safe = localSafety(said, store.settings.region);
      if (safe) return showSafety(safe);
      // "this assignment is killing me" is a feeling, not a task name: send it as what you said
      if (looksLikeFeeling(taskIn)) {
        transcript = [taskIn.trim(), transcript].filter(Boolean).join('. ');
        taskIn = '';
      }
      let task = taskIn.trim();
      // the pinned tab's title already goes along as the concrete name
      const tabTitle = store.settings.taskTab?.title?.trim() ?? '';
      if (task && tabTitle && task.toLowerCase() === tabTitle.toLowerCase()) task = '';
      if (!task && transcript && !looksLikeFeeling(transcript) && transcript.split(/\s+/).length <= 8) task = transcript.trim();
      const cur = sessionRef.current;
      const reuse = cur && !cur.endedAt && Date.now() - cur.lastActiveAt < 3 * 3_600_000 && (!task || task === cur.task);
      if (!reuse) {
        await closeSession('drifted');
        const fresh = startSession(task, energyIn, store.settings.taskTab?.title || undefined);
        await persistSession(fresh);
        recent.current = [];
        const winId = await actions.addWin('started', `Started ${task || store.settings.taskTab?.title || 'something hard'}`);
        justStarted.current = { sessionId: fresh.id, winId };
      } else if (cur && cur.energy !== energyIn) {
        await persistSession({ ...cur, energy: energyIn });
      }
      void sendToBackground({ kind: 'newSession' });
      setSeqState(state);
      await sequence('start', { transcript, state, energy: energyIn });
    },
    [store, seqState, energy, sequence, showSafety, closeSession, persistSession],
  );

  const resume = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.endedAt) {
      setScreen('home');
      return;
    }
    // resume from the last completed step; never comment on the stall, and
    // don't offer the very idea that just stalled again
    const dropped = s.steps.slice(s.lastCompletedIndex + 1);
    const r = resumeFromLastCompleted(s);
    await persistSession(r);
    setSeqState('restuck');
    await sequence(r.lastCompletedIndex >= 0 ? 'next' : 'start', {
      state: 'restuck',
      exclude: Array.from(new Set(dropped.map((d) => d.strategy_id).filter(Boolean))),
      avoidText: dropped[dropped.length - 1]?.step,
    });
  }, [persistSession, sequence]);

  const doOfframp = useCallback(async () => {
    if (!store) return;
    setScreen('dayclosed');
    setOfframp({ note: null, rest: null, loading: true });
    const s = sessionRef.current;
    const progress = s ? s.steps.filter((x) => x.outcome === 'done').map((x) => x.step) : [];
    const task = s?.task || store.settings.taskTab?.title || '';
    const r = await requestOfframp(task, progress, store.settings.wordingStyle, s?.energy ?? energy, store.settings);
    const note: FutureNote = { t: Date.now(), task, note: r.note_to_future_self, progress };
    await actions.saveNote(note);
    await closeSession('day_closed');
    await actions.addWin('day_closed', 'Called it a day kindly');
    await mutate('breakState', () => null);
    void sendToBackground({ kind: 'guardDayClosed' });
    setOfframp({ note, rest: r.rest_suggestion, loading: false });
  }, [store, energy, closeSession]);

  const startBreak = useCallback(async (minutes: 5 | 15) => {
    await mutate('breakState', () => ({ startedAt: Date.now(), plannedMin: minutes, returnPromptShown: false }));
    await chrome.alarms.create('nudge-break-end', { delayInMinutes: minutes });
    void sendToBackground({ kind: 'stepEnded' });
    await actions.addWin('rested', `Took a real break (${minutes} min)`);
    setScreen('resting');
  }, []);

  const onAction = useCallback(
    async (b: ActionButton) => {
      const s = sessionRef.current;
      if (!s || !resp) return;
      const marked = markOutcome(s, b);
      switch (b) {
        case 'done':
          await persistSession(marked);
          await actions.addWin('step_done', shortStep(resp.next_step), resp.strategy_id);
          void sendToBackground({ kind: 'stepEnded' });
          setScreen('celebrate');
          return;
        case 'too_big': {
          // lower energy for this session only — today's energy on the dashboard stays yours to set
          const lowered = lowerEnergy(marked);
          await persistSession(lowered);
          await sequence('too_big', { energy: lowered.energy });
          return;
        }
        case 'smaller':
          await persistSession(marked);
          await sequence('smaller');
          return;
        case 'different':
          await persistSession(marked);
          await actions.feedback(resp.strategy_id, 'skip');
          await sequence('different', { exclude: [resp.strategy_id] });
          return;
        case 'rest':
          await persistSession(marked);
          void sendToBackground({ kind: 'stepEnded' });
          setScreen('rest');
          return;
      }
    },
    [resp, persistSession, sequence, setEnergy],
  );

  const runCrisisDemo = useCallback(() => {
    if (!store) return;
    const p = localSafety(CRISIS_DEMO_PHRASE, store.settings.region);
    if (p) showSafety(p);
  }, [store, showSafety]);

  const pendingIntent = useRef<PanelIntent | null>(null);
  const handleIntent = (intent: PanelIntent) => {
    switch (intent.screen) {
      case 'stuck': {
        // "Help me start" from the page: start right away with the pinned task /
        // open session at the remembered energy — no second tap needed
        const st: SequenceState = intent.state === 'restuck' ? 'restuck' : intent.state;
        const e = (intent.state === 'depleted' ? Math.min(energy, 2) : energy) as Energy;
        if (e !== energy) setEnergyState(e);
        setSeqState(st);
        void begin('', undefined, st, e);
        break;
      }
      case 'break':
        setScreen('rest');
        break;
      case 'resume':
        void (async () => {
          await mutate('breakState', () => null);
          await resume();
        })();
        break;
      case 'offramp':
        void doOfframp();
        break;
      case 'safety-demo':
        runCrisisDemo();
        break;
      case 'checkin':
        setScreen('home');
        break;
    }
  };
  usePanelIntent((intent: PanelIntent) => {
    if (!store || !store.settings.onboarded) {
      pendingIntent.current = intent; // handled once the panel is ready
      return;
    }
    handleIntent(intent);
  });
  useEffect(() => {
    if (store?.settings.onboarded && pendingIntent.current) {
      const i = pendingIntent.current;
      pendingIntent.current = null;
      handleIntent(i);
    }
  });

  if (!store) return <div className="content"><Loading text="Opening…" /></div>;

  if (!store.settings.onboarded) {
    return (
      <div className="app">
        <main className="content">
          <Onboarding settings={store.settings} onDone={() => setScreen('home')} />
        </main>
      </div>
    );
  }

  const s = store.settings;
  const dndOn = !!s.dndUntil && s.dndUntil > Date.now();
  const lastNote = store.notes[store.notes.length - 1] ?? null;
  const current = sessionRef.current;

  let body: JSX.Element;
  switch (screen) {
    case 'loading':
      body = <Loading text={loadingText} />;
      break;
    case 'step':
      body = resp ? (
        <StepView
          resp={resp}
          settings={s}
          onAction={(b) => void onAction(b)}
          onTimer={(m) => {
            setBdMinutes(m);
            setScreen('bodydouble');
          }}
          onBrainDump={() => {
            setDump(null);
            setScreen('braindump');
          }}
        />
      ) : (
        <Loading text={loadingText} />
      );
      break;
    case 'celebrate':
      body = resp ? (
        <Celebrate
          resp={resp}
          settings={s}
          count={doneCount(current)}
          onFeedback={(f) => void actions.feedback(resp.strategy_id, f)}
          onNext={() => void sequence('next')}
          onBodyDouble={() => {
            setBdMinutes(15);
            void sendToBackground({ kind: 'stepStarted', index: (current?.steps.length ?? 1) - 1 });
            setScreen('bodydouble');
          }}
          onEnough={() => setScreen('rest')}
        />
      ) : (
        <Loading text="…" />
      );
      break;
    case 'bodydouble':
      body = (
        <BodyDouble
          settings={s}
          initialMinutes={bdMinutes}
          step={current?.steps.length && current.steps[current.steps.length - 1].outcome !== 'done' ? current.steps[current.steps.length - 1].step : current?.task ? `Keeping you company with ${current.task}.` : null}
          onSound={(v) => void actions.updateSettings({ bodyDoubleSound: v })}
          onDone={async () => {
            const cur = sessionRef.current;
            const last = cur?.steps[cur.steps.length - 1];
            if (last && last.outcome !== 'done' && resp) {
              // the timer was for the current step: finishing it completes that step
              await onAction('done');
              return;
            }
            await actions.addWin('step_done', 'Body-doubled through a stretch', 'body_doubling');
            void sendToBackground({ kind: 'stepEnded' });
            setResp((r) => (r ? { ...r, strategy_id: 'body_doubling', strategy_name: STRATEGY_BY_ID.body_doubling?.name ?? 'Body doubling' } : r));
            setScreen('celebrate');
          }}
          onStuckAgain={() => void resume()}
          onStop={() => {
            void sendToBackground({ kind: 'stepEnded' });
            setScreen('rest');
          }}
        />
      );
      break;
    case 'braindump':
      body = (
        <BrainDump
          settings={s}
          loading={dumpLoading}
          result={dump}
          onSubmit={async (text) => {
            const safe = localSafety(text, s.region);
            if (safe) return showSafety(safe);
            setDumpLoading(true);
            const r = await requestBrainDump(text, s.wordingStyle, energy, s);
            setDumpLoading(false);
            if (r.mode === 'safety' && r.safety) return showSafety(r.safety);
            setDump(r);
            if (r.pick) await actions.addWin('brain_dump', `Emptied my head: ${r.groups.reduce((a, g) => a + g.items.length, 0)} things → picked 1`);
          }}
          onStartWith={(item) => {
            setDump(null);
            void begin(item, undefined, 'overwhelmed');
          }}
        />
      );
      break;
    case 'rest':
      body = <RestChoose settings={s} onChoose={(m) => (m === 'day' ? void doOfframp() : void startBreak(m))} />;
      break;
    case 'resting':
      body = store.breakState ? (
        <Resting
          settings={s}
          breakState={store.breakState}
          onBack={async () => {
            await mutate('breakState', () => null);
            await chrome.alarms.clear('nudge-break-end');
            await actions.addWin('came_back', 'Came back after a break');
            if (sessionRef.current && !sessionRef.current.endedAt && sessionRef.current.steps.length) setScreen('welcome');
            else setScreen('home');
          }}
          onMore={async () => {
            await mutate('breakState', (b) => (b ? { ...b, plannedMin: b.plannedMin + 5, returnPromptShown: false } : b));
          }}
          onDayDone={() => void doOfframp()}
        />
      ) : (
        <Loading text="…" />
      );
      break;
    case 'dayclosed':
      body = <DayClosed settings={s} note={offramp.note} rest={offramp.rest} loading={offramp.loading} onHome={() => setScreen('home')} />;
      break;
    case 'welcome':
      body = (
        <Welcome
          settings={s}
          note={lastNote}
          onFresh={async () => {
            await closeSession('drifted');
            await persistSession(null);
            await actions.addWin('came_back', 'Came back — fresh start');
            void sendToBackground({ kind: 'newSession' });
            setScreen('home');
          }}
          onPickUp={current && !current.endedAt && current.steps.length ? () => void resume() : null}
        />
      );
      break;
    case 'safety':
      body = safety ? (
        <Safety
          payload={safety}
          onBack={() => {
            setSafety(null);
            setScreen('home');
          }}
        />
      ) : (
        <Loading text="…" />
      );
      break;
    case 'settings':
      body = <SettingsScreen store={store} onDemo={() => setScreen('demo')} />;
      break;
    case 'demo':
      body = <Demo settings={s} onCrisis={runCrisisDemo} />;
      break;
    default:
      body = (
        <Home
          store={store}
          energy={energy}
          onEnergy={setEnergy}
          onStart={(task, transcript) => void begin(task, transcript)}
          onBrainDump={() => {
            setDump(null);
            setScreen('braindump');
          }}
          onBreak={() => setScreen('rest')}
        />
      );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => setScreen('home')} aria-label="Nudge home">
          <span className="brand-dot" aria-hidden="true" />
          Nudge
        </button>
        {s.demoMode && (
          <button type="button" className="pill calm" style={{ border: 0, cursor: 'pointer' }} onClick={() => setScreen('demo')}>
            demo
          </button>
        )}
        <button
          type="button"
          className="btn ghost icon"
          aria-pressed={dndOn}
          aria-label={dndOn ? 'Do not disturb is on — turn off' : 'Do not disturb for 1 hour'}
          title={dndOn ? 'Do not disturb is on' : 'Do not disturb (1 hour)'}
          onClick={() => void actions.updateSettings({ dndUntil: dndOn ? null : Date.now() + 3_600_000 })}
        >
          <MoonIcon />
        </button>
        <button type="button" className="btn ghost icon" aria-label="Settings" title="Settings" onClick={() => setScreen(screen === 'settings' ? 'home' : 'settings')}>
          <GearIcon />
        </button>
      </header>
      <main className="content" id="main">
        {body}
      </main>
    </div>
  );
}

export type { StorageShape };
