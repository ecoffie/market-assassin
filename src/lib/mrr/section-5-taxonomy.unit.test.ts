/**
 * Block 5 done-test (§5 Taxonomy) — hermetic. The Mindy client is mocked so the
 * SHAPE contracts are asserted deterministically; the live grounded run is
 * exercised separately by scripts/mrr-run.mts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ impl: null as null | ((t: string, a: Record<string, unknown>) => unknown) }));

vi.mock('./mindy-client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    callTool: vi.fn(async (tool: string, args: Record<string, unknown>) => {
      const result = calls.impl ? calls.impl(tool, args) : undefined;
      if (result instanceof Error) {
        return { tool, args, evidence: { source: `Mindy MCP ${tool}`, retrievedAt: new Date().toISOString(), query: args }, error: result.message, ok: false };
      }
      return { tool, args, evidence: { source: `Mindy MCP ${tool}`, retrievedAt: new Date().toISOString(), query: args }, result, ok: true };
    }),
  };
});

import { buildSection5, SELECTION_RULE } from './section-5-taxonomy';
import { normalizeRequirement } from './normalizer';

const REQ = normalizeRequirement({
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  naics: '541512',
  psc: 'DA01',
  keyword: 'modeling and simulation',
  description: 'DHA seeks joint medical planning, modeling and simulation capabilities.',
}).normalized;

const COVERAGE_OK = {
  coverage: {
    totalMarket: 412_600_000,
    coveragePct: 0.9,
    coverageCodes: ['541715', '541330'],
    allNaics: [
      { code: '541715', name: 'R&D in the Physical, Engineering and Life Sciences', amount: 200e6, pct: 0.48 },
      { code: '541512', name: 'Computer Systems Design Services', amount: 19e6, pct: 0.047 },
    ],
    topPsc: { code: 'R425', name: 'Support Professional: Engineering/Technical' },
  },
  _meta: { grounded: true, degraded: false, naics_count: 2, total_market: 412_600_000 },
};

beforeEach(() => { calls.impl = null; });

describe('§5 Taxonomy', () => {
  it('produces a sourced §5 structure from grounded coverage', async () => {
    calls.impl = (t) => (t === 'derive_company_keywords'
      ? { keywords: ['modeling', 'simulation'], _meta: { grounded: true, degraded: false } }
      : COVERAGE_OK);
    const s = await buildSection5(REQ);
    expect(s.primaryNaics).toMatchObject({ state: 'value', value: '541512' });
    expect(s.primaryNaicsOrigin).toBe('supplied');
    expect(s.marketTotal).toMatchObject({ state: 'value', value: 412_600_000 });
    expect(s.coverageSet.state).toBe('value');
    expect(s.sizeStandard.state).toBe('value');
    expect(s.naicsBasis.state).toBe('value');
    // every grounded field carries source + retrieval time
    for (const f of [s.primaryNaics, s.marketTotal, s.coverageSet]) {
      expect((f as { evidence: { source: string; retrievedAt: string } }).evidence.source).toBeTruthy();
      expect((f as { evidence: { retrievedAt: string } }).evidence.retrievedAt).toBeTruthy();
    }
  });

  it('does NOT pretend derive_company_keywords returned codes', async () => {
    // The tool returns keyword PHRASES. Even when it returns something code-like,
    // the primary NAICS must come from coverage/supplied input — never from here.
    calls.impl = (t) => (t === 'derive_company_keywords'
      ? { keywords: ['999999', 'bogus code'], _meta: { grounded: true, degraded: false } }
      : COVERAGE_OK);
    const s = await buildSection5({ ...REQ, naics: undefined });
    expect(s.primaryNaics).toMatchObject({ state: 'value', value: '541715' }); // from coverage
    expect(s.primaryNaicsOrigin).toBe('derived');
    expect(JSON.stringify(s.primaryNaics)).not.toContain('999999');
  });

  it('records the coverage keyword AND the deterministic selection rule', async () => {
    calls.impl = () => COVERAGE_OK;
    const s = await buildSection5(REQ);
    expect(s.coverageKeyword).toMatchObject({ state: 'value', value: 'modeling and simulation' });
    expect(s.selectionRule).toBe(SELECTION_RULE);
    expect(s.selectionRule).toContain('verbatim');
  });

  it('renders keyword derivation Unknown when the tool is ungrounded, keeping the user keyword', async () => {
    calls.impl = (t) => (t === 'derive_company_keywords'
      ? { keywords: [], _meta: { grounded: false, degraded: false } }
      : COVERAGE_OK);
    const s = await buildSection5(REQ);
    expect(s.derivedKeywords.state).toBe('unknown');
    expect(s.coverageKeyword).toMatchObject({ state: 'value', value: 'modeling and simulation' });
  });

  it('renders coverage Unknown (never zero) when coverage is ungrounded', async () => {
    calls.impl = (t) => (t === 'get_keyword_coverage'
      ? { coverage: null, _meta: { grounded: false, degraded: false } }
      : { keywords: ['x'], _meta: { grounded: true, degraded: false } });
    const s = await buildSection5(REQ);
    expect(s.marketTotal.state).toBe('unknown');
    expect(s.coverageSet.state).toBe('unknown');
    expect(JSON.stringify(s.marketTotal)).not.toContain('"value":0');
  });

  it('distinguishes a DEGRADED coverage upstream from a missing one', async () => {
    calls.impl = (t) => (t === 'get_keyword_coverage'
      ? { coverage: null, _meta: { grounded: false, degraded: true } }
      : { keywords: ['x'], _meta: { grounded: true, degraded: false } });
    const s = await buildSection5(REQ);
    expect(s.marketTotal.state).toBe('degraded');
  });

  it('renders a MEASURED zero market as true_zero, not unknown', async () => {
    calls.impl = (t) => (t === 'get_keyword_coverage'
      ? { coverage: { totalMarket: 0, coveragePct: 0, allNaics: [], topPsc: null }, _meta: { grounded: true, degraded: false, naics_count: 0, total_market: 0 } }
      : { keywords: ['x'], _meta: { grounded: true, degraded: false } });
    const s = await buildSection5(REQ);
    expect(s.marketTotal.state).toBe('true_zero');
  });

  it('turns a thrown coverage call into Unknown WITH the attempt recorded', async () => {
    calls.impl = (t) => (t === 'get_keyword_coverage' ? new Error('ETIMEDOUT') : { keywords: ['x'], _meta: { grounded: true } });
    const s = await buildSection5(REQ);
    expect(s.marketTotal.state).toBe('unknown');
    expect(JSON.stringify(s.marketTotal)).toContain('ETIMEDOUT');
    expect(JSON.stringify(s.marketTotal)).toContain('attemptedEvidence');
  });

  it('fails VISIBLY when the SBA fixture lacks the code — never guesses a threshold', async () => {
    calls.impl = () => COVERAGE_OK;
    const s = await buildSection5({ ...REQ, naics: '238220' }); // not in the fixture
    expect(s.sizeStandard.state).toBe('unknown');
    expect((s.sizeStandard as { reason: string }).reason).toMatch(/not in the versioned local SBA fixture/);
  });

  it('carries the size-standard table citation and units', async () => {
    calls.impl = () => COVERAGE_OK;
    const s = await buildSection5(REQ);
    expect(s.sizeStandardCitation).toContain('13 CFR 121.201');
    // Assert that a VERSION stamp is present, not one specific edition: the table is
    // reissued, and pinning the date here would fail the build for a correct update.
    expect(s.sizeStandardCitation).toMatch(/\b(19|20)\d{2}\b/);
    if (s.sizeStandard.state === 'value') expect(s.sizeStandard.value.unit).toContain('million');
  });

  it('always states the market measurement basis alongside the total', async () => {
    calls.impl = () => COVERAGE_OK;
    const s = await buildSection5(REQ);
    expect(s.marketBasis).toContain('exact-phrase');
    expect(s.marketBasis).toContain('lower bound');
  });
});
