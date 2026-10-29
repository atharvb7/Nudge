'use client';

import { useState, type FormEvent } from 'react';

export function normalizeHost(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (s === 'localhost') return s;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

export function SiteListEditor({
  id,
  label,
  help,
  sites,
  onChange,
  placeholder = 'e.g. youtube.com',
}: {
  id: string;
  label: string;
  help: string;
  sites: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const [hint, setHint] = useState('');

  const add = (e: FormEvent) => {
    e.preventDefault();
    const host = normalizeHost(value);
    if (!host) {
      setHint('That doesn’t look like a website name yet — try something like example.com.');
      return;
    }
    if (sites.includes(host)) {
      setHint(`${host} is already on the list.`);
      return;
    }
    onChange([...sites, host]);
    setValue('');
    setHint(`Added ${host}.`);
  };

  return (
    <div>
      <form onSubmit={add} noValidate>
        <label htmlFor={id} className="n-label">
          {label}
        </label>
        <p id={`${id}-help`} className="mb-2 text-sm text-muted">
          {help}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={id}
            className="n-input sm:flex-1"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (hint) setHint('');
            }}
            placeholder={placeholder}
            aria-describedby={`${id}-help ${id}-hint`}
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
          />
          <button type="submit" className="n-btn-soft">
            Add
          </button>
        </div>
        <p id={`${id}-hint`} className="mt-1 min-h-[1.5em] text-sm text-muted" aria-live="polite">
          {hint}
        </p>
      </form>
      {sites.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={`${label}: current list`}>
          {sites.map((s) => (
            <li key={s} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface2 pl-4 text-sm font-semibold text-ink">
              {s}
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink"
                aria-label={`Remove ${s}`}
                onClick={() => onChange(sites.filter((x) => x !== s))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">None yet.</p>
      )}
    </div>
  );
}
