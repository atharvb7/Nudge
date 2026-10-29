import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ENERGY_LABELS, type Energy, type StepSize } from '@nudge/shared';

export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="toggle-row">
      <div className="label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label" style={{ fontWeight: 600, fontSize: '0.95rem' }}>
        {label}
      </span>
      <div className="row" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className="btn soft"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Energy as 1–5 "spoons". */
export function EnergyPicker({ value, onChange }: { value: Energy; onChange: (e: Energy) => void }) {
  return (
    <div className="field">
      <span style={{ fontWeight: 600, fontSize: '0.95rem' }} id="energy-label">
        Energy right now <span className="muted small">· {ENERGY_LABELS[value]}</span>
      </span>
      <div className="energy" role="radiogroup" aria-labelledby="energy-label">
        {([1, 2, 3, 4, 5] as Energy[]).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} of 5 — ${ENERGY_LABELS[n]}`}
            className={`spoon ${n <= value ? 'on' : ''}`}
            onClick={() => onChange(n)}
          >
            <span className="fill" aria-hidden="true">
              🥄
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SizeBadge({ size }: { size: StepSize }) {
  return (
    <span className="pill accent size-badge" aria-label={`Step size: ${size}`}>
      <span className="size-dots" aria-hidden="true">
        <i />
        <i className={size === 'small' ? '' : 'off'} />
      </span>
      {size}
    </span>
  );
}

/**
 * Calm visual timer: a shrinking ring whose colour slowly fades from sage to
 * lavender. Never red. Numbers are optional.
 */
export function RingTimer({
  totalMs,
  startedAt,
  showNumbers,
  size = 200,
  label,
  onDone,
}: {
  totalMs: number;
  startedAt: number;
  showNumbers: boolean;
  size?: number;
  label?: string;
  onDone?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, totalMs]);
  const left = Math.max(0, totalMs - (now - startedAt));
  const frac = totalMs ? left / totalMs : 0;
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onDone?.();
    }
  }, [left, onDone]);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  // sage (#4f7d66) → lavender (#6c5fa0)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * (1 - frac));
  const stroke = `rgb(${mix(79, 108)}, ${mix(125, 95)}, ${mix(102, 160)})`;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  return (
    <div className="ring" role="timer" aria-label={label ?? 'Timer'}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--n-surface-2)" strokeWidth="14" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <div className="label">
        {showNumbers ? (
          <span style={{ fontSize: '1.6rem', color: 'var(--n-text)' }}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        ) : (
          <span className="sr-only">
            About {Math.max(1, Math.round(left / 60000))} minutes left
          </span>
        )}
      </div>
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="breath" aria-hidden="true" />
      {text}
    </div>
  );
}
