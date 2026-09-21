/**
 * Per-source advancement. Fixtures are the REAL production values measured
 * 2026-09-20, so these pin the actual masking defect.
 */
import { describe, it, expect, vi } from 'vitest';
import { getResearchSourceAdvancement, needsIntervention, corpusHeadline } from './specialty-advancement';

const ADV = [
  { source: 'nih_reporter', rows_held: 1416, last_scraped_at: '2026-09-14T04:00:00Z', latest_source_date: '2026-09-12', days_since_scrape: 6, advancement_state: 'content_stale' },
  { source: 'grants_gov',   rows_held: 63,   last_scraped_at: '2026-04-12T04:00:00Z', latest_source_date: '2026-04-10', days_since_scrape: 161, advancement_state: 'dormant' },
  { source: 'darpa_baa',    rows_held: 6,    last_scraped_at: '2026-04-05T04:00:00Z', latest_source_date: '2026-04-01', days_since_scrape: 168, advancement_state: 'dormant' },
];
// nsf_sbir is ABSENT from the table entirely — it has never written a row.
const EXPECTED = [
  { source: 'nih_reporter', rows_held: 1416, ever_advanced: true },
  { source: 'grants_gov',   rows_held: 63,   ever_advanced: true },
  { source: 'darpa_baa',    rows_held: 6,    ever_advanced: true },
  { source: 'nsf_sbir',     rows_held: 0,    ever_advanced: false },
];

const db = (adv = ADV, exp = EXPECTED) =>
  ({ rpc: vi.fn(async (fn: string) => ({ data: fn === 'research_source_advancement' ? adv : exp, error: null })) }) as never;

describe('a configured-but-silent source cannot hide', () => {
  it('nsf_sbir appears even though it is absent from the table', async () => {
    const rows = await getResearchSourceAdvancement(db());
    const nsf = rows.find((r) => r.source === 'nsf_sbir');
    expect(nsf).toBeDefined();
    expect(nsf!.state).toBe('never_advanced');
    expect(nsf!.rowsHeld).toBe(0);
    expect(nsf!.lastScrapedAt).toBeNull();
  });

  it('never_advanced is NOT reported as zero-days-stale', async () => {
    const rows = await getResearchSourceAdvancement(db());
    expect(rows.find((r) => r.source === 'nsf_sbir')!.daysSinceScrape).toBeNull();
  });
});

describe('a healthy busiest source must not mask dead ones', () => {
  it('the corpus is NOT healthy while 3 of 4 sources are dead', async () => {
    const h = corpusHeadline(await getResearchSourceAdvancement(db()));
    expect(h.healthy).toBe(false);
    expect(h.total).toBe(4);
    expect(h.dead).toBe(3);
    expect(h.summary).toContain('nsf_sbir:never_advanced');
    expect(h.summary).toContain('darpa_baa:dormant');
  });

  it('intervention list names dormant AND never-advanced sources', async () => {
    const need = needsIntervention(await getResearchSourceAdvancement(db()));
    expect(new Set(need.map((r) => r.source))).toEqual(new Set(['grants_gov', 'darpa_baa', 'nsf_sbir']));
  });

  it('only an all-advancing corpus reports healthy', async () => {
    const allGood = ADV.map((r) => ({ ...r, advancement_state: 'current', days_since_scrape: 1 }));
    const h = corpusHeadline(await getResearchSourceAdvancement(db(allGood, EXPECTED.slice(0, 3))));
    expect(h.healthy).toBe(true);
    expect(h.summary).toBe('3/3 sources advancing');
  });
});

describe('unknown state degrades safely', () => {
  it('an unrecognised state becomes never_advanced, never current', async () => {
    const weird = [{ ...ADV[0], advancement_state: 'probably_fine' }];
    const rows = await getResearchSourceAdvancement(db(weird, EXPECTED.slice(0, 1)));
    expect(rows[0].state).toBe('never_advanced');
  });
});

describe('errors surface, never become empty', () => {
  it('an RPC error throws instead of reporting zero sources', async () => {
    const bad = { rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) } as never;
    await expect(getResearchSourceAdvancement(bad)).rejects.toThrow(/boom/);
  });
});
