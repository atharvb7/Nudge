'use client';

// Native radio inputs styled as a segmented control: arrow keys, labels and
// screen-reader semantics come for free.
export function Segmented<T extends string | number>({
  name,
  legend,
  description,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  description?: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="py-3">
      <legend className="font-semibold text-ink">{legend}</legend>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              htmlFor={id}
              className={`flex min-h-tap cursor-pointer flex-col justify-center rounded-soft border px-4 py-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
                checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface2'
              }`}
            >
              <input id={id} type="radio" name={name} className="sr-only" checked={checked} onChange={() => onChange(o.value)} />
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                {checked ? (
                  <span aria-hidden="true" className="text-accent">
                    ✓
                  </span>
                ) : null}
                {o.label}
              </span>
              {o.hint ? <span className="text-xs text-muted">{o.hint}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
