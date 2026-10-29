import { useState } from 'react';
import { defaultStorage, seedDemoData, type Settings } from '@nudge/shared';
import { sendToBackground } from '../../lib/messages';
import { replaceAll, setSession } from '../../lib/storage';
import { actions } from '../store';

/** Judging / demo controls. Simulations bypass learning mode and cooldowns. */
export function Demo({ settings, onCrisis }: { settings: Settings; onCrisis: () => void }) {
  const [status, setStatus] = useState('');
  const sim = async (sim: 'stuck' | 'restuck' | 'depleted' | 'long_break', label: string) => {
    await sendToBackground({ kind: 'simulate', sim });
    setStatus(`${label} — look at the bottom corner of your current page.`);
  };
  return (
    <div className="stack fade-in">
      <h1>Demo mode</h1>
      <p className="muted small">For showing Nudge quickly. Real nudges stay gentle and rate-limited; these skip the waiting.</p>
      <div className="stack">
        <button type="button" className="btn soft" onClick={() => void sim('stuck', 'Showed a stuck nudge')}>
          Simulate stuck
        </button>
        <button type="button" className="btn soft" onClick={() => void sim('restuck', 'Showed the “still going?” chip')}>
          Simulate re-stuck
        </button>
        <button type="button" className="btn soft" onClick={() => void sim('depleted', 'Showed a rest-first nudge')}>
          Simulate depleted
        </button>
        <button type="button" className="btn soft" onClick={() => void sim('long_break', 'Showed the soft return prompt')}>
          Simulate long break
        </button>
        <button type="button" className="btn calm" onClick={onCrisis}>
          Simulate crisis phrase
        </button>
      </div>
      <p role="status" aria-live="polite" className="small muted">
        {status}
      </p>
      <hr className="soft" />
      <button
        type="button"
        className="btn soft"
        onClick={async () => {
          await replaceAll(seedDemoData(Date.now()));
          setStatus('Loaded a week of sample history. Open the dashboard to see it.');
        }}
      >
        Load 1-week sample history
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={async () => {
          const fresh = defaultStorage(Date.now());
          fresh.settings = { ...fresh.settings, ...settings, onboarded: true, demoMode: settings.demoMode, installedAt: Date.now() };
          await replaceAll(fresh);
          await setSession({ panelIntent: null, stepStartedAt: null });
          setStatus('Reset to a fresh start (settings kept).');
        }}
      >
        Reset history
      </button>
      <label className="row small">
        <input type="checkbox" checked={settings.demoMode} onChange={(e) => void actions.updateSettings({ demoMode: e.target.checked })} /> Keep demo mode on (skips learning mode)
      </label>
    </div>
  );
}
