/**
 * NaicsPicker — autocomplete input for NAICS code selection.
 *
 * Type 'cyber' → shows '541512 — Computer Systems Design Services',
 * '541519 — Other Computer Related Services', etc. Click to add to
 * the picked list. Backspace on empty input removes the last picked.
 *
 * Replaces hand-typing of comma-separated NAICS codes — users almost
 * never know the codes by heart, so let them search by description.
 *
 * Use in onboarding, settings, vault identity form, target list, etc.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { searchNaics, getNaics, type NaicsEntry } from '@/lib/codes/lookup';
import { NaicsBadge } from './NaicsBadge';

interface NaicsPickerProps {
  value: string[];
  onChange: (codes: string[]) => void;
  placeholder?: string;
  /** Restrict picker to a specific NAICS level (2/4/6). Default any. */
  level?: number;
  /** Max number of codes the user can pick (default no limit) */
  max?: number;
  /** Show inline description on the picked badges (default true) */
  showInlineDescriptions?: boolean;
}

export function NaicsPicker({
  value,
  onChange,
  placeholder = 'Search NAICS by code or description (e.g. "cybersecurity")',
  level,
  max,
  showInlineDescriptions = true,
}: NaicsPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NaicsEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const r = searchNaics(query, { limit: 8, level });
    // Exclude already-picked codes
    setResults(r.filter(e => !value.includes(e.code)));
    setActiveIndex(0);
  }, [query, value, level]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function addCode(code: string) {
    if (max && value.length >= max) return;
    if (value.includes(code)) return;
    onChange([...value, code]);
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  }

  function removeCode(code: string) {
    onChange(value.filter(c => c !== code));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (results.length > 0) {
        e.preventDefault();
        addCode(results[activeIndex].code);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Backspace' && query === '' && value.length > 0) {
      removeCode(value[value.length - 1]);
    }
  }

  // If the user pasted/typed an exact-match code, allow Enter to add it
  // even if it's not in our local cache (paranoia escape hatch).
  const isExactCode = /^\d{2,6}$/.test(query.trim());
  const exactCodeKnown = isExactCode && getNaics(query.trim()) !== null;
  const showAddRawHint = isExactCode && !exactCodeKnown && !value.includes(query.trim());

  return (
    <div className="space-y-2" ref={containerRef}>
      {/* Picked badges (each removable) */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(code => (
            <span key={code} className="inline-flex items-center gap-1 rounded bg-emerald-900/40 border border-emerald-700/50 text-xs px-2 py-1">
              <NaicsBadge code={code} inline={showInlineDescriptions} size="sm" />
              <button
                type="button"
                onClick={() => removeCode(code)}
                className="text-emerald-300 hover:text-rose-400 ml-1"
                aria-label={`Remove ${code}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={max && value.length >= max ? `Maximum ${max} codes selected` : placeholder}
          disabled={!!(max && value.length >= max)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />

        {/* Suggestions dropdown */}
        {isOpen && (results.length > 0 || showAddRawHint) && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
            {results.map((entry, i) => (
              <button
                key={entry.code}
                type="button"
                onClick={() => addCode(entry.code)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`block w-full text-left px-3 py-2 text-sm border-b border-slate-800 last:border-b-0 ${
                  i === activeIndex ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                }`}
              >
                <span className="font-mono text-emerald-400">{entry.code}</span>
                <span className="text-slate-500 mx-1.5">·</span>
                <span className="text-slate-200">{entry.title}</span>
              </button>
            ))}
            {showAddRawHint && (
              <button
                type="button"
                onClick={() => addCode(query.trim())}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-800/50 text-amber-300"
              >
                Add &ldquo;{query.trim()}&rdquo; as a code (not in our list — verify it&apos;s a real NAICS)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
