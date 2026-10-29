'use client';

import type { ReactNode } from 'react';

export function PageHeader({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="n-h1">{title}</h1>
        {lede ? <p className="n-lede">{lede}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  children,
  className = '',
  as: As = 'section',
  headingLevel = 2,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <As className={`n-card ${className}`} aria-labelledby={title && id ? `${id}-title` : undefined} id={id}>
      {title ? (
        <H id={id ? `${id}-title` : undefined} className="n-h2">
          {title}
        </H>
      ) : null}
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      {children ? <div className={title || description ? 'mt-4' : ''}>{children}</div> : null}
    </As>
  );
}

export function EmptyState({ title = "Nothing here yet — and that's okay.", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="rounded-soft border border-dashed border-line bg-surface2/50 px-5 py-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="font-semibold text-ink">
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-12 w-[4.5rem] shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
          checked ? 'border-accent bg-accent' : 'border-line bg-surface2'
        }`}
      >
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
        <span
          aria-hidden="true"
          className={`absolute h-8 w-8 rounded-full bg-surface shadow-card transition-transform ${checked ? 'translate-x-[2.15rem]' : 'translate-x-1.5'}`}
        />
      </button>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`n-skeleton ${className}`} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Getting things ready…</span>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'calm' | 'sun' }) {
  const tones = {
    neutral: 'bg-surface2 text-ink',
    accent: 'bg-accent-soft text-ink',
    calm: 'bg-calm-soft text-ink',
    sun: 'bg-sun-soft text-ink',
  } as const;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>{children}</span>;
}

export function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}
