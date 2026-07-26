/**
 * GET /api/app/contacts-map — pins for the Opportunity Map "Contacts" mode.
 *
 * TWO sub-datasets (?type=companies|buyers, default companies):
 *  • companies — award-winning federal contractors from BigQuery (searchRecipients).
 *    Each firm has a HQ city/state; we place it at the STATE CENTROID + a small
 *    deterministic jitter so many firms in one state don't stack into a single dot.
 *  • buyers — government decision-makers (contracting officers / POCs) from
 *    federal_contacts. That table carries NO location, so we JOIN it to
 *    sam_opportunities by solicitation_number to recover the place-of-performance
 *    (or buying-office) state, then place by state centroid + jitter.
 *
 * Both: MI-token authed (same as opportunity-map), capped at MAX_PINS, filtered to
 * the viewport bbox AFTER geocoding, and — critically — a pin is placed ONLY when we
 * have a REAL 2-letter state. Rows with no location are skipped, never fabricated.
 *
 * Response mirrors the other map endpoints: { success, pins, totalForFilters }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { STATE_CENTROIDS, jitter } from '@/lib/geo/state-centroids';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { searchRecipients } from '@/lib/bigquery/recipients';

export const dynamic = 'force-dynamic';

const MAX_PINS = 400; // sensible cap (task spec) — keeps the map readable + BQ/DB cheap.

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function money(n: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}

// A pin is inside the viewport bbox. (west,south,east,north)
function inBbox(lat: number, lng: number, b: [number, number, number, number]) {
  return lat >= b[1] && lat <= b[3] && lng >= b[0] && lng <= b[2];
}

// Deterministic per-state jitter counter so repeated firms/buyers in the same state
// fan out around the centroid instead of stacking on one point.
function placeByState(state: string, seenPerState: Map<string, number>): [number, number] | null {
  const base = STATE_CENTROIDS[state];
  if (!base) return null;
  const seed = seenPerState.get(state) || 0;
  seenPerState.set(state, seed + 1);
  return jitter(base, seed);
}

// ── Companies: award-winning contractors (BigQuery) ─────────────────────────
async function companiesPins(params: {
  bbox: [number, number, number, number];
  state: string;
  search: string;
}) {
  // searchRecipients returns firms with city/state + contract totals. Pull a generous
  // page (it caps internally at 100), sorted by obligated $ (the biggest players first).
  // We over-fetch a little to survive the bbox filter, then cap at MAX_PINS.
  const { rows, total } = await searchRecipients({
    search: params.search || undefined,
    state: params.state || undefined,
    sortBy: 'total_obligated',
    limit: 100,
    liveBq: true, // authed in-app request — must hit live BQ, else 0 on a cold cache.
  });

  const seenPerState = new Map<string, number>();
  const pins: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const state = normalizeStateCode(r.state || '') || '';
    if (!/^[A-Z]{2}$/.test(state)) continue; // real state only — never fabricate a location
    const at = placeByState(state, seenPerState);
    if (!at) continue;
    if (!inBbox(at[0], at[1], params.bbox)) continue;
    const parts: string[] = [];
    if (r.award_count) parts.push(`${r.award_count.toLocaleString()} award${r.award_count === 1 ? '' : 's'}`);
    if (r.total_obligated) parts.push(money(r.total_obligated) + ' won');
    if (r.distinct_agency_count) parts.push(`${r.distinct_agency_count} agenc${r.distinct_agency_count === 1 ? 'y' : 'ies'}`);
    pins.push({
      id: r.recipient_uei || r.recipient_name,
      lat: at[0], lng: at[1],
      name: r.recipient_name,
      state,
      city: (r.city || '').trim(),
      meta: parts.join(' · '),
    });
    if (pins.length >= MAX_PINS) break;
  }
  return { pins, totalForFilters: total || pins.length };
}

// ── Buyers: government decision-makers (federal_contacts ⋈ sam_opportunities) ──
async function buyersPins(params: {
  bbox: [number, number, number, number];
  state: string;
  search: string;
}) {
  const db = sb();
  // federal_contacts has NO state column, so recover location from the notice the POC
  // is named on: join by solicitation_number → sam_opportunities (pop_state, then the
  // buying-office state as a fallback — both are ~2-letter uppercase). We over-fetch
  // because many rows dedupe (same person on many notices) and many drop for no state.
  let q = db
    .from('federal_contacts')
    .select('id, contact_fullname, contact_title, department_ind_agency, office, sub_tier, solicitation_number', { count: 'exact' })
    .not('contact_fullname', 'is', null)
    .not('solicitation_number', 'is', null)
    .limit(4000);
  if (params.search) q = q.ilike('contact_fullname', `%${params.search}%`);

  const { data, count, error } = await q;
  if (error) throw error;

  // Resolve each POC's notice → state. Batch the sol-number lookups.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data || []) as Record<string, any>[];
  const solNums = Array.from(
    new Set(rows.map((r) => String(r.solicitation_number || '')).filter(Boolean)),
  ).slice(0, 2000);

  // Map solicitation_number → state (pop_state OR office_address->>state).
  const solState = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < solNums.length; i += CHUNK) {
    const chunk = solNums.slice(i, i + CHUNK);
    const { data: opps, error: oErr } = await db
      .from('sam_opportunities')
      .select('solicitation_number, pop_state, office_address')
      .in('solicitation_number', chunk);
    if (oErr) throw oErr;
    for (const o of (opps || []) as Array<{ solicitation_number: string; pop_state: string | null; office_address: { state?: string } | null }>) {
      if (solState.has(o.solicitation_number)) continue;
      const st = normalizeStateCode((o.pop_state as string | null) || o.office_address?.state || '') || '';
      if (/^[A-Z]{2}$/.test(st)) solState.set(o.solicitation_number, st);
    }
  }

  const seenPerState = new Map<string, number>();
  const seenPeople = new Set<string>();
  const pins: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    // Filter by requested state (post-geocode) — buyers state is derived from the notice.
    const state = solState.get(String(r.solicitation_number || ''));
    if (!state) continue; // no real location → no pin (never fabricate)
    if (params.state && state !== params.state) continue;
    // Dedupe the same person (they appear on many notices).
    const key = `${(r.contact_fullname || '').toLowerCase()}|${(r.department_ind_agency || '').toLowerCase()}`;
    if (seenPeople.has(key)) continue;
    seenPeople.add(key);
    const at = placeByState(state, seenPerState);
    if (!at) continue;
    if (!inBbox(at[0], at[1], params.bbox)) continue;
    pins.push({
      id: String(r.id),
      lat: at[0], lng: at[1],
      name: r.contact_fullname,
      title: r.contact_title || '',
      agency: r.department_ind_agency || '',
      office: r.sub_tier || r.office || '',
      state,
    });
    if (pins.length >= MAX_PINS) break;
  }
  return { pins, totalForFilters: count ?? pins.length };
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const email = (p.get('email') || '').trim().toLowerCase();

  const auth = requireMIAuthSession(request, email || null);
  if (!auth.ok) return auth.response;

  const bboxRaw = p.get('bbox');
  if (!bboxRaw) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const bbox = parts as [number, number, number, number];

  const type = (p.get('type') || 'companies').toLowerCase() === 'buyers' ? 'buyers' : 'companies';
  const state = normalizeStateCode(p.get('state') || '') || '';
  const search = (p.get('search') || p.get('q') || '').trim();

  try {
    const out = type === 'buyers'
      ? await buyersPins({ bbox, state, search })
      : await companiesPins({ bbox, state, search });
    return NextResponse.json({ success: true, mode: 'contacts', type, ...out });
  } catch (e) {
    console.error('[contacts-map] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
