'use client';

import { formatNaics } from '@/lib/codes/lookup';
import type { NaicsPriorityRole } from '@/lib/alerts/naics-priorities';

export function NaicsCodeRoles({
  codes,
  priorities,
  onChange,
  onRemove,
}: {
  codes: string[];
  priorities: Record<string, NaicsPriorityRole>;
  onChange: (next: Record<string, NaicsPriorityRole>) => void;
  onRemove: (code: string) => void;
}) {
  if (codes.length === 0) return null;

  const setRole = (code: string, role: NaicsPriorityRole | null) => {
    const next = { ...priorities };
    if (!role) delete next[code];
    else next[code] = role;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-faint">
        Confirm each code. A keyword match is not confirmation — mark primary or secondary, or remove it.
      </p>
      <div className="space-y-1.5">
        {codes.map((code) => {
          const role = priorities[code];
          return (
            <div key={code} className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-ground-deep/40 px-2.5 py-1.5">
              <span className="text-xs text-slate-200">{formatNaics(code)}</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRole(code, role === 'primary' ? null : 'primary')}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    role === 'primary' ? 'bg-emerald-500/20 text-emerald-200' : 'text-faint hover:text-slate-200'
                  }`}
                >
                  Primary
                </button>
                <button
                  type="button"
                  onClick={() => setRole(code, role === 'secondary' ? null : 'secondary')}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    role === 'secondary' ? 'bg-purple-500/20 text-purple-200' : 'text-faint hover:text-slate-200'
                  }`}
                >
                  Secondary
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(code)}
                  className="rounded-full px-2 py-0.5 text-[11px] text-faint hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
