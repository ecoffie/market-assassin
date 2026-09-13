'use client';

import { formatNaics } from '@/lib/codes/lookup';
import type { NaicsPriorityRole } from '@/lib/alerts/naics-priorities';
import type { SuggestedCodeToReview } from '@/lib/alerts/coming-back-to-market';
import { invalidNaicsCodes } from '@/lib/codes/validate-market-codes';

export function NaicsCodeRoles({
  codes,
  priorities,
  onChange,
  onRemove,
  suggestions = [],
  onAddSuggested,
}: {
  codes: string[];
  priorities: Record<string, NaicsPriorityRole>;
  onChange: (next: Record<string, NaicsPriorityRole>) => void;
  onRemove: (code: string) => void;
  suggestions?: SuggestedCodeToReview[];
  onAddSuggested?: (code: string) => void;
}) {
  const invalid = invalidNaicsCodes(codes);
  const valid = codes.filter((c) => !invalid.includes(c));
  if (valid.length === 0 && suggestions.length === 0 && invalid.length === 0) return null;

  const setRole = (code: string, role: NaicsPriorityRole | null) => {
    const next = { ...priorities };
    if (!role) delete next[code];
    else next[code] = role;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {valid.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-faint">
            Confirm each code. A keyword match is not confirmation — mark primary or secondary, or remove it.
          </p>
          <div className="space-y-1.5">
            {valid.map((code) => {
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
      )}
      {invalid.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
          <p className="text-xs font-medium text-amber-200">Codes to correct</p>
          <p className="text-xs text-faint">
            These stored codes are not in Census 2022. They stay until you remove them. They are not used for matching.
          </p>
          <div className="space-y-1.5">
            {invalid.map((code) => (
              <div key={code} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 px-2.5 py-1.5">
                <span className="text-xs text-slate-200">{code} — Invalid NAICS code</span>
                <button
                  type="button"
                  onClick={() => onRemove(code)}
                  className="ml-auto rounded-full px-2 py-0.5 text-[11px] text-faint hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="space-y-2 rounded-lg border border-hairline bg-ground-deep/20 px-2.5 py-2">
          <p className="text-xs font-medium text-slate-200">Suggested codes to review</p>
          <p className="text-xs text-faint">
            These match your capability text. They are not in your market until you add them.
          </p>
          <div className="space-y-1.5">
            {suggestions.map((s) => (
              <div key={s.code} className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline px-2.5 py-1.5">
                <span className="text-xs text-slate-200">
                  {formatNaics(s.code)}
                  <span className="ml-1 text-faint">{`from "${s.phrase}"`}</span>
                </span>
                {onAddSuggested && (
                  <button
                    type="button"
                    onClick={() => onAddSuggested(s.code)}
                    className="ml-auto rounded-full px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
                  >
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
