/**
 * Agency forecast summary — the data layer for the public /forecasts hub.
 *
 * WHY THIS EXISTS
 * ---------------
 * `agency_forecasts` holds 35,912 rows in Supabase and had NO public surface.
 * Every reader was `/opportunity-map/*` (authenticated), an `/api/*` route, or
 * `/mcp/about`. Meanwhile `/forecasts` — the obvious URL — had no route at all:
 * it returned 404, it was advertised in sitemap.xml, and roughly 1,300 public
 * pages linked to it. The largest block of already-materialized, publicly
 * renderable data on the site was reachable only by logging in.
 *
 * Source: Supabase (`agency_forecasts`), read-only, service-role.
 * **No BigQuery.** A public request must never reach the warehouse.
 *
 * HONESTY CONTRACT
 * ----------------
 * Every figure here is counted from rows actually read. On a read failure the
 * summary returns `available: false` and the page renders an unavailable state
 * plus `noindex` — it never renders a zero it cannot prove. That is the same
 * rule the BigQuery cache layer follows (src/lib/bigquery/cache.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Columns are tiny; paging 36k rows of four fields is ~1.5 MB once per day. */
const PAGE = 1000;
const MAX_ROWS = 60_000;

export interface Tally {
  key: string;
  label: string;
  count: number;
}

export interface ForecastSummary {
  available: boolean;
  total: number;
  agencies: Tally[];
  naics: Tally[];
  fiscalYears: Tally[];
  setAsides: Tally[];
  /** Distinct source systems the rows came from — shown as provenance. */
  sources: Tally[];
  /** Most recent last_synced_at across the corpus, ISO or null. */
  lastSynced: string | null;
}

const UNAVAILABLE: ForecastSummary = {
  available: false,
  total: 0,
  agencies: [],
  naics: [],
  fiscalYears: [],
  setAsides: [],
  sources: [],
  lastSynced: null,
};

interface Row {
  source_agency: string | null;
  bureau: string | null;
  naics_code: string | null;
  naics_description: string | null;
  fiscal_year: string | null;
  set_aside_type: string | null;
  source_type: string | null;
  last_synced_at: string | null;
}

function tally(
  rows: Row[],
  keyOf: (r: Row) => string | null,
  labelOf: (r: Row) => string | null,
  limit: number,
): Tally[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { label: labelOf(r) || k, count: 1 });
  }
  return [...m.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getForecastSummary(): Promise<ForecastSummary> {
  const db = sb();
  if (!db) return UNAVAILABLE;

  const rows: Row[] = [];
  try {
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await db
        .from('agency_forecasts')
        .select(
          'source_agency, bureau, naics_code, naics_description, fiscal_year, set_aside_type, source_type, last_synced_at',
        )
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[forecasts] read failed:', error.message);
        return UNAVAILABLE; // fail closed — never a partial count presented as a total
      }
      const batch = (data ?? []) as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch (err) {
    console.error('[forecasts] read threw:', err instanceof Error ? err.message : err);
    return UNAVAILABLE;
  }

  if (rows.length === 0) return UNAVAILABLE;

  let lastSynced: string | null = null;
  for (const r of rows) {
    if (r.last_synced_at && (!lastSynced || r.last_synced_at > lastSynced)) {
      lastSynced = r.last_synced_at;
    }
  }

  return {
    available: true,
    total: rows.length,
    agencies: tally(rows, (r) => r.bureau || r.source_agency, (r) => r.bureau || r.source_agency, 40),
    naics: tally(rows, (r) => r.naics_code, (r) => r.naics_description || r.naics_code, 25),
    fiscalYears: tally(rows, (r) => r.fiscal_year, (r) => r.fiscal_year, 8),
    setAsides: tally(rows, (r) => r.set_aside_type, (r) => r.set_aside_type, 12),
    sources: tally(rows, (r) => r.source_type, (r) => r.source_type, 8),
    lastSynced,
  };
}

/** Slugify an agency name the way /agencies/[slug] expects. */
export function agencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
