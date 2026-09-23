/**
 * NON-REGRESSION PIN (IMI test, 2026-09-22 — case 8).
 *
 * get_contractor_profile for Industrial Mechanical Inc. (UEI M66AH329AJM6) found an award the manual
 * USAspending search missed: a 2017 FDA dust collector ($149,633, HHSF223201710177C). The manual run
 * dropped it because its search excluded contract vehicles (the award id is CONT_IDV_…). This pins
 * that get_contractor_profile keeps returning it — an IDV-typed award id, a 2017 action date, and a
 * null place-of-performance state must not filter it out of recent_awards.
 *
 * HERMETIC: the award rows are the frozen BigQuery result-cache value for IMI
 * (src/lib/opportunities/__fixtures__/imi-find/imi-recent-awards.json, captured read-only).
 * The rollup PROFILE row in the mock is derived from those awards (sum / count / dates), not captured.
 */
import { describe, it, expect, vi } from 'vitest';
import awardsFx from '../opportunities/__fixtures__/imi-find/imi-recent-awards.json';
import { makeTier2Tools } from './tier2-tools';

vi.mock('@/lib/bigquery/cache', () => ({ bqUnavailable: () => false }));
vi.mock('@/lib/awards-ingest/read-warehouse-coverage', () => ({ loadAwardsWarehouseCoverage: vi.fn(async () => null) }));
vi.mock('@/lib/contractor/name-resolution', () => ({ resolveAwardCorpusByName: vi.fn(async () => ({ status: 'none', searched: '' })) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, limit: 12, resetAt: 0 })) }));

const AWARDS = awardsFx.data as Array<Record<string, unknown>>;
const sum = AWARDS.reduce((a, r) => a + Number(r.obligation_amount || 0), 0);

vi.mock('@/lib/bigquery/recipients', () => ({
  recipientSlug: (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  resolveCanonicalSlug: vi.fn(async () => null),
  getRollupOrSingleBySlug: vi.fn(async (slug: string) => (slug.startsWith('industrial-mechanical-inc')
    ? {
        rollup_uei: 'M66AH329AJM6', rollup_name: 'INDUSTRIAL MECHANICAL INC', child_ueis: ['M66AH329AJM6'],
        city: 'WATKINSVILLE', state: 'GA', total_obligated: sum, award_count: AWARDS.length,
        distinct_agency_count: 2, first_action_date: '2017-09-08', last_action_date: '2026-07-08',
      }
    : null)),
  getRecipientByUei: vi.fn(async () => null),
  getRecentAwardsForRecipient: vi.fn(async () => AWARDS),
  getTopAgenciesForRecipient: vi.fn(async () => []),
  getYearlyTotalsForRecipient: vi.fn(async () => []),
  getSetAsideHistoryForRecipient: vi.fn(async () => []),
  findCapableSmallBusinesses: vi.fn(async () => ({ rows: [], total: 0 })),
}));

describe('get_contractor_profile — IMI award history pin', () => {
  it('the frozen fixture holds the 2017 FDA dust-collector award', () => {
    const fda = AWARDS.find((r) => r.piid === 'HHSF223201710177C');
    expect(fda).toMatchObject({ obligation_amount: 149633, action_date: '2017-09-08', awarding_agency: 'Department of Health and Human Services' });
    expect(String(fda?.description)).toMatch(/DUST COLLECTOR/);
  });

  it('get_contractor_profile("Industrial Mechanical Inc") still returns it in recent_awards', async () => {
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Industrial Mechanical Inc' }) as {
      found: boolean;
      recent_awards: Array<Record<string, unknown>>;
    };
    expect(res.found).toBe(true);
    expect(res.recent_awards).toHaveLength(3);
    const fda = res.recent_awards.find((a) => a.piid === 'HHSF223201710177C');
    expect(fda).toBeDefined();
    expect(fda).toMatchObject({
      award_id: 'CONT_IDV_HHSF223201710177C_7524',
      obligation_amount: 149633,
      action_date: '2017-09-08',
      awarding_office: 'FDA OFFICE OF ACQ  GRANT SVCS',
    });
    expect(String(fda?.description)).toMatch(/DUST COLLECTOR/);
  });
});
