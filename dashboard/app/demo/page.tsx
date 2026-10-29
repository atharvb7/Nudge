'use client';

import { useState } from 'react';
import { detectCrisis, safetyPayload, type SafetyPayload, type SimulateKind } from '@nudge/shared';
import { useNudge } from '@/lib/nudge-context';
import { Card, PageHeader, PageSkeleton } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NudgePreview, type PreviewKind } from '@/components/NudgePreview';

const SIMS: Array<{ kind: SimulateKind; label: string; what: string }> = [
  { kind: 'stuck', label: 'Simulate stuck', what: 'Lots of tab switching, keeps returning to the task, almost no typing there.' },
  { kind: 'restuck', label: 'Simulate re-stuck', what: 'A step started, then activity dropped and escape tabs crept back in.' },
  { kind: 'depleted', label: 'Simulate depleted', what: 'A long late-night session with growing pauses.' },
  { kind: 'long_break', label: 'Simulate long break', what: 'A 5-minute break that drifted to 20+ minutes on social media.' },
  { kind: 'crisis', label: 'Simulate crisis phrase', what: 'Someone types words that sound like they might not be safe. Coaching stops; support comes first.' },
];

// A sample phrase used only to exercise the on-device classifier. Never stored.
const SAMPLE_CRISIS_PHRASE = "I don't want to be alive anymore";

export default function DemoPage() {
  const { snapshot, send, status } = useNudge();
  const [preview, setPreview] = useState<{ kind: PreviewKind; nonce: number } | null>(null);
  const [safety, setSafety] = useState<SafetyPayload | null>(null);
  const [msg, setMsg] = useState('');
  const [confirmSeed, setConfirmSeed] = useState(false);

  if (!snapshot) return <PageSkeleton />;
  const connected = status === 'connected';
  const s = snapshot.settings;

  const simulate = async (kind: SimulateKind) => {
    if (kind === 'crisis') {
      const level = detectCrisis(SAMPLE_CRISIS_PHRASE);
      setSafety(level === 'none' ? null : safetyPayload(s.region, level));
    }
    try {
      await send({ type: 'simulate', kind });
    } catch {
      // Preview still works below even if the extension didn't answer.
    }
    if (connected && kind !== 'crisis') {
      setPreview(null);
      setMsg('Sent to the extension — look at the bottom corner of this tab. It’s also logged in “What I noticed”.');
    } else {
      setPreview({ kind, nonce: Date.now() });
      setMsg(
        kind === 'crisis'
          ? 'Showing what happens on a crisis phrase. The phrase is never saved anywhere.'
          : 'Here’s exactly how it appears — bottom corner, calm, no sound. Logged in “What I noticed”.',
      );
    }
  };

  const loadSample = async () => {
    setConfirmSeed(false);
    try {
      await send({ type: 'loadDemoData' });
    } catch {
      setMsg('That didn’t go through. Your data is unchanged — want to try again?');
      return;
    }
    setMsg('A sample week is loaded. Have a look around — Today, What I noticed, What works, Wins.');
  };

  return (
    <div className="n-rise">
      <PageHeader
        title="Demo mode"
        lede="Walk through the key moments without waiting for them to happen. Great for showing Nudge to someone."
      />
      <p role="status" aria-live="polite" className={msg ? 'mb-6 rounded-soft bg-accent-soft p-3 text-ink' : 'sr-only'}>
        {msg}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card id="moments" title="Simulate a moment" description={connected ? 'These go to your extension, which shows them in the active tab.' : 'You’re on sample data, so a live preview appears in the corner.'}>
          <ul className="flex flex-col gap-3">
            {SIMS.map((sim) => (
              <li key={sim.kind} className="flex flex-col gap-2 rounded-soft border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted sm:max-w-[60%]">{sim.what}</p>
                <button type="button" className={sim.kind === 'crisis' ? 'n-btn-calm shrink-0' : 'n-btn-soft shrink-0'} onClick={() => void simulate(sim.kind)}>
                  {sim.label}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card id="sample" title="Sample history" description="A believable week: wins, ratings, guesses with reasons, and a few “Wrong”s that tuned things.">
            <button type="button" className="n-btn-primary" onClick={() => (connected ? setConfirmSeed(true) : void loadSample())}>
              Load 1-week sample history
            </button>
          </Card>
          <Card id="tips" title="Things to show" headingLevel={2}>
            <ol className="list-inside list-decimal space-y-1 text-sm text-ink">
              <li>Simulate stuck → Help me start → try “Make it smaller”.</li>
              <li>Switch wording to “Clear & literal” in Settings, then try again.</li>
              <li>Tap “Wrong” on a guess in What I noticed.</li>
              <li>Set energy to 1 spoon on Today and watch the plan shrink.</li>
              <li>Open Privacy to show exactly what is and isn’t tracked.</li>
            </ol>
          </Card>
        </div>
      </div>

      {preview ? (
        <NudgePreview kind={preview.kind} nonce={preview.nonce} style={s.wordingStyle} stats={snapshot.stats} safety={safety} onClose={() => setPreview(null)} />
      ) : null}

      <ConfirmDialog
        open={confirmSeed}
        title="Replace with sample data?"
        confirmLabel="Yes, load the sample"
        cancelLabel="Keep my data"
        onConfirm={() => void loadSample()}
        onClose={() => setConfirmSeed(false)}
      >
        <p>This swaps what&apos;s in your extension for a sample week. You might want to export your own data first on the Privacy page.</p>
      </ConfirmDialog>
    </div>
  );
}
