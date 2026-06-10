/**
 * /api/app/target-list — CRUD for the user's saved BD target offices.
 *
 * Slice 3A of the Target Market Research roadmap. Drives the
 * "+ Add to my list" button in the AgencyDrawer (Slice 3B) and the
 * upcoming My Target List panel (Slice 3C).
 *
 * Vocabulary note: "target list" is plain BD language per the
 * mindy-vocabulary-rule. The table is `user_target_list`, NOT
 * `user_target_accounts` / "TAL" / sales jargon.
 *
 * Verbs:
 *   GET    ?email=...               → list mine (most-recent first)
 *   POST   { ...office fields }     → add (idempotent via UNIQUE)
 *   PATCH  { id, ...fields }        → update status / priority / notes
 *   DELETE { id, user_email }       → remove
 *
 * Pro-gated. Free users get 402 when they try to POST. Reading the
 * list is allowed for any signed-in user (so the "saved" star can
 * render correctly even after a tier downgrade — they still see what
 * they had).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { getAgencySatForNaics } from '@/lib/bigquery/agencies';

// Normalize an agency name so the BQ SAT data ("DEPARTMENT OF VETERANS AFFAIRS")
// matches the saved target's name ("Department of Veterans Affairs"). Strip
// punctuation/case + the "department of" filler down to core tokens.
function normalizeAgencyName(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(DEPARTMENT|DEPT|OF|THE|U S|US|ADMINISTRATION|AGENCY|NATIONAL)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

const VALID_STATUSES = ['targeting', 'contacted', 'qualified', 'passed', 'won'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

function normalizeOfficeName(name: string): string {
  return name.toUpperCase().replace(/\s+/g, ' ').trim();
}

interface SatLookupAgency {
  contractingOffice?: string;
  name?: string;
  satRatio?: number;
  satContractCount?: number;
  contractCount?: number;
}

interface SatBackfillProfile {
  naicsCodes: string[];
  pscCode: string;
  businessType: string;
  veteranStatus: string;
}

/** Match a saved office to TMR cache or find-agencies row; return satRatio 0..1. */
function satRatioForOffice(officeName: string, agencies: SatLookupAgency[]): number {
  const want = normalizeOfficeName(officeName);
  if (!want) return 0;
  for (const row of agencies) {
    for (const label of [row.contractingOffice, row.name]) {
      if (!label) continue;
      const norm = normalizeOfficeName(label);
      if (norm === want || norm.includes(want) || want.includes(norm)) {
        const precomputed = Number(row.satRatio);
        if (Number.isFinite(precomputed) && precomputed > 0) return precomputed;
        const sat = row.satContractCount || 0;
        const count = row.contractCount || 0;
        if (sat > 0 && count > 0) return sat / count;
      }
    }
  }
  return 0;
}

function cacheLookupKey(naics: string, psc: string): string {
  return `${naics.trim()}|${(psc || '').trim()}`;
}

/** NAICS/PSC pairs to search: per-target provenance + profile defaults. */
function collectSatCacheKeys(
  targets: Array<Record<string, unknown>>,
  profile: SatBackfillProfile,
): Array<{ naics: string; psc: string }> {
  const keys = new Map<string, { naics: string; psc: string }>();
  const add = (naics: string, psc = '') => {
    const n = naics.trim();
    if (!n) return;
    const k = cacheLookupKey(n, psc);
    if (!keys.has(k)) keys.set(k, { naics: n, psc: psc.trim() });
  };

  for (const t of targets) {
    if (Number(t.sat_ratio) > 0) continue;
    const naicsRaw = String(t.source_naics || '').split(',')[0].trim();
    add(naicsRaw);
    add(naicsRaw, String(t.source_psc || ''));
  }
  for (const n of profile.naicsCodes) {
    add(n);
    add(n, profile.pscCode);
  }
  return [...keys.values()];
}

async function loadCachedAgencies(
  keys: Array<{ naics: string; psc: string }>,
  profile: SatBackfillProfile,
): Promise<Map<string, SatLookupAgency[]>> {
  const cacheByKey = new Map<string, SatLookupAgency[]>();
  const supabase = getSupabase();

  for (const { naics, psc } of keys) {
    const lookupKey = cacheLookupKey(naics, psc);
    if (cacheByKey.has(lookupKey)) continue;

    try {
      let rows: Array<{ agencies?: SatLookupAgency[] }> | null = null;

      const exact = await supabase
        .from('agency_target_data_cache')
        .select('agencies, generated_at')
        .eq('naics_code', naics)
        .eq('psc_code', psc)
        .eq('business_type', profile.businessType || '')
        .eq('veteran_status', profile.veteranStatus || '')
        .order('generated_at', { ascending: false })
        .limit(2);
      rows = exact.data;

      if (!rows?.length) {
        const loose = await supabase
          .from('agency_target_data_cache')
          .select('agencies, generated_at')
          .eq('naics_code', naics)
          .eq('psc_code', psc)
          .order('generated_at', { ascending: false })
          .limit(3);
        rows = loose.data;
      }

      const merged: SatLookupAgency[] = [];
      for (const row of rows || []) {
        if (Array.isArray(row.agencies)) merged.push(...row.agencies);
      }
      if (merged.length > 0) cacheByKey.set(lookupKey, merged);
    } catch (err) {
      console.warn('[target-list] SAT cache lookup failed:', lookupKey, err);
    }
  }

  return cacheByKey;
}

async function loadLiveFindAgencies(
  profile: SatBackfillProfile,
  request: NextRequest,
): Promise<SatLookupAgency[]> {
  const primaryNaics = profile.naicsCodes[0]?.trim();
  if (!primaryNaics && !profile.pscCode.trim()) return [];

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || (request.headers.get('x-forwarded-proto') && request.headers.get('host')
      ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
      : 'https://tools.govcongiants.org');

  try {
    const res = await fetch(`${baseUrl}/api/usaspending/find-agencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        naicsCode: primaryNaics,
        pscCode: profile.pscCode,
        businessType: profile.businessType,
        veteranStatus: profile.veteranStatus,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await res.json().catch(() => null);
    if (!data?.success || !Array.isArray(data.agencies)) return [];
    return data.agencies as SatLookupAgency[];
  } catch (err) {
    console.warn('[target-list] live find-agencies SAT backfill failed:', err);
    return [];
  }
}

function resolveSatRatio(
  target: Record<string, unknown>,
  cacheByKey: Map<string, SatLookupAgency[]>,
  liveAgencies: SatLookupAgency[],
  profile: SatBackfillProfile,
): number {
  const office = String(target.office_name || '');
  const tryKeys: Array<{ naics: string; psc: string }> = [];
  const targetNaics = String(target.source_naics || '').split(',')[0].trim();
  const targetPsc = String(target.source_psc || '').trim();
  if (targetNaics) {
    tryKeys.push({ naics: targetNaics, psc: targetPsc });
    tryKeys.push({ naics: targetNaics, psc: '' });
  }
  for (const n of profile.naicsCodes) {
    tryKeys.push({ naics: n, psc: profile.pscCode });
    tryKeys.push({ naics: n, psc: '' });
  }

  for (const key of tryKeys) {
    const agencies = cacheByKey.get(cacheLookupKey(key.naics, key.psc));
    if (agencies?.length) {
      const ratio = satRatioForOffice(office, agencies);
      if (ratio > 0) return ratio;
    }
  }
  if (liveAgencies.length > 0) {
    return satRatioForOffice(office, liveAgencies);
  }
  return 0;
}

/** Backfill sat_ratio from TMR cache, profile NAICS, then live find-agencies. */
async function enrichTargetsSat(
  targets: Array<Record<string, unknown>>,
  profile: SatBackfillProfile,
  request: NextRequest,
  allowLive: boolean,
): Promise<{ targets: Array<Record<string, unknown>>; persisted: number }> {
  const needsSat = targets.some((t) => !Number(t.sat_ratio));
  if (!needsSat) return { targets, persisted: 0 };

  const cacheKeys = collectSatCacheKeys(targets, profile);
  const cacheByKey = cacheKeys.length > 0
    ? await loadCachedAgencies(cacheKeys, profile)
    : new Map<string, SatLookupAgency[]>();

  let enriched = targets.map((t) => {
    if (Number(t.sat_ratio) > 0) return t;
    const ratio = resolveSatRatio(t, cacheByKey, [], profile);
    if (ratio > 0) return { ...t, sat_ratio: ratio };
    return t;
  });

  // PRIMARY reliable source: BigQuery agency-level set-aside ratio per NAICS.
  // The old path (TMR cache + ~40s live USASpending call) left agencies at 0%
  // when they shouldn't be (e.g. VA construction is 78% set-aside, was showing
  // 0). BQ has the awards data and is cached — compute SAT = set-aside$/total$
  // for the target's agency in the target's (or profile's) NAICS. Eric 2026-06-05.
  if (enriched.some((t) => !Number(t.sat_ratio))) {
    // One BQ lookup per distinct NAICS needed (cached), then match by agency.
    const naicsNeeded = new Set<string>();
    for (const t of enriched) {
      if (Number(t.sat_ratio) > 0) continue;
      const n = String(t.source_naics || '').split(',')[0].trim() || profile.naicsCodes[0] || '';
      if (n) naicsNeeded.add(n.slice(0, 3)); // 3-digit prefix = the sector (236 = construction)
    }
    const satByNaics = new Map<string, Map<string, number>>();
    for (const n of naicsNeeded) {
      try {
        const rows = await getAgencySatForNaics(n, true); // liveBq: authed Mindy
        satByNaics.set(n, new Map(rows.map((r) => [normalizeAgencyName(r.awarding_agency), r.sat_ratio])));
      } catch (e) {
        console.warn('[target-list] BQ SAT lookup failed for', n, (e as Error)?.message);
      }
    }
    enriched = enriched.map((t) => {
      if (Number(t.sat_ratio) > 0) return t;
      const n = (String(t.source_naics || '').split(',')[0].trim() || profile.naicsCodes[0] || '').slice(0, 3);
      const ratio = satByNaics.get(n)?.get(normalizeAgencyName(String(t.agency_name || '')));
      if (ratio && ratio > 0) return { ...t, sat_ratio: ratio };
      return t;
    });
  }

  // The live USASpending find-agencies call takes ~40s — NEVER block a page
  // load on it (Eric 2026-06-05: target list took 11-14s; commit b1259f2 added
  // this live lookup on every GET). Only run it when explicitly requested
  // (?live=1, e.g. a manual/background "refresh SAT data"). Normal loads use
  // the fast cache + profile backfill above and render instantly.
  const stillNeedLive = allowLive && enriched.some(
    (t) => !Number(t.sat_ratio) && profile.naicsCodes.length > 0,
  );
  if (stillNeedLive) {
    const liveAgencies = await loadLiveFindAgencies(profile, request);
    if (liveAgencies.length > 0) {
      enriched = enriched.map((t) => {
        if (Number(t.sat_ratio) > 0) return t;
        const ratio = satRatioForOffice(String(t.office_name || ''), liveAgencies);
        if (ratio > 0) return { ...t, sat_ratio: ratio };
        return t;
      });
    }
  }

  const supabase = getSupabase();
  let persisted = 0;
  for (const t of enriched) {
    const id = t.id as string | undefined;
    const newRatio = Number(t.sat_ratio);
    const old = targets.find((row) => row.id === id);
    if (!id || !old || Number(old.sat_ratio) > 0 || !(newRatio > 0)) continue;
    const { error } = await supabase
      .from('user_target_list')
      .update({ sat_ratio: newRatio, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) persisted++;
    else console.warn('[target-list] SAT persist failed for', id, error.message);
  }

  return { targets: enriched, persisted };
}

async function loadSatBackfillProfile(email: string): Promise<SatBackfillProfile> {
  try {
    const { data } = await getSupabase()
      .from('user_notification_settings')
      .select('naics_codes, business_type')
      .eq('user_email', email.toLowerCase())
      .maybeSingle();
    const codes = (data?.naics_codes || []) as string[];
    return {
      naicsCodes: codes.map((c) => String(c).trim()).filter(Boolean),
      pscCode: '',
      businessType: String(data?.business_type || ''),
      veteranStatus: '',
    };
  } catch {
    return { naicsCodes: [], pscCode: '', businessType: '', veteranStatus: '' };
  }
}

// ---------------------------------------------------------------------
// GET — list my saved targets
// ---------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabase()
      .from('user_target_list')
      .select('*')
      .eq('user_email', email.toLowerCase())
      .order('added_at', { ascending: false });

    if (error) {
      console.error('[target-list] GET error:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to load target list', code: error.code },
        { status: 500 }
      );
    }

    const profile = await loadSatBackfillProfile(email);
    // Live SAT lookup (~40s) only on explicit ?live=1 — never on the default
    // page load, so the list renders fast.
    const allowLive = request.nextUrl.searchParams.get('live') === '1';
    const { targets, persisted } = await enrichTargetsSat(
      (data || []) as Array<Record<string, unknown>>,
      profile,
      request,
      allowLive,
    );

    return NextResponse.json({
      success: true,
      targets,
      count: targets.length,
      sat_backfill_persisted: persisted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] GET threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// POST — add an office to my target list
// ---------------------------------------------------------------------
//
// Pro-gated. Required: user_email, agency_name, office_name. Other
// fields are snapshot-from-research so the saved row survives even if
// the underlying USAspending data refreshes later.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!email) {
    return NextResponse.json({ error: 'user_email required' }, { status: 400 });
  }
  if (!body.agency_name || !body.office_name) {
    return NextResponse.json(
      { error: 'agency_name and office_name are required' },
      { status: 400 }
    );
  }

  // Tier gate. Saved-target lists are a Mindy Pro feature.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'Saved target lists are included with Mindy Pro',
        teaser: {
          note: 'Pro lets you save offices from Market Research to a persistent list you can work over months — with status tracking, notes, and (soon) an outreach activity log.',
        },
      },
      { status: 402 }
    );
  }

  // Normalize numbers — UI sometimes passes strings.
  const num = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  // CRM LINKAGE (Eric 2026-06-05): when an office is added with a DoDAAC code,
  // pull its canonical NAME + sub-agency from the dodaac_directory reference
  // table — the Fortune-1000 pattern (the code is the key; the name lives once
  // in the directory). So the CRM record always carries the official office
  // name, even if the caller only had the code. Falls back to the passed name.
  let officeName = String(body.office_name || '');
  let subAgencyName = body.sub_agency_name as string | null || null;
  const officeCode = (body.office_code ? String(body.office_code) : '').toUpperCase().trim();
  if (officeCode && /^[A-Z][A-Z0-9]{5}$/.test(officeCode)) {
    try {
      const { data: ref } = await getSupabase()
        .from('dodaac_directory')
        .select('office_name, sub_agency')
        .eq('dodaac', officeCode)
        .maybeSingle();
      if (ref?.office_name) officeName = ref.office_name;
      if (ref?.sub_agency && !subAgencyName) subAgencyName = ref.sub_agency;
    } catch { /* directory unavailable — keep the passed name */ }
  }

  const insertPayload: Record<string, unknown> = {
    user_email: email.toLowerCase(),
    workspace_id: body.workspace_id || null,

    agency_code: body.agency_code || null,
    agency_name: body.agency_name,
    sub_agency_code: body.sub_agency_code || null,
    sub_agency_name: subAgencyName,
    office_code: officeCode || body.office_code || null,
    office_name: officeName,
    location: body.location || null,

    // Provenance (roadmap Slice 5b) — remember the NAICS/PSC the user
    // was searching when this office surfaced, so My Target List can
    // show "surfaced from PSC D316". Comma-joined strings; null when the
    // search omitted that classifier.
    source_naics: typeof body.source_naics === 'string' ? body.source_naics.trim() || null : null,
    source_psc: typeof body.source_psc === 'string' ? body.source_psc.trim() || null : null,

    set_aside_spending: num(body.set_aside_spending),
    contract_count: num(body.contract_count),
    sat_ratio: num(body.sat_ratio),
    pain_point_count: num(body.pain_point_count),
    open_opp_count: num(body.open_opp_count),
    upcoming_event_count: num(body.upcoming_event_count),

    status: typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status) ? body.status : 'targeting',
    priority: typeof body.priority === 'string' && (VALID_PRIORITIES as readonly string[]).includes(body.priority) ? body.priority : 'medium',
    notes: body.notes || null,
    added_from: body.added_from || 'research_drawer',
  };

  try {
    const { data, error } = await getSupabase()
      .from('user_target_list')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // 23505 = unique violation — office already saved. Return 409
      // so the UI can surface "Already in your list" instead of red.
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, already_saved: true, error: 'Office already in your target list' },
          { status: 409 }
        );
      }
      console.error('[target-list] POST Postgres error:', {
        message: error.message, details: error.details, hint: error.hint, code: error.code,
      });
      return NextResponse.json(
        { error: error.message, details: error.details, hint: error.hint, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, target: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] POST threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// PATCH — update status / priority / notes on an existing target
// ---------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!id || !email) {
    return NextResponse.json({ error: 'id and user_email required' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status)) {
    updates.status = body.status;
  }
  if (typeof body.priority === 'string' && (VALID_PRIORITIES as readonly string[]).includes(body.priority)) {
    updates.priority = body.priority;
  }
  if ('notes' in body) {
    updates.notes = body.notes || null;
  }

  try {
    const { data, error } = await getSupabase()
      .from('user_target_list')
      .update(updates)
      .eq('id', id)
      .eq('user_email', email.toLowerCase()) // ownership check
      .select()
      .single();

    if (error) {
      console.error('[target-list] PATCH error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Target not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ success: true, target: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] PATCH threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// DELETE — remove from my target list
// ---------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!id || !email) {
    return NextResponse.json({ error: 'id and user_email required' }, { status: 400 });
  }

  try {
    // ON DELETE CASCADE on user_target_outreach.target_id handles the
    // child rows automatically — see the migration.
    const { error } = await getSupabase()
      .from('user_target_list')
      .delete()
      .eq('id', id)
      .eq('user_email', email.toLowerCase());

    if (error) {
      console.error('[target-list] DELETE error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] DELETE threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
