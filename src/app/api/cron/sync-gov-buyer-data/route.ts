/**
 * Cron: Sync Government-Buyer Market-Research Data
 *
 * GET /api/cron/sync-gov-buyer-data
 *
 * Two pulls in one daily pass (Eric, 2026-06-04 — "pulling two things"):
 *
 *   1. SB SIDE  → sam_entities
 *      SAM-registered small businesses, fetched via the Entity
 *      Management API (searchEntities). Seeded per (NAICS, state) slice,
 *      checkpointed in sam_entities_sync_state so coverage extends
 *      incrementally instead of re-pulling everything each day. Feeds
 *      the Active Performer rubric + market-depth count.
 *
 *   2. GOV SIDE → federal_contacts (role_category='contracting')
 *      Government POC names/contacts harvested from the
 *      sam_opportunities.points_of_contact arrays we ALREADY sync daily
 *      (near-free — no extra SAM call). Feeds the HigherGov-style people
 *      search. COVERAGE CAVEAT: this is the contracting officer/specialist
 *      only — NOT the program manager / engineer / end-user (those aren't
 *      in SAM POCs; role_category leaves empty buckets for them). See
 *      docs/PRD-gov-buyer-market-research.md §7.
 *
 *      ⚠️ THE CONTACTS PULL IS NOW A REGISTERED, CHECKPOINTED SOURCE.
 *      It is `decision_makers_sam_contacts` in `data_source_instances`, it owns a durable
 *      cursor in `decision_makers_sync_state`, and it is scheduled by its OWN `cron_jobs`
 *      row — NOT by being chained off sync-sam-opportunities. The implementation lives in
 *      src/lib/gov-contacts/buyer-contact-run.ts; this route is only the HTTP edge.
 *      It used to re-read the newest 10 pages with `offset` reset to 0 each run, which is
 *      an ~11-day rolling window over 207,986 notices — 50.8% of held rows had not been
 *      revisited in 90+ days. Do NOT reintroduce a head-only sweep here.
 *
 * Modes (?pull=):
 *   - both     (default) run gov POCs + a slice of SB entities
 *   - contacts gov POC harvest only
 *   - entities SB entity slice only
 *
 * Designed to be cheap per run: the entity pull processes a bounded
 * number of (NAICS,state) slices per invocation (ENTITY_SLICES_PER_RUN)
 * so it never blows the SAM rate limit (1k/day) or the cron timeout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { reportCronOutcome } from '@/lib/cron-self-report';

/**
 * ⚠️ The cron_jobs row is named `sync-decision-makers` while this ROUTE is
 * `sync-gov-buyer-data`. reportCronOutcome writes by JOB name, so the mapping is
 * stated explicitly here rather than inferred from the path.
 */
const CRON_JOB_NAME = 'sync-decision-makers';
import { createClient } from '@supabase/supabase-js';
import { searchEntities } from '@/lib/sam/entity-api';
import { runDecisionMakersSync } from '@/lib/gov-contacts/buyer-contact-run';

// The contacts drain runs under a soft wall-clock budget (budgetMs, default 210s). Without an
// explicit ceiling the platform default would kill the run BEFORE the checkpoint write at the
// end of the handler — contact rows would land but the cursor would never advance, so the drain
// would redo the same page forever while looking like it was working.
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// How many (NAICS,state) entity slices to pull per cron run. Bounded so
// one invocation stays well under the SAM 1k/day cap and the timeout.
// Remaining slices get picked up on subsequent daily runs (checkpointed).
const ENTITY_SLICES_PER_RUN = Number(process.env.GOV_BUYER_ENTITY_SLICES_PER_RUN || 8);
// SAM entity API caps page size at 10 — verified 2026-06-04: size>10
// returns HTTP 400 "size is N", which searchEntities swallows to
// totalCount=0. That made the cron mark every slice 'complete' with 0
// rows. Pages per slice are bounded below so we still make progress.
const ENTITY_PAGE_SIZE = 10;
// Pages to pull per slice PER RUN (10 entities each). 5 pages = 50
// entities/slice/run × 8 slices = ~40 SAM calls/run, well under the cap.
const ENTITY_PAGES_PER_SLICE = Number(process.env.GOV_BUYER_ENTITY_PAGES_PER_SLICE || 5);

// Seed NAICS for the pilot. The two officials' NAICS go here first;
// expand over time. (Same IT/consulting spine the rest of the app seeds.)
const SEED_NAICS = (process.env.GOV_BUYER_SEED_NAICS ||
  '541512,541511,541611,541330,541990,561210,541519,518210')
  .split(',').map(s => s.trim()).filter(Boolean);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// ───────────────────────── helpers ─────────────────────────

// Map a transformed SAMEntity → sam_entities row.
// Exported so the dry-run (scripts/dry-run-gov-buyer-entities.ts) tests
// the REAL mapping, not a drifting copy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function entityToRow(e: any) {
  const naicsCodes: string[] = Array.isArray(e.naicsList)
    ? e.naicsList.map((n: { naicsCode: string }) => n.naicsCode).filter(Boolean)
    : [];
  const primary = Array.isArray(e.naicsList)
    ? (e.naicsList.find((n: { isPrimary: boolean }) => n.isPrimary)?.naicsCode || naicsCodes[0] || null)
    : null;
  const pscCodes: string[] = Array.isArray(e.pscList)
    ? e.pscList.map((p: { pscCode: string }) => p.pscCode).filter(Boolean)
    : [];
  // certifications are already normalized labels (8(a)/HUBZone/...) by
  // entity-api transformEntity via SBA_TYPE_MAP.
  const certs: string[] = e.certifications?.sbaBusinessTypes || [];

  const phys = e.physicalAddress || {};
  return {
    uei: e.ueiSAM,
    cage_code: e.cageCode || null,
    legal_business_name: e.legalBusinessName || e.ueiSAM,
    dba_name: e.dbaName || null,
    // transformEntity outputs the physical address as { city,
    // stateOrProvince, zipCode, countryCode } — read THOSE names. The
    // old code read stateOrProvinceCode/state, which don't exist on the
    // transformed object, so physical_state was always null (verified
    // 2026-06-04 via dry-run — every row had a city but no state).
    physical_city: phys.city || null,
    physical_state: phys.stateOrProvince || null,
    physical_zip: phys.zipCode || null,
    physical_country: phys.countryCode || null,
    primary_naics: primary,
    naics_codes: naicsCodes,
    psc_codes: pscCodes,
    certifications: certs,
    // P0-3: per-NAICS small-business representation, preserved as a tri-state map
    // ({"561720":"Y"}; absent key = SAM did not say) plus a derived array for indexed
    // containment queries. certifications[] answers a DIFFERENT question (socioeconomic
    // set-asides) and must not be used as a size proxy — doing so is the P0-3 defect.
    naics_small_business: e.certifications?.naicsSmallBusiness || {},
    small_business_naics: Object.entries(e.certifications?.naicsSmallBusiness || {})
      .filter(([, v]) => v === 'Y').map(([c]) => c).sort(),
    naics_sb_source: 'sam_entity_api',
    naics_sb_observed_at: new Date().toISOString(),
    registration_status: e.registrationStatus || null,
    registration_expiry: e.registrationExpirationDate
      ? new Date(e.registrationExpirationDate).toISOString().slice(0, 10)
      : null,
    points_of_contact: e.pointsOfContact || [],
    entity_url: e.entityUrl || null,
    sam_url: e.ueiSAM ? `https://sam.gov/entity/${e.ueiSAM}` : null,
    source: 'sam_entity_api',
    synced_at: new Date().toISOString(),
  };
}

// ───────────────────────── SB entity pull ─────────────────────────

async function syncEntities() {
  const sb = getSupabase();
  let slicesRun = 0;
  let upserted = 0;
  const errors: string[] = [];

  // Pick the next NAICS slices to work: those never synced or stalest.
  // Ensure a sync_state row exists for each seed NAICS (nationwide slice).
  // Use the sentinel 'ALL' for nationwide, NOT null — Postgres treats
  // NULL != NULL, so a UNIQUE(naics_code, state_code) constraint never
  // dedupes null state and every run inserted a NEW duplicate slice row
  // (bug 2026-06-04: checkpoints never advanced, table stuck re-pulling
  // pages 1-5). A non-null sentinel makes the conflict target work.
  for (const naics of SEED_NAICS) {
    await sb.from('sam_entities_sync_state')
      .upsert({ naics_code: naics, state_code: 'ALL' }, { onConflict: 'naics_code,state_code', ignoreDuplicates: true });
  }

  const { data: slices } = await sb
    .from('sam_entities_sync_state')
    .select('*')
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(ENTITY_SLICES_PER_RUN);

  const debug: Array<Record<string, unknown>> = [];
  for (const slice of slices || []) {
    slicesRun++;
    try {
      await sb.from('sam_entities_sync_state')
        .update({ status: 'in_progress' })
        .eq('id', slice.id);

      // Pull several small (size=10) pages per slice this run. SAM caps
      // entity page size at 10, so we page through to make real progress.
      let page = (slice.last_page || 0) + 1;
      let sliceRows = 0;
      let totalCount = slice.total_records || 0;
      let hasMore = true;
      for (let p = 0; p < ENTITY_PAGES_PER_SLICE && hasMore; p++) {
        const result = await searchEntities({
          naicsCode: slice.naics_code,
          // 'ALL' sentinel = nationwide → no state filter.
          stateCode: slice.state_code && slice.state_code !== 'ALL' ? slice.state_code : undefined,
          registrationStatus: 'Active',
          page,
          size: ENTITY_PAGE_SIZE,
        });
        totalCount = result.totalCount;
        hasMore = result.hasMore;

        const rows = result.entities.filter((e) => e.ueiSAM).map(entityToRow);
        if (rows.length) {
          const { error } = await sb
            .from('sam_entities')
            .upsert(rows, { onConflict: 'uei', ignoreDuplicates: false });
          if (error) { errors.push(`entities ${slice.naics_code} p${page}: ${error.message}`); break; }
          upserted += rows.length;
          sliceRows += rows.length;
        }
        page++;
      }

      debug.push({ naics: slice.naics_code, fromPage: (slice.last_page || 0) + 1, toPage: page - 1, totalCount, sliceRows });

      // Advance / complete the checkpoint. last_page = next page to fetch;
      // reset to 0 when we've swept the whole NAICS so it re-checks later.
      const done = !hasMore;
      await sb.from('sam_entities_sync_state').update({
        last_page: done ? 0 : page - 1,
        total_records: totalCount,
        entities_upserted: (slice.entities_upserted || 0) + sliceRows,
        status: done ? 'complete' : 'in_progress',
        last_error: null,
        last_synced_at: new Date().toISOString(),
      }).eq('id', slice.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`entities ${slice.naics_code}: ${msg}`);
      await sb.from('sam_entities_sync_state')
        .update({ status: 'error', last_error: msg, last_synced_at: new Date().toISOString() })
        .eq('id', slice.id);
    }
  }

  return { slicesRun, upserted, errors, debug };
}

// ───────────────────────── gov POC pull ─────────────────────────
//
// Delegates to the registered source runner. The extraction logic, the checkpoint algebra
// and the clock semantics are all unit-tested in src/lib/gov-contacts/buyer-contact-source.ts.

// ───────────────────────── handler ─────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Auth: the cron DISPATCHER's bearer, a direct Vercel cron header, or an admin password.
  //
  // ⚠️ The dispatcher bearer is load-bearing and was missing. This route only accepted
  // `x-vercel-cron` / `?password=`, but the dispatcher (src/app/api/cron/dispatch) calls jobs
  // with `authorization: Bearer $CRON_SECRET` + `x-cron-dispatch: 1` and never sets
  // `x-vercel-cron`. So the FIRST scheduled fire of `sync-decision-makers` came back 401
  // (2026-09-15T02:00:27Z) — registered, enabled, firing on time, and unable to authenticate.
  // Matches the shape used by every other dispatcher-run job (see fco-roster-watch).
  const auth = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const isDispatcher = Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
  const password = searchParams.get('password');
  if (!isVercelCron && !isDispatcher && password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pull = searchParams.get('pull') || 'both';
  // dry=1 means ZERO persistent writes: no contact rows, no checkpoint move, no lease, no
  // clocks, no alert state. It is a read-only rehearsal, not a quieter run.
  const dry = searchParams.get('dry') === '1';
  const num = (k: string, d: number) => {
    const v = Number(searchParams.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const started = Date.now();
  const out: Record<string, unknown> = { pull, dry };

  try {
    if (pull === 'both' || pull === 'contacts') {
      out.contacts = await runDecisionMakersSync(getSupabase(), {
        dry,
        pageSize: num('pageSize', 500),
        refreshPages: num('refreshPages', 12),
        backfillPages: num('backfillPages', 20),
        refreshWindowDays: num('refreshWindowDays', 3),
        budgetMs: num('budgetMs', 210_000),
      });
    }
    if ((pull === 'both' || pull === 'entities') && !dry) {
      out.entities = await syncEntities();
    }
    out.durationSeconds = Math.round((Date.now() - started) / 1000);
    out.success = true;
    // The dispatcher fire-and-forgets this route (timeout_ms 290s > its 55s await
    // cap) and records `dispatched` at 12s, which the watchdog ignores. Without
    // this the run's real outcome is invisible forever — 71 such runs in 30 days.
    // A `dry` rehearsal must not overwrite the scheduled job's status.
    if (!dry) await reportCronOutcome(CRON_JOB_NAME, 'success');
    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!dry) await reportCronOutcome(CRON_JOB_NAME, 'error', msg).catch(() => {});
    return NextResponse.json({ success: false, error: msg, ...out }, { status: 500 });
  }
}
