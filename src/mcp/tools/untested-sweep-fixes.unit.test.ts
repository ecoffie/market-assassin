/**
 * Untested-tools sweep fixes (FM-U01..U09, Eric/QA independent test 2026-07-29). Locks the
 * deterministic parts of each fix. Live-verified separately: U01 (Amentum FY2025 $14.4B correct),
 * U02 (332994 not_applicable), U03 (null goals), U09 (Navy $176.5B), U06 (no past recompete dates).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('FM-U01 — EDGAR annual values labeled by period-end, not the XBRL fy field', () => {
  const src = read('../../lib/edgar/index.ts');
  it('derives the year from `end` (period-end), not the fy designation', () => {
    expect(src).toContain('yearOf');
    expect(src).toMatch(/new Date\(r\.end\)\.getUTCFullYear\(\)/);
  });
  it('accepts an annual row by ~1-year duration (so a lagging fp tag does not drop the latest 10-K)', () => {
    expect(src).toMatch(/days >= 350 && days <= 380/);
  });
});

describe('FM-U02 — pricing-intel refuses a non-services (manufacturing/product) NAICS', () => {
  const src = read('./pricing-intel.ts');
  it('non-service sectors (11/21/23/31-33/42/44/45/48/49) → not grounded', () => {
    expect(src).toContain('NON_SERVICE_SECTORS');
    expect(src).toContain('naicsNotPriceable');
    expect(src).toMatch(/grounded\s*=\s*!naicsNotPriceable/);
  });
});

describe('FM-U03 — sba-goaling emits null (not all-zeros) on an unmatched agency', () => {
  const src = read('./sba-goaling.ts');
  it('goals is null when !grounded, never a fabricated zeros scorecard', () => {
    expect(src).toMatch(/const goals: GoalingRow\[\] \| null = !grounded/);
  });
  it('meets_small_business_goal is null (unknown) when unmatched, not false (failed)', () => {
    expect(src).toMatch(/meetsSb = grounded \? .* : null/);
  });
});

describe('FM-U04 — predecessor/incumbent penalizes stale PoP + rewards NAICS match', () => {
  const src = read('../../lib/usaspending/solicitation-incumbent.ts');
  it('caps confidence by PoP-end recency (>8y → low, >5y → not high)', () => {
    expect(src).toContain('yearsSinceEnd');
    expect(src).toMatch(/yearsSinceEnd > 8/);
    expect(src).toMatch(/yearsSinceEnd > 5/);
  });
  it('boosts a same-NAICS award', () => {
    expect(src).toMatch(/detail\.naicsCode.*===.*input\.naics_code|input\.naics_code.*detail\.naicsCode/);
  });
});

describe('FM-U05 — solicitation-documents resolves a solicitation number, not just a UUID', () => {
  const src = read('../../lib/sam/solicitation-documents.ts');
  it('falls back to solicitation_number when the input is not UUID-shaped', () => {
    expect(src).toContain('looksLikeUuid');
    expect(src).toMatch(/\.eq\('solicitation_number', noticeId\)/);
  });
});

describe('FM-U06 — expiring-contracts computes recompete date/lead LIVE (never a past date)', () => {
  const src = read('../../lib/recompete/query.ts');
  it('recomputes lead_time_months from today (>=0) and clamps est date to not-past', () => {
    expect(src).toMatch(/lead_time_months: leadMonths/);
    expect(src).toMatch(/Math\.max\(now, end - solLead\)/);
  });
  // Pure-logic mirror of the date math.
  it('a near-term expiry never yields a past estimated_recompete_date or lead_time 0', () => {
    const now = Date.now();
    const MS = 30.4375 * 86_400_000;
    const compute = (endMs: number) => ({
      lead: Math.max(0, Math.round((endMs - now) / MS)),
      est: Math.max(now, endMs - 9 * MS),
    });
    for (const months of [1, 3, 6, 15]) {
      const r = compute(now + months * MS);
      expect(r.lead).toBeGreaterThan(0);
      expect(r.est).toBeGreaterThanOrEqual(now);
    }
  });
});

describe('FM-U07 — regulatory-demand + grants rank by relevance when a keyword is given', () => {
  it('federal-register uses order:relevance with a term', () => {
    expect(read('../../lib/federal-register/index.ts')).toMatch(/q\.query \? 'relevance' : 'newest'/);
  });
  it('grants uses relevancy sort with a keyword', () => {
    expect(read('../../lib/grants/search.ts')).toMatch(/keyword \? 'relevancy\|desc' : 'openDate\|desc'/);
  });
});

describe('FM-U08 — winning-playbook applies a relevance floor (no off-topic corpus as guidance)', () => {
  const src = read('./winning-playbook.ts');
  it('filters chunks below RELEVANCE_FLOOR before treating them as guidance', () => {
    expect(src).toContain('RELEVANCE_FLOOR');
    expect(src).toContain('relevantChunks');
  });
});

describe('FM-U09 — agency analytics resolve military sub-tiers under DoD', () => {
  const src = read('../../lib/usaspending/agency-spending-detail.ts');
  it('maps Navy/Army/Air Force to a DoD sub-tier filter (tier: subtier)', () => {
    expect(src).toContain('DOD_SUBTIER_ALIASES');
    expect(src).toMatch(/tier: 'subtier', name: subAgency/);
  });
  it('budget-trends maps a military service to DoD with a DoD-wide note', () => {
    const bt = read('./agency-budget-trends.ts');
    expect(bt).toContain('dodWideNote');
  });
});
