/**
 * Option C — quarantine unsupported agency attribution from AGENCY-SPECIFIC reads.
 *
 * Measured on production 2026-09-20 (445 gao_high_risk rows):
 *   artifact_agency       148  → excluded from agency-specific reads
 *   unsupported_by_title   64  → excluded from agency-specific reads
 *   no_title_evidence     211  → retained, never presented as corroborated
 *   corroborated_by_title  22  → retained normally
 *
 * Exact-DDL validated against the real database (transaction + ROLLBACK):
 * the safe view returns 344 rows (211 + 111 non-GAO + 22); the base table keeps
 * all 556. 212 quarantined = 148 + 64.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: { from: string[]; eq: [string, string][]; in: [string, unknown][] } = { from: [], eq: [], in: [] };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      captured.from.push(table);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain; q.order = chain;
      q.eq = (k: string, v: string) => { captured.eq.push([k, v]); return q; };
      q.in = (k: string, v: unknown) => { captured.in.push([k, v]); return q; };
      q.gte = chain;
      q.limit = async () => ({ data: [], error: null });
      // getIntelligenceForBriefing awaits the builder directly
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return q;
    },
  }),
}));

beforeEach(() => {
  captured.from = []; captured.eq = []; captured.in = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  vi.resetModules();
});

describe('agency-specific reads go through the quarantine, never the base table', () => {
  it('getAgencyIntelligence reads agency_intelligence_agency_safe', async () => {
    const { getAgencyIntelligence } = await import('./index');
    await getAgencyIntelligence('Department of Veterans Affairs');
    expect(captured.from).toContain('agency_intelligence_agency_safe');
    expect(captured.from).not.toContain('agency_intelligence');
  });

  it('getIntelligenceForBriefing — the SECOND query authority — also uses it', async () => {
    const { getIntelligenceForBriefing } = await import('./index');
    await getIntelligenceForBriefing(['Department of Veterans Affairs']);
    expect(captured.from).toContain('agency_intelligence_agency_safe');
    expect(captured.from).not.toContain('agency_intelligence');
  });

  it('the base table is reachable ONLY via an explicit opt-in', async () => {
    const { getAgencyIntelligence } = await import('./index');
    await getAgencyIntelligence('Department of Veterans Affairs', undefined, {
      includeUnsupportedAttribution: true,
    });
    expect(captured.from).toContain('agency_intelligence');
  });
});

describe('no source row is deleted', () => {
  it('the migration creates a VIEW and issues no DELETE/UPDATE on the corpus', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260921_agency_intelligence_agency_safe.sql'),
      'utf8',
    ).replace(/--.*$/gm, '');
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.agency_intelligence_agency_safe/);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.agency_intelligence\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it('the quarantine predicate keeps non-GAO rows and the two allowed classes', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260921_agency_intelligence_agency_safe.sql'),
      'utf8',
    );
    expect(sql).toMatch(/ai\.intelligence_type <> 'gao_high_risk'/);
    expect(sql).toMatch(/IN \('corroborated_by_title', 'no_title_evidence'\)/);
    // the two quarantined classes must NOT appear as allowed values
    expect(sql).not.toMatch(/IN \([^)]*'artifact_agency'/);
    expect(sql).not.toMatch(/IN \([^)]*'unsupported_by_title'[^)]*\)\s*;/);
  });
});

describe('no_title_evidence is never silently promoted to corroborated', () => {
  async function unified(rows: Record<string, unknown>[]) {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          q.select = chain; q.order = chain; q.eq = chain; q.in = chain; q.gte = chain;
          q.limit = async () => ({ data: rows, error: null });
          q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
          return q;
        },
      }),
    }));
    vi.doMock('@/lib/strategic-intel/sourced-pain-points', () => ({
      getAgencySourcedIntelligence: async () => ({
        agency: 'Department of Veterans Affairs', canonicalAgency: 'Department of Veterans Affairs',
        sourced: [], legacy: [], painPoints: [], priorities: [],
        meta: { sourcedCount: 0, legacyCount: 0, legacyPriorityCount: 0, provenanceAvailable: false },
      }),
      formatPainPointForDisplay: (p: { pain_point: string }) => p.pain_point,
      toCitation: (p: unknown) => p,
    }));
    const { getUnifiedAgencyIntelligence } = await import('./index');
    return getUnifiedAgencyIntelligence('Department of Veterans Affairs');
  }

  const row = (evidence: string) => ({
    agency_name: 'Department of Veterans Affairs',
    intelligence_type: 'gao_high_risk',
    title: 'Veterans Affairs: Programmatic and Management Challenges',
    source_name: 'GovInfo API',
    // A CURRENT date, so these rows exercise the attribution labels. Undated or
    // stale legacy GAO is withheld before labelling (legacy-gao-currency.unit.test.ts).
    publication_date: '2025-01-15',
    attribution_evidence: evidence,
  });

  it('an unresolved row is labelled UNRESOLVED', async () => {
    const r = await unified([row('no_title_evidence')]);
    expect(r?.gaoReports[0]).toContain('agency attribution UNRESOLVED');
    expect(r?.gaoReports[0]).toContain('not corroborated by the report title');
  });

  it('a corroborated row carries NO unresolved marker', async () => {
    const r = await unified([row('corroborated_by_title')]);
    expect(r?.gaoReports[0]).not.toContain('UNRESOLVED');
    expect(r?.gaoReports[0]).toContain('LEGACY_GOVINFO');
  });

  it('corroborated rows remain visible — this quarantines, it does not blank the surface', async () => {
    const r = await unified([row('corroborated_by_title')]);
    expect(r?.gaoReports).toHaveLength(1);
    expect(r?.gaoReports[0]).toContain('Veterans Affairs: Programmatic and Management Challenges');
  });
});
