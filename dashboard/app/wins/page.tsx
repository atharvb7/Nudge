'use client';

import { useMemo, useState } from 'react';
import { DAY, THEMES, WIN_SOUNDS, dayKey, unlockedFor, type Win } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { Card, EmptyState, PageHeader, PageSkeleton, Toggle, formatDay, formatTime } from '@/components/ui';
import { playWinSound } from '@/lib/sound';

const KIND: Record<Win['kind'], { icon: string; label: string }> = {
  started: { icon: '🌱', label: 'Started' },
  step_done: { icon: '✅', label: 'Did a step' },
  paused_start: { icon: '🌙', label: 'Gave it a go' },
  rested: { icon: '☕', label: 'Rested on purpose' },
  brain_dump: { icon: '🧺', label: 'Brain dump' },
  checkin: { icon: '💬', label: 'Checked in' },
  came_back: { icon: '👋', label: 'Came back' },
  day_closed: { icon: '🌇', label: 'Closed the day kindly' },
};

function WeekBars({ wins }: { wins: Win[] }) {
  const days = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 7 }).map((_, idx) => {
      const t = now - (6 - idx) * DAY;
      const k = dayKey(t);
      return {
        k,
        label: idx === 6 ? 'Today' : new Date(t).toLocaleDateString([], { weekday: 'short' }),
        full: idx === 6 ? 'Today' : new Date(t).toLocaleDateString([], { weekday: 'long' }),
        count: wins.filter((w) => dayKey(w.t) === k).length,
      };
    });
  }, [wins]);
  const max = Math.max(1, ...days.map((d) => d.count));

  return (
    <figure>
      <div className="flex h-44 items-end gap-2 sm:gap-4" aria-hidden="true">
        {days.map((d) => (
          <div key={d.k} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.full}: ${d.count} ${d.count === 1 ? 'attempt' : 'attempts'}`}>
            <span className="text-sm font-semibold text-ink">{d.count}</span>
            <div
              className={`w-full max-w-[3rem] rounded-t-[4px] ${d.count ? 'bg-accent' : 'bg-surface2'}`}
              style={{ height: d.count ? `${Math.max(8, (d.count / max) * 100)}%` : '6px' }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-2 sm:gap-4" aria-hidden="true">
        {days.map((d) => (
          <span key={d.k} className="flex-1 text-center text-xs font-semibold text-muted">
            {d.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        Attempts over the last 7 days: {days.map((d) => `${d.full} ${d.count}`).join(', ')}.
      </figcaption>
    </figure>
  );
}

const PAGE = 12;

export default function WinsPage() {
  const { snapshot, updateSettings } = useNudge();
  const [limit, setLimit] = useState(PAGE);
  const wins = useMemo(() => [...(snapshot?.wins ?? [])].sort((a, b) => b.t - a.t), [snapshot?.wins]);

  if (!snapshot) return <PageSkeleton />;
  const total = wins.length;
  const s = snapshot.settings;
  const unlocked = new Set([...s.unlockedThemes, ...unlockedFor(total)]);
  const paused = wins.filter((w) => w.kind === 'paused_start').length;
  const rested = wins.filter((w) => w.kind === 'rested').length;

  return (
    <div className="n-rise">
      <PageHeader title="Wins" lede="Every attempt counts — including the ones that paused." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          <Card id="total" title="All your attempts">
            <p className="text-5xl font-bold text-ink">{total}</p>
            <p className="mt-2 text-sm text-muted">
              That includes {paused} {paused === 1 ? 'start' : 'starts'} that paused and {rested} {rested === 1 ? 'rest' : 'rests'} taken on purpose. They all count.
            </p>
          </Card>
          <Card id="week" title="This week" description="Quiet days are fine. Rest is part of it.">
            <WeekBars wins={wins} />
          </Card>
        </div>

        <Card id="log" title="Wins log">
          {wins.length ? (
            <>
              <ul className="flex flex-col gap-2">
                {wins.slice(0, limit).map((w) => (
                  <li key={w.id} className="flex items-start gap-3 rounded-soft p-2 hover:bg-surface2/60">
                    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface2 text-lg">
                      {KIND[w.kind]?.icon ?? '✨'}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-ink">{w.label}</p>
                      <p className="text-sm text-muted">
                        <span className="sr-only">{KIND[w.kind]?.label}. </span>
                        {formatDay(w.t)} · {formatTime(w.t)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {wins.length > limit ? (
                <div className="mt-4 text-center">
                  <button type="button" className="n-btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
                    Show more
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState>Opening a task, trying for two minutes, even resting on purpose — they all land here.</EmptyState>
          )}
        </Card>
      </div>

      <section aria-labelledby="treats-title" className="n-card mt-6">
        <h2 id="treats-title" className="n-h2">
          Little treats
        </h2>
        <p className="mt-1 text-sm text-muted">
          Optional colours and sounds that unlock as your attempts add up. They never expire and nothing is lost if you take time away.
        </p>

        <h3 className="mt-5 font-bold text-ink">Colour themes</h3>
        <div role="radiogroup" aria-label="Colour theme" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {THEMES.map((t) => {
            const open = unlocked.has(t.id);
            const selected = s.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!open}
                disabled={!open}
                onClick={() => open && void updateSettings({ theme: t.id })}
                className={`flex min-h-[6rem] flex-col items-start gap-2 rounded-card border p-3 text-left transition-colors ${
                  selected ? 'border-accent ring-2 ring-accent' : 'border-line'
                } ${open ? 'bg-surface hover:bg-surface2' : 'cursor-not-allowed bg-surface2/60'}`}
              >
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-6 w-6 rounded-full" style={{ background: t.accent, opacity: open ? 1 : 0.4 }} />
                  <span className="h-6 w-6 rounded-full border border-line" style={{ background: t.soft, opacity: open ? 1 : 0.4 }} />
                </span>
                <span className="font-semibold text-ink">{t.name}</span>
                <span className="text-xs text-muted">{open ? t.description : `Unlocks at ${t.unlockAt} attempts`}</span>
              </button>
            );
          })}
        </div>

        <h3 className="mt-6 font-bold text-ink">Win sounds</h3>
        <Toggle
          id="win-sounds"
          checked={s.winSounds}
          onChange={(v) => void updateSettings({ winSounds: v })}
          label="Play a soft sound for wins"
          description="Off by default. Never plays on its own otherwise."
        />
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {WIN_SOUNDS.map((snd) => {
            const open = total >= snd.unlockAt;
            return (
              <li key={snd.id} className="flex items-center justify-between gap-2 rounded-soft border border-line p-3">
                <span>
                  <span className="block font-semibold text-ink">{snd.name}</span>
                  <span className="text-xs text-muted">{open ? 'Unlocked' : `Unlocks at ${snd.unlockAt} attempts`}</span>
                </span>
                <button
                  type="button"
                  className="n-btn-soft px-4 text-sm"
                  disabled={!open}
                  onClick={() => playWinSound(snd.id)}
                  aria-label={`Preview ${snd.name}`}
                >
                  Play
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
