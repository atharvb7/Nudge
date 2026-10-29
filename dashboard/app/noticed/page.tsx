'use client';

import { useMemo, useState } from 'react';
import type { Inference, Sensitivity } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { Card, EmptyState, PageHeader, PageSkeleton, formatDay, formatTime } from '@/components/ui';

type StateKey = Inference['state'];

const STATE_META: Record<StateKey, { label: string; cls: string; icon: string }> = {
  flow: { label: 'Flow', cls: 'bg-accent-soft text-ink', icon: '🌊' },
  stuck: { label: 'Stuck', cls: 'bg-calm-soft text-ink', icon: '🪨' },
  restuck: { label: 'Stuck again', cls: 'bg-calm-soft text-ink', icon: '🔁' },
  depleted: { label: 'Running low', cls: 'bg-sun-soft text-ink', icon: '🔋' },
  away: { label: 'Away', cls: 'bg-surface2 text-ink', icon: '🚶' },
  neutral: { label: 'Just browsing', cls: 'bg-surface2 text-ink', icon: '·' },
  long_break: { label: 'Long break', cls: 'bg-surface2 text-ink', icon: '☕' },
};

const FILTERS: Array<{ id: 'all' | 'stuck' | 'flow' | 'depleted' | 'other'; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'stuck', label: 'Stuck' },
  { id: 'flow', label: 'Flow' },
  { id: 'depleted', label: 'Running low' },
  { id: 'other', label: 'Breaks & away' },
];

function matchesFilter(i: Inference, f: (typeof FILTERS)[number]['id']): boolean {
  if (f === 'all') return true;
  if (f === 'stuck') return i.state === 'stuck' || i.state === 'restuck';
  if (f === 'flow') return i.state === 'flow';
  if (f === 'depleted') return i.state === 'depleted';
  return i.state === 'away' || i.state === 'long_break' || i.state === 'neutral';
}

function whatIDid(i: Inference): string {
  if (i.acted === 'silenced') return `Stayed quiet${i.silencedBecause ? ` — ${i.silencedBecause.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}` : ''}.`;
  if (i.acted === 'learning') return 'Learning mode, so I only took a note.';
  if (i.acted === 'nudged') return i.state === 'flow' ? 'Showed a tiny, ignorable chip.' : 'Offered a gentle nudge.';
  if (i.state === 'flow') return "Didn't interrupt — I never do during flow.";
  return 'Just took a note.';
}

function sensitivityWords(v: number): string {
  if (v >= 1.6) return 'Waiting for much stronger signals';
  if (v > 1.05) return 'Waiting for stronger signals';
  if (v < 0.95) return 'A little quicker to notice';
  return 'Usual';
}

function SensitivityCard({ s }: { s: Sensitivity }) {
  const rows: Array<[string, number]> = [
    ['Noticing when you’re stuck', s.stuck],
    ['Noticing when you’re running low', s.depleted],
    ['Noticing flow', s.flow],
  ];
  return (
    <Card id="tuning" title="How I'm tuned for you" description="Every “Wrong” makes me more careful. Every “Right” helps me trust the pattern.">
      <dl className="grid gap-3 sm:grid-cols-3">
        {rows.map(([label, v]) => (
          <div key={label} className="rounded-soft bg-surface2 p-3">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-semibold text-ink">{sensitivityWords(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function InferenceRow({ inf, onFeedback, thanks }: { inf: Inference; onFeedback: (f: 'right' | 'wrong') => void; thanks: boolean }) {
  const meta = STATE_META[inf.state] ?? STATE_META.neutral;
  return (
    <li className="rounded-soft border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${meta.cls}`}>
          <span aria-hidden="true">{meta.icon}</span>
          {meta.label}
        </span>
        <time className="text-sm text-muted" dateTime={new Date(inf.t).toISOString()}>
          {formatTime(inf.t)}
        </time>
      </div>
      <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-ink">{inf.reason}</p>
          <p className="mt-1 text-sm text-muted">{whatIDid(inf)}</p>
        </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="Was this right?">
        <span className="mr-1 text-sm text-muted">Was I right?</span>
        <button
          type="button"
          aria-pressed={inf.feedback === 'right'}
          onClick={() => onFeedback('right')}
          className={`n-btn px-4 text-sm ${inf.feedback === 'right' ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}
        >
          Right
        </button>
        <button
          type="button"
          aria-pressed={inf.feedback === 'wrong'}
          onClick={() => onFeedback('wrong')}
          className={`n-btn px-4 text-sm ${inf.feedback === 'wrong' ? 'bg-calm text-accent-ink' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}
        >
          Wrong
        </button>
      </div>
      </div>
      {thanks ? (
        <p className="mt-2 text-sm text-ink" role="status">
          Thanks — I&apos;ll wait for stronger signals before saying that again.
        </p>
      ) : null}
    </li>
  );
}

const PAGE = 25;

export default function NoticedPage() {
  const { snapshot, send } = useNudge();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [limit, setLimit] = useState(PAGE);
  const [thanked, setThanked] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => [...(snapshot?.inferences ?? [])].sort((a, b) => b.t - a.t), [snapshot?.inferences]);
  const filtered = useMemo(() => sorted.filter((i) => matchesFilter(i, filter)), [sorted, filter]);
  const shown = filtered.slice(0, limit);
  const groups = useMemo(() => {
    const m = new Map<string, Inference[]>();
    for (const i of shown) {
      const k = formatDay(i.t);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return Array.from(m.entries());
  }, [shown]);

  if (!snapshot) return <PageSkeleton />;
  const learning = snapshot.learningDaysLeft > 0 && !snapshot.settings.demoMode;

  const feedback = async (inf: Inference, f: 'right' | 'wrong') => {
    await send({ type: 'inferenceFeedback', id: inf.id, feedback: f });
    setThanked((prev) => {
      const next = new Set(prev);
      if (f === 'wrong') next.add(inf.id);
      else next.delete(inf.id);
      return next;
    });
  };

  return (
    <div className="n-rise">
      <PageHeader
        title="What I noticed"
        lede="Every guess I made, and exactly why. You're the expert on you — tell me when I got it wrong."
      />

      <div className="flex flex-col gap-6">
        <SensitivityCard s={snapshot.settings.sensitivity} />

        <section aria-labelledby="timeline-title" className="n-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="timeline-title" className="n-h2">
              Timeline
            </h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    setLimit(PAGE);
                  }}
                  className={`min-h-[2.75rem] rounded-full px-4 text-sm font-semibold ${filter === f.id ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-surface2'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            {groups.length === 0 ? (
              <EmptyState>
                {learning
                  ? "I'm still in learning mode, quietly getting to know your rhythm. My guesses will show up here, each with its reason."
                  : 'When I notice something, it will show up here with a plain-English reason.'}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-6">
                {groups.map(([day, items]) => (
                  <div key={day}>
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{day}</h3>
                    <ul className="flex flex-col gap-3">
                      {items.map((inf) => (
                        <InferenceRow key={inf.id} inf={inf} thanks={thanked.has(inf.id)} onFeedback={(f) => void feedback(inf, f)} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {filtered.length > limit ? (
              <div className="mt-5 text-center">
                <button type="button" className="n-btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
                  Show older ({filtered.length - limit} more)
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
