import { useEffect, useState } from 'react';
import { THEMES, type HealthResponse, type Region, type Settings, type StorageShape } from '@nudge/shared';
import { Segmented, Toggle } from '../components/ui';
import { actions } from '../store';
import { getHealth } from '../../lib/api';
import { onDeviceAvailability } from '../../lib/speech';
import { calmVoices, speak } from '../../lib/tts';
import { sendToBackground, type TabInfo } from '../../lib/messages';

const HOUR = 3_600_000;

function tomorrowMorning(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export function SettingsScreen({ store, onDemo }: { store: StorageShape; onDemo: () => void }) {
  const s = store.settings;
  const set = (patch: Partial<Settings>) => void actions.updateSettings(patch);
  const [health, setHealth] = useState<HealthResponse | null | 'loading'>('loading');
  const [onDevice, setOnDevice] = useState<'available' | 'downloadable' | 'unavailable'>('unavailable');
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [backend, setBackend] = useState(s.backendUrl);

  useEffect(() => {
    setHealth('loading');
    void getHealth(s.backendUrl).then(setHealth);
  }, [s.backendUrl]);
  useEffect(() => {
    void onDeviceAvailability().then(setOnDevice);
    void sendToBackground<TabInfo[]>({ kind: 'listTabs' }).then((t) => setTabs(Array.isArray(t) ? t : []));
  }, []);

  const dndOn = !!s.dndUntil && s.dndUntil > Date.now();
  const unlocked = THEMES.filter((t) => s.unlockedThemes.includes(t.id));
  const voices = calmVoices();

  return (
    <div className="stack fade-in">
      <h1>Settings</h1>

      <p className="section-title">Quiet</p>
      <section className="card">
        <div className="field">
          <span style={{ fontWeight: 600 }}>Do not disturb {dndOn && <span className="pill calm">on until {new Date(s.dndUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</span>
          <div className="row">
            <button type="button" className="btn soft" onClick={() => set({ dndUntil: Date.now() + HOUR })}>
              1 hour
            </button>
            <button type="button" className="btn soft" onClick={() => set({ dndUntil: Date.now() + 2 * HOUR })}>
              2 hours
            </button>
            <button type="button" className="btn soft" onClick={() => set({ dndUntil: tomorrowMorning() })}>
              Until tomorrow
            </button>
            {dndOn && (
              <button type="button" className="btn ghost" onClick={() => set({ dndUntil: null })}>
                Turn off
              </button>
            )}
          </div>
          <p className="small muted">Good for exams and calls. I also stay quiet on my own in fullscreen and on video calls.</p>
        </div>
        <Toggle label="Quiet hours" checked={s.quietHours.enabled} onChange={(v) => set({ quietHours: { ...s.quietHours, enabled: v } })} />
        {s.quietHours.enabled && (
          <div className="row">
            <label className="small">
              From{' '}
              <input type="time" className="input" value={s.quietHours.start} onChange={(e) => set({ quietHours: { ...s.quietHours, start: e.target.value } })} />
            </label>
            <label className="small">
              To <input type="time" className="input" value={s.quietHours.end} onChange={(e) => set({ quietHours: { ...s.quietHours, end: e.target.value } })} />
            </label>
          </div>
        )}
        <Toggle label="Pause all tracking" hint="Nothing is sensed while paused." checked={s.trackingPaused} onChange={(v) => set({ trackingPaused: v })} />
      </section>

      <p className="section-title">Task tab</p>
      <section className="card">
        <p className="small muted">{s.taskTab ? `Pinned: ${s.taskTab.title || s.taskTab.host}${s.taskTab.tabId === null ? ' (tab closed — I’ll treat the same site as your task)' : ''}` : 'No task tab pinned.'}</p>
        <select
          className="input"
          aria-label="Pin a task tab"
          value=""
          onChange={(e) => void sendToBackground({ kind: 'pinTab', tabId: e.target.value === 'none' ? null : Number(e.target.value) })}
        >
          <option value="">Pin a different tab…</option>
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {(t.title || t.host).slice(0, 60)}
            </option>
          ))}
          {s.taskTab && <option value="none">Unpin</option>}
        </select>
      </section>

      <p className="section-title">Words</p>
      <section className="card stack">
        <Segmented
          label="Wording style"
          value={s.wordingStyle}
          options={[
            { value: 'warm', label: 'Warm & casual' },
            { value: 'literal', label: 'Clear & literal' },
          ]}
          onChange={(v) => set({ wordingStyle: v })}
        />
        <Toggle label="Explain why" hint="Add one plain sentence about why each step helps." checked={s.explainWhy} onChange={(v) => set({ explainWhy: v })} />
      </section>

      <p className="section-title">Voice</p>
      <section className="card stack">
        <Segmented
          label="Input"
          value={s.inputStyle}
          options={[
            { value: 'voice', label: 'Voice + buttons' },
            { value: 'buttons', label: 'Buttons only' },
          ]}
          onChange={(v) => set({ inputStyle: v })}
        />
        <div className="field">
          <label htmlFor="engine">Speech engine</label>
          <select id="engine" className="input" value={s.speechEngine} onChange={(e) => set({ speechEngine: e.target.value as Settings['speechEngine'] })}>
            <option value="auto">Automatic (most private available)</option>
            <option value="on-device">On-device only</option>
            <option value="local-whisper">Local Whisper (needs the Nudge helper running)</option>
            <option value="chrome-cloud">Chrome cloud speech — audio goes to Google</option>
          </select>
          <p className="small muted">On-device speech here: {onDevice === 'available' ? 'ready' : onDevice === 'downloadable' ? 'can be downloaded' : 'not supported in this browser yet'}.</p>
        </div>
        <Toggle label="Whisper mode" hint="Listens more closely, for shared rooms." checked={s.whisperMode} onChange={(v) => set({ whisperMode: v })} />
        <Toggle
          label="Wake phrase “Nudge, I’m stuck”"
          hint={onDevice === 'available' ? 'Listens on-device only. Off by default.' : 'Needs on-device speech, which this browser doesn’t offer yet — so it stays off to keep audio private.'}
          checked={s.wakePhrase && onDevice === 'available'}
          disabled={onDevice !== 'available'}
          onChange={(v) => set({ wakePhrase: v })}
        />
        <Toggle label="Read replies aloud (button)" hint="Never plays on its own." checked={s.tts.enabled} onChange={(v) => set({ tts: { ...s.tts, enabled: v } })} />
        {s.tts.enabled && (
          <>
            <div className="field">
              <label htmlFor="rate">Speaking speed</label>
              <input id="rate" type="range" min={0.6} max={1.4} step={0.05} value={s.tts.rate} onChange={(e) => set({ tts: { ...s.tts, rate: Number(e.target.value) } })} />
            </div>
            {voices.length > 0 && (
              <div className="field">
                <label htmlFor="voice">Voice</label>
                <select id="voice" className="input" value={s.tts.voiceURI ?? ''} onChange={(e) => set({ tts: { ...s.tts, voiceURI: e.target.value || null } })}>
                  <option value="">Calmest available</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} {v.localService ? '(on-device)' : '(online)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" className="btn ghost" onClick={() => speak('Here with you. One tiny step at a time.', s.tts.rate, s.tts.voiceURI)}>
              Try it
            </button>
          </>
        )}
      </section>

      <p className="section-title">Gentle extras</p>
      <section className="card">
        <Toggle label="“Water? Stretch?” after long focus" checked={s.hydrationChip} onChange={(v) => set({ hydrationChip: v })} />
        <Toggle label="Time anchors (~every 30 min)" hint="A tiny “~30 min have passed” note." checked={s.timeAnchor} onChange={(v) => set({ timeAnchor: v })} />
        <Toggle label="“Still here with you” messages" checked={s.stillHereMessages} onChange={(v) => set({ stillHereMessages: v })} />
        <Toggle label="Soft sound for wins" checked={s.winSounds} onChange={(v) => set({ winSounds: v })} />
      </section>

      <p className="section-title">Look &amp; feel</p>
      <section className="card stack">
        <Segmented
          label="Font"
          value={s.a11y.font}
          options={[
            { value: 'default', label: 'Atkinson Hyperlegible' },
            { value: 'dyslexic', label: 'Dyslexia-friendly (Lexend)' },
          ]}
          onChange={(v) => set({ a11y: { ...s.a11y, font: v } })}
        />
        <Segmented
          label="Text size"
          value={s.a11y.textScale}
          options={[
            { value: 1, label: 'A' },
            { value: 1.15, label: 'A+' },
            { value: 1.3, label: 'A++' },
            { value: 1.5, label: 'A+++' },
          ]}
          onChange={(v) => set({ a11y: { ...s.a11y, textScale: v } })}
        />
        <Segmented
          label="Reduce motion"
          value={s.a11y.reducedMotion}
          options={[
            { value: 'system', label: 'Like my system' },
            { value: 'on', label: 'Less motion' },
            { value: 'off', label: 'Allow motion' },
          ]}
          onChange={(v) => set({ a11y: { ...s.a11y, reducedMotion: v } })}
        />
        <Toggle label="High contrast" checked={s.a11y.highContrast} onChange={(v) => set({ a11y: { ...s.a11y, highContrast: v } })} />
        <Segmented label="Theme (unlocked by your attempts — never lost)" value={s.theme} options={unlocked.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => set({ theme: v })} />
      </section>

      <p className="section-title">Safety &amp; privacy</p>
      <section className="card stack">
        <div className="field">
          <label htmlFor="region">Region for support lines</label>
          <select id="region" className="input" value={s.region} onChange={(e) => set({ region: e.target.value as Region })}>
            <option value="IN">India</option>
            <option value="US">United States</option>
            <option value="UK">United Kingdom</option>
            <option value="OTHER">Somewhere else</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="backend">Nudge helper address</label>
          <div className="row">
            <input id="backend" className="input" style={{ flex: 1 }} value={backend} onChange={(e) => setBackend(e.target.value)} />
            <button type="button" className="btn soft" onClick={() => set({ backendUrl: backend.trim() || 'http://localhost:8000' })}>
              Save
            </button>
          </div>
          <p className="small muted" role="status">
            {health === 'loading'
              ? 'Checking…'
              : health
                ? `Connected · AI: ${health.llm === 'none' ? 'strategy cards only' : health.llm} (${health.llm_location === 'cloud' ? '☁️ cloud' : health.llm_location === 'local' ? '🔒 on this computer' : 'offline'})`
                : 'Not running — that’s okay, I use on-device strategy cards instead.'}
          </p>
        </div>
        <p className="small muted">
          I only notice metadata: tab switches, how often you come back to your task, counts of key presses (never which keys), idle time and site
          names. No page content, no webcam, no audio stored. Incognito windows are never tracked.
        </p>
        <a className="btn soft" href="http://localhost:3000" target="_blank" rel="noreferrer">
          Open dashboard &amp; privacy center
        </a>
      </section>

      <button type="button" className="btn ghost" onClick={onDemo}>
        Demo mode
      </button>
      <p className="small muted center">Nudge is a support tool, not medical treatment.</p>
    </div>
  );
}
