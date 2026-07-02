'use client';

/**
 * CatalogTeaserFree — Treatment B ("count + blurred rows") for free-tier catalog
 * surfaces (Expiring Contracts, Upcoming Buys, Contractors, Decision Makers).
 *
 * Enterprise-SaaS data-product pattern (Apollo / ZoomInfo / Crunchbase): show the
 * free user the REAL match count for their profile ("2,341 match you") + a few
 * REAL teaser rows we render blurred, then upgrade to reveal. Feeling the volume
 * of matches is the highest-converting free→paid moment for a data catalog.
 *
 * All numbers and rows are REAL (rule #1). We fetch the actual match count and a
 * handful of real rows from the SAME endpoint the paid panel uses; the rows are
 * obscured with a CSS blur, never fabricated.
 *
 * Config per featureId maps to the real endpoint, its count field, its label
 * field, and how to scope it to the user's profile (NAICS for opp/contractor
 * catalogs; agency for the contact directory, which has no NAICS axis).
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import LockedPreview from './LockedPreview';

type FeatureId = 'recompetes' | 'forecasts' | 'contractors' | 'decision-makers';

interface Props {
  email: string;
  featureId: FeatureId;
  onPanelChange?: (panel: AppPanel) => void;
}

type Profile = { naics: string[]; agencies: string[] };

// Per-surface config: title/noun for copy, and a builder that turns the user's
// profile into the real request URL. All endpoints are auth-gated (not tier-gated),
// so a logged-in free user gets a real count. limit=5 gives us the teaser rows.
const CONFIG: Record<FeatureId, {
  title: string;
  noun: string;
  // What the user must set in Settings for this surface to produce real results.
  setupPrompt: string;
  // Returns { url, countKeys, labelKeys } or null if the profile can't scope it.
  // labelKeys are tried in order — the first non-empty real value wins (rows can
  // have a null primary field, so we fall back to another REAL field, never fake).
  build: (p: Profile) => { url: string; countKeys: string[]; labelKeys: string[] } | null;
}> = {
  recompetes: {
    title: 'Expiring Contracts',
    noun: 'expiring contracts',
    setupPrompt: 'Set your NAICS codes, PSC codes, and keywords',
    build: (p) => {
      const naics = p.naics[0];
      if (!naics) return null;
      return {
        url: `/api/recompete?naics=${encodeURIComponent(naics)}&months=18&limit=5&sort=value&order=desc`,
        countKeys: ['pagination.total', 'summary.vehicleCount'],
        labelKeys: ['description', 'naics_description', 'incumbent_name', 'awarding_agency'],
      };
    },
  },
  forecasts: {
    title: 'Upcoming Buys',
    noun: 'upcoming agency forecasts',
    setupPrompt: 'Set your NAICS codes, PSC codes, and keywords',
    build: (p) => {
      const naics = p.naics[0];
      if (!naics) return null;
      return {
        url: `/api/forecasts?naics=${encodeURIComponent(naics)}&limit=5`,
        countKeys: ['pagination.total', 'summary.totalForecasts'],
        labelKeys: ['title', 'agency', 'department'],
      };
    },
  },
  contractors: {
    title: 'Contractors',
    noun: 'contractors',
    setupPrompt: 'Set your NAICS codes, PSC codes, and keywords',
    build: (p) => {
      const naics = p.naics[0];
      if (!naics) return null;
      return {
        url: `/api/contractors/search-bq?naics=${encodeURIComponent(naics)}&limit=5&sortBy=contract_value`,
        countKeys: ['totalCount', 'filteredCount'],
        labelKeys: ['company', 'city'],
      };
    },
  },
  'decision-makers': {
    title: 'Decision Makers',
    noun: 'buying-office contacts',
    setupPrompt: 'Add the agencies you sell to in your profile',
    // This directory is keyed by AGENCY, not NAICS. Scope to the user's first
    // target agency. If they have NONE, return null → we show the activation
    // nudge instead of an unscoped vanity count ("153K match you" was dishonest:
    // the whole directory, not their matches). The profile drives the result;
    // no target agency = complete the profile first (Eric 2026-07-02).
    build: (p) => {
      const agency = p.agencies[0];
      if (!agency) return null;
      return {
        url: `/api/app/federal-contacts?limit=5&agency=${encodeURIComponent(agency)}`, // email header added at fetch time
        countKeys: ['total'],
        labelKeys: ['contact_fullname', 'contact_title', 'department_ind_agency'],
      };
    },
  },
};

// Safely read a dotted path like "pagination.total" off a response object.
function readPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

// Find the rows array in a response regardless of the wrapper key.
function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['contracts', 'vehicles', 'forecasts', 'contractors', 'contacts', 'opportunities', 'results', 'data']) {
      if (Array.isArray(d[key])) return d[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export default function CatalogTeaserFree({ email, featureId, onPanelChange }: Props) {
  const cfg = CONFIG[featureId];
  const [count, setCount] = useState<number | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Empty profile → the profile drives every result, so with no codes there's
  // nothing to match. Show the activation nudge (→ onboarding slurpee) instead
  // of a hollow unscoped count (Eric 2026-07-02).
  const [profileEmpty, setProfileEmpty] = useState(false);

  const load = useCallback(async () => {
    if (!email) { setLoading(false); return; }
    try {
      // 1) Profile → NAICS + agencies (the authoritative notification profile).
      const wsRes = await fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, {
        headers: getMIApiHeaders(email),
      });
      const ws = wsRes.ok ? await wsRes.json().catch(() => null) : null;
      const s = ws?.profile?.notification || {};
      const profile: Profile = {
        naics: Array.isArray(s.naics_codes) ? s.naics_codes.map(String) : [],
        agencies: Array.isArray(s.agencies) ? s.agencies.map(String) : [],
      };

      // build() returns null when the profile can't scope THIS surface (no NAICS
      // for opp/contractor catalogs; no target agency for the contact directory).
      // That's the activation state — the profile isn't complete enough to produce
      // real, personalized results, so drive them to finish setup.
      const req = cfg.build(profile);
      if (!req) { setProfileEmpty(true); setLoading(false); return; }

      // 2) Real count + teaser rows from the SAME endpoint the paid panel uses.
      const res = await fetch(req.url, { headers: getMIApiHeaders(email) });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json().catch(() => null);

      // Count: first countKey that yields a number.
      let total: number | null = null;
      for (const key of req.countKeys) {
        const v = readPath(data, key);
        if (typeof v === 'number') { total = v; break; }
      }
      setCount(total);

      // Teaser labels — real row values, blurred at render time. Try each label
      // key in order so a null primary field falls back to another REAL field.
      const labels = extractRows(data)
        .map((r) => {
          for (const k of req.labelKeys) {
            const v = r[k];
            if (typeof v === 'string' && v.trim()) return v;
          }
          return '';
        })
        .filter(Boolean)
        .slice(0, 5);
      setRows(labels);
    } catch { /* teaser is best-effort — LockedPreview still shows the upgrade CTA */ } finally {
      setLoading(false);
    }
  }, [email, cfg]);

  useEffect(() => { void load(); }, [load]);

  // Empty profile → activation nudge. The profile drives every result, so with no
  // codes there's nothing real to match. Route to Settings (a 2-min add of NAICS/
  // PSC/keywords) — not a hollow unscoped count. Enterprise onboarding SaaS gates
  // the payoff behind the setup step; the setup step IS the product loop.
  if (!loading && profileEmpty) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-white">{cfg.title}</h1>
          <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-300">
            🔒 Pro
          </span>
        </div>
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 to-slate-950/60 p-6">
          <p className="text-base font-semibold text-amber-100">
            {cfg.setupPrompt} to see the {cfg.noun} that match you.
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Mindy matches every result against your profile — your codes are what turn this into <em>your</em> market.
            Add them once and your alerts, briefings, and this list all start working.
          </p>
          <button
            type="button"
            onClick={() => onPanelChange?.('settings')}
            className="mt-4 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow hover:from-purple-500 hover:to-purple-400"
          >
            Complete your profile →
          </button>
          <p className="mt-2 text-xs text-slate-500">Takes about two minutes.</p>
        </div>
      </div>
    );
  }

  return (
    <LockedPreview
      featureId={featureId}
      title={cfg.title}
      subtitle="Upgrade to Pro to see the full list, filter it, and act on every match."
      ctaLabel="Upgrade to unlock"
      count={count}
      countNoun={cfg.noun}
      sampleRows={rows}
      loading={loading}
    />
  );
}
