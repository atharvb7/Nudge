'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { COPY } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { PageSkeleton } from './ui';

const NAV = [
  { href: '/', label: 'Today', icon: '☀️' },
  { href: '/noticed', label: 'What I noticed', icon: '🔎' },
  { href: '/works', label: 'What works for me', icon: '🌱' },
  { href: '/wins', label: 'Wins', icon: '✨' },
  { href: '/privacy', label: 'Privacy', icon: '🔒' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
  { href: '/demo', label: 'Demo', icon: '🎬' },
  { href: '/insights', label: 'Insights', icon: '💬' },
];

function StatusPill() {
  const { status } = useNudge();
  const map = {
    loading: { dot: 'bg-line', text: 'Getting things ready…' },
    connected: { dot: 'bg-accent', text: 'Connected to your Nudge extension' },
    demo: { dot: 'bg-calm', text: 'Sample data (demo mode)' },
    disconnected: { dot: 'bg-sun', text: "Can't reach the extension right now" },
  } as const;
  const m = map[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex min-h-[2.25rem] items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink"
    >
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
      {m.text}
    </span>
  );
}

function DisconnectedBanner() {
  const { status, reconnect, switchToSampleData } = useNudge();
  if (status !== 'disconnected') return null;
  return (
    <div role="region" aria-label="Connection" className="mb-6 rounded-card border border-line bg-sun-soft p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <p className="text-ink">
        I can&apos;t reach your Nudge extension at the moment, so you&apos;re seeing the last thing I saw. Nothing is lost.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
        <button type="button" className="n-btn-primary" onClick={() => void reconnect()}>
          Try again
        </button>
        <button type="button" className="n-btn-ghost" onClick={() => void switchToSampleData()}>
          Use sample data
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { snapshot, status } = useNudge();
  const [menuOpen, setMenuOpen] = useState(false);
  const style = snapshot?.settings.wordingStyle ?? 'warm';

  useEffect(() => setMenuOpen(false), [pathname]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const ready = status !== 'loading' && snapshot;

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-5 focus:py-3 focus:font-semibold focus:text-ink focus:shadow-card"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-h-tap items-center gap-2 rounded-full pr-2 text-xl font-bold text-ink" aria-label="Nudge home">
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-lg">
              🌿
            </span>
            Nudge
          </Link>
          <div className="flex items-center gap-2">
            <StatusPill />
            <button
              type="button"
              className="n-btn-ghost px-4 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="primary-nav"
              onClick={() => setMenuOpen((v) => !v)}
            >
              Menu
            </button>
          </div>
        </div>
        <nav
          id="primary-nav"
          aria-label="Main"
          className={`mx-auto max-w-[1100px] px-4 pb-3 sm:px-6 ${menuOpen ? 'block' : 'hidden'} lg:block`}
        >
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-wrap lg:gap-1">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-tap items-center gap-2 rounded-full px-4 text-[0.95rem] font-semibold transition-colors ${
                      active ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-surface2 hover:text-ink'
                    }`}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1100px] px-4 py-8 outline-none sm:px-6 sm:py-10">
        <DisconnectedBanner />
        {ready || pathname.startsWith('/insights') ? children : <PageSkeleton />}
      </main>

      <footer className="mx-auto max-w-[1100px] px-4 pb-10 pt-4 text-sm text-muted sm:px-6">
        <div className="flex flex-col gap-1 border-t border-line pt-6 sm:flex-row sm:justify-between">
          <p>{COPY[style].disclaimer}</p>
          <p>Everything here stays in your browser.</p>
        </div>
      </footer>
    </>
  );
}
