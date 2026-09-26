/**
 * Mindy's dedicated SBIR/STTR search is retired (src/lib/sbir/retired.ts). The AI briefing generator's
 * multisite fetch is an ACTIVE nightly path (precompute-briefings reaches it; measured 2026-09-26), so the
 * retired `sbir_sttr` slice must never reach the briefing LLM — while legitimate non-SBIR R&D rows still do.
 *
 * BEHAVIOURAL, end to end: the REAL generateAIBriefing runs; the REAL fetchMultisiteOpportunities runs
 * against an in-memory `aggregated_opportunities`; only I/O is faked (Supabase, recompete fetch, LLM,
 * angle memory). We assert on the rows the pipeline returns AND on the prompt the LLM actually receives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;
const NOW = new Date('2026-09-26T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const TABLES: Record<string, Row[]> = {
  aggregated_opportunities: [
    { id: 'sbir-1', source: 'nih_reporter', opportunity_type: 'sbir_sttr', status: 'active', posted_date: daysAgo(1),
      title: 'RETIRED-SBIR-ROW Smart Occlusion Dose Monitor', agency: 'NIH - NEI', source_url: 'https://reporter.nih.gov/project-details/1' },
    { id: 'grant-1', source: 'grants_gov', opportunity_type: 'grant', status: 'active', posted_date: daysAgo(2),
      title: 'KEEP-GRANT Cyber Resilience Research Program', agency: 'NSF' },
    { id: 'baa-1', source: 'darpa_baa', opportunity_type: 'baa', status: 'active', posted_date: daysAgo(3),
      title: 'KEEP-BAA Defense Sciences Office-wide BAA', agency: 'DARPA' },
    { id: 'nihgrant-1', source: 'nih_reporter', opportunity_type: 'grant', status: 'active', posted_date: daysAgo(4),
      title: 'KEEP-NIH-GRANT Clinical Data Provenance', agency: 'NIH' },
    { id: 'sbir-old', source: 'nih_reporter', opportunity_type: 'sbir_sttr', status: 'active', posted_date: daysAgo(90),
      title: 'OLD-SBIR outside the 30-day window', agency: 'NIH' },
  ],
};

/** A minimal PostgREST-shaped builder over TABLES, implementing the filters the pipeline uses. */
function from(table: string) {
  let rows = [...(TABLES[table] ?? [])];
  let lim = Infinity;
  const b: Record<string, unknown> = {};
  const chain = (fn: () => void) => (...a: unknown[]) => { void a; fn(); return b; };
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; };
  b.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; };
  b.not = (c: string, op: string, v: string) => {
    if (op === 'in') { const vs = v.replace(/[()]/g, '').split(','); rows = rows.filter((r) => !vs.includes(String(r[c]))); }
    return b;
  };
  b.gte = (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? '') >= v); return b; };
  b.lte = (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? '') <= v); return b; };
  b.order = (c: string, o?: { ascending?: boolean }) => {
    rows.sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return b;
  };
  b.limit = (n: number) => { lim = n; return b; };
  for (const m of ['or', 'ilike', 'neq', 'is', 'contains', 'overlaps', 'range', 'filter', 'match']) b[m] = chain(() => {});
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  b.single = async () => ({ data: rows[0] ?? null, error: null });
  b.then = (res: (v: unknown) => void) => res({ data: rows.slice(0, lim), error: null, count: rows.length });
  return b;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from, rpc: async () => ({ data: null, error: null }) }) }));
vi.mock('../pipelines/fpds-recompete', () => ({ fetchExpiringContractsFromDb: vi.fn(async () => []), fetchExpiringContracts: vi.fn(async () => []) }));
vi.mock('../enrichment', () => ({ enrichContractsWithIntel: vi.fn(async (c: unknown) => c) }));
vi.mock('../angle-history', () => ({
  extractAnglesFromBriefing: () => [], persistAngles: vi.fn(async () => {}), getRecentAngles: vi.fn(async () => []), formatAnglesForPrompt: () => '',
}));
const prompts: string[] = [];
vi.mock('../delivery/llm-router', () => ({
  extractAndParseJSON: () => null,
  generateBriefingJson: vi.fn(async (...args: unknown[]) => {
    prompts.push(JSON.stringify(args));
    throw new Error('LLM stubbed in test');
  }),
}));
const fetchSpy = vi.fn();
vi.mock('../pipelines/multisite', async (orig) => {
  const real = await orig<typeof import('../pipelines/multisite')>();
  return {
    ...real,
    fetchMultisiteOpportunities: async (p: Parameters<typeof real.fetchMultisiteOpportunities>[0]) => {
      const r = await real.fetchMultisiteOpportunities(p);
      fetchSpy(p, r);
      return r;
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  prompts.length = 0;
  fetchSpy.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
});

describe('AI briefing generator — retired SBIR rows excluded, legitimate R&D rows kept', () => {
  it('the real generator fetch returns the non-SBIR rows and no sbir_sttr row', async () => {
    const { generateAIBriefing } = await import('../delivery/ai-briefing-generator');
    await generateAIBriefing('template@govcongiants.com', { skipEnrichment: true, naicsOverride: ['541512'], briefingType: 'daily' }).catch(() => null);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [params, result] = fetchSpy.mock.calls[0] as [Record<string, unknown>, { opportunities: { id: string; opportunityType: string }[] }];
    const ids = result.opportunities.map((o) => o.id).sort();
    expect(ids).toEqual(['baa-1', 'grant-1', 'nihgrant-1']); // every legitimate in-window row survives
    expect(result.opportunities.some((o) => o.opportunityType === 'sbir_sttr')).toBe(false);
    expect(params.excludeOpportunityTypes).toEqual(['sbir_sttr']);
  });

  it('the prompt the LLM receives carries the kept rows and never the SBIR row', async () => {
    const { generateAIBriefing } = await import('../delivery/ai-briefing-generator');
    await generateAIBriefing('template@govcongiants.com', { skipEnrichment: true, naicsOverride: ['541512'], briefingType: 'daily' }).catch(() => null);

    expect(prompts.length).toBeGreaterThan(0);
    const prompt = prompts.join('\n');
    expect(prompt).toContain('KEEP-GRANT');
    expect(prompt).toContain('KEEP-BAA');
    expect(prompt).not.toContain('RETIRED-SBIR-ROW');
  });

  it('control: the same fetch WITHOUT the exclusion would have let the SBIR row in (the test can fail)', async () => {
    const { fetchMultisiteOpportunities } = await vi.importActual<typeof import('../pipelines/multisite')>('../pipelines/multisite');
    const r = await fetchMultisiteOpportunities({ postedFrom: daysAgo(30), limit: 25 });
    expect(r.opportunities.map((o) => o.id)).toContain('sbir-1');
  });
});
