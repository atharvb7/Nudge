'use client';

import { useEffect, useState } from 'react';
import type { A11ySettings, Region, Settings } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { Card, PageHeader, PageSkeleton, Toggle } from '@/components/ui';
import { Segmented } from '@/components/Segmented';

function validUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function SettingsPage() {
  const { snapshot, updateSettings, recheckHealth } = useNudge();
  const stored = snapshot?.settings.backendUrl ?? '';
  const [backend, setBackend] = useState(stored);
  const [backendHint, setBackendHint] = useState('');

  useEffect(() => setBackend(stored), [stored]);

  if (!snapshot) return <PageSkeleton />;
  const s = snapshot.settings;
  const a11y = (patch: Partial<A11ySettings>) => void updateSettings({ a11y: { ...s.a11y, ...patch } });
  const set = (patch: Partial<Settings>) => void updateSettings(patch);
  const dndOn = !!s.dndUntil && s.dndUntil > Date.now();

  return (
    <div className="n-rise">
      <PageHeader title="Settings" lede="Make Nudge feel comfortable. Changes sync to the extension straight away." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="reading" title="Reading & seeing">
          <Segmented
            name="font"
            legend="Font"
            value={s.a11y.font}
            onChange={(v) => a11y({ font: v })}
            options={[
              { value: 'default', label: 'Atkinson Hyperlegible', hint: 'Clear, distinct letters' },
              { value: 'dyslexic', label: 'Dyslexia-friendly', hint: 'Lexend, extra spacing' },
            ]}
          />
          <Segmented
            name="text-size"
            legend="Text size"
            value={String(s.a11y.textScale)}
            onChange={(v) => a11y({ textScale: Number(v) as A11ySettings['textScale'] })}
            options={[
              { value: '1', label: 'Regular' },
              { value: '1.15', label: 'Large' },
              { value: '1.3', label: 'Larger' },
              { value: '1.5', label: 'Largest' },
            ]}
          />
          <Toggle id="contrast" checked={s.a11y.highContrast} onChange={(v) => a11y({ highContrast: v })} label="High contrast" description="Stronger text and borders." />
          <Segmented
            name="motion"
            legend="Motion"
            value={s.a11y.reducedMotion}
            onChange={(v) => a11y({ reducedMotion: v })}
            options={[
              { value: 'system', label: 'Follow my device' },
              { value: 'on', label: 'Reduce motion' },
              { value: 'off', label: 'Allow gentle motion' },
            ]}
          />
        </Card>

        <Card id="words" title="Words & help">
          <Segmented
            name="wording"
            legend="Wording style"
            value={s.wordingStyle}
            onChange={(v) => set({ wordingStyle: v })}
            options={[
              { value: 'warm', label: 'Warm & casual', hint: '“Want to just open it?”' },
              { value: 'literal', label: 'Clear & literal', hint: '“Open the file DBMS.pdf.”' },
            ]}
          />
          <Toggle id="explain" checked={s.explainWhy} onChange={(v) => set({ explainWhy: v })} label="Explain why" description="Add one plain sentence about why each step might help." />
          <Toggle id="anchor" checked={s.timeAnchor} onChange={(v) => set({ timeAnchor: v })} label="Time anchors" description="A tiny “~30 min have passed” chip during sessions." />
          <Toggle id="hydrate" checked={s.hydrationChip} onChange={(v) => set({ hydrationChip: v })} label="Water & stretch chip" description="After 90 minutes of flow — tiny, and easy to ignore." />
          <Segmented
            name="region"
            legend="Support resources for"
            value={s.region}
            onChange={(v) => set({ region: v as Region })}
            options={[
              { value: 'IN', label: 'India' },
              { value: 'US', label: 'US' },
              { value: 'UK', label: 'UK' },
              { value: 'OTHER', label: 'Elsewhere' },
            ]}
          />
        </Card>

        <Card id="quiet" title="Quiet times">
          <Toggle
            id="quiet-hours"
            checked={s.quietHours.enabled}
            onChange={(v) => set({ quietHours: { ...s.quietHours, enabled: v } })}
            label="Quiet hours"
            description="No nudges or chips during these hours."
          />
          <div className="grid grid-cols-2 gap-3 pb-3">
            <div>
              <label htmlFor="qh-start" className="n-label">
                From
              </label>
              <input
                id="qh-start"
                type="time"
                className="n-input"
                value={s.quietHours.start}
                disabled={!s.quietHours.enabled}
                onChange={(e) => e.target.value && set({ quietHours: { ...s.quietHours, start: e.target.value } })}
              />
            </div>
            <div>
              <label htmlFor="qh-end" className="n-label">
                Until
              </label>
              <input
                id="qh-end"
                type="time"
                className="n-input"
                value={s.quietHours.end}
                disabled={!s.quietHours.enabled}
                onChange={(e) => e.target.value && set({ quietHours: { ...s.quietHours, end: e.target.value } })}
              />
            </div>
          </div>
          <div className="border-t border-line pt-3">
            <p className="font-semibold text-ink">Do not disturb</p>
            <p className="text-sm text-muted" aria-live="polite">
              {dndOn
                ? `On until ${new Date(s.dndUntil as number).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                : 'For exams, calls, or whenever. Fullscreen and video calls are already quiet automatically.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { label: '1 hour', ms: 60 * 60_000 },
                { label: '3 hours', ms: 3 * 60 * 60_000 },
              ].map((o) => (
                <button key={o.label} type="button" className="n-btn-soft px-4 text-sm" onClick={() => set({ dndUntil: Date.now() + o.ms })}>
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                className="n-btn-soft px-4 text-sm"
                onClick={() => {
                  const t = new Date();
                  t.setHours(24, 0, 0, 0);
                  set({ dndUntil: t.getTime() });
                }}
              >
                Until tomorrow
              </button>
              {dndOn ? (
                <button type="button" className="n-btn-ghost px-4 text-sm" onClick={() => set({ dndUntil: null })}>
                  Turn off
                </button>
              ) : null}
            </div>
          </div>
        </Card>

        <Card id="helper" title="AI helper address" description="Where the local helper runs. Leave it as is unless you moved it.">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = backend.trim().replace(/\/$/, '');
              if (!validUrl(v)) {
                setBackendHint('That needs to be a web address, like http://localhost:8000.');
                return;
              }
              set({ backendUrl: v });
              setBackendHint('Saved. Checking it now.');
              window.setTimeout(recheckHealth, 50);
            }}
            noValidate
          >
            <label htmlFor="backend-url" className="n-label">
              Helper address
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="backend-url"
                className="n-input sm:flex-1"
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                inputMode="url"
                spellCheck={false}
                aria-describedby="backend-hint"
              />
              <button type="submit" className="n-btn-soft">
                Save
              </button>
            </div>
            <p id="backend-hint" className="mt-1 min-h-[1.5em] text-sm text-muted" aria-live="polite">
              {backendHint}
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
