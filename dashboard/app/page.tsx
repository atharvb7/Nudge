'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { COPY, wakingDayKey, reshufflePlan, type Energy, type PlanItem } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { EnergyDial } from '@/components/EnergyDial';
import { Card, EmptyState, PageHeader, PageSkeleton, Pill, formatDay } from '@/components/ui';

const SIZE_LABEL: Record<PlanItem['size'], string> = { tiny: 'Tiny', small: 'Small', big: 'Big' };
const SIZE_TONE: Record<PlanItem['size'], 'accent' | 'calm' | 'sun'> = { tiny: 'accent', small: 'calm', big: 'sun' };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Hello, night owl';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function PlanRow({
  item,
  note,
  onDone,
  onLater,
  onRemove,
}: {
  item: PlanItem;
  note?: string;
  onDone: () => void;
  onLater: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-soft border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <button
          type="button"
          onClick={onDone}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-accent text-accent hover:bg-accent-soft"
          aria-label={`Mark "${item.title}" as done`}
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ✓
          </span>
        </button>
        <div className="min-w-0 pt-1">
          <p className="break-words font-semibold text-ink">{item.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Pill tone={SIZE_TONE[item.size]}>{SIZE_LABEL[item.size]}</Pill>
            {note ? <span className="text-sm text-muted">{note}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-[3.75rem] sm:pl-0">
        <button type="button" className="n-btn-ghost px-4 text-sm" onClick={onLater}>
          Save for later
        </button>
        <button type="button" className="n-btn-ghost px-4 text-sm" onClick={onRemove} aria-label={`Remove "${item.title}"`}>
          Remove
        </button>
      </div>
    </li>
  );
}

const LITERAL_PLAN_MESSAGES: Record<Energy, string> = {
  1: 'Energy level 1. The list shows one small item. Doing nothing today is also okay.',
  2: 'Energy level 2. The list shows only the smallest items.',
  3: 'Energy level 3. The list shows a few small items.',
  4: 'Energy level 4. You can pick any items you want. You do not need to do all of them.',
  5: 'Energy level 5. You can pick any items. Breaks are part of the plan.',
};

function AddItem({ onAdd }: { onAdd: (title: string, size: PlanItem['size']) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [size, setSize] = useState<PlanItem['size']>('small');
  const [hint, setHint] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setHint('Add a few words first — anything works.');
      return;
    }
    if (!(await onAdd(t, size))) {
      setHint('That didn’t save just now — your words are still here.');
      return;
    }
    setTitle('');
    setHint('Added. Nice.');
  };

  return (
    <form onSubmit={submit} className="mt-5 border-t border-line pt-5" noValidate>
      <label htmlFor="new-item" className="n-label">
        Add something to today
      </label>
      <div className="flex flex-col gap-3">
        <input
          id="new-item"
          className="n-input"
          value={title}
          maxLength={140}
          onChange={(e) => {
            setTitle(e.target.value);
            if (hint) setHint('');
          }}
          placeholder="e.g. Read the first page of the DBMS notes"
          aria-describedby="new-item-hint"
          autoComplete="off"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <fieldset className="flex gap-1 rounded-full border border-line bg-surface2 p-1 sm:flex-1">
          <legend className="sr-only">How big does it feel?</legend>
          {(['tiny', 'small', 'big'] as const).map((s) => (
            <label key={s} className={`flex min-h-[2.75rem] flex-1 cursor-pointer justify-center items-center rounded-full px-4 text-sm font-semibold ${size === s ? 'bg-surface text-ink shadow-card' : 'text-muted'}`}>
              <input type="radio" name="size" value={s} checked={size === s} onChange={() => setSize(s)} className="sr-only" />
              {SIZE_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="n-btn-primary sm:px-8">
          Add
        </button>
        </div>
      </div>
      <p id="new-item-hint" className="mt-2 min-h-[1.5em] text-sm text-muted" aria-live="polite">
        {hint}
      </p>
    </form>
  );
}

export default function TodayPage() {
  const { snapshot, act } = useNudge();
  const [keptAnyway, setKeptAnyway] = useState<Energy | null>(null);
  const [showLater, setShowLater] = useState(false);
  const [announce, setAnnounce] = useState('');

  const today = wakingDayKey();
  const energy = snapshot?.energyToday && snapshot.energyToday.day === today ? snapshot.energyToday.energy : null;
  const plan = useMemo(() => snapshot?.plan ?? [], [snapshot?.plan]);
  const shuffle = useMemo(() => (energy ? reshufflePlan(plan, energy) : null), [plan, energy]);

  if (!snapshot) return <PageSkeleton />;
  const style = snapshot.settings.wordingStyle;
  const todayItems = plan.filter((p) => p.status === 'today');
  const later = plan.filter((p) => p.status === 'later');
  const done = plan.filter((p) => p.status === 'done');
  const offer = shuffle && shuffle.offerToMove.length > 0 && keptAnyway !== energy ? shuffle.offerToMove : [];
  const visible = shuffle ? (offer.length ? shuffle.keep : [...shuffle.keep, ...shuffle.offerToMove]) : todayItems;
  const extraIds = new Set(shuffle && keptAnyway === energy ? shuffle.offerToMove.map((p) => p.id) : []);
  const note = snapshot.notes[snapshot.notes.length - 1];
  const learning = snapshot.learningDaysLeft > 0 && !snapshot.settings.demoMode;
  const session = snapshot.session && !snapshot.session.endedAt ? snapshot.session : null;

  const extras = (
    <>
      {note ? (
        <Card title="A note from past-you" description={`${formatDay(note.t)} · ${note.task}`}>
          <blockquote className="border-l-4 border-accent pl-4 text-ink">{note.note}</blockquote>
        </Card>
      ) : null}

      {session ? (
        <Card title="In progress" description="Pick it up whenever you like — or don't. It's saved for later.">
          <p className="font-semibold text-ink">{session.task || 'Untitled task'}</p>
          <p className="text-sm text-muted">
            {session.steps.length} {session.steps.length === 1 ? 'step' : 'steps'} so far
          </p>
        </Card>
      ) : null}
    </>
  );

  const move = async (ids: string[], status: PlanItem['status'], msg: string) => {
    if (await act({ type: 'planMove', ids, status })) setAnnounce(msg);
  };

  return (
    <div className="n-rise">
      <PageHeader title={`${greeting()}.`} lede="One gentle look at today. Change anything — nothing here is a rule." />
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {learning ? (
        <div className="mb-6 rounded-card border border-line bg-calm-soft p-4 text-ink" role="note">
          <p className="font-semibold">
            Learning mode · {snapshot.learningDaysLeft} {snapshot.learningDaysLeft === 1 ? 'day' : 'days'} left
          </p>
          <p className="text-sm text-muted">{COPY[style].learningMode}</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          <Card id="energy" title="How's your energy?" description="Your plan reshapes itself around this. Low energy means fewer, smaller things.">
            <EnergyDial
              style={style}
              value={energy}
              onChange={(e) => {
                void act({ type: 'setEnergy', energy: e });
                setKeptAnyway(null);
              }}
            />
            {shuffle ? (
              <p className="mt-3 rounded-soft bg-surface2 p-3 text-sm text-ink">
                {style === 'literal' && energy ? LITERAL_PLAN_MESSAGES[energy] : shuffle.message}
              </p>
            ) : null}
          </Card>

          <div className="hidden flex-col gap-6 lg:flex">{extras}</div>
        </div>

        <Card id="plan" title="Today's gentle plan" description={
            energy
              ? style === 'literal'
                ? `Shaped for energy level ${energy} of 5.`
                : `Shaped for ${energy} ${energy === 1 ? 'spoon' : 'spoons'}.`
              : 'Set your energy to shape this list.'
          }>
          {offer.length ? (
            <div className="mb-5 rounded-soft border border-line bg-sun-soft p-4" role="region" aria-label="Suggestion">
              <p className="font-semibold text-ink">Want to save these for later? No penalty, they&apos;ll wait for you.</p>
              <ul className="mt-2 list-inside list-disc text-sm text-ink">
                {offer.map((o) => (
                  <li key={o.id}>{o.title}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="n-btn-primary"
                  onClick={() => void move(offer.map((o) => o.id), 'later', `${offer.length} saved for later.`)}
                >
                  Save for later
                </button>
                <button type="button" className="n-btn-ghost" onClick={() => setKeptAnyway(energy)}>
                  Keep them
                </button>
              </div>
            </div>
          ) : null}

          {visible.length ? (
            <ul className="flex flex-col gap-2">
              {visible.map((item) => (
                <PlanRow
                  key={item.id}
                  item={item}
                  note={extraIds.has(item.id) ? 'if there’s room' : undefined}
                  onDone={() => void move([item.id], 'done', `"${item.title}" done. Lovely.`)}
                  onLater={() => void move([item.id], 'later', `"${item.title}" saved for later.`)}
                  onRemove={() => void act({ type: 'planRemove', id: item.id }).then((ok) => ok && setAnnounce('Removed.'))}
                />
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing planned — and that's okay.">
              {later.length ? 'A few things are saved for later whenever you want them.' : 'Add something below, or simply rest.'}
            </EmptyState>
          )}

          <AddItem
            onAdd={async (title, size) => {
              const ok = await act({ type: 'planAdd', title, size });
              if (ok) setAnnounce(`Added "${title}".`);
              return ok;
            }}
          />

          {done.length ? (
            <div className="mt-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">Done</h3>
              <ul className="mt-2 flex flex-col gap-1">
                {done.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-soft px-2 py-1">
                    <span className="min-w-0 break-words text-ink">
                      <span aria-hidden="true" className="mr-2 text-accent">
                        ✓
                      </span>
                      {d.title}
                    </span>
                    <button type="button" className="min-h-tap shrink-0 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface2" onClick={() => void move([d.id], 'today', 'Moved back to today.')}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 border-t border-line pt-4">
            <button
              type="button"
              className="flex min-h-tap w-full items-center justify-between rounded-soft px-2 text-left font-semibold text-ink hover:bg-surface2"
              aria-expanded={showLater}
              aria-controls="later-list"
              onClick={() => setShowLater((v) => !v)}
            >
              <span>
                {COPY[style].savedForLater} <span className="font-normal text-muted">({later.length})</span>
              </span>
              <span aria-hidden="true">{showLater ? '▴' : '▾'}</span>
            </button>
            {showLater ? (
              <div id="later-list" className="mt-2">
                {later.length ? (
                  <ul className="flex flex-col gap-2">
                    {later.map((l) => (
                      <li key={l.id} className="flex flex-col gap-2 rounded-soft bg-surface2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0 break-words text-ink">{l.title}</span>
                        <button type="button" className="n-btn-soft shrink-0 px-4 text-sm" onClick={() => void move([l.id], 'today', `"${l.title}" is back on today.`)}>
                          Bring to today
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 text-sm text-muted">Nothing waiting here right now.</p>
                )}
              </div>
            ) : null}
          </div>
        </Card>
        <div className="flex flex-col gap-6 lg:hidden">{extras}</div>
      </div>
    </div>
  );
}
