/**
 * computeTodaysLens must report the EXACT NAICS codes its counts used — the map link carries them.
 * Supabase is mocked with a recording query builder: the NAICS clause every count used is captured
 * and compared with lens.lensNaics, so the two cannot disagree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let profileCodes: string[] | null = null;
const orClauses: string[] = [];

function builder(table: string) {
  type Q = Record<string, (...a: never[]) => unknown>;
  const q: Q = {
    select: () => q, eq: () => q, gt: () => q, not: () => q, overlaps: () => q, contains: () => q,
    or: (c: string) => { orClauses.push(c); return q; },
    maybeSingle: async () => ({ data: profileCodes === null ? null : { naics_codes: profileCodes }, error: null }),
    then: (res: (v: unknown) => unknown) => res({ count: table === 'sam_opportunities' ? 5 : 0, error: null }),
  };
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

const { computeTodaysLens } = await import('./todays-lens');

beforeEach(() => { orClauses.length = 0; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://t.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

const codesIn = (clause: string) => clause.split(',').map((c) => c.replace(/^naics_code\.(eq|like)\./, '').replace(/%$/, ''));

describe('computeTodaysLens → lensNaics', () => {
  it('profile codes: lensNaics equals the codes every count was scoped to', async () => {
    profileCodes = ['236220', '541330', '238'];
    const lens = await computeTodaysLens('jb@example.com');
    expect(lens.lensNaics).toEqual(['236220', '541330', '238']);
    expect(orClauses.length).toBeGreaterThan(1);
    for (const c of orClauses) expect(codesIn(c)).toEqual(lens.lensNaics);
    expect(lens.lensCount).toBe(5);
  });

  it('no profile codes: lensNaics is the fallback set the counts used (so the link carries the defaults)', async () => {
    profileCodes = null;
    const lens = await computeTodaysLens('new@example.com');
    expect(lens.usingFallback).toBe(true);
    expect(lens.lensNaics).toEqual(['541512', '541611', '541330', '541990', '561210']);
    for (const c of orClauses) expect(codesIn(c)).toEqual(lens.lensNaics);
  });
});

describe('both surfaces build the lens link with the shared helper', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('daily alert email', () => {
    const src = read('src/lib/alerts/todays-lens-email.ts');
    expect(src).toContain("todaysLensMapPath(lens, { src: 'alert', sentOn: opts?.sentOn })");
    expect(src).not.toMatch(/opportunity-map\?strategy=\$\{encodeURIComponent\(lens\.lensStrategy\)\}&src=alert/);
  });
  it('daily-alerts cron passes the send date', () => {
    expect(read('src/app/api/cron/daily-alerts/route.ts')).toMatch(/renderTodaysLensEmailBlock\(todaysLens, MINDY_SITE_URL, trackedUrl, \{ sentOn: new Date\(\)\.toISOString\(\)\.slice\(0, 10\) \}\)/);
  });
  it("Today's Intel hero", () => {
    const src = read('src/components/app/panels/TodaysLensHero.tsx');
    expect(src).toContain("{ src: 'todays_intel' }");
    expect(src).toContain('todaysLensMapPath(');
    expect(src).not.toMatch(/`\/opportunity-map\?strategy=\$\{encodeURIComponent\(data\.lensStrategy\)\}`/);
  });
  it('the hero API returns the scope the link needs', () => {
    const src = read('src/app/api/app/todays-lens/route.ts');
    expect(src).toContain('lensNaics: lens.lensNaics');
    expect(src).toContain('lensCount: lens.lensCount');
  });
});
