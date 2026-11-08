/**
 * ONE data snapshot, two surfaces: the Today's Lens CTA count (computeTodaysLens → the daily alert
 * "Explore N recommended") must EQUAL the Map API's market total (`marketTotalForFilters` from
 * GET /api/app/opportunity-map) for the lens link's params.
 *
 * Both read the same in-memory `sam_opportunities` fixture through a small PostgREST-shaped fake, so
 * this runs the REAL route handler and the REAL lens. The fixture carries the case that broke it:
 * one solicitation posted as several amendments, some with coordinates and some without.
 *
 * Joseph Boyd, 2026-10-25: rows (lens) vs listings (Map) made "Explore 24 recommended" open a Map
 * that said 20; the Map itself added distinct mapped listings to RAW unmapped rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2001-01-01T00:00:00Z';
const ALL3 = ['repeat_buyer', 'sb_friendly', 'sources_sought'];
const opp = (o: Partial<Row>): Row => ({
  notice_id: null, solicitation_number: null, naics_code: '541512', active: true, response_deadline: FUTURE,
  opportunity_dna_keys: ALL3, map_lat: 38.9, map_lng: -77.0, title: 't', ...o,
});

// The snapshot. Expected: 5 listings in the user's codes, 4 of them in the lens (all three strands).
const SAM: Row[] = [
  // L1 — ONE solicitation, THREE amendments: two have coordinates, one does not → 1 mapped listing.
  opp({ notice_id: 'n01', solicitation_number: 'W912-A' }),
  opp({ notice_id: 'n02', solicitation_number: 'W912-A' }),
  opp({ notice_id: 'n03', solicitation_number: 'w912-a ', map_lat: null, map_lng: null }), // same key, case/space
  // L2 — ONE solicitation, FOUR amendments, none locatable → 1 unmapped listing (raw rows said 4).
  ...['n04', 'n05', 'n06', 'n07'].map((id) => opp({ notice_id: id, solicitation_number: 'W912-B', naics_code: '238220', map_lat: null, map_lng: null })),
  // L3 — no solicitation number: its own notice is the listing.
  opp({ notice_id: 'n08' }),
  // L4 — in the user's codes but only one strand → a chip, not the lens.
  opp({ notice_id: 'n09', solicitation_number: 'X-1', opportunity_dna_keys: ['repeat_buyer'] }),
  // L5 — outside the user's codes → excluded everywhere.
  opp({ notice_id: 'n10', solicitation_number: 'Z-1', naics_code: '999999' }),
  // L6 — closed → excluded everywhere.
  opp({ notice_id: 'n11', solicitation_number: 'Z-2', response_deadline: PAST }),
  // L7 — one mapped notice plus an unmapped amendment → still ONE mapped listing.
  opp({ notice_id: 'n12', solicitation_number: 'W912-C' }),
  opp({ notice_id: 'n13', solicitation_number: 'W912-C', map_lat: null, map_lng: null }),
];
const PROFILES: Row[] = [{ user_email: 'jb@example.com', naics_codes: ['541512', '238'] }];

// ── a minimal PostgREST-shaped fake over the fixture. Unknown operators THROW, so a new filter the
// route or lens starts using cannot silently pass through as "matches everything".
function matchOr(row: Row, expr: string): boolean {
  return expr.split(',').some((c) => {
    const m = /^([a-z_]+)\.(eq|like)\.(.*)$/.exec(c);
    if (!m) throw new Error(`fake: unsupported or() clause ${c}`);
    const v = String(row[m[1]] ?? '');
    return m[2] === 'eq' ? v === m[3] : v.startsWith(m[3].replace(/%$/, ''));
  });
}
function from(table: string) {
  const src = table === 'sam_opportunities' ? SAM : table === 'user_notification_settings' ? PROFILES : [];
  const preds: Array<(r: Row) => boolean> = [];
  let withCount = false, head = false, lo = 0, hi = Infinity;
  const q = {
    select: (_c: string, o?: { count?: string; head?: boolean }) => { withCount = !!o?.count; head = !!o?.head; return q; },
    eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return q; },
    gt: (c: string, v: string) => { preds.push((r) => String(r[c] ?? '') > v); return q; },
    gte: (c: string, v: number) => { preds.push((r) => r[c] != null && (r[c] as number) >= v); return q; },
    lte: (c: string, v: number) => { preds.push((r) => r[c] != null && (r[c] as number) <= v); return q; },
    is: (c: string, v: null) => { preds.push((r) => (r[c] ?? null) === v); return q; },
    not: (c: string, op: string, v: null) => { if (op !== 'is' || v !== null) throw new Error(`fake: not(${op})`); preds.push((r) => r[c] != null); return q; },
    or: (e: string) => { preds.push((r) => matchOr(r, e)); return q; },
    contains: (c: string, arr: string[]) => { preds.push((r) => Array.isArray(r[c]) && arr.every((k) => (r[c] as string[]).includes(k))); return q; },
    order: () => q,
    limit: (n: number) => { hi = Math.min(hi, n - 1); return q; },
    range: (a: number, b: number) => { lo = a; hi = b; return q; },
    maybeSingle: async () => ({ data: src.filter((r) => preds.every((p) => p(r)))[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      try {
        const all = src.filter((r) => preds.every((p) => p(r)))
          .sort((a, b) => String(a.notice_id).localeCompare(String(b.notice_id)));
        return Promise.resolve({ data: head ? null : all.slice(lo, hi + 1), count: withCount ? all.length : null, error: null }).then(res, rej);
      } catch (e) { return Promise.reject(e).then(res, rej); }
    },
  };
  return new Proxy(q, { get: (t, k) => { if (k in t) return t[k as keyof typeof t]; throw new Error(`fake: unsupported operator ${String(k)}`); } });
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));
vi.mock('@/lib/gov-contacts/dodaac-directory', () => ({ loadDodaacEarlySignal: async () => new Map() }));
vi.mock('@/lib/opportunities/early-signal-pins', () => ({
  decorateWithEarlySignal: async (x: unknown[]) => x, filterByEarlySignal: (x: unknown[]) => x, dodaacFromSolicitation: () => null,
}));
vi.mock('@/lib/opportunities/repeat-buyer', () => ({ isRepeatBuyer: () => false }));

const { computeTodaysLens } = await import('./todays-lens');
const { todaysLensMapPath } = await import('./todays-lens-link');
const { GET } = await import('@/app/api/app/opportunity-map/route');

beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://t.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

async function mapApi(path: string) {
  const u = new URL(path, 'https://getmindy.ai');
  u.searchParams.set('bbox', '-180,-90,180,90');
  const res = await GET(new NextRequest(u.toString()));
  return res.json();
}

describe('one snapshot: lens CTA count === Map API market total', () => {
  it('the email CTA count equals the Map API market total for the lens link', async () => {
    const lens = await computeTodaysLens('jb@example.com');
    expect(lens.lensStrategy).toBe('repeat_buyer,sb_friendly,sources_sought');
    const api = await mapApi(todaysLensMapPath(lens, { src: 'alert', sentOn: '2026-10-21' }));
    expect(api.success).toBe(true);
    expect(lens.lensCount).toBe(api.marketTotalForFilters);
    expect(lens.lensCount).toBe(4);                      // L1, L2, L3, L7 — not the 10 raw rows
  });

  it('the Map total includes listings without coordinates, one per listing', async () => {
    const lens = await computeTodaysLens('jb@example.com');
    const api = await mapApi(todaysLensMapPath(lens, { src: 'alert' }));
    expect(api.totalForFilters).toBe(3);                 // L1, L3, L7 have a pin
    expect(api.unmappedForFilters).toBe(1);              // L2 — 4 amendments, one listing (raw rows said 6)
    expect(api.totalForFilters + api.unmappedForFilters).toBe(api.marketTotalForFilters);
    expect(api.pins.length).toBe(3);                     // the pins agree with the mapped count
  });

  it('headline and strategy chips count the same unit (listings), never summed', async () => {
    const lens = await computeTodaysLens('jb@example.com');
    expect(lens.totalOpen).toBe(5);                      // L1, L2, L3, L4, L7 (11 raw rows → 5 listings)
    const by = Object.fromEntries(lens.strands.map((s) => [s.key, s.count]));
    expect(by).toEqual({ repeat_buyer: 5, sb_friendly: 4, sources_sought: 4 });
    // Overlapping chips sum past the headline — which is exactly why no surface may add them.
    expect(lens.strands.reduce((a, s) => a + s.count, 0)).toBeGreaterThan(lens.totalOpen);
  });
});
