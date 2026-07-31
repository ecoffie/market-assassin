/**
 * Shared grants-ingest core — the ONE place the Grants.gov → grants_cache sync logic lives, so the
 * cron (steady-state refresh) and the local runner (one-time drain / manual re-pull) can never
 * drift (the "extract per-record logic into a shared lib" rule — same pattern as ingestDibbs).
 *
 * Pulls the ACTIONABLE statuses: posted (open now) + forecasted (upcoming, not yet open — the grant
 * equivalent of the Forecast horizon). Closed/archived are deliberately EXCLUDED (past-deadline =
 * un-actionable clutter on a find-and-bid map, same rule as expired recompetes). Each grant is
 * pinned at its AWARDING DEPARTMENT's HQ (grants have no place of performance) via grantsHqFor +
 * geocodeCity — honestly "agency HQ · approximate". Upserts on opp_number; accumulate pattern (the
 * table is the durable store, each run widens/refreshes coverage).
 *
 * Eric 2026-07-31 — "store the grants" (Option 1), widened to forecasted, then daily cron.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchGrants } from './search';
import { grantsHqFor } from './grants-hq';
import { geocodeCity } from '@/lib/geo/city-geocode';

/** Statuses we keep on the map — actionable only. Order is the fetch order. */
export const GRANT_INGEST_STATUSES: Array<'posted' | 'forecasted'> = ['posted', 'forecasted'];

export interface IngestGrantsOptions {
  /** Max rows to pull PER STATUS (safety cap; the real total is ~1,225 posted + ~502 forecasted). */
  maxPerStatus?: number;
  /** Grants.gov page size (its search caps a page at 100). */
  pageSize?: number;
  /** Timestamp to stamp synced_at with — pass in (scripts/crons can't call Date.now in some ctxs). */
  nowIso?: string;
}

export interface IngestGrantsResult {
  fetched: number;
  placed: number;      // rows given agency-HQ coords
  unplaced: number;    // rows with no resolvable HQ (should be ~0 — DC default catches all)
  upserted: number;
  perStatus: Record<string, number>;
  degraded: boolean;   // an upstream Grants.gov fetch errored mid-run (partial data)
}

const clean = (s?: string | null) => (s == null ? null : String(s).replace(/\x00/g, '').trim() || null);
const stableSeed = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
// Grants.gov dates are MM/DD/YYYY → ISO for a date column.
export function grantToIsoDate(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/**
 * Fetch + resolve + upsert actionable grants into grants_cache. Returns counts; degrades (does NOT
 * throw) on an upstream fetch error mid-run — stamps `degraded:true` and upserts what it got, so a
 * transient Grants.gov blip refreshes partially instead of failing the whole cron.
 */
export async function ingestGrants(
  db: SupabaseClient,
  opts: IngestGrantsOptions = {},
): Promise<IngestGrantsResult> {
  const maxPerStatus = Math.max(1, opts.maxPerStatus ?? 5000);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const nowIso = opts.nowIso ?? new Date().toISOString();

  const rows: Record<string, unknown>[] = [];
  const perStatus: Record<string, number> = {};
  let placed = 0, unplaced = 0, degraded = false;

  for (const status of GRANT_INGEST_STATUSES) {
    let n = 0;
    for (let offset = 0; offset < maxPerStatus; offset += pageSize) {
      const res = await searchGrants({ status, limit: pageSize, offset }).catch(() => null);
      if (!res || res.degraded) { degraded = true; break; }   // upstream blip — keep what we have
      if (res.grants.length === 0) break;
      for (const g of res.grants) {
        const oppNumber = clean(g.oppNumber);
        if (!oppNumber) continue;
        const hq = grantsHqFor(g.agencyCode);
        const geo = geocodeCity(hq.city, hq.state, stableSeed(oppNumber));
        if (geo) placed++; else unplaced++;
        rows.push({
          opp_number: oppNumber,
          title: clean(g.title),
          agency: clean(g.agency),
          agency_code: clean(g.agencyCode),
          description: clean(g.description),
          award_ceiling: g.awardCeiling != null && Number.isFinite(g.awardCeiling) ? g.awardCeiling : null,
          posted_date: grantToIsoDate(g.postedDate),
          close_date: grantToIsoDate(g.closeDate),
          status,   // the FETCH status is authoritative (posted | forecasted)
          cfda_list: Array.isArray(g.cfdaList) ? g.cfdaList : null,
          url: clean(g.url),
          map_lat: geo ? geo.lat : null,
          map_lng: geo ? geo.lng : null,
          map_loc_source: geo ? 'agency_hq' : null,
          synced_at: nowIso,
        });
        n++;
      }
      if (res.grants.length < pageSize) break; // last page
    }
    perStatus[status] = n;
  }

  // Dedupe by opp_number BEFORE upsert — ON CONFLICT can't touch a row twice in one statement, and
  // a grant could theoretically appear under two fetches. Keep the last occurrence.
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) byId.set(r.opp_number as string, r);
  const deduped = [...byId.values()];

  let upserted = 0;
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500);
    const { error } = await db.from('grants_cache').upsert(chunk, { onConflict: 'opp_number' });
    if (error) { console.error(`[grants:ingest] upsert failed (${chunk.length}): ${error.message}`); degraded = true; continue; }
    upserted += chunk.length;
  }

  return { fetched: rows.length, placed, unplaced, upserted, perStatus, degraded };
}
