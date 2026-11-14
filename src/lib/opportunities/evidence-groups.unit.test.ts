import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { labelOpenRow } from './find-opportunities';
import { interpretMarket } from './market-interpretation';
import {
  evidenceGroupOf, evidenceGroupsEnabled, evidenceCapability, groupOpenRows, openEvidenceTotals, EVIDENCE_TOTALS_MAX,
} from './evidence-groups';

/**
 * C2 (Agent 3, 2026-11-14): direct / related-market / other groups from Agent 1's released labelOpenRow, counted over
 * the full matched set so that direct + related + other === total. Rows below follow the shapes in
 * find-preset-evidence.unit.test.ts (Agent 1's P1-D tests).
 */
const plan = buildDiscoveryPlan({ query: 'janitorial services' }, MCP_POLICY);
const cap = evidenceCapability(plan);
const row = (o: Record<string, unknown>) => ({ notice_id: String(Math.random()), title: '', description: '', department: '', sub_tier: '', solicitation_number: '', naics_code: '', psc_code: '', response_deadline: null, ...o });
const ROWS = [
  row({ title: 'Recurring Janitorial Services, Key West', naics_code: '561720' }),       // direct (code)
  row({ title: 'Base operations support', description: 'Includes janitorial services for 12 buildings', naics_code: '561210' }), // direct (text)
  row({ title: 'Bombing Range Operation', naics_code: '561210' }),                         // related (family code only)
  row({ title: 'Grounds maintenance', naics_code: '561730' }),                             // related
  row({ title: 'Aircraft test stand', naics_code: '334515' }),                             // other
];

describe('the mapping (the only one)', () => {
  it('DIRECT → direct, RELATED → related, everything else → other', () => {
    expect(evidenceGroupOf('DIRECT_MATCH')).toBe('direct');
    expect(evidenceGroupOf('RELATED_MARKET_CANDIDATE')).toBe('related');
    expect(evidenceGroupOf('WEAK_NON_MARKET')).toBe('other');
  });
  it('a related-market notice is never direct', () => {
    const { groups } = groupOpenRows([ROWS[2], ROWS[3]], plan, cap);
    expect(groups).toEqual(['related', 'related']);
  });
});

describe('one classifier: groups equal labelOpenRow for the same rows', () => {
  it('every row gets the group of its labelOpenRow class', () => {
    const { groups, counts } = groupOpenRows(ROWS, plan, cap);
    expect(groups).toEqual(ROWS.map((r) => evidenceGroupOf(labelOpenRow(r, plan, cap).cls)));
    expect(counts).toEqual({ direct: 2, related: 2, other: 1 });
  });
  it('capability is derived the way find_opportunities derives it (keyword residual + buyer)', () => {
    expect(evidenceCapability(plan)).toEqual(interpretMarket('janitorial services', null).capability);
  });
});

describe('release control', () => {
  it('only the literal "true" enables it', () => {
    expect(evidenceGroupsEnabled('true')).toBe(true);
    for (const v of [undefined, '', '1', 'on', 'TRUE', 'yes']) expect(evidenceGroupsEnabled(v)).toBe(false);
  });
  it('no surface is wired yet: the Map API does not import this module (slice 1 is library-only)', () => {
    // Measured 2026-11-14: full-set totals take 1.5-15 s per search on the Map plan; the Map request path must not
    // carry that. Wiring needs a cached / precomputed design first (plan section 4).
    const src = readFileSync(join(process.cwd(), 'src/app/api/app/opportunity-map/route.ts'), 'utf8');
    expect(src).not.toContain('evidence-groups');
  });
});

type Fake = { rows: Array<Record<string, unknown>>; count: number | null; countError?: string; readError?: string };
function fake(f: Fake) {
  const page = () => {
    const q = {
      order: () => q,
      range: (from: number, to: number) => Promise.resolve(f.readError
        ? { data: null, error: { message: f.readError } }
        : { data: f.rows.slice(from, to + 1), error: null }),
    };
    return q;
  };
  return {
    count: () => Promise.resolve({ count: f.count, error: f.countError ? { message: f.countError } : null }),
    page,
  };
}

describe('openEvidenceTotals: the invariant and honest failure', () => {
  it('direct + related + other === total', async () => {
    const r = await openEvidenceTotals({ ...fake({ rows: ROWS, count: ROWS.length }), plan, cap });
    expect(r.complete).toBe(true);
    if (r.complete) expect(r.direct + r.related + r.other).toBe(r.total);
  });
  it('pages past 1,000 rows', async () => {
    const many = Array.from({ length: 2345 }, (_, i) => ROWS[i % ROWS.length]);
    const r = await openEvidenceTotals({ ...fake({ rows: many, count: many.length }), plan, cap });
    expect(r.complete && r.total).toBe(2345);
  });
  it('above the cap: groups are null with a reason, never 0 and never a sample', async () => {
    const r = await openEvidenceTotals({ ...fake({ rows: [], count: EVIDENCE_TOTALS_MAX + 1 }), plan, cap });
    expect(r).toMatchObject({ complete: false, total: EVIDENCE_TOTALS_MAX + 1, direct: null, related: null, other: null });
  });
  it('a failed count is unknown (null), not zero', async () => {
    const r = await openEvidenceTotals({ ...fake({ rows: ROWS, count: null, countError: 'timeout' }), plan, cap });
    expect(r).toMatchObject({ complete: false, total: null, direct: null });
  });
  it('rows that do not reconcile with the count return complete:false, never a mismatched sum', async () => {
    const r = await openEvidenceTotals({ ...fake({ rows: ROWS.slice(0, 3), count: 5 }), plan, cap });
    expect(r).toMatchObject({ complete: false, direct: null });
  });
  it('a failed read is reported, not counted', async () => {
    const r = await openEvidenceTotals({ ...fake({ rows: ROWS, count: 5, readError: 'statement timeout' }), plan, cap });
    expect(r).toMatchObject({ complete: false, total: 5, direct: null });
  });
});
