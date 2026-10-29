'use client';

import { useMemo, useState } from 'react';
import { STRATEGIES, STRATEGY_BY_ID, rankForDisplay, type RankedStrategy } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { Card, EmptyState, PageHeader, PageSkeleton, Pill } from '@/components/ui';

function band(rate: number): { label: string; tone: 'accent' | 'calm' | 'neutral' } {
  if (rate >= 0.6) return { label: 'Works for you', tone: 'accent' };
  if (rate >= 0.4) return { label: 'Mixed', tone: 'calm' };
  return { label: 'Not your thing, for now', tone: 'neutral' };
}

function StrategyRow({ r, rank }: { r: RankedStrategy; rank: number }) {
  const [open, setOpen] = useState(false);
  const card = STRATEGY_BY_ID[r.id];
  const name = card?.name ?? r.id.replace(/_/g, ' ');
  const b = band(r.rate);
  const pct = Math.round(r.rate * 100);
  const rated = r.up + r.down;
  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
          <span aria-hidden="true" className="w-6 shrink-0 text-right text-sm font-bold text-muted">
            {rank}
          </span>
          <span className="min-w-0 break-words font-semibold text-ink">{name}</span>
        </div>
        <div className="flex flex-1 items-center gap-3 pl-9 sm:pl-0">
          <div
            className="relative h-3 flex-1 rounded-full bg-surface2"
            title={`${name}: helped ${r.up} of ${rated} times you rated it`}
            aria-hidden="true"
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <span className="w-28 shrink-0 text-sm text-ink">
            👍 {r.up} <span className="text-muted">·</span> 👎 {r.down}
          </span>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 pl-9 sm:pl-[17.5rem]">
        <span className="sr-only">
          Helped {r.up} of {rated} times you rated it.
        </span>
        <Pill tone={b.tone}>{b.label}</Pill>
        {card ? (
          <button
            type="button"
            className="min-h-[2.75rem] rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface2 hover:text-ink"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide why it works' : 'Why it works'}
          </button>
        ) : null}
      </div>
      {open && card ? <p className="mt-2 pl-9 text-sm text-ink sm:pl-[17.5rem]">{card.why_it_works}</p> : null}
    </li>
  );
}

export default function WorksPage() {
  const { snapshot } = useNudge();
  const ranked = useMemo(() => rankForDisplay(snapshot?.stats ?? {}), [snapshot?.stats]);
  const untried = useMemo(() => {
    const seen = new Set(Object.entries(snapshot?.stats ?? {}).filter(([, s]) => s.up + s.down > 0).map(([id]) => id));
    const pool = STRATEGIES.filter((c) => !seen.has(c.id) && !c.is_rest);
    const offset = new Date().getDate() % Math.max(1, pool.length);
    return [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, 4);
  }, [snapshot?.stats]);

  if (!snapshot) return <PageSkeleton />;
  const totalRatings = ranked.reduce((a, r) => a + r.up + r.down, 0);

  return (
    <div className="n-rise">
      <PageHeader
        title="What works for me"
        lede="Built from your own 👍 and 👎 after each idea. I mostly suggest what helps you, and now and then something new — so favourites don't wear out."
      />
      <div className="flex flex-col gap-6">
        <Card
          id="ranked"
          title="Your strategies, ranked"
          description={totalRatings ? `Based on ${totalRatings} quick ratings. The bar shows how often each one helped.` : undefined}
        >
          {ranked.length ? (
            <ol className="divide-y divide-line">
              {ranked.map((r, i) => (
                <StrategyRow key={r.id} r={r} rank={i + 1} />
              ))}
            </ol>
          ) : (
            <EmptyState>After you try an idea, a quick 👍 or 👎 teaches me what works for you. It&apos;ll show up here.</EmptyState>
          )}
        </Card>

        <Card id="untried" title="Ideas you haven't tried yet" description="No pressure. They're here if you're curious.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {untried.map((c) => (
              <li key={c.id} className="rounded-soft border border-line bg-surface2/60 p-4">
                <p className="font-semibold text-ink">{c.name}</p>
                <p className="mt-1 text-sm text-muted">{c.why_it_works}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
