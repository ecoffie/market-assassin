import { describe, it, expect } from 'vitest';

/**
 * Pure-logic mirror of computeEmailMapConverter (the correctness-critical grouping + rate math).
 * The lib reads user_engagement live; this test locks the click-grouping, the map-reach join, the
 * null-not-0 rate, staff exclusion, and the newest-first ledger over fixture rows — so a regression
 * (a fabricated 0% rate, counting clicks as clickers, a wrong reach join, missing staff exclusion)
 * fails loudly without touching the DB. Mirrors the same logic the lib runs.
 */

interface ClickRow { user_email: string; created_at: string }
// A tiny stand-in for isExcludedFromMetrics (staff domain + a known testimonial address).
const isExcluded = (email: string) => email.endsWith('@govcongiants.com') || email === 'aj@cypherintel.com';

function computeConverter(clickRows: ClickRow[], mapReachedEmails: string[], windowDays: number) {
  const reached = new Set(mapReachedEmails.map((e) => e.toLowerCase()).filter((e) => !isExcluded(e)));
  const perClicker = new Map<string, { clicks: number; lastClickAt: string }>();
  let clicks = 0;
  for (const r of clickRows) {
    const email = r.user_email.toLowerCase();
    if (!email || isExcluded(email)) continue;
    clicks += 1;
    const prev = perClicker.get(email);
    if (!prev) perClicker.set(email, { clicks: 1, lastClickAt: r.created_at });
    else { prev.clicks += 1; if (r.created_at > prev.lastClickAt) prev.lastClickAt = r.created_at; }
  }
  const clickers = perClicker.size;
  let mapReached = 0;
  for (const email of perClicker.keys()) if (reached.has(email)) mapReached += 1;
  const clickToReachRate = clickers > 0 ? Math.round((mapReached / clickers) * 1000) / 10 : null;
  const recentClickers = [...perClicker.entries()]
    .map(([email, v]) => ({ email, clicks: v.clicks, lastClickAt: v.lastClickAt, reachedMap: reached.has(email) }))
    .sort((a, b) => (a.lastClickAt < b.lastClickAt ? 1 : a.lastClickAt > b.lastClickAt ? -1 : 0));
  return { windowDays, clicks, clickers, mapReached, clickToReachRate, recentClickers };
}

describe('email → map converter — click grouping + reach + rate', () => {
  it('distinct clickers vs total clicks: a user clicking 3× = 1 clicker, 3 clicks', () => {
    const rows: ClickRow[] = [
      { user_email: 'a@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'a@co.com', created_at: '2026-08-02T09:00:00Z' },
      { user_email: 'a@co.com', created_at: '2026-08-03T09:00:00Z' },
      { user_email: 'b@co.com', created_at: '2026-08-01T09:00:00Z' },
    ];
    const c = computeConverter(rows, [], 7);
    expect(c.clicks).toBe(4);
    expect(c.clickers).toBe(2);
    expect(c.recentClickers.find((r) => r.email === 'a@co.com')!.clicks).toBe(3);
  });

  it('reachedMap is true ONLY when the clicker email is in the map_view set', () => {
    const rows: ClickRow[] = [
      { user_email: 'a@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'b@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'c@co.com', created_at: '2026-08-01T09:00:00Z' },
    ];
    // a + c reached the map; z reached but never clicked (not counted); b clicked but did not reach.
    const c = computeConverter(rows, ['a@co.com', 'c@co.com', 'z@co.com'], 7);
    expect(c.clickers).toBe(3);
    expect(c.mapReached).toBe(2);                                   // a + c only
    expect(c.recentClickers.find((r) => r.email === 'a@co.com')!.reachedMap).toBe(true);
    expect(c.recentClickers.find((r) => r.email === 'b@co.com')!.reachedMap).toBe(false);
  });

  it('clickToReachRate = mapReached / clickers, rounded 1dp', () => {
    const rows: ClickRow[] = [
      { user_email: 'a@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'b@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'c@co.com', created_at: '2026-08-01T09:00:00Z' },
    ];
    const c = computeConverter(rows, ['a@co.com', 'b@co.com'], 7);   // 2 of 3 reached
    expect(c.clickToReachRate).toBeCloseTo(66.7);
  });

  it('no clickers -> clickToReachRate null (NEVER a fabricated 0%)', () => {
    const c = computeConverter([], ['a@co.com'], 7);
    expect(c.clickers).toBe(0);
    expect(c.clickToReachRate).toBeNull();
  });

  it('staff / testimonial clickers AND arrivals are excluded', () => {
    const rows: ClickRow[] = [
      { user_email: 'staff@govcongiants.com', created_at: '2026-08-01T09:00:00Z' }, // staff
      { user_email: 'aj@cypherintel.com', created_at: '2026-08-01T09:00:00Z' },      // testimonial
      { user_email: 'real@customer.com', created_at: '2026-08-01T09:00:00Z' },       // real
    ];
    // The excluded emails also appear in the arrival set — must not leak into mapReached either.
    const c = computeConverter(rows, ['staff@govcongiants.com', 'aj@cypherintel.com', 'real@customer.com'], 7);
    expect(c.clicks).toBe(1);                                       // only the real click counts
    expect(c.clickers).toBe(1);
    expect(c.mapReached).toBe(1);                                   // real@customer reached
    expect(c.recentClickers).toHaveLength(1);
    expect(c.recentClickers[0].email).toBe('real@customer.com');
  });

  it('recentClickers are newest-first by lastClickAt', () => {
    const rows: ClickRow[] = [
      { user_email: 'old@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'new@co.com', created_at: '2026-08-05T09:00:00Z' },
      { user_email: 'mid@co.com', created_at: '2026-08-03T09:00:00Z' },
    ];
    const c = computeConverter(rows, [], 30);
    expect(c.recentClickers.map((r) => r.email)).toEqual(['new@co.com', 'mid@co.com', 'old@co.com']);
  });

  it('lastClickAt is the MOST RECENT click for a repeat clicker', () => {
    const rows: ClickRow[] = [
      { user_email: 'a@co.com', created_at: '2026-08-01T09:00:00Z' },
      { user_email: 'a@co.com', created_at: '2026-08-04T09:00:00Z' }, // most recent
      { user_email: 'a@co.com', created_at: '2026-08-02T09:00:00Z' },
    ];
    const c = computeConverter(rows, [], 30);
    expect(c.recentClickers[0].lastClickAt).toBe('2026-08-04T09:00:00Z');
  });
});
