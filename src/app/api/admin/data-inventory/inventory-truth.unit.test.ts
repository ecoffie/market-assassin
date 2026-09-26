import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DATA CORE INVENTORY TRUTH GUARD
 *
 * /admin/data-inventory is an admin TRUTH surface. This file runs the REAL route
 * against a fake Supabase / BigQuery and asserts what the page is allowed to claim.
 *
 * History: the predecessor guard (PR #1339 → reworked) only checked that three
 * mirrored tables were represented. It passed while the page double-counted SAM rows,
 * called vendor POCs decision makers, presented 1993-2000 GAO testimonies as current,
 * omitted the living legislation + GAO corpora, and listed IG/CRS as feeds with 0
 * held documents (audit: tasks/data-inventory-audit-2026-09-26.md). The guards below
 * are one per failure class found there.
 */

// ── Fake data plane ────────────────────────────────────────────────────────────
// Head-counts are keyed by `table|filters`. Anything unlisted returns 7 so a missing
// expectation is visible rather than silently zero.
const COUNTS: Record<string, number> = {
  'sam_opportunities|': 224_158,
  'sam_opportunities|eq:active=true': 35_829,
  'sam_opportunities|eq:embedding_source=sow': 30_541,
  'sam_opportunities|eq:embedding_source=description': 117_892,
  'sam_opportunities|eq:embedding_source=none': 55_328,
  'federal_contacts|': 302_151,
  'federal_contacts|eq:contact_kind=government_buyer': 220_134,
  'federal_contacts|eq:contact_kind=vendor_entity_poc': 82_017,
  'federal_contacts|is:contact_kind=null': 0,
  'recompete_opportunities|': 181_773,
  'recompete_opportunities|is:quality_flag=null': 143_709,
  'recompete_opportunities|eq:quality_flag=expired': 28_676,
  'recompete_opportunities|eq:quality_flag=grouped_synthetic': 9_297,
  'recompete_opportunities|eq:quality_flag=placeholder_value': 84,
  'recompete_opportunities|eq:quality_flag=sentinel_value': 5,
  'recompete_opportunities|eq:quality_flag=implausible_value': 2,
  'institute_sources|eq:source_type=gao_report': 73,
  'institute_sources|eq:source_type=ig_report': 0,
  'institute_sources|eq:source_type=crs_report': 0,
  'agency_intelligence|eq:intelligence_type=gao_high_risk': 445,
  'agency_intelligence|eq:intelligence_type=contract_pattern': 111,
  'aggregated_opportunities|eq:source=nsf_sbir': 0,
  'dod_sbir_topics|': 0,
};

const LEGISLATION_ROWS = [
  ...Array.from({ length: 22 }, (_, i) => ({ source_type: 'introduced_bill', document_number: `119-HR${i}-IH`, publication_date: '2026-06-15', raw: { fiscalYear: i % 2 ? 2026 : 2027 } })),
  { source_type: 'enacted_law', document_number: '119-S1071-PUBLIC-LAW', publication_date: '2025-12-19', raw: { fiscalYear: 2026 } },
  { source_type: 'enacted_law', document_number: '119-S1071-ENR', publication_date: null, raw: { fiscalYear: 2026 } },
  ...Array.from({ length: 4 }, (_, i) => ({ source_type: 'committee_report', document_number: `119-HRPT-${i}`, publication_date: '2026-06-15', raw: { fiscalYear: 2027 } })),
  { source_type: 'committee_report', document_number: '119-SRPT-39-ERRATA', publication_date: null, raw: { fiscalYear: 2026 } },
];

const INSTANCES = [
  { dataset_key: 'strategic_intelligence', source_key: 'institute_legislation', source_state: 'upstream_quiet', intervention_state: 'none_required', held_population: 29, last_data_advance: '2026-09-20T13:33:55Z', last_poll: '2026-09-23T01:29:17Z' },
  { dataset_key: 'strategic_intelligence', source_key: 'institute_gao', source_state: 'current', intervention_state: 'none_required', held_population: 73, last_data_advance: '2026-09-26T12:20:27Z', last_poll: '2026-09-26T12:20:27Z' },
  { dataset_key: 'forecast_intelligence', source_key: 'forecast_epa_apex', source_state: 'unreachable', intervention_state: 'required', held_population: 50, last_data_advance: null, last_poll: null },
  { dataset_key: 'forecast_intelligence', source_key: 'forecast_hhs_sbcx', source_state: 'current', intervention_state: 'none_required', held_population: 5343, last_data_advance: null, last_poll: null },
  { dataset_key: 'sam_opportunities', source_key: 'sam_opportunities_sam_gov', source_state: 'current', intervention_state: 'none_required', held_population: 215_066, last_data_advance: null, last_poll: null },
];
const CRON_ROWS = [{ job_name: 'institute-legislation-sync', cron_expr: '40 13 * * 0', enabled: 'true' }];
const RUN_ROWS = [{ job_name: 'institute-legislation-sync', started_at: '2026-09-20T13:58:27Z', status: 'success', http_status: null }];
const DATA_SOURCES = [
  { key: 'sam_opportunities', record_count: 123_255, last_built: null },
  { key: 'gsa_calc_pricing', record_count: 240_000, last_built: null },
  { key: 'bq_awards', record_count: null, last_built: '2026-09-20T00:00:00Z' },
];

function fakeQuery(table: string) {
  const filters: string[] = [];
  let head = false;
  const q: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return q; };
  q.select = chain((_c: unknown, opts: unknown) => { head = !!(opts as { head?: boolean } | undefined)?.head; });
  q.eq = chain((col: unknown, v: unknown) => filters.push(`eq:${col}=${v}`));
  q.is = chain((col: unknown, v: unknown) => filters.push(`is:${col}=${v}`));
  q.not = chain((col: unknown, op: unknown, v: unknown) => filters.push(`not:${col}.${op}=${v}`));
  for (const m of ['in', 'gte', 'order', 'limit', 'range']) q[m] = chain(() => {});
  q.then = (resolve: (v: unknown) => void) => {
    if (head) {
      const key = `${table}|${filters.filter((f) => !f.startsWith('not:')).join('&')}`;
      resolve({ count: COUNTS[key] ?? 7, error: null });
      return;
    }
    const data =
      table === 'institute_sources' ? LEGISLATION_ROWS
        : table === 'data_source_instances' ? INSTANCES
          : table === 'cron_jobs' ? CRON_ROWS
            : table === 'cron_job_runs' ? RUN_ROWS.filter((r) => filters.includes(`eq:job_name=${r.job_name}`))
              : table === 'data_sources' ? DATA_SOURCES
                : [];
    resolve({ data, error: null });
  };
  return q;
}

vi.mock('@/lib/supabase/server-clients', () => ({
  getCountClient: () => ({ from: (t: string) => fakeQuery(t) }),
}));
vi.mock('@/lib/bigquery/client', () => ({
  BQ_TABLES: { recipientsRollup: 'rollup', recipients: 'recipients', awards: 'awards' },
  bqQuery: async ({ query }: { query: string }) =>
    [{ n: query.includes('rollup') ? 296_445 : query.includes('recipients') ? 321_500 : 63_000_000 }],
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let body: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (k: string) => body.datasets.find((d: any) => d.key === k);

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  vi.resetModules();
  const { GET } = await import('./route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('http://localhost/api/admin/data-inventory?password=pw'));
  body = await res.json();
});

describe('Data Core inventory truth', () => {
  it('the route holds its own structural invariants', () => {
    expect(body.violations).toEqual([]);
  });

  it('LEGISLATION: the living legislative corpus is its own source dataset, not folded into pain points', () => {
    const leg = row('legislation');
    expect(leg).toBeDefined();
    expect(leg.kind).toBe('source_corpus');
    expect(leg.stored).toBe(29);
    const part = (l: string) => leg.breakdown.find((b: { label: string }) => b.label === l)?.count;
    expect(part('bill versions')).toBe(22);
    expect(part('enacted-law records')).toBe(2);
    expect(part('committee reports')).toBe(5);
    expect(leg.provenance).toMatch(/FY2026, FY2027/);
    expect(leg.provenance).toMatch(/Bill TEXT is not held/);
    expect(leg.surface.tools).toEqual(expect.arrayContaining(['get_legislation_status', 'get_agency_intel']));
  });

  it('LEGISLATION: before a scheduled re-run, a manual refresh is shown and recurrence is NOT re-proven', () => {
    const s = row('legislation').freshness.schedules[0];
    expect(s.lastScheduledRun.at).toBe('2026-09-20T13:58:27Z');
    expect(s.lastManualRefresh).toBe('2026-09-23T01:29:17Z');
    expect(s.recurrence).toBe('not_yet_reproven');
    expect(s.nextScheduled).toMatch(/T13:40:00/);
  });

  it('GAO: living reports, source-backed claims and historical testimonies are three separate rows', () => {
    const living = row('gao_living');
    const claims = row('sourced_pain_points');
    const hist = row('gao_historical');
    expect(living.kind).toBe('source_corpus');
    expect(living.stored).toBe(73);
    expect(claims.kind).toBe('derived_intelligence');
    expect(hist.stored).toBe(445);
    expect(hist.surface.state).toBe('withheld');
    expect(hist.freshness.state).toBe('STATIC');
    expect(hist.label).toMatch(/historical/i);
    expect(`${hist.label} ${hist.provenance} ${hist.freshness.detail}`).toMatch(/NOT current/);
    expect(row('agency_intel')).toBeUndefined(); // the old conflated "exclusive GAO" row is gone
  });

  it('PAIN POINTS: static curated claims; IG / CRS / NDAA are prose attributions, never living sources', async () => {
    const pp = row('pain_points');
    expect(pp.kind).toBe('static_manual');
    expect(pp.freshness.state).toBe('STATIC');
    const attr = (l: string) => pp.proseAttributions.find((a: { label: string }) => a.label === l);
    expect(attr('IG / OIG').livingRecords).toBe(0);
    expect(attr('CRS').livingRecords).toBe(0);
    // No dataset may name IG or CRS as an upstream while zero such documents are held.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allUpstreams = body.datasets.flatMap((d: any) => d.upstreams);
    // Tokenise on _ and - : `\b` treats `_` as a word char, so `ig_audits` slipped past a
    // word-boundary regex (found by inject -> expected red -> was green).
    const isIgOrCrs = (u: string) => u.toLowerCase().split(/[_\-\s]+/).some((t) => ['ig', 'oig', 'crs', 'inspector'].includes(t));
    expect(allUpstreams.filter(isIgOrCrs)).toEqual([]);
    const { UPSTREAM_PUBLISHERS } = await import('@/lib/data-core/inventory-model');
    expect(Object.keys(UPSTREAM_PUBLISHERS).filter(isIgOrCrs)).toEqual([]);
    expect(body.provenanceLimits.igSourceDocuments).toBe(0);
    expect(body.provenanceLimits.crsSourceDocuments).toBe(0);
  });

  it('HEADLINE: the semantic index and passthrough never enter the unique-record total', () => {
    const idx = row('semantic_index');
    expect(idx.kind).toBe('derived_index');
    expect(idx.uniqueContribution).toBe(0);
    // indexed = SOW + description only; empty-array "none" sentinels are not vectors
    expect(idx.stored).toBe(30_541 + 117_892);
    const sources = body.datasets.filter((d: { kind: string }) => d.kind === 'source_corpus');
    const expected = sources.reduce((s: number, d: { uniqueContribution: number | null }) => s + (d.uniqueContribution ?? 0), 0);
    expect(body.totals.uniqueSourceRecords).toBe(expected);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of body.datasets.filter((x: any) => x.kind === 'passthrough')) {
      expect(d.stored, d.key).toBeNull();
      expect(d.surface.state, d.key).toBe('passthrough');
    }
    for (const k of ['pricing_intel', 'incumbent_financials', 'regulatory_demand']) expect(row(k)?.kind, k).toBe('passthrough');
  });

  it('SAM: stored total and active/open are different numbers, and only active is called open', () => {
    const sam = row('sam_opps');
    expect(sam.stored).toBe(224_158);
    expect(sam.served.count).toBe(35_829);
    expect(sam.served.label).toMatch(/active/);
    expect(sam.provenance).not.toMatch(/live open-opportunity corpus/);
  });

  it('RECOMPETES: served excludes flagged rows; synthetic groups are not underlying records', () => {
    const rc = row('recompetes');
    expect(rc.stored).toBe(181_773);
    expect(rc.served.count).toBe(143_709);
    expect(rc.uniqueContribution).toBe(181_773 - 9_297);
    const ex = rc.served.excluded.reduce((s: number, e: { count: number }) => s + e.count, 0);
    expect(rc.served.count + ex).toBe(rc.stored);
  });

  it('CONTACTS: vendor POCs are never counted as decision makers', () => {
    const c = row('contacts');
    expect(row('decision_makers')).toBeUndefined();
    expect(c.served.count).toBe(220_134);
    expect(c.served.label).toMatch(/government/);
    expect(c.served.excluded.find((e: { label: string }) => /vendor/.test(e.label)).count).toBe(82_017);
  });

  it('FORECASTS: a multi-feed dataset shows its worst feed, not an average', () => {
    expect(row('forecasts').freshness.state).toBe('UNREACHABLE');
  });

  it('RESEARCH: a source with 0 rows is labelled as contributing nothing and is not counted as an upstream', () => {
    const r = row('research_funding');
    expect(r.breakdown.find((b: { label: string }) => b.label === 'NSF SBIR/STTR').note).toMatch(/0 rows/);
    expect(r.upstreams).not.toContain('nsf_sbir');
  });

  it('BUDGET: static file with its own as-of date', () => {
    const b = row('budget_authority');
    expect(b.kind).toBe('static_manual');
    expect(b.freshness.state).toBe('STATIC');
    expect(b.freshness.asOf).toMatch(/^2026-02-18/);
  });

  it('SOURCES: upstream publishers, not label strings; registry disagreement shown as debt', () => {
    expect(body.upstreams.persisted).toContain('congress_gov');
    expect(body.upstreams.persisted).toContain('gao');
    expect(body.upstreams.persisted.filter((u: string) => u === 'sam_gov')).toHaveLength(1);
    expect(body.upstreams.persisted.some((u: string) => /openai/i.test(u))).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debt = body.registryDebt.map((d: any) => d.where);
    expect(debt.some((w: string) => w.includes('sam_opportunities.record_count'))).toBe(true);
    expect(debt.some((w: string) => w.includes('gsa_calc_pricing'))).toBe(true);
  });

  it('no stale vanity metrics survive (formats / agencies / LOC / commits)', () => {
    expect(body.recreateCost).toBeUndefined();
    const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    expect(SRC).not.toMatch(/commits:\s*\d/);
    expect(SRC).not.toMatch(/linesOfCode:\s*\d/);
    expect(SRC).not.toMatch(/agencies:\s*'300\+'/);
  });

  it('every tool the inventory names is a real MCP tool', async () => {
    const { listMcpTools } = await import('@/lib/mcp/tool-registry');
    const live = new Set(listMcpTools().map((t) => (t.function as { name: string }).name));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const named = body.datasets.flatMap((d: any) => d.surface.tools as string[]);
    expect(named.filter((t: string) => !live.has(t))).toEqual([]);
  });

  it('COLLECTORS: every data-collector cron in the repo is represented by a dataset', () => {
    // Derived from the filesystem, not a list typed here: a new institute-* / sync-*
    // collector fails this until the inventory represents it (or it is declared not-a-corpus).
    const NOT_A_CORPUS = new Set([
      'sync-stripe-cache',        // billing cache
      'embed-user-capabilities',  // per-user profile vectors
      'snapshot-metrics', 'snapshot-leaderboards', 'snapshot-watchlist',
      'snapshot-awards', 'snapshot-opportunities', 'snapshot-recompetes', // per-user briefing snapshots
    ]);
    const cronDir = join(process.cwd(), 'src/app/api/cron');
    const collectors = readdirSync(cronDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^(sync-|snapshot-|institute-|extract-|embed-)/.test(d.name))
      .map((d) => d.name)
      .filter((n) => !NOT_A_CORPUS.has(n));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobsSeen = new Set(body.datasets.flatMap((d: any) => (d.freshness.schedules ?? []).map((s: any) => s.job)));
    const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    const missing = collectors.filter((n) => !jobsSeen.has(n) && !new RegExp(`'${n}(-[a-z]+)?'`).test(SRC));
    expect(missing, 'collector crons with no inventory row').toEqual([]);
  });
});
