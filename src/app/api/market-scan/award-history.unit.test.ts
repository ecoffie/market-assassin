/**
 * /api/market-scan must never return funded NIH RePORTER projects as SBIR/open opportunities.
 * Behavioural: the REAL GET handler runs; Supabase is an in-memory table, external HTTP is stubbed empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const future = new Date(Date.now() + 200 * 86_400_000).toISOString();
const ROWS: Row[] = [
  { id: 'nih-1', external_id: 'nih-1', source: 'nih_reporter', opportunity_type: 'grant', status: 'active', posted_date: '2026-09-20', close_date: future,
    title: 'FUNDED-NIH Pilot Projects Core', source_url: 'https://reporter.nih.gov/project-details/1', agency: 'NIH' },
  { id: 'nsf-1', external_id: 'nsf-1', source: 'nsf_sbir', opportunity_type: 'sbir_sttr', status: 'active', posted_date: '2026-09-19', close_date: future,
    title: 'OPEN-NSF SBIR Phase I Solicitation', source_url: 'https://seedfund.nsf.gov/x', agency: 'NSF' },
];
function from(table: string) {
  let rows = table === 'aggregated_opportunities' ? [...ROWS] : [];
  let lim = Infinity;
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; };
  b.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; };
  b.limit = (n: number) => { lim = n; return b; };
  for (const m of ['order', 'or', 'ilike', 'gte', 'lte', 'not', 'neq', 'is', 'range', 'filter', 'contains', 'overlaps']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  b.single = async () => ({ data: rows[0] ?? null, error: null });
  b.then = (res: (v: unknown) => void) => res({ data: rows.slice(0, lim), error: null, count: rows.length });
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from, rpc: async () => ({ data: [], error: null }) }) }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [], data: [], opportunities: [] }), { status: 200 })));
});

describe('/api/market-scan — funded NIH projects never appear as SBIR opportunities', () => {
  it('returns the NSF solicitation and not the funded NIH project', async () => {
    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/market-scan?naics=541512&includeGrants=false'));
    const body = await res.json();
    const titles = (body.sbirOpportunities ?? []).map((o: { title: string }) => o.title);
    expect(titles).toContain('OPEN-NSF SBIR Phase I Solicitation');
    expect(titles.join(' ')).not.toContain('FUNDED-NIH');
    expect(JSON.stringify(body.rankedOpportunities ?? [])).not.toContain('FUNDED-NIH');
  });
});
