'use client';

/**
 * NaicsAutocompleteInput — a drop-in replacement for the plain
 * comma-separated NAICS text inputs used across the app.
 *
 * Keeps the existing "236, 541512" comma-string value/onChange contract,
 * but adds a typeahead: as the user types the CURRENT (last) code
 * fragment — by number OR description — a suggestion dropdown appears.
 * Clicking a suggestion replaces the fragment with the real code.
 *
 * Search is client-side (searchNaics over the bundled NAICS table), so
 * it's instant and needs no API call.
 */
import { useMemo, useRef, useState } from 'react';
import { searchNaics, type NaicsEntry } from '@/lib/codes/lookup';

interface Props {
  value: string;                       // comma-separated codes, e.g. "236, 541512"
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

// Split a comma-string into [committed codes, current fragment].
function splitFragment(value: string): { head: string[]; fragment: string } {
  const parts = value.split(',');
  const fragment = parts[parts.length - 1].trim();
  const head = parts.slice(0, -1).map(p => p.trim()).filter(Boolean);
  return { head, fragment };
}

export function NaicsAutocompleteInput({
  value,
  onChange,
  placeholder = 'Type a code or word (e.g. 236 or "cybersecurity")',
  className = '',
  ariaLabel = 'NAICS codes',
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { head, fragment } = splitFragment(value);

  const suggestions = useMemo<NaicsEntry[]>(() => {
    if (fragment.length < 2) return [];
    const already = new Set([...head, ...(fragment ? [] : [])]);
    return searchNaics(fragment, { limit: 8 }).filter(e => !already.has(e.code));
  }, [fragment, head]);

  const pick = (code: string) => {
    const next = [...head, code];
    onChange(next.join(', ') + ', ');
    setOpen(false);
    setActiveIdx(0);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}  // allow click
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && suggestions[activeIdx]) { e.preventDefault(); pick(suggestions[activeIdx].code); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        className={className}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={s.code}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s.code); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 border-b border-slate-800/60 last:border-0 ${
                i === activeIdx ? 'bg-slate-800' : 'hover:bg-slate-800/60'
              }`}
            >
              <span className="font-mono text-sm text-emerald-300 shrink-0">{s.code}</span>
              <span className="text-sm text-slate-300 truncate">{s.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
