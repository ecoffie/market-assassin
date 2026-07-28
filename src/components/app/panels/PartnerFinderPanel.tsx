'use client';

/**
 * Partner Finder — semantic teaming-partner discovery (PRD Phase 4 surface).
 * docs/PRD-contractor-capability-profiles.md
 *
 * TWO MODES, both backed by contractor_capability_profiles.capability_embedding:
 *   • Describe   — "wildland firefighting crews" → firms whose award history MEANS that,
 *                  regardless of which NAICS/PSC they file under.
 *   • Complement — pick a firm → firms that do ADJACENT work. Deliberately excludes
 *                  near-identical firms: those are competitors, not partners.
 *
 * Reuses, rather than rebuilds:
 *   - /api/app/capability-search  (Phase 3 semantic layer)
 *   - /api/teaming  (the existing teaming CRM) for "Save as partner"
 * Everything shown is derived from real award history — no self-reported capability text.
 */

import { useState, useCallback } from 'react';
import { Search, Users, Building2, Loader2, BookmarkPlus, Check, Info } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { useAppTracker } from '../track';

interface PartnerFinderPanelProps {
  email: string | null;
  tier: AppTier;
}

interface Match {
  rollup_uei: string;
  rollup_name: string;
  state: string | null;
  capability_label: string | null;
  capability_summary: string | null;
  specialty_tier: 'specialist' | 'focused' | 'diversified' | null;
  award_count: number;
  total_obligated: number;
  similarity: number;
}

const money = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
};

const TIER_STYLE: Record<string, string> = {
  specialist: 'bg-emerald-500/15 text-emerald-300',
  focused: 'bg-blue-500/15 text-blue-300',
  diversified: 'bg-surface text-ink-soft',
};

const EXAMPLES = [
  'wildland firefighting crews',
  'cybersecurity and network defense',
  'drone and unmanned aircraft maintenance',
  'custodial and janitorial services',
];

export default function PartnerFinderPanel({ email, tier }: PartnerFinderPanelProps) {
  const track = useAppTracker(email);
  const [mode, setMode] = useState<'describe' | 'complement'>('describe');
  const [query, setQuery] = useState('');
  const [anchorUei, setAnchorUei] = useState('');
  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const run = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (mode === 'describe' && !q) return;
    if (mode === 'complement' && !anchorUei.trim()) return;

    setLoading(true); setError(null); setSearched(true);
    try {
      const p = new URLSearchParams();
      if (mode === 'describe') p.set('q', q); else p.set('uei', anchorUei.trim());
      if (state.trim()) p.set('state', state.trim().toUpperCase());
      if (tierFilter && mode === 'describe') p.set('tier', tierFilter);
      p.set('limit', '25');

      const res = await fetch(`/api/app/capability-search?${p}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Search failed');
      setMatches(data.matches || []);
      setScanned(data.scanned || 0);
      setAnchorName(data.anchor ?? null);
      // AppEventType/AppEventSource are fixed unions — use the existing 'tool_use' + a
      // metadata action rather than inventing event names the schema doesn't know.
      track('tool_use', 'pipeline', { action: 'partner_finder_search', mode, resultCount: (data.matches || []).length });
    } catch (e) {
      setError((e as Error).message);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, [mode, query, anchorUei, state, tierFilter, track]);

  /** Save into the EXISTING teaming CRM (user_teaming_partners) — no new storage. */
  const savePartner = useCallback(async (m: Match) => {
    if (!email) return;
    try {
      const res = await fetch('/api/teaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: email,
          company_name: m.rollup_name,
          partner_type: 'sub',
          // Provenance: make it obvious in the CRM where this came from and that it is
          // award-derived, not self-reported.
          notes: m.capability_summary
            ? `${m.capability_summary} (matched via Partner Finder, ${Math.round(m.similarity * 100)}% capability similarity)`
            : 'Matched via Partner Finder',
        }),
      });
      if (res.ok) {
        setSaved((s) => ({ ...s, [m.rollup_uei]: true }));
        track('tool_use', 'pipeline', { action: 'partner_finder_save', uei: m.rollup_uei });
      }
    } catch { /* non-blocking — the row stays visible either way */ }
  }, [email, track]);

  // NOT named use* — the react-hooks lint rule treats any use-prefixed identifier as a Hook
  // and rejects calling it from an onClick callback.
  const setAnchorFrom = (m: Match) => {
    setMode('complement');
    setAnchorUei(m.rollup_uei);
    setAnchorName(m.rollup_name);
    setMatches([]); setSearched(false);
  };

  if (tier === 'free') {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-line bg-surface p-6 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-faint" />
          <h3 className="text-lg font-semibold text-ink">Partner Finder</h3>
          <p className="mt-2 text-sm text-ink-soft">
            Find teaming partners by what they actually do — derived from federal award history.
          </p>
          <p className="mt-3 text-xs text-faint">Available on Pro.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
          <Users className="h-5 w-5" strokeWidth={2} /> Partner Finder
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Search 71,000+ contractors by what their award history says they actually do — not by NAICS code.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-1">
        <button
          onClick={() => { setMode('describe'); setMatches([]); setSearched(false); }}
          className={`rounded px-3 py-1.5 text-sm font-medium ${mode === 'describe' ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}
        >
          Describe the work
        </button>
        <button
          onClick={() => { setMode('complement'); setMatches([]); setSearched(false); }}
          className={`rounded px-3 py-1.5 text-sm font-medium ${mode === 'complement' ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}
        >
          Complement a firm
        </button>
      </div>

      {/* Search controls */}
      <div className="mb-4 space-y-3">
        {mode === 'describe' ? (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && run()}
                  placeholder="Describe the work, e.g. “wildland firefighting crews”"
                  className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint"
                />
              </div>
              <button
                onClick={() => run()}
                disabled={loading || !query.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setQuery(ex); run(ex); }}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input
                value={anchorUei}
                onChange={(e) => setAnchorUei(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && run()}
                placeholder="Paste a contractor UEI, or click “Find partners like this” on any result"
                className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint"
              />
            </div>
            <button
              onClick={() => run()}
              disabled={loading || !anchorUei.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find'}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="State (e.g. VA)"
            maxLength={2}
            className="w-32 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm uppercase text-ink placeholder:text-faint placeholder:normal-case"
          />
          {mode === 'describe' && (
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            >
              <option value="">Any concentration</option>
              <option value="specialist">Specialist (80%+ in one code)</option>
              <option value="focused">Focused (50–80%)</option>
              <option value="diversified">Diversified</option>
            </select>
          )}
        </div>
      </div>

      {mode === 'complement' && anchorName && (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
          Finding partners that <span className="font-medium text-ink">complement {anchorName}</span> — adjacent
          capability, deliberately excluding firms that do the same thing (those compete with you).
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {/* Results */}
      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Matching against capability profiles…
        </div>
      )}

      {!loading && searched && !matches.length && !error && (
        <div className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-soft">
          No matches above the similarity floor.
          {scanned > 0 && <span className="block mt-1 text-xs text-faint">Scanned {scanned.toLocaleString()} capability profiles.</span>}
          <span className="mt-2 block text-xs text-faint">Try broader wording, or drop the state filter.</span>
        </div>
      )}

      {!loading && matches.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-1.5 text-xs text-faint">
            <Info className="h-3 w-3" />
            {matches.length} matches from {scanned.toLocaleString()} profiles · similarity is capability
            adjacency, not a fit score — 0.5+ is strong for this data.
          </div>
          <div className="space-y-2">
            {matches.map((m) => (
              <div key={m.rollup_uei} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{m.rollup_name}</span>
                      {m.state && <span className="text-xs text-faint">{m.state}</span>}
                      {m.specialty_tier && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_STYLE[m.specialty_tier]}`}>
                          {m.specialty_tier}
                        </span>
                      )}
                    </div>
                    {m.capability_label && (
                      <div className="mt-1 text-sm text-ink-soft">{m.capability_label}</div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-faint">
                      <span>{m.award_count.toLocaleString()} award{m.award_count === 1 ? '' : 's'}</span>
                      <span>{money(m.total_obligated)} obligated</span>
                      <span title="Cosine similarity between capability profiles">
                        {Math.round(m.similarity * 100)}% capability match
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => savePartner(m)}
                      disabled={!email || saved[m.rollup_uei]}
                      className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:text-ink disabled:opacity-60"
                    >
                      {saved[m.rollup_uei]
                        ? <><Check className="h-3 w-3" /> Saved</>
                        : <><BookmarkPlus className="h-3 w-3" /> Save partner</>}
                    </button>
                    <button
                      onClick={() => setAnchorFrom(m)}
                      className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:text-ink"
                    >
                      Partners like this
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Capability is derived from federal award history (PSC/NAICS mix, buyers, set-aside wins) —
            not self-reported capability statements. Set-aside history is work won, not a verified
            certification; confirm certs in SAM.
          </p>
        </>
      )}
    </div>
  );
}
