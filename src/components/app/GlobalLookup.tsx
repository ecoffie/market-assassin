'use client';

/**
 * Global lookup bar — contract #, company, UEI, or market keyword.
 * Ambiguous single words (e.g. "Excel") disambiguate: contractor vs market.
 */
import { useState } from 'react';
import { Search, X, Building2, BarChart3, ChevronRight } from 'lucide-react';
import AwardDetailDrawer from './awards/AwardDetailDrawer';
import {
  looksLikeUei,
  looksLikePiid,
  looksLikeCompany,
  isAmbiguousLookup,
  getProductVendorHint,
  filterContractorMatches,
  type ContractorHit,
} from '@/lib/lookup-intent';

function fmt$(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

interface Disambiguation {
  query: string;
  contractors: ContractorHit[];
  vendorHint: ReturnType<typeof getProductVendorHint>;
}

export default function GlobalLookup({ email }: { email: string | null }) {
  const [value, setValue] = useState('');
  const [openPiid, setOpenPiid] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [focused, setFocused] = useState(false);
  const [disambig, setDisambig] = useState<Disambiguation | null>(null);

  async function resolveContractor(query: string) {
    setResolving(true);
    setHint(null);
    setDisambig(null);
    try {
      const res = await fetch(`/api/contractors/search-bq?search=${encodeURIComponent(query)}&limit=1`);
      const data = await res.json();
      const top = (data?.contractors || [])[0];
      if (top?.slug) {
        // Stay in-app: open the Contractors panel and auto-fire the
        // full in-app profile view (not the public SEO page, not the
        // drawer). The Contractors panel switches to ?view=profile when
        // these params are set. Pre-fix this jumped to /contractors/[slug]
        // and dumped the user out of the app shell with no path back.
        const params = new URLSearchParams({
          panel: 'contractors',
          view: 'profile',
          slug: top.slug,
          company: top.company || query,
        });
        window.location.href = `/app?${params.toString()}`;
      } else {
        setHint(`No contractor found for "${query}".`);
      }
    } catch {
      setHint('Lookup failed — try again.');
    } finally {
      setResolving(false);
    }
  }

  function goMarketResearch(q: string) {
    setDisambig(null);
    window.location.href = `/app?panel=research&keyword=${encodeURIComponent(q)}`;
  }

  function goContractorsSearch(q: string) {
    setDisambig(null);
    window.location.href = `/app?panel=contractors&search=${encodeURIComponent(q)}`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    setHint(null);
    setDisambig(null);

    if (looksLikeUei(q)) {
      resolveContractor(q.toUpperCase());
      return;
    }
    if (looksLikePiid(q)) {
      setOpenPiid(q.toUpperCase());
      return;
    }
    if (looksLikeCompany(q)) {
      resolveContractor(q);
      return;
    }

    // Ambiguous single word — check contractor DB + product→vendor hints before
    // defaulting to market research ("Excel" ≠ healthcare keyword market).
    if (isAmbiguousLookup(q)) {
      setResolving(true);
      try {
        const vendorHint = getProductVendorHint(q);
        const res = await fetch(`/api/contractors/search-bq?search=${encodeURIComponent(q)}&limit=8`);
        const data = await res.json();
        const raw: ContractorHit[] = (data?.contractors || []).map((c: {
          uei: string; company: string; slug: string;
          total_contract_value: number; state?: string;
        }) => ({
          uei: c.uei,
          company: c.company,
          slug: c.slug,
          total_contract_value: c.total_contract_value,
          state: c.state,
        }));
        const matches = filterContractorMatches(raw, q);

        if (vendorHint || matches.length > 0) {
          setDisambig({ query: q, contractors: matches, vendorHint });
          return;
        }
      } catch {
        // Fall through to market research on search failure
      } finally {
        setResolving(false);
      }
    }

    goMarketResearch(q);
  }

  return (
    <>
      <form onSubmit={submit} className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" strokeWidth={1.75} />
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setHint(null); setDisambig(null); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); }, 200)}
          placeholder="Contract #, company, UEI, or a market like “drones”…"
          aria-label="Look up a contract number, company, UEI, or research a market"
          className="w-full rounded-lg border border-slate-700 bg-slate-900/80 pl-9 pr-9 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-60"
          disabled={resolving}
        />
        {resolving && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        )}

        {focused && !value && !hint && !disambig && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-2xl shadow-black/40 z-50">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">Look up by</p>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs">
                <span className="text-slate-300">Contract number</span>
                <span className="font-mono text-slate-500">140F0822D0024</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs">
                <span className="text-slate-300">Company name</span>
                <span className="font-mono text-slate-500">Lockheed Martin</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs">
                <span className="text-slate-300">UEI</span>
                <span className="font-mono text-slate-500">E466BXU4KJH8</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs">
                <span className="text-slate-300">A market / keyword</span>
                <span className="text-slate-500">drones, demolition…</span>
              </div>
              <p className="px-2 pt-1 text-[10px] text-slate-600">Single words like &ldquo;Excel&rdquo; ask company vs market.</p>
            </div>
          </div>
        )}

        {disambig && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-slate-600 bg-slate-900 shadow-2xl shadow-black/50 z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800">
              <p className="text-xs font-semibold text-white">&ldquo;{disambig.query}&rdquo; — what did you mean?</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Company lookup and market research are different searches.</p>
            </div>

            {disambig.vendorHint && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => resolveContractor(disambig.vendorHint!.searchQuery)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-purple-500/10 border-b border-slate-800/80"
              >
                <Building2 className="w-4 h-4 text-purple-400 shrink-0" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-purple-200">{disambig.vendorHint.label}</div>
                  <div className="text-[10px] text-slate-500">Product name → federal vendor profile</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              </button>
            )}

            {disambig.contractors.slice(0, 4).map((c) => (
              <button
                key={c.uei}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const params = new URLSearchParams({
                    panel: 'contractors',
                    view: 'profile',
                    slug: c.slug,
                    company: c.company,
                  });
                  window.location.href = `/app?${params.toString()}`;
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-emerald-500/10 border-b border-slate-800/60 last:border-0"
              >
                <Building2 className="w-4 h-4 text-emerald-400 shrink-0" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white truncate">{c.company}</div>
                  <div className="text-[10px] text-slate-500">
                    {fmt$(c.total_contract_value)}{c.state ? ` · ${c.state}` : ''}
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              </button>
            ))}

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => goContractorsSearch(disambig.query)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800 border-t border-slate-800 text-xs text-slate-400"
            >
              <Search className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              View all contractors matching &ldquo;{disambig.query}&rdquo;
            </button>

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => goMarketResearch(disambig.query)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-blue-500/10 border-t border-slate-700"
            >
              <BarChart3 className="w-4 h-4 text-blue-400 shrink-0" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-blue-200">Research federal market for &ldquo;{disambig.query}&rdquo;</div>
                <div className="text-[10px] text-slate-500">Which agencies buy this — award keyword search</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            </button>
          </div>
        )}

        {hint && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 z-50">
            {hint}
          </div>
        )}
      </form>

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
