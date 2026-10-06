/**
 * Competition Health grounding contract (buyer-side mirror).
 *
 * The lib must be HONEST: a failed primary read surfaces the error (never a fake empty market);
 * set-aside % is computed from EXACT head-counts over the WHOLE set (never a sampled ratio — the
 * 1000-row-cap trap); supplier-base breadth comes from the population RPC, never a capped pull;
 * the awarded mix matches the CANONICAL agency name exactly; and the page never writes business data.
 *
 * Regression fixtures are RECORDED from production on 2026-10-06 (read-only), see
 * __fixtures__/competition-health-2026-10-06.json. The 2026-10-06 defect: the DoD card showed 712
 * distinct winners (a 1,000-row slice) against a real 4,763 across 17,742 notices, and an empty
 * awarded mix because ILIKE '%DEPT OF DEFENSE%' matched 0 of 24,617 "Department of Defense" rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from './__fixtures__/competition-health-2026-10-06.json';

/**
 * FLAKE FIX (2026-08-16): computeCompetitionHealth → computeCompetitionDepth issues live fetches to
 * api.usaspending.gov. Stub fetch to a deterministic empty result; depth has its own suite.
 */
import {
  computeCompetitionHealth, buildCompetitionPriorities, AWARDED_SETASIDE_LABELS, MIN_FIRST_TIME_LOOKBACK_DAYS,
} from './competition-health';

const realFetch = globalThis.fetch;
const realUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const realKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
  // No Supabase in unit → the external cache degrades to a straight fetcher call (no cache write).
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = realUrl;
  if (realKey) process.env.SUPABASE_SERVICE_ROLE_KEY = realKey;
});

const NOW = Date.parse(fixture.until);
type Res = { count?: number | null; data?: unknown; error?: { message: string } | null };
type Call = { table: string; ops: { op: string; args: unknown[] }[] };

/**
 * Filter-aware Supabase stub. Every builder call is RECORDED (so tests can assert what was queried
 * and that nothing was written); `resolve(call)` decides each query's result from its filters.
 */
function makeClient(opts: {
  resolve: (call: Call) => Res;
  rpc?: (fn: string, args: Record<string, unknown>) => Res;
}) {
  const calls: Call[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const handler = {
      get(_t: unknown, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => {
            const r = opts.resolve(call);
            resolve({ count: r.count ?? null, data: r.data ?? null, error: r.error ?? null });
          };
        }
        return (...args: unknown[]) => { call.ops.push({ op: prop, args }); return proxy; };
      },
    };
    const proxy: unknown = new Proxy(chain, handler as ProxyHandler<Record<string, unknown>>);
    return proxy;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    const r = opts.rpc ? opts.rpc(fn, args) : { error: { message: `function ${fn} does not exist` } };
    return { data: r.data ?? null, error: r.error ?? null };
  };
  return { client: { from, rpc } as unknown as Parameters<typeof computeCompetitionHealth>[0], calls, rpcCalls };
}

const eqOf = (call: Call, col: string) => call.ops.find((o) => o.op === 'eq' && o.args[0] === col)?.args[1];

/** Resolver backed by the recorded fixture. */
function fixtureResolver(agency: string, active = 1000, withSA = 400) {
  return (call: Call): Res => {
    if (call.table === 'sam_opportunities') {
      const isHead = call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head);
      if (isHead) return { count: call.ops.some((o) => o.op === 'neq' && o.args[1] === 'NONE') ? withSA : active };
      return { data: [{ set_aside_code: 'SBA', naics_code: '236220' }] };
    }
    if (call.table === 'recompete_opportunities') {
      const ag = eqOf(call, 'awarding_agency') ?? eqOf(call, 'awarding_sub_agency');
      const col = eqOf(call, 'awarding_agency') != null ? 'awarding_agency' : 'awarding_sub_agency';
      const mix = (fixture.awardedMix as Record<string, Record<string, number>>)[`${col}=${ag}`] ?? {};
      const label = eqOf(call, 'set_aside_enriched') as string | undefined;
      if (label) return { count: mix[label] ?? 0 };
      return { count: Object.values(mix).reduce((a, b) => a + b, 0) };
    }
    return { error: { message: `unexpected table ${call.table} for ${agency}` } };
  };
}
const fixtureRpc = (fn: string, args: Record<string, unknown>): Res => {
  if (fn !== 'competition_health_winners') return { error: { message: 'unknown fn' } };
  const row = (fixture.winners as Record<string, unknown>)[args.p_department as string];
  return row ? { data: [row] } : { data: [{ awards: 0, distinct_winners: 0, awards_with_amount: 0, total_dollars: 0, top3_dollars: 0, first_time_winners: 0, lookback_start: null, top_winners: [] }] };
};

describe('competition-health grounding contract', () => {
  it('surfaces a primary-read failure as an error (never a fake empty market)', async () => {
    const { client } = makeClient({ resolve: () => ({ count: null, error: { message: 'db down' } }) });
    const h = await computeCompetitionHealth(client, 'TEST AGENCY', 90, NOW);
    expect(h.error).toContain('db down');
    expect(h.grounded).toBe(false);
  });

  it('computes set-aside % from EXACT head-counts (DoD screenshot: 8,667 of 22,906 = 37.8%)', async () => {
    const { client } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE', 22906, 8667), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    expect(h.smallBizParticipation).toEqual({ activeOpps: 22906, withSetAside: 8667, pct: 37.8 });
  });

  it('a failed set-aside count is UNKNOWN (pct null), never 0%', async () => {
    const { client } = makeClient({
      resolve: (c) => (c.ops.some((o) => o.op === 'neq' && o.args[1] === 'NONE') ? { count: null, error: { message: 'timeout' } } : { count: 500, data: [] }),
      rpc: fixtureRpc,
    });
    const h = await computeCompetitionHealth(client, 'X', 90, NOW);
    expect(h.smallBizParticipation.pct).toBeNull();
  });

  it('discloses that the open-notice mix is a sample when the active set exceeds the pull', async () => {
    const { client } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE', 22906, 8667), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    expect(h.openNoticeSample).toEqual({ rows: 1, of: 22906, complete: false });
  });

  it('never fabricates the deferred metrics — they stay null + disclosed', async () => {
    const { client } = makeClient({ resolve: fixtureResolver('X'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'X', 90, NOW);
    expect(h.supplierReach).toBeNull();
    expect(h.competitionDepth.avgBidders).toBeNull();
    expect(h.competitionDepth.grounded).toBe(false);
    expect(h.notYetMeasurable.length).toBe(1);
  });
});

describe('supplier-base breadth — population RPC, not a capped pull (2026-10-06 regression)', () => {
  it('DEFENSE reproduces 4,763 distinct winners across 17,742 notices (was 712 from a 1,000-row slice)', async () => {
    const { client, rpcCalls, calls } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    expect(h.winners.complete).toBe(true);
    expect(h.winners.distinctWinners).toBe(4763);
    expect(h.winners.awardsWithAwardee).toBe(17742);
    expect(h.winners.distinctWinners).not.toBe(712);
    // concentration over the WHOLE population: 85.81B / 250.32B
    expect(h.winners.concentrationPct).toBe(34.3);
    expect(h.winners.topWinners[0].name).toBe('RAYTHEON COMPANY');
    // the window passed to the RPC is exactly the stated window
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_department: 'DEPT OF DEFENSE', p_until: new Date(NOW).toISOString() });
    expect(Date.parse(rpcCalls[0].args.p_until as string) - Date.parse(rpcCalls[0].args.p_since as string)).toBe(90 * 86400_000);
    // no award-notice row pull at all — the capped path is gone
    expect(calls.some((c) => c.ops.some((o) => o.op === 'eq' && o.args[0] === 'notice_type'))).toBe(false);
  });

  it('first-time winners are population-level but flagged insufficient history (record starts 2026-03-16)', async () => {
    const { client } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    expect(h.winners.firstTimeVendors).toBe(2764); // not the old "10 of the top 15"
    expect(h.winners.firstTime.lookbackStart).toBe('2026-03-16T00:00:00+00:00');
    expect(h.winners.firstTime.lookbackDays).toBeLessThan(MIN_FIRST_TIME_LOOKBACK_DAYS);
    expect(h.winners.firstTime.historySufficient).toBe(false);
    // ...so no "supplier base is broadening" claim may fire on it
    expect(buildCompetitionPriorities(h).some((p) => /broadening/i.test(p.title))).toBe(false);
  });

  it.each([
    ['INTERIOR, DEPARTMENT OF THE', 1526, 2299, 13.5],   // medium buyer, also over the 1,000 cap
    ['ENVIRONMENTAL PROTECTION AGENCY', 55, 68, 78.1],   // small buyer
  ])('%s: population figures from the recorded aggregate', async (agency, distinct, awards, conc) => {
    const { client } = makeClient({ resolve: fixtureResolver(agency), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, agency, 90, NOW);
    expect(h.winners.distinctWinners).toBe(distinct);
    expect(h.winners.awardsWithAwardee).toBe(awards);
    expect(h.winners.concentrationPct).toBe(conc);
  });

  it('RPC unavailable (migration not applied) → unknown, never zero, and no fallback row pull', async () => {
    const { client, calls } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE') }); // no rpc → "does not exist"
    const h = await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    expect(h.winners.complete).toBe(false);
    expect(h.winners.distinctWinners).toBeNull();
    expect(h.winners.firstTimeVendors).toBeNull();
    expect(h.winners.concentrationPct).toBeNull();
    expect(h.winners.error).toContain('does not exist');
    expect(calls.some((c) => c.ops.some((o) => o.op === 'eq' && o.args[0] === 'notice_type'))).toBe(false);
    expect(buildCompetitionPriorities(h).some((p) => /supplier/i.test(p.title))).toBe(false);
  });

  it('concentration watch still fires on a complete population (threshold rules preserved)', async () => {
    const { client } = makeClient({ resolve: fixtureResolver('ENVIRONMENTAL PROTECTION AGENCY'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'ENVIRONMENTAL PROTECTION AGENCY', 90, NOW);
    const pr = buildCompetitionPriorities(h);
    expect(pr.some((p) => p.title === 'Awards are concentrated in a few suppliers' && p.body.includes('78.1%'))).toBe(true);
  });
});

describe('awarded set-aside mix — canonical identity, exact head-counts', () => {
  it('DEPT OF DEFENSE (the "DEPT OF X" form) finds all 24,617 enriched rows (keyword match found 0)', async () => {
    const { client, calls } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    expect(fixture.keywordMatchBefore["awarding_agency ILIKE '%DEPT OF DEFENSE%'"]).toBe(0);
    expect(h.awardedSetAside.identity).toEqual({ name: 'Department of Defense', tier: 'toptier' });
    expect(h.awardedSetAside.total).toBe(24617);
    expect(h.awardedSetAsideMix.reduce((a, m) => a + m.count, 0)).toBe(24617);
    expect(h.awardedSetAsideMix[0]).toEqual({ label: 'Full & Open', count: 14645 });
    const rec = calls.filter((c) => c.table === 'recompete_opportunities');
    expect(rec.length).toBe(1 + AWARDED_SETASIDE_LABELS.length);
    expect(rec.every((c) => !c.ops.some((o) => o.op === 'ilike'))).toBe(true);
  });

  it.each([
    ['INTERIOR, DEPARTMENT OF THE', 'Department of the Interior', 2189],
    ['ENVIRONMENTAL PROTECTION AGENCY', 'Environmental Protection Agency', 221],
  ])('%s → %s (%i rows, exact)', async (agency, canonical, total) => {
    const { client } = makeClient({ resolve: fixtureResolver(agency), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, agency, 90, NOW);
    expect(h.awardedSetAside.identity?.name).toBe(canonical);
    expect(h.awardedSetAside.total).toBe(total);
  });

  it('a service branch matches on awarding_sub_agency (Navy: 5,299 rows)', async () => {
    const { client, calls } = makeClient({ resolve: fixtureResolver('DEPT OF THE NAVY'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'DEPT OF THE NAVY', 90, NOW);
    expect(h.awardedSetAside.identity).toEqual({ name: 'Department of the Navy', tier: 'subtier' });
    expect(h.awardedSetAside.total).toBe(5299);
    expect(calls.filter((c) => c.table === 'recompete_opportunities').every((c) => eqOf(c, 'awarding_sub_agency') === 'Department of the Navy')).toBe(true);
  });

  it('an unresolvable agency is refused, not guessed — no recompete query at all', async () => {
    const { client, calls } = makeClient({ resolve: fixtureResolver('SOME MADE-UP OFFICE'), rpc: fixtureRpc });
    const h = await computeCompetitionHealth(client, 'SOME MADE-UP OFFICE', 90, NOW);
    expect(h.awardedSetAside.identity).toBeNull();
    expect(h.awardedSetAsideMix).toEqual([]);
    expect(h.awardedSetAside.note).toContain("Can't confidently map");
    expect(calls.some((c) => c.table === 'recompete_opportunities')).toBe(false);
  });
});

describe('page load performs no business-data writes', () => {
  it('only reads tables and calls the read-only aggregate', async () => {
    const { client, calls, rpcCalls } = makeClient({ resolve: fixtureResolver('DEPT OF DEFENSE'), rpc: fixtureRpc });
    await computeCompetitionHealth(client, 'DEPT OF DEFENSE', 90, NOW);
    const WRITES = ['insert', 'update', 'upsert', 'delete'];
    expect(calls.flatMap((c) => c.ops.map((o) => o.op)).filter((op) => WRITES.includes(op))).toEqual([]);
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(['sam_opportunities', 'recompete_opportunities']));
    expect(rpcCalls.map((r) => r.fn)).toEqual(['competition_health_winners']);
  });

  it('the aggregate function is declared read-only (STABLE, no DML in its body)', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/20261006_competition_health_winners.sql', 'utf8');
    const body = sql.split('AS $function$')[1].split('$function$')[0];
    expect(sql).toMatch(/\bSTABLE\b/);
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  });
});

describe('the depth interval is never presented as an agency-wide estimate (review 2026-10-06)', () => {
  it('the card renders the interval only together with its recency/non-random scope statement', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/app/admin/competition-health/page.tsx', 'utf8');
    const rendered = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(rendered).toContain('singleBidSampleInterval');
    expect(rendered).toContain('intervalScope');
    // no confidence-interval language in anything the card renders
    expect(rendered).not.toMatch(/95% CI|confidence interval/i);
    const block = rendered.slice(rendered.indexOf('singleBidSampleInterval &&'));
    expect(block.slice(0, 900)).toContain('intervalScope');
  });
});

