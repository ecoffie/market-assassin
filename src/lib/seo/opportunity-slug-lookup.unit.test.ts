/**
 * getOpportunityBySlug must be INDEX-ASSISTED.
 *
 * The original lookup was `notice_id ILIKE '%<tail>'` alone — a leading-wildcard
 * ILIKE that cannot use the notice_id btree, so every public /opportunity/<slug>
 * render seq-scanned sam_opportunities (prod pg_stat_statements: 337,765 calls,
 * mean 461 ms, 14.0% of all DB time). The fix adds a `title ILIKE '%w1%w2%…%'`
 * predicate built from the slug words so the title trigram index can serve it,
 * and falls back to the ORIGINAL query when that finds no exact match, so the set
 * of slugs that resolve is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { filters: Array<[string, string, string]>; limit: number | null };
const calls: Call[] = [];
let responder: (c: Call) => Array<Record<string, unknown>> = () => [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const call: Call = { filters: [], limit: null };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.ilike = (col: string, pat: string) => {
        call.filters.push(['ilike', col, pat]);
        return b;
      };
      b.limit = (n: number) => {
        call.limit = n;
        calls.push(call);
        return Promise.resolve({ data: responder(call), error: null });
      };
      return b;
    },
  }),
}));

import { getOpportunityBySlug, opportunitySlug, slugTitlePattern } from './opportunities';

/** Postgres ILIKE (default escape '\\', none used here) → JS regex. */
function ilikeToRegex(pattern: string): RegExp {
  const src = pattern
    .split('')
    .map((ch) => (ch === '%' ? '[\\s\\S]*' : ch === '_' ? '[\\s\\S]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${src}$`, 'i');
}

const BODY = 'x'.repeat(400);
function row(title: string | null, notice_id: string) {
  return { title, notice_id, description: BODY, sow_text: null, active: true };
}
/** Simulate the DB: apply each recorded ILIKE filter to an in-memory corpus. */
function dbOver(corpus: Array<Record<string, unknown>>) {
  return (c: Call) =>
    corpus
      .filter((r) =>
        c.filters.every(([, col, pat]) => {
          const v = r[col];
          return typeof v === 'string' && ilikeToRegex(pat).test(v);
        }),
      )
      .slice(0, c.limit ?? 1000);
}

const TITLES = [
  'Janitorial Services',
  'J--Repair of HVAC System, Bldg 1234 & 1235',
  'R&D: Advanced Materials (Phase II)',
  '  --Leading and trailing symbols!!  ',
  'Café Renovation — Main Building',
  'Fuel, JP-8, 50,000 Gallons; Delivery to Ft. Hood, TX',
  'Z1DA--621-21-102 | Replace Roof at Building 2 (VA-26-00012345)',
  '100% Small Business Set-Aside: IT Support Services for the Department of Veterans Affairs Office of Information and Technology',
  'A'.repeat(120),
  'Notice of Intent to Sole Source - Brand Name Only - Thermo Fisher Scientific Orbitrap Exploris 480 Mass Spectrometer Service Agreement',
  '6515--Medical Supplies / Surgical Instruments',
  'Ground Maintenance @ Naval Station Norfolk',
  'C-130J Spare Parts',
  'U.S. Army Corps of Engineers - Dredging, Lower Mississippi River',
  "Contractor's Facility Security #2",
  'ÉTUDE préliminaire – naïve façade',
  'Electrical Upgrades (Phase 1/3) — Building #401, 402, 403 and 404 at Joint Base Lewis-McChord, Washington State',
  '2026 Annual Elevator Maintenance',
  'SOURCES SOUGHT: Cloud Hosting',
  'Pest Control_Services',
  'Snow removal 50%-off?',
  'X',
  'Body Armor (Level IV) – Plates & Carriers – 10,000 ea',
  '  ',
  '***',
  'TELECOMMUNICATIONS INFRASTRUCTURE MODERNIZATION PROGRAM SUPPORT SERVICES INCLUDING NETWORK ENGINEERING ADVISORY',
  'Weapon System Support – F-35 Lightning II',
  'Lab Equipment: µ-Pipettes',
  'Trash & Recycling',
  'Fire alarm testing/inspection (annual) — VAMC',
];

describe('getOpportunityBySlug — index-assisted lookup', () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });

  it('applies a title ILIKE predicate built from the slug words before any fallback', async () => {
    const r = row('J--Repair of HVAC System, Bldg 1234', 'ab12cd34ef56ab12cd34ef56deadbeef');
    responder = dbOver([r]);
    const slug = opportunitySlug(r.title, r.notice_id);
    const opp = await getOpportunityBySlug(slug);
    expect(opp?.noticeId).toBe(r.notice_id);
    expect(calls).toHaveLength(1); // resolved by the assisted query — no fallback
    expect(calls[0].filters).toContainEqual(['ilike', 'title', '%j%repair%of%hvac%system%bldg%1234%']);
    expect(calls[0].filters).toContainEqual(['ilike', 'notice_id', '%deadbeef']);
  });

  it('falls back to the ORIGINAL notice_id-only query when the assisted query has no exact match', async () => {
    const r = row(null, '00000000000000000000000012345678'); // placeholder base 'opportunity'
    responder = dbOver([r]);
    const slug = opportunitySlug(r.title, r.notice_id);
    // placeholder base: assisted query skipped, original query used
    expect(slugTitlePattern(slug)).toBeNull();
    await getOpportunityBySlug(slug);
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toEqual([['ilike', 'notice_id', '%12345678']]);
  });

  it('a nonexistent slug runs assisted THEN original (documented residual cost)', async () => {
    responder = () => [];
    expect(await getOpportunityBySlug('no-such-thing-ffffffff')).toBeNull();
    expect(calls.map((c) => c.filters.length)).toEqual([2, 1]);
    expect(calls[1].filters).toEqual([['ilike', 'notice_id', '%ffffffff']]);
  });

  it.each(TITLES.map((t, i) => [t, i] as const))('title pattern matches its own title and round-trips: %j', async (title, i) => {
    const noticeId = `${i.toString(16).padStart(4, '0')}aaaabbbbccccdddd${(0xa0000000 + i).toString(16)}`;
    const slug = opportunitySlug(title, noticeId);
    const pat = slugTitlePattern(slug);
    if (pat !== null) expect(ilikeToRegex(pat).test(title)).toBe(true);

    // Round trip: whether or not the title is indexable/assisted, the row resolves
    // exactly as the original code would (title length >= 8 required).
    const r = row(title, noticeId);
    responder = dbOver([r, row('Decoy row with the same tail', 'ffff' + noticeId.slice(4))]);
    const opp = await getOpportunityBySlug(slug);
    if (title.trim().length >= 8) expect(opp?.noticeId).toBe(noticeId);
    else expect(opp).toBeNull();
  });
});
