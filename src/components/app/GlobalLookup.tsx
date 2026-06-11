'use client';

/**
 * Global lookup bar (the enterprise "type an identifier → land on its detail"
 * pattern — Bloomberg/GovWin/Salesforce). v1 resolves a CONTRACT NUMBER (PIID) to
 * the full USASpending award detail, reusing the live /api/app/award-detail spine
 * + AwardDetailDrawer. Architected to grow: detect UEI / opportunity-id / agency
 * later and route to the right detail. Lives in the /app header (members only).
 */
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import AwardDetailDrawer from './awards/AwardDetailDrawer';

// A contract PIID is an alphanumeric token, typically 9-20 chars, often with the
// agency code prefix (e.g. 140F0822D0024, W912HV26Z0015, FA865012C5168). We accept
// any alphanumeric-ish token of reasonable length as a candidate.
function looksLikePiid(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{6,24}$/.test(t) && /\d/.test(t);
}

export default function GlobalLookup({ email }: { email: string | null }) {
  const [value, setValue] = useState('');
  const [openPiid, setOpenPiid] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    if (looksLikePiid(q)) {
      setHint(null);
      setOpenPiid(q.toUpperCase());
    } else {
      // v1 only handles contract numbers; guide the user instead of failing silently.
      setHint("That doesn't look like a contract number. Try a PIID like 140F0822D0024.");
    }
  }

  return (
    <>
      <form onSubmit={submit} className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" strokeWidth={1.75} />
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setHint(null); }}
          placeholder="Look up a contract number (PIID)…"
          aria-label="Look up a contract number"
          className="w-full rounded-lg border border-slate-700 bg-slate-900/80 pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        {hint && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 z-50">
            {hint}
          </div>
        )}
      </form>

      {/* Result modal — reuses the live AwardDetailDrawer (self-fetches by piid). */}
      {openPiid && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4">
          <div className="relative my-12 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">Contract lookup</h2>
                <p className="text-xs text-slate-400 font-mono">{openPiid}</p>
              </div>
              <button
                onClick={() => { setOpenPiid(null); setValue(''); }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="p-5">
              <AwardDetailDrawer
                piid={openPiid}
                email={email}
                fallbackUrl={`https://www.usaspending.gov/search/?keyword=${encodeURIComponent(openPiid)}`}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
