/**
 * Stale legacy GAO must never read as a current finding about the buyer.
 *
 * Measured on production 2026-09-25: all 445 `gao_high_risk` rows are GovInfo
 * testimonies published 1993-10-06 → 2000-09-27, every one stamped fiscal_year=2026
 * (the fetch year). 233 survive the attribution quarantine and were reaching
 * understand_customer as undated `gao_reports`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCurrentLegacyGao, legacyGaoDateLabel, LEGACY_GAO_MAX_AGE_YEARS } from './legacy-gao-currency';

const NOW = new Date('2026-09-25T12:00:00Z');

describe('isCurrentLegacyGao — the government date decides, never fiscal_year', () => {
  it('a 1998 testimony stamped fiscal_year 2026 is NOT current', () => {
    expect(isCurrentLegacyGao(
      { intelligence_type: 'gao_high_risk', publication_date: '1998-02-05', fiscal_year: 2026 } as never,
      NOW,
    )).toBe(false);
  });

  it('the newest production row (2000-09-27) is NOT current', () => {
    expect(isCurrentLegacyGao({ intelligence_type: 'gao_high_risk', publication_date: '2000-09-27' }, NOW)).toBe(false);
  });

  it('an UNDATED GAO row is not current — unknown age must not render as now', () => {
    expect(isCurrentLegacyGao({ intelligence_type: 'gao_high_risk', publication_date: null }, NOW)).toBe(false);
    expect(isCurrentLegacyGao({ intelligence_type: 'gao_high_risk', publication_date: 'garbage' }, NOW)).toBe(false);
  });

  it(`a GAO row inside ${LEGACY_GAO_MAX_AGE_YEARS} years is current; the boundary day is inclusive`, () => {
    expect(isCurrentLegacyGao({ intelligence_type: 'gao_high_risk', publication_date: '2024-03-01' }, NOW)).toBe(true);
    expect(isCurrentLegacyGao({ intelligence_type: 'gao_high_risk', publication_date: '2021-09-25' }, NOW)).toBe(true);
    expect(isCurrentLegacyGao({ intelligence_type: 'gao_high_risk', publication_date: '2021-09-24' }, NOW)).toBe(false);
  });

  it('non-GAO rows are out of scope (contract_pattern carries no publication_date at all)', () => {
    expect(isCurrentLegacyGao({ intelligence_type: 'contract_pattern', publication_date: null }, NOW)).toBe(true);
  });

  it('labels the government date, or says it is unknown', () => {
    expect(legacyGaoDateLabel({ publication_date: '1998-02-05' })).toBe('1998-02-05');
    expect(legacyGaoDateLabel({ publication_date: null })).toBe('date unknown');
  });
});

// ── Read paths ────────────────────────────────────────────────────────────────
const ROWS = [
  { intelligence_type: 'gao_high_risk', title: 'VA Health Care: 1998 testimony', publication_date: '1998-02-05', fiscal_year: 2026, attribution_evidence: 'corroborated_by_title' },
  { intelligence_type: 'gao_high_risk', title: 'VA Acquisition: recent report', publication_date: '2025-06-01', fiscal_year: 2026, attribution_evidence: 'corroborated_by_title' },
  { intelligence_type: 'contract_pattern', title: 'pattern', description: 'Top NAICS 541512', publication_date: null, fiscal_year: 2026 },
];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain; q.order = chain; q.eq = chain; q.in = chain; q.gte = chain;
      q.limit = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: ROWS, error: null }).then(res);
      return q;
    },
  }),
}));

vi.mock('@/lib/strategic-intel/sourced-pain-points', () => ({
  getAgencySourcedIntelligence: async () => ({
    painPoints: [], priorities: [], meta: { sourcedCount: 0, legacyCount: 0 },
  }),
  formatPainPointForDisplay: (p: { pain_point: string }) => p.pain_point,
  toCitation: (p: unknown) => p,
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  vi.resetModules();
});

describe('agency-specific reads withhold stale legacy GAO by default', () => {
  it('getAgencyIntelligence drops the 1998 row and keeps the recent GAO + non-GAO rows', async () => {
    const { getAgencyIntelligence } = await import('./index');
    const rows = await getAgencyIntelligence('Department of Veterans Affairs');
    expect(rows.map((r) => r.title)).toEqual(['VA Acquisition: recent report', 'pattern']);
  });

  it('historical research can still reach every row — nothing is deleted', async () => {
    const { getAgencyIntelligence } = await import('./index');
    const rows = await getAgencyIntelligence('Department of Veterans Affairs', undefined, { includeHistoricalGao: true });
    expect(rows).toHaveLength(3);
  });

  it('getIntelligenceForBriefing — whose fiscal_year gate cannot catch these rows — also withholds them', async () => {
    const { getIntelligenceForBriefing } = await import('./index');
    const rows = await getIntelligenceForBriefing(['Department of Veterans Affairs']);
    expect(rows.map((r) => r.title)).not.toContain('VA Health Care: 1998 testimony');
  });

  it('getUnifiedAgencyIntelligence serves only current GAO, dated, and counts what it withheld', async () => {
    const { getUnifiedAgencyIntelligence } = await import('./index');
    const intel = await getUnifiedAgencyIntelligence('Department of Veterans Affairs');
    expect(intel?.gaoReports).toHaveLength(1);
    expect(intel?.gaoReports[0]).toContain('VA Acquisition: recent report (GAO, 2025-06-01)');
    expect(intel?.gaoReports.join(' ')).not.toContain('1998 testimony');
    expect(intel?.historicalGaoWithheld).toBe(1);
  });
});
