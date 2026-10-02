'use client';

import { useId, useRef, useState } from 'react';
import type { TagInfo } from '@/lib/repo.ts';

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export function RefPicker({
  label,
  value,
  onChange,
  tags,
  loading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tags: TagInfo[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const query = value.trim().toLowerCase();
  const exact = tags.some((t) => t.name.toLowerCase() === query);
  const options = (exact || !query ? tags : tags.filter((t) => t.name.toLowerCase().includes(query))).slice(0, 30);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </label>
      <div className="flex h-11 items-center rounded-xl border border-line-strong bg-white transition focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgba(15,17,21,0.06)]">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={loading ? 'Loading tags' : 'tag, branch or SHA'}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => tags.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && open && options[active]) {
              e.preventDefault();
              pick(options[active].name);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          className="h-full min-w-0 flex-1 bg-transparent pl-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-ink-faint"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show ${label.toLowerCase()} tags`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="grid h-full w-9 place-items-center text-ink-faint hover:text-ink"
        >
          {loading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-ink" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      {open && options.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-64 animate-pop overflow-auto rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,17,21,0.25)]"
        >
          {options.map((t, i) => (
            <li
              key={t.name}
              role="option"
              aria-selected={t.name === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(t.name);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[13px] ${
                i === active ? 'bg-wash' : ''
              }`}
            >
              <span className="truncate font-mono">{t.name}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">
                {t.prerelease ? 'pre · ' : ''}
                {fmt(t.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
