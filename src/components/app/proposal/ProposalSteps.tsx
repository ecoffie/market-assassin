'use client';

/**
 * The proposal page's three steps (Eric, 2026-11-17: "make the proposal page a lot easier"):
 *   1. Pick your solicitation  →  2. Mindy drafts it  →  3. Review and download
 * One tracker at the top, and ONE primary next-step button; everything else lives in "More".
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type ProposalStep = 1 | 2 | 3;

/** Which step the user is on: no source → 1, source but no draft → 2, a draft → 3. */
export function proposalStep(input: { hasSource: boolean; hasDraft: boolean }): ProposalStep {
  if (input.hasDraft) return 3;
  if (input.hasSource) return 2;
  return 1;
}

export const PROPOSAL_STEP_LABELS: Record<ProposalStep, string> = {
  1: 'Pick your solicitation',
  2: 'Mindy drafts it',
  3: 'Review and download',
};

export function ProposalStepTracker({ step, onStepClick }: { step: ProposalStep; onStepClick?: (s: ProposalStep) => void }) {
  return (
    <ol className="flex flex-nowrap items-center justify-center gap-2 sm:gap-3 max-w-full overflow-x-auto" aria-label="Proposal steps" data-testid="proposal-steps">
      {([1, 2, 3] as ProposalStep[]).map((s, i) => {
        const done = s < step;
        const current = s === step;
        const clickable = !!onStepClick && s <= step;
        return (
          <li key={s} className="flex shrink-0 items-center gap-2 sm:gap-3">
            {i > 0 && <span aria-hidden className="h-px w-4 sm:w-8 bg-hairline" />}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(s)}
              aria-current={current ? 'step' : undefined}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                current
                  ? 'border-[#006aff] bg-[#006aff]/10 font-semibold text-ink'
                  : done
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-hairline text-faint'
              } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                  current ? 'bg-[#006aff] text-white' : done ? 'bg-emerald-500 text-white' : 'bg-surface text-faint'
                }`}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : s}
              </span>
              {PROPOSAL_STEP_LABELS[s]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export interface MoreMenuItem { label: string; onClick: () => void; disabled?: boolean }

/** A small "More ▾" menu for the secondary actions the header used to show as buttons. */
export function MoreMenu({ items }: { items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 px-3 py-2 bg-surface hover:bg-input text-ink-soft text-sm rounded-lg transition-colors"
      >
        More <ChevronDown className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 min-w-[200px] rounded-lg border border-hairline bg-ground p-1 shadow-lg">
          {items.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-ink-soft hover:bg-surface disabled:opacity-50"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
