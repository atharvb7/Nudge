'use client';

import { useMemo, useState } from 'react';
import type { Inference, Sensitivity } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { Card, EmptyState, PageHeader, PageSkeleton, formatDay, formatTime } from '@/components/ui';

type StateKey = Inference['state'];

const STATE_META: Record<StateKey, { label: string; cls: string; icon: string }> = {
  flow: { label: 'Flow', cls: 'bg-accent-soft text-ink', icon: '🌊' },
  stuck: { label: 'Stuck', cls: 'bg-calm-soft text-ink', icon: '🧩' },
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

type Family = 'stuck' | 'flow' | 'depleted' | 'away' | 'long_break' | 'neutral';

interface Group {
  key: string;
  family: Family;
  items: Inference[]; // newest first
}

const FAMILY_NOUN: Record<Family, [string, string]> = {
  stuck: ['stuck moment', 'stuck moments'],
  flow: ['flow stretch', 'flow stretches'],
  depleted: ['running-low moment', 'running-low moments'],
  away: ['time away', 'times away'],
  long_break: ['long break', 'long breaks'],
  neutral: ['quiet moment', 'quiet moments'],
};

function familyOf(i: Inference): Family {
  return i.state === 'restuck' ? 'stuck' : (i.state as Family);
}

function partOfDay(t: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date(t).getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function partPhrase(t: number): string {
  const part = partOfDay(t);
  const isToday = new Date(t).toDateString() === new Date().toDateString();
  if (isToday) return part === 'night' ? 'tonight' : `this ${part}`;
  return part === 'night' ? 'at night' : `in the ${part}`;
}

/** Repeats of the same kind of moment in the same part of a day become one group. */
function groupDay(items: Inference[]): Group[] {
  const map = new Map<string, Group>();
  for (const i of items) {
    const fam = familyOf(i);
    const key = `${fam}-${partOfDay(i.t)}`;
    const g = map.get(key);
    if (g) g.items.push(i);
    else map.set(key, { key: `${key}-${i.id}`, family: fam, items: [i] });
  }
  return Array.from(map.values()).sort((a, b) => b.items[0].t - a.items[0].t);
}

function FeedbackButtons({ value, onFeedback, label }: { value: 'right' | 'wrong' | undefined; onFeedback: (f: 'right' | 'wrong') => void; label: string }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="mr-1 text-sm text-muted">Was I right?</span>
      <button
        type="button"
        aria-pressed={value === 'right'}
        onClick={() => onFeedback('right')}
        className={`n-btn px-4 text-sm ${value === 'right' ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}
      >
        Right
      </button>
      <button
        type="button"
        aria-pressed={value === 'wrong'}
        onClick={() => onFeedback('wrong')}
        className={`n-btn px-4 text-sm ${value === 'wrong' ? 'bg-calm text-accent-ink' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}
      >
        Wrong
      </button>
    </div>
  );
}

function GroupRow({ group, onFeedback, thanks }: { group: Group; onFeedback: (f: 'right' | 'wrong') => void; thanks: boolean }) {
  const latest = group.items[0];
  const oldest = group.items[group.items.length - 1];
  const many = group.items.length > 1;
  const meta = many ? STATE_META[group.family] ?? STATE_META.neutral : STATE_META[latest.state] ?? STATE_META.neutral;
  const feedbacks = new Set(group.items.map((i) => i.feedback));
  const value = feedbacks.size === 1 ? latest.feedback : undefined;
  const [one, several] = FAMILY_NOUN[group.family] ?? FAMILY_NOUN.neutral;
  return (
    <li className="rounded-soft border border-line bg-surface p-4" data-ids={group.items.map((i) => i.id).join(' ')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${meta.cls}`}>
          <span aria-hidden="true">{meta.icon}</span>
          {meta.label}
        </span>
        <span className="text-sm text-muted">
          {many ? (
            <>
              <time dateTime={new Date(oldest.t).toISOString()}>{formatTime(oldest.t)}</time>
              {' – '}
              <time dateTime={new Date(latest.t).toISOString()}>{formatTime(latest.t)}</time>
            </>
          ) : (
            <time dateTime={new Date(latest.t).toISOString()}>{formatTime(latest.t)}</time>
          )}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {many ? (
            <p className="font-semibold text-ink">
              {group.items.length} {group.items.length === 1 ? one : several} {partPhrase(latest.t)}
            </p>
          ) : null}
          <p className="text-ink">
            {many ? <span className="text-muted">Latest: </span> : null}
            {latest.reason}
          </p>
          <p className="mt-1 text-sm text-muted">{whatIDid(latest)}</p>
          {many ? (
            <details className="mt-2">
              <summary className="inline-flex min-h-[2.75rem] cursor-pointer items-center rounded-full px-1 text-sm font-semibold text-muted hover:text-ink">
                See all {group.items.length}
              </summary>
              <ul className="mt-1 flex flex-col gap-2 border-l-2 border-line pl-3">
                {group.items.map((i) => (
                  <li key={i.id} className="text-sm">
                    <time className="font-semibold text-ink" dateTime={new Date(i.t).toISOString()}>
                      {formatTime(i.t)}
                    </time>{' '}
                    <span className="text-ink">{i.reason}</span> <span className="text-muted">{whatIDid(i)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <FeedbackButtons value={value} onFeedback={onFeedback} label={many ? `Was I right about these ${group.items.length}?` : 'Was this right?'} />
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
  const { snapshot, act, send, updateSettings } = useNudge();
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
    return Array.from(m.entries()).map(([day, items]) => [day, groupDay(items)] as const);
  }, [shown]);

  if (!snapshot) return <PageSkeleton />;
  const learning = snapshot.learningDaysLeft > 0 && !snapshot.settings.demoMode;

  // One answer covers the whole group, but only tunes sensitivity once.
  const feedback = async (group: Group, f: 'right' | 'wrong') => {
    const todo = group.items.filter((i) => i.feedback !== f);
    if (todo.length) {
      let tuned: unknown;
      try {
        tuned = await send({ type: 'inferenceFeedback', id: todo[0].id, feedback: f });
      } catch {
        return;
      }
      for (const i of todo.slice(1)) await act({ type: 'inferenceFeedback', id: i.id, feedback: f });
      if (todo.length > 1 && tuned && typeof tuned === 'object' && 'stuck' in tuned) {
        await updateSettings({ sensitivity: tuned as Sensitivity });
      }
    }
    setThanked((prev) => {
      const next = new Set(prev);
      if (f === 'wrong') next.add(group.key);
      else next.delete(group.key);
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

          <p className="mt-2 text-sm text-muted">Getting stuck is normal. This is only so I know when a hand might help.</p>

          <div className="mt-5">
            {groups.length === 0 ? (
              <EmptyState>
                {learning
                  ? "I'm still in learning mode, quietly getting to know your rhythm. My guesses will show up here, each with its reason."
                  : 'When I notice something, it will show up here with a plain-English reason.'}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-6">
                {groups.map(([day, dayGroups]) => (
                  <div key={day}>
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{day}</h3>
                    <ul className="flex flex-col gap-3">
                      {dayGroups.map((g) => (
                        <GroupRow key={g.key} group={g} thanks={thanked.has(g.key)} onFeedback={(f) => void feedback(g, f)} />
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
