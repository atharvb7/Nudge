'use client';

import { useRef, type KeyboardEvent } from 'react';
import { ENERGY_LABELS, type Energy } from '@nudge/shared';

const LEVELS: Energy[] = [1, 2, 3, 4, 5];

export function EnergyDial({ value, onChange }: { value: Energy | null; onChange: (e: Energy) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (to: number) => {
    const next = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, to))];
    onChange(next);
    refs.current[next - 1]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, level: Energy) => {
    const i = level - 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(i + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(4);
    }
  };

  const focusable = value ?? 3;

  return (
    <div>
      <div role="radiogroup" aria-label="Energy today, in spoons" className="grid grid-cols-5 gap-2">
        {LEVELS.map((level) => {
          const selected = value === level;
          return (
            <button
              key={level}
              ref={(el) => {
                refs.current[level - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${level} ${level === 1 ? 'spoon' : 'spoons'}: ${ENERGY_LABELS[level]}`}
              tabIndex={focusable === level ? 0 : -1}
              onClick={() => onChange(level)}
              onKeyDown={(e) => onKey(e, level)}
              className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-card border px-1 py-2 transition-colors ${
                selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface2'
              }`}
            >
              <span aria-hidden="true" className="flex flex-wrap justify-center text-base leading-none sm:text-lg">
                {Array.from({ length: level }).map((_, i) => (
                  <span key={i}>🥄</span>
                ))}
              </span>
              <span className={`text-sm font-bold ${selected ? 'text-ink' : 'text-muted'}`}>{level}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 min-h-[1.6em] text-base font-semibold text-ink" aria-live="polite">
        {value ? ENERGY_LABELS[value] : 'Tap how much energy you have. Any answer is a good answer.'}
      </p>
    </div>
  );
}
