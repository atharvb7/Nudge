'use client';

import { useState } from 'react';
import { COPY, CRISIS_RESOURCES, TRUSTED_PERSON_LINE } from '@nudge/shared';
import { useNudge, type HealthState } from '@/lib/nudge-context';
import { Card, PageHeader, PageSkeleton, Pill, Toggle } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SiteListEditor } from '@/components/SiteListEditor';

const TRACKED = [
  'How often you switch tabs (a count per minute)',
  'How often you come back to your pinned task tab',
  'How many keys, scrolls and clicks happen per tab — counts only, never which keys',
  'Idle gaps, from Chrome’s idle signal',
  'How long a session has been going, and the hour of day',
  'The website name (like docs.google.com) — never the full address',
];

const NOT_TRACKED = [
  'No webcam, ever',
  'No page content — I never read what’s on the page',
  'No keystroke values — I can’t see what you type',
  'No audio storage — voice is turned into text, then the audio is dropped',
  'No full URLs, page titles of other tabs, or browsing history',
  'No account, no server copy of your data',
];

function AiStatus({ health, onRecheck }: { health: HealthState; onRecheck: () => void }) {
  let body: React.ReactNode;
  if (health.kind === 'checking') {
    body = <p className="text-muted">Checking…</p>;
  } else if (health.kind === 'offline' || health.health.llm === 'none') {
    body = (
      <>
        <Pill tone="neutral">
          <span aria-hidden="true">📇</span> Built-in cards only
        </Pill>
        <p className="mt-2 text-ink">
          {health.kind === 'offline'
            ? 'AI helper is off — Nudge uses its built-in cards. Help still works, fully offline.'
            : 'The helper is running but no AI model is available, so Nudge uses its built-in cards.'}
        </p>
      </>
    );
  } else {
    const h = health.health;
    const cloud = h.llm_location === 'cloud';
    body = (
      <>
        <Pill tone={cloud ? 'calm' : 'accent'}>
          <span aria-hidden="true">{cloud ? '☁️' : '💻'}</span>
          {cloud ? 'Cloud AI (Gemini)' : 'On this computer (Ollama)'}
        </Pill>
        <p className="mt-2 text-ink">
          {cloud
            ? 'Step requests (your task words and a little context) are sent to Google’s Gemini. Sensing and nudges still run only in your browser. Whoever runs the helper can switch cloud off.'
            : 'Step ideas are generated on this computer. Nothing leaves your machine.'}
        </p>
        <ul className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
          <li>Matching ideas: {h.embeddings === 'minilm' ? 'local MiniLM model' : 'simple keyword matching'}</li>
          <li>Voice to text: {h.whisper ? 'local Whisper' : 'not set up on the helper'}</li>
        </ul>
      </>
    );
  }
  return (
    <Card id="ai" title="Where the AI runs" description="The helper only answers requests. It never stores them.">
      <div aria-live="polite">{body}</div>
      <button type="button" className="n-btn-ghost mt-4 px-4 text-sm" onClick={onRecheck}>
        Check again
      </button>
    </Card>
  );
}

export default function PrivacyPage() {
  const { snapshot, send, updateSettings, health, recheckHealth, status } = useNudge();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState('');

  if (!snapshot) return <PageSkeleton />;
  const s = snapshot.settings;
  const resources = CRISIS_RESOURCES[s.region] ?? CRISIS_RESOURCES.OTHER;

  const exportData = async () => {
    try {
      const data = await send({ type: 'exportData' });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nudge-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg('Your data file is downloading.');
    } catch {
      setMsg('I couldn’t get your data just now. Want to try again?');
    }
  };

  const deleteAll = async () => {
    setConfirm(false);
    try {
      await send({ type: 'deleteAll' });
      setMsg('All cleared. A fresh start, whenever you like.');
    } catch {
      setMsg('That didn’t go through. Nothing was changed — want to try again?');
    }
  };

  return (
    <div className="n-rise">
      <PageHeader
        title="Privacy center"
        lede="Everything Nudge knows lives in your browser. Here's exactly what that is — and what it isn't."
      />
      <p role="status" aria-live="polite" className={msg ? 'mb-6 rounded-soft bg-accent-soft p-3 text-ink' : 'sr-only'}>
        {msg}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card id="tracked" title="What I notice" description="Metadata only, computed every 30 seconds. Raw events are deleted right after.">
          <ul className="flex flex-col gap-2">
            {TRACKED.map((t) => (
              <li key={t} className="flex gap-3 text-ink">
                <span aria-hidden="true" className="text-accent">
                  •
                </span>
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card id="not-tracked" title="What I never look at">
          <ul className="flex flex-col gap-2">
            {NOT_TRACKED.map((t) => (
              <li key={t} className="flex gap-3 text-ink">
                <span aria-hidden="true" className="text-calm">
                  ✕
                </span>
                {t}
              </li>
            ))}
          </ul>
        </Card>

        <AiStatus health={health} onRecheck={recheckHealth} />

        <Card id="pause" title="Pause">
          <Toggle
            id="pause-tracking"
            checked={s.trackingPaused}
            onChange={(v) => void updateSettings({ trackingPaused: v })}
            label="Pause all noticing"
            description="Nudge stops sensing and stays quiet. You can still open it yourself any time."
          />
          {status === 'demo' ? <p className="mt-2 text-sm text-muted">You&apos;re looking at sample data, so this only changes the sample.</p> : null}
        </Card>
      </div>

      <Card id="sites" title="Sites" className="mt-6" description="Fine-tune how websites are treated. Switching between work sites never counts as being stuck.">
        <div className="grid gap-8 lg:grid-cols-3">
          <SiteListEditor
            id="excluded"
            label="Never notice on these sites"
            help="Nothing at all is counted here — not even switches."
            sites={s.excludedSites}
            onChange={(next) => void updateSettings({ excludedSites: next })}
            placeholder="e.g. mybank.com"
          />
          <SiteListEditor
            id="research"
            label="These count as work"
            help="Handy for sites like YouTube when you use them for lectures."
            sites={s.researchSites}
            onChange={(next) => void updateSettings({ researchSites: next })}
          />
          <SiteListEditor
            id="escape"
            label="These are my escape sites"
            help="Places you tend to drift to. No judgement — it just helps me notice."
            sites={s.escapeSites}
            onChange={(next) => void updateSettings({ escapeSites: next })}
            placeholder="e.g. reddit.com"
          />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card id="your-data" title="Your data" description="It's yours. Take it with you, or clear it all.">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="n-btn-primary" onClick={() => void exportData()}>
              Export my data
            </button>
            <button type="button" className="n-btn-ghost" onClick={() => setConfirm(true)}>
              Delete everything
            </button>
          </div>
        </Card>

        <Card id="limits" title="Honest limits">
          <p className="text-ink">
            Nudge only lives in this browser. It can&apos;t see your phone, so phone distractions aren&apos;t tracked — and that&apos;s on purpose for now.
          </p>
          <p className="mt-2 text-sm text-muted">
            On the roadmap: a phone companion with the exact same privacy model — on-device, metadata only, nothing stored on a server.
          </p>
        </Card>
      </div>

      <Card id="support" title="Support, not treatment" className="mt-6">
        <p className="text-ink">{COPY[s.wordingStyle].disclaimer}</p>
        <p className="mt-3 text-sm text-muted">If things ever feel like too much, you deserve real support right away:</p>
        <ul className="mt-2 flex flex-col gap-1">
          {resources.map((r) => (
            <li key={r.name} className="text-ink">
              <span className="font-semibold">{r.name}</span>
              {r.phone ? (
                <>
                  {' — '}
                  <a className="font-semibold text-accent underline underline-offset-4" href={`tel:${r.phone.replace(/[^0-9+]/g, '')}`}>
                    {r.phone}
                  </a>
                </>
              ) : null}
              {r.alt ? <span className="text-muted"> or {r.alt}</span> : null}
              {r.url ? (
                <>
                  {' — '}
                  <a className="font-semibold text-accent underline underline-offset-4" href={r.url} target="_blank" rel="noreferrer">
                    {r.url.replace(/^https?:\/\//, '')}
                  </a>
                </>
              ) : null}
              {r.note ? <span className="text-sm text-muted"> · {r.note}</span> : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">{TRUSTED_PERSON_LINE}</p>
      </Card>

      <ConfirmDialog
        open={confirm}
        title="Clear everything?"
        confirmLabel="Yes, delete it all"
        onConfirm={() => void deleteAll()}
        onClose={() => setConfirm(false)}
      >
        <p>
          This removes your plan, wins, notes and everything I&apos;ve learned about what works for you. It can&apos;t be undone. You might want to export first — totally up to you.
        </p>
      </ConfirmDialog>
    </div>
  );
}
