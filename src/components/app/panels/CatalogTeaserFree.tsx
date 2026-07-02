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
import { getMIApiHeaders } from '../authHeaders';
import LockedPreview from './LockedPreview';

type FeatureId = 'recompetes' | 'forecasts' | 'contractors' | 'decision-makers';

interface Props {
  email: string;
  featureId: FeatureId;
}

type Profile = { naics: string[]; agencies: string[] };

// Per-surface config: title/noun for copy, and a builder that turns the user's
// profile into the real request URL. All endpoints are auth-gated (not tier-gated),
// so a logged-in free user gets a real count. limit=5 gives us the teaser rows.
const CONFIG: Record<FeatureId, {
  title: string;
  noun: string;
  // Returns { url, countKeys, labelKeys } or null if the profile can't scope it.
  // labelKeys are tried in order — the first non-empty real value wins (rows can
  // have a null primary field, so we fall back to another REAL field, never fake).
  build: (p: Profile) => { url: string; countKeys: string[]; labelKeys: string[] } | null;
}> = {
  recompetes: {
    title: 'Expiring Contracts',
    noun: 'expiring contracts',
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
    // This directory is keyed by AGENCY, not NAICS. Scope to the user's first
    // target agency; if they have none, we show a profile-scoped-by-agency count
    // isn't possible — fall back to no filter (still their logged-in total view).
    build: (p) => {
      const agency = p.agencies[0];
      const agencyParam = agency ? `&agency=${encodeURIComponent(agency)}` : '';
      return {
        url: `/api/app/federal-contacts?limit=5${agencyParam}`, // email header added at fetch time
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

export default function CatalogTeaserFree({ email, featureId }: Props) {
  const cfg = CONFIG[featureId];
  const [count, setCount] = useState<number | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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

      const req = cfg.build(profile);
      if (!req) { setLoading(false); return; }

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
