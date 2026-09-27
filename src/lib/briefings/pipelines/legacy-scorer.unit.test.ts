import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { CASE_ROWS, CASE_SENT_AT, asOpportunity } from '@/lib/alerts/__fixtures__/alert-relevance-case';
import { LEGACY_PROFILES, legacyCorpus } from './__fixtures__/legacy-scorer-corpus';

/**
 * The callers that were NOT migrated (weekly-alerts, send-notifications, diff-engine,
 * trigger-alerts, and every non-daily fetch caller) must behave exactly as on main.
 *
 * GOLDEN values below were produced by running main's `scoreOpportunity` (origin/main
 * sam-gov.ts, commit before #1717) over this corpus with the clock pinned to CASE_SENT_AT.
 * If this fails, the shared change leaked into callers it must not touch.
 */
const GOLDEN: Record<keyof typeof LEGACY_PROFILES, number[]> = {
  aiFirm: [100, 100, 100, 80, 100, 100, 100, 65, 75, 65, 100, 100, 100, 100, 100, 100, 100, 100, 35],
  noKeywords: [90, 85, 95, 55, 100, 95, 85, 40, 50, 40, 100, 85, 100, 95, 45, 90, 55, 95, 35],
  wosbWithDescription: [81, 45, 31, 35, 100, 31, 46, 20, 30, 51, 10, 100, 46, 66, 21, 81, 100, 100, 5],
  nonVeteran: [20, 15, 95, 15, 30, 95, 15, 0, 10, 0, 55, 15, 25, 45, 0, 20, 5, 25, 35],
  bare: [20, 15, 15, 15, 20, 15, 15, 0, 10, 0, 0, 15, 0, 5, 0, 20, 5, 15, 5],
};

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(CASE_SENT_AT)); });
afterAll(() => { vi.useRealTimers(); });

describe('legacy scoreOpportunity is unchanged from main', () => {
  const rows = () => legacyCorpus(CASE_ROWS.map(asOpportunity));

  for (const name of Object.keys(GOLDEN) as (keyof typeof GOLDEN)[]) {
    it(`${name}: every score equals main's — so every ordering does too`, async () => {
      const { scoreOpportunity } = await import('./sam-gov');
      const got = rows().map((r) => scoreOpportunity(r, LEGACY_PROFILES[name]));
      expect(got).toEqual(GOLDEN[name]);
      const order = (scores: number[]) => scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.i);
      expect(order(got)).toEqual(order(GOLDEN[name]));
    });
  }
});

describe('only daily alerts use the new ranking and the full-market scan', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  const LEGACY_SCORER_CALLERS = [
    'src/app/api/cron/weekly-alerts/route.ts',
    'src/app/api/cron/send-notifications/route.ts',
    'src/lib/briefings/diff-engine.ts',
    'src/app/api/admin/trigger-alerts/route.ts',
  ];
  const FETCH_CALLERS = [
    ...LEGACY_SCORER_CALLERS.slice(0, 1),
    'src/app/api/cron/send-briefings-fast/route.ts',
    'src/app/api/app/market-dossier/route.ts',
    'src/app/api/alerts/save-profile/route.ts',
    'src/app/api/admin/send-all-briefings/route.ts',
    'src/app/api/admin/trigger-catchup-briefings/route.ts',
    'src/app/api/admin/test-sam-cache/route.ts',
  ];

  it('the non-migrated callers still call the legacy scoreOpportunity, not the evidence scorer', () => {
    for (const f of LEGACY_SCORER_CALLERS) {
      const src = read(f);
      expect(src, f).toMatch(/scoreOpportunity\(/);
      expect(src, f).not.toMatch(/scoreOpportunityDetailed/);
    }
  });

  it('no caller other than daily-alerts opts into the full-market keyword scan', () => {
    for (const f of FETCH_CALLERS) expect(read(f), f).not.toMatch(/fullMarketKeywordScan/);
    expect(read('src/app/api/cron/daily-alerts/route.ts')).toMatch(/fullMarketKeywordScan: true/);
    expect(read('src/app/api/cron/daily-alerts/route.ts')).toMatch(/scoreOpportunityDetailed\(/);
  });
});
