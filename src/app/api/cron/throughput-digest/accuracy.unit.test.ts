/**
 * Guards the throughput digest's own accuracy.
 *
 * THE IRONY (2026-08-04): this monitor exists to catch pipelines that "succeed" while
 * delivering a fraction of their output — and then did exactly that itself. It reported
 *
 *     Alert coverage 63% — 1,000 of 1,596 daily-alert users processed today
 *
 * Both halves were wrong, in opposite directions:
 *   · the numerator 1,000 was the PostgREST row cap, not a count (real: 1,433)
 *   · the denominator counted 277 profiles with no NAICS, keywords or agencies —
 *     users daily-alerts deliberately skips as unmatchable
 * True coverage that day was 100% (1,318 of 1,321). It cried wolf on a healthy
 * pipeline, which is the fastest way to teach people to ignore a monitor.
 *
 * The same day it correctly caught the real SAM outage (4% → 100% after the fix), so
 * the fix here is accuracy, not distrust: keep the check, remove the false positives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/throughput-digest/route.ts'),
  'utf8'
);

// Mirrors the coverage arithmetic.
type Profile = { user_email: string; naics_codes?: string[] | null; keywords?: string[] | null; agencies?: string[] | null };
const targetable = (u: Profile) =>
  (u.naics_codes?.length || 0) > 0 || (u.keywords?.length || 0) > 0 || (u.agencies?.length || 0) > 0;

function coverage(eligible: Profile[], alerted: string[]) {
  const t = eligible.filter(targetable);
  const emails = new Set(t.map(u => u.user_email));
  const processed = new Set(alerted.filter(e => emails.has(e))).size;
  return { processed, total: t.length, unmatchable: eligible.length - t.length,
           pct: t.length > 0 ? Math.round((processed / t.length) * 100) : null };
}

describe('coverage arithmetic', () => {
  it('excludes unmatchable profiles from the denominator', () => {
    // The 2026-08-04 shape: 1,598 daily, 277 of them unmatchable, 1,318 alerted.
    const eligible: Profile[] = [
      ...Array.from({ length: 1321 }, (_, i) => ({ user_email: `t${i}@x.com`, naics_codes: ['541512'] })),
      ...Array.from({ length: 277 }, (_, i) => ({ user_email: `u${i}@x.com`, naics_codes: [], keywords: [], agencies: [] })),
    ];
    const alerted = Array.from({ length: 1318 }, (_, i) => `t${i}@x.com`);
    const r = coverage(eligible, alerted);
    expect(r.total).toBe(1321);        // NOT 1598
    expect(r.unmatchable).toBe(277);
    expect(r.pct).toBe(100);           // the old maths said 63%
  });

  it('a user with only keywords is targetable — NAICS is not required', () => {
    // daily-alerts ORs keywords with NAICS, so keyword-only users do get mailed.
    expect(targetable({ user_email: 'a@x.com', keywords: ['drone'] })).toBe(true);
    expect(targetable({ user_email: 'b@x.com', agencies: ['DHS'] })).toBe(true);
    expect(targetable({ user_email: 'c@x.com', naics_codes: [], keywords: [], agencies: [] })).toBe(false);
    expect(targetable({ user_email: 'd@x.com' })).toBe(false);
  });

  it('cannot report above 100% when a stray alert lands outside the cohort', () => {
    const eligible: Profile[] = [{ user_email: 'a@x.com', naics_codes: ['541512'] }];
    const r = coverage(eligible, ['a@x.com', 'weekly-user@x.com', 'someone-else@x.com']);
    expect(r.processed).toBe(1);
    expect(r.pct).toBe(100);
  });

  it('an empty eligible list is UNKNOWN, never 100%', () => {
    // 0/0 = "100% covered" is a green light for a completely dead pipeline.
    expect(coverage([], []).pct).toBeNull();
  });
});

describe('synthetic accounts are not customer-facing orphans', () => {
  const isSynthetic = (e: string) => /@test\.|^healthcheck-|@example\./i.test(e);

  it('ignores the accounts this repo creates itself', () => {
    // 171 of 586 orphans on 2026-08-04 — a ~40% inflation of the actionable number.
    expect(isSynthetic('healthcheck-1783008019192@test.govcongiants.com')).toBe(true);
    expect(isSynthetic('probe@example.test')).toBe(true);
    expect(isSynthetic('someone@test.govcongiants.com')).toBe(true);
  });

  it('keeps real users, including lookalike domains', () => {
    expect(isSynthetic('frontdesk@ssupportsolutions.com')).toBe(false);
    expect(isSynthetic('duaso@arcadiastructura.com')).toBe(false);
    expect(isSynthetic('contact@protest-consulting.com')).toBe(false); // contains "test"
  });
});

describe('the route pages every list read', () => {
  it('has a shared paging helper', () => {
    expect(SRC).toContain('async function fetchAllRows');
  });

  it('routes all four list-shaped reads through it', () => {
    // alert_log, eligible profiles, briefings_enabled profiles, classifications.
    expect(SRC.match(/fetchAllRows</g)?.length ?? 0).toBeGreaterThanOrEqual(5); // 1 decl + 4 calls
  });

  it('no list select is left un-ranged', () => {
    // A .select() that fetches rows must be followed by .range() before its await.
    // Counts and .limit(1) reads are exempt — they do not truncate.
    const listSelects = SRC.split('\n').filter(l =>
      l.includes(".select('") && !l.includes('count:') && !l.includes('head: true'));
    for (const line of listSelects) {
      const idx = SRC.indexOf(line);
      const window = SRC.slice(idx, idx + 420);
      expect(window, `un-paged list select: ${line.trim()}`).toMatch(/\.range\(|\.limit\(1\)/);
    }
  });

  it('names the excluded cohort in the message', () => {
    // A denominator that silently shrinks hides the opposite bug.
    expect(SRC).toContain('unmatchable by design');
    expect(SRC).toContain('test/healthcheck accounts ignored');
  });
});
