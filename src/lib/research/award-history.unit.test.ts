/**
 * Funded NIH RePORTER projects are AWARD HISTORY, never open opportunities (2026-09-26).
 * Behavioural: the REAL multisite pipeline and the REAL AI briefing generator run over an in-memory
 * `aggregated_opportunities`; only I/O is faked. Fixtures mirror live rows (nih_reporter project-details
 * pages, status=active, close_date = project END in the future).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAwardHistoryRow, recordKindFor } from './award-history';

type Row = Record<string, unknown>;
const NOW = new Date('2026-09-26T12:00:00Z');
const d = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const ROWS: Row[] = [
  { id: 'nih-grant', source: 'nih_reporter', opportunity_type: 'grant', status: 'active', posted_date: d(-1), close_date: d(200),
    title: 'FUNDED-NIH Pilot Projects Core', source_url: 'https://reporter.nih.gov/project-details/11238055', agency: 'NIH' },
  { id: 'nih-sbir', source: 'nih_reporter', opportunity_type: 'sbir_sttr', status: 'active', posted_date: d(-2), close_date: d(300),
    title: 'FUNDED-NIH-SBIR Occlusion Monitor', source_url: 'https://reporter.nih.gov/project-details/11405130', agency: 'NIH - NEI' },
  { id: 'gg-open', source: 'grants_gov', opportunity_type: 'grant', status: 'active', posted_date: d(-3), close_date: d(45),
    title: 'OPEN-GRANT Cyber Resilience Research', source_url: 'https://www.grants.gov/search-results-detail/1', agency: 'NSF' },
  { id: 'darpa-baa', source: 'darpa_baa', opportunity_type: 'baa', status: 'active', posted_date: d(-4), close_date: d(330),
    title: 'OPEN-BAA DSO Office-wide', source_url: 'https://sam.gov/opp/x', agency: 'DARPA' },
];

function from(table: string) {
  let rows = table === 'aggregated_opportunities' ? [...ROWS] : [];
  let lim = Infinity;
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; };
  b.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; };
  b.not = (c: string, op: string, v: string) => {
    if (op === 'in') { const vs = v.replace(/[()]/g, '').split(','); rows = rows.filter((r) => !vs.includes(String(r[c]))); }
    return b;
  };
  b.gte = (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? '') >= v); return b; };
  b.lte = (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? '') <= v); return b; };
  b.order = (c: string, o?: { ascending?: boolean }) => { rows.sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return b; };
  b.limit = (n: number) => { lim = n; return b; };
  for (const m of ['or', 'ilike', 'neq', 'is', 'contains', 'overlaps', 'range', 'filter', 'match']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  b.single = async () => ({ data: rows[0] ?? null, error: null });
  b.then = (res: (v: unknown) => void) => res({ data: rows.slice(0, lim), error: null, count: rows.length });
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from, rpc: async () => ({ data: null, error: null }) }) }));
vi.mock('@/lib/briefings/pipelines/fpds-recompete', () => ({ fetchExpiringContractsFromDb: vi.fn(async () => []), fetchExpiringContracts: vi.fn(async () => []) }));
vi.mock('@/lib/briefings/enrichment', () => ({ enrichContractsWithIntel: vi.fn(async (c: unknown) => c) }));
vi.mock('@/lib/briefings/angle-history', () => ({ extractAnglesFromBriefing: () => [], persistAngles: vi.fn(async () => {}), getRecentAngles: vi.fn(async () => []), formatAnglesForPrompt: () => '' }));
const prompts: string[] = [];
vi.mock('@/lib/briefings/delivery/llm-router', () => ({
  extractAndParseJSON: () => null,
  generateBriefingJson: vi.fn(async (...a: unknown[]) => { prompts.push(JSON.stringify(a)); throw new Error('LLM stubbed'); }),
}));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  prompts.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
});

describe('classifier', () => {
  it('nih_reporter and project-details URLs are award history; solicitations are not', () => {
    expect(isAwardHistoryRow({ source: 'nih_reporter' })).toBe(true);
    expect(isAwardHistoryRow({ source: 'other', source_url: 'https://reporter.nih.gov/project-details/9' })).toBe(true);
    expect(recordKindFor({ source: 'grants_gov', source_url: 'https://www.grants.gov/x' })).toBe('opportunity');
    expect(recordKindFor({ source: 'darpa_baa' })).toBe('opportunity');
  });
});

describe('multisite pipeline (shared by every opportunity consumer)', () => {
  it('default fetch returns the open rows and NO funded NIH project', async () => {
    const { fetchMultisiteOpportunities } = await import('@/lib/briefings/pipelines/multisite');
    const r = await fetchMultisiteOpportunities({ limit: 25 });
    expect(r.opportunities.map((o) => o.id).sort()).toEqual(['darpa-baa', 'gg-open']);
    expect(r.opportunities.every((o) => o.recordKind === 'opportunity')).toBe(true);
    expect(r.opportunities.find((o) => o.id === 'gg-open')?.closeDate).toBe(d(45)); // real deadlines untouched
  });

  it('a caller that explicitly asks for nih_reporter gets it LABELED award_history with no deadline', async () => {
    const { fetchMultisiteOpportunities } = await import('@/lib/briefings/pipelines/multisite');
    const r = await fetchMultisiteOpportunities({ sources: ['nih_reporter'], limit: 25 });
    expect(r.opportunities.map((o) => o.id).sort()).toEqual(['nih-grant', 'nih-sbir']); // control: the fixture rows ARE fetchable
    for (const o of r.opportunities) {
      expect(o.recordKind).toBe('award_history');
      expect(o.closeDate).toBeUndefined();
      expect(o.projectEndDate).toBeTruthy();
    }
  });
});

describe('AI briefing generator (active nightly path) — end to end', () => {
  it('the LLM prompt carries the open rows and never a funded NIH project', async () => {
    const { generateAIBriefing } = await import('@/lib/briefings/delivery/ai-briefing-generator');
    await generateAIBriefing('template@govcongiants.com', { skipEnrichment: true, naicsOverride: ['541512'], briefingType: 'daily' }).catch(() => null);
    expect(prompts.length).toBeGreaterThan(0);
    const p = prompts.join('\n');
    expect(p).toContain('OPEN-GRANT');
    expect(p).toContain('OPEN-BAA');
    expect(p).not.toContain('FUNDED-NIH');
  });
});
