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
import {
  statusCompleteness, runIsComplete, probeReconcileSchema, reconcileAbsentGrants, confirmAbsentGrants, grantsGovIdFromUrl,
  type StatusCompleteness, type ReconcileResult, type ConfirmResult, type ReconcileOptions,
} from './reconcile';

/** Statuses we keep on the map — actionable only. Order is the fetch order. */
export const GRANT_INGEST_STATUSES: Array<'posted' | 'forecasted'> = ['posted', 'forecasted'];

export interface IngestGrantsOptions {
  /** Max rows to pull PER STATUS (safety cap; the real total is ~1,225 posted + ~502 forecasted). */
  maxPerStatus?: number;
  /** Grants.gov page size (its search caps a page at 100). */
  pageSize?: number;
  /** Timestamp to stamp synced_at with — pass in (scripts/crons can't call Date.now in some ctxs). */
  nowIso?: string;
  /** Max absent rows to confirm against fetchOpportunity this run (bounded; 0 disables). */
  confirmLimit?: number;
  /** Reconcile safety options (breaker). The cron never overrides the breaker. */
  reconcile?: ReconcileOptions;
  /** Injectable fetch for the confirmation step (tests). */
  fetchImpl?: typeof fetch;
}

export interface IngestGrantsResult {
  fetched: number;
  placed: number;      // rows given agency-HQ coords
  unplaced: number;    // rows with no resolvable HQ (should be ~0 — DC default catches all)
  upserted: number;
  perStatus: Record<string, number>;
  degraded: boolean;   // an upstream Grants.gov fetch errored mid-run (partial data)
  /** Per-status completeness evidence (expected hitCount vs unique fetched, pages, errors). */
  completeness: Record<string, StatusCompleteness>;
  /** Every status proven complete → the only condition under which reconcile may mark absence. */
  complete: boolean;
  /** Whether the reconcile migration is applied (columns + runs table). Without it: upsert-only. */
  schema: { columns: boolean; runsTable: boolean };
  reconcile: ReconcileResult;
  confirm: ConfirmResult | null;
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

  type Evidence = { hitCounts: number[]; pages: number; unique: Set<string>; degraded: boolean; error: string | null; capped: boolean };
  const evidence: Record<string, Evidence> = {};

  for (const status of GRANT_INGEST_STATUSES) {
    let n = 0;
    const ev: Evidence = { hitCounts: [], pages: 0, unique: new Set<string>(), degraded: false, error: null, capped: false };
    evidence[status] = ev;
    let exhausted = false;
    for (let offset = 0; offset < maxPerStatus; offset += pageSize) {
      let res: Awaited<ReturnType<typeof searchGrants>> | null = null;
      try {
        res = await searchGrants({ status, limit: pageSize, offset });
      } catch (e) {
        ev.error = (e as Error).message || 'fetch threw';
      }
      if (!res || res.degraded) { degraded = true; ev.degraded = true; break; }   // upstream blip — keep what we have
      ev.pages++;
      ev.hitCounts.push(res.total); // unfiltered search → `total` is Grants.gov's hitCount
      if (res.grants.length === 0) { exhausted = true; break; }
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
        ev.unique.add(oppNumber);
        n++;
      }
      if (res.grants.length < pageSize) { exhausted = true; break; } // last page
    }
    if (!exhausted && !ev.degraded && !ev.error) ev.capped = true;
    perStatus[status] = n;
  }

  const completeness: Record<string, StatusCompleteness> = {};
  for (const [status, ev] of Object.entries(evidence)) {
    completeness[status] = statusCompleteness({
      status, hitCounts: ev.hitCounts, pages: ev.pages, fetchedUnique: ev.unique.size,
      degraded: ev.degraded, error: ev.error, capped: ev.capped,
    });
  }

  // Migration probe: without the reconcile columns the upsert must stay byte-for-byte the old shape.
  const schema = await probeReconcileSchema(db).catch(() => ({ columns: false, runsTable: false }));

  // Rows absent BEFORE this run (to count restorations). Only meaningful with the columns present.
  const previouslyAbsent = new Set<string>();
  if (schema.columns) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('grants_cache').select('opp_number').not('absent_since', 'is', null).order('opp_number').range(from, from + 999);
      if (error) { console.error('[grants:ingest] previously-absent read failed:', error.message); break; }
      for (const r of (data || []) as Array<{ opp_number: string }>) previouslyAbsent.add(r.opp_number);
      if (!data || data.length < 1000) break;
    }
  }

  // Dedupe by opp_number BEFORE upsert — ON CONFLICT can't touch a row twice in one statement, and
  // a grant could theoretically appear under two fetches. Keep the last occurrence.
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) byId.set(r.opp_number as string, r);
  const deduped = [...byId.values()].map((r) =>
    // Seen in this snapshot → last_seen_at now, and any earlier absence is cleared (restored).
    schema.columns ? { ...r, last_seen_at: nowIso, absent_since: null, superseded_by: null } : r,
  );

  let upserted = 0;
  let upsertFailed = false;
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500);
    const { error } = await db.from('grants_cache').upsert(chunk, { onConflict: 'opp_number' });
    if (error) { console.error(`[grants:ingest] upsert failed (${chunk.length}): ${error.message}`); degraded = true; upsertFailed = true; continue; }
    upserted += chunk.length;
  }

  // A failed upsert chunk means some SEEN rows were not refreshed — treat the run as incomplete.
  const complete = runIsComplete(completeness) && !upsertFailed;

  let reconcile: ReconcileResult;
  if (!schema.columns) {
    reconcile = { ran: false, reason: 'reconcile migration not applied (grants_cache columns missing) — upsert-only', markedAbsent: 0, actionableMarkedAbsent: 0, superseded: 0, restored: 0 };
  } else {
    // Stable identity: Grants.gov opportunity id → the number it is listed under in THIS snapshot.
    const seenIds = new Map<string, string>();
    for (const r of byId.values()) { const gid = grantsGovIdFromUrl(r.url); if (gid) seenIds.set(gid, r.opp_number as string); }
    reconcile = await reconcileAbsentGrants(db, { complete, seen: new Set(byId.keys()), previouslyAbsent, nowIso, seenIds }, opts.reconcile)
      .catch((e) => ({ ran: false, reason: `reconcile error: ${(e as Error).message}`, markedAbsent: 0, actionableMarkedAbsent: 0, superseded: 0, restored: 0 }));
    if (!complete && reconcile.reason?.startsWith('run not proven complete')) {
      const why = Object.entries(completeness).filter(([, c]) => !c.complete).map(([st, c]) => `${st}: ${c.reason}`);
      if (upsertFailed) why.push('upsert: a chunk failed');
      reconcile = { ...reconcile, reason: `run not proven complete — nothing marked absent (${why.join('; ')})` };
    }
  }

  let confirm: ConfirmResult | null = null;
  if (schema.columns) {
    confirm = await confirmAbsentGrants(db, { limit: opts.confirmLimit ?? 40, nowIso, fetchImpl: opts.fetchImpl })
      .catch((e) => { console.error('[grants:confirm] failed:', (e as Error).message); return null; });
  }

  // Persist the run's evidence (best-effort; missing table → logged skip, never fails the ingest).
  if (schema.runsTable) {
    const { error } = await db.from('grants_ingest_runs').insert({
      started_at: nowIso, complete, degraded,
      per_status: completeness, reconcile, confirm,
      error: upsertFailed ? 'one or more upsert chunks failed' : null,
    });
    if (error) console.error('[grants:ingest] run record insert failed:', error.message);
  } else {
    console.warn('[grants:ingest] grants_ingest_runs missing — run evidence not persisted (migration not applied)');
  }

  return { fetched: rows.length, placed, unplaced, upserted, perStatus, degraded, completeness, complete, schema, reconcile, confirm };
}
