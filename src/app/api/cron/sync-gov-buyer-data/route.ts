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
import { createClient } from '@supabase/supabase-js';
import { searchEntities } from '@/lib/sam/entity-api';

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

function normalize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// A SAM POC "fullName" is garbage when an agency (e.g. DLA) stuffs the
// field with buyer-lookup instructions. Mirror the filter in
// scripts/populate-contracting-officers.js.
function isGarbageName(name: string | null): boolean {
  if (!name) return true;
  if (name.length > 80) return true;          // paragraph, not a name
  if (/\b(see|visit|email|contact the|please)\b/i.test(name)) return true;
  return false;
}

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

async function syncContacts() {
  const sb = getSupabase();
  const errors: string[] = [];
  let upserted = 0;
  const PAGE = 1000;
  let offset = 0;

  // Sweep sam_opportunities pages, flatten points_of_contact → rows.
  // Bounded by CONTACT_MAX_PAGES so a single run stays cheap; the unique
  // source_row_key makes re-runs idempotent so daily passes converge.
  const MAX_PAGES = Number(process.env.GOV_BUYER_CONTACT_PAGES_PER_RUN || 10);

  for (let p = 0; p < MAX_PAGES; p++) {
    const { data: opps, error } = await sb
      .from('sam_opportunities')
      .select('notice_id, solicitation_number, department, office, sub_tier, posted_date, points_of_contact')
      .order('posted_date', { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error) { errors.push(`contacts page ${p}: ${error.message}`); break; }
    if (!opps || opps.length === 0) break;

    const rows: Record<string, unknown>[] = [];
    for (const row of opps) {
      const pocs = Array.isArray(row.points_of_contact) ? row.points_of_contact : [];
      pocs.forEach((c: Record<string, unknown>, idx: number) => {
        const fullName = normalize(c.fullName as string);
        const email = normalize(c.email as string);
        const phone = normalize(c.phone as string);
        if (isGarbageName(fullName)) return;
        if (!email && !phone) return;            // useless for outreach
        rows.push({
          source_row_key: `${row.notice_id}::${idx}`,
          contact_fullname: fullName,
          contact_title: normalize(c.title as string) ||
            (c.type === 'primary' ? 'Primary Contact' : c.type === 'secondary' ? 'Secondary Contact' : null),
          contact_email: email,
          contact_phone: phone,
          department_ind_agency: normalize(row.department),
          office: normalize(row.office),
          sub_tier: normalize(row.sub_tier),
          role_category: 'contracting',          // the only role SAM POCs yield
          solicitation_number: normalize(row.solicitation_number),
          posted_date: normalize(row.posted_date),
          source: 'sam_opportunities_poc',
          raw_data: c,
          updated_at: new Date().toISOString(),
        });
      });
    }

    if (rows.length) {
      const { error: upErr } = await sb
        .from('federal_contacts')
        .upsert(rows, { onConflict: 'source_row_key', ignoreDuplicates: false });
      if (upErr) errors.push(`contacts upsert page ${p}: ${upErr.message}`);
      else upserted += rows.length;
    }

    if (opps.length < PAGE) break;
    offset += PAGE;
  }

  return { upserted, errors };
}

// ───────────────────────── handler ─────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Auth: Vercel cron header OR admin password (mirrors other crons).
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const password = searchParams.get('password');
  if (!isVercelCron && password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pull = searchParams.get('pull') || 'both';
  const started = Date.now();
  const out: Record<string, unknown> = { pull };

  try {
    if (pull === 'both' || pull === 'contacts') {
      out.contacts = await syncContacts();
    }
    if (pull === 'both' || pull === 'entities') {
      out.entities = await syncEntities();
    }
    out.durationSeconds = Math.round((Date.now() - started) / 1000);
    out.success = true;
    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg, ...out }, { status: 500 });
  }
}
