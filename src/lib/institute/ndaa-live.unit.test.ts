/**
 * POTETO — NDAA Legislative Intelligence Live.
 *   DISCOVER → CLASSIFY → INGEST → PROVENANCE → CORRECT → FRESHNESS → SCHEDULE
 *
 * Hermetic: no Congress, no database. Pins (a) fiscal-year-independent discovery,
 * (b) per-version legal status that never lets proposed or superseded text read as
 * law, and (c) a run-level state that reports the CURRENT authorization.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { discoverSince } from './legislation-discovery';
import {
  billVersionsToDocuments,
  lawStatusAtIngestion,
  legislativeStage,
  matchesSubject,
  measureRole,
  NDAA_TITLE_PATTERN,
} from './legislation';
import { fiscalYearStates } from '@/app/api/cron/institute-legislation-sync/route';

function feed(bills: Array<{ congress: number; type: string; number: string; title: string }>, opts: { fail?: boolean } = {}) {
  return (async (u: string) => {
    if (opts.fail) return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) } as unknown as Response;
    const url = new URL(u);
    const limit = Number(url.searchParams.get('limit') ?? 250);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const rows = bills.map((b) => ({ ...b, updateDate: '2027-06-01', originChamber: b.type === 'S' ? 'Senate' : 'House' }));
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ bills: rows.slice(offset, offset + limit), pagination: { count: rows.length } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// ── FY28 FORWARD: a future NDAA the source code has never heard of ─────────────
describe('discovery is fiscal-year and bill-number independent', () => {
  const unrelated = Array.from({ length: 900 }, (_, i) => ({ congress: 120, type: 'HR', number: String(100 + i), title: `An unrelated measure ${i}` }));
  const future = { congress: 120, type: 'HR', number: '1234', title: 'National Defense Authorization Act for Fiscal Year 2028' };

  it('finds an unknown FY2028 NDAA under an unknown bill number in the next Congress', async () => {
    const bills = [...unrelated.slice(0, 700), future, ...unrelated.slice(700)];
    const res = await discoverSince({ congress: 120, since: null, fetchImpl: feed(bills), maxPages: 10, budgetMs: 10_000 });
    expect(res.coverage).toBe('complete');
    expect(res.matched.map((m) => `${m.billType ?? (m as { type?: string }).type}${m.number}`)).toContain('HR1234');
  });

  it('classifies it as the FY2028 authorization vehicle — year read from the title, not a constant', () => {
    expect(matchesSubject(future, NDAA_TITLE_PATTERN)).toBe(true);
    expect(measureRole(future.title)).toBe('authorization_vehicle');
    const [doc] = billVersionsToDocuments(
      { congress: 120, billType: 'HR', number: '1234', title: future.title, updateDate: null, originChamber: 'House' },
      [{ type: 'Introduced in House', date: '2027-05-01', formats: [] }],
      { latestActionDate: null, latestActionText: null, becameLaw: false, lawNumber: null },
      '2027-05-02T00:00:00Z',
    );
    expect(doc.raw).toMatchObject({ fiscalYear: 2028, measureRole: 'authorization_vehicle', legislativeStage: 'introduced', lawStatusAtIngestion: 'not_enacted' });
    expect(doc.documentNumber).toBe('120-HR1234-IH');
  });

  it('the discovery + classification path does not depend on any specific bill number or fiscal year', () => {
    const files = ['src/lib/institute/legislation-discovery.ts', 'src/lib/institute/legislation.ts', 'src/app/api/cron/institute-legislation-sync/route.ts'];
    for (const f of files) {
      const code = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1'); // comments may cite history; code may not
      for (const lit of ['8800', '4784', '2296', '2027', '1071']) {
        expect(code.includes(lit), `${f} hard-codes ${lit}`).toBe(false);
      }
    }
  });
});

// ── PROVENANCE: the legal weight of each VERSION ────────────────────────────────
describe('per-version legal status never lets proposed or superseded text read as law', () => {
  it.each([
    // [versionCode, measureBecameLaw, stage, lawStatus]
    ['IS', true, 'introduced', 'superseded_by_enactment'],       // S.1071 as introduced: NOT law
    ['ES', true, 'passed_chamber', 'superseded_by_enactment'],
    ['EAH', true, 'passed_chamber', 'superseded_by_enactment'],
    ['ENR', true, 'enrolled', 'enacted'],                       // the signed text
    ['PUBLIC-LAW', true, 'enacted', 'enacted'],
    ['RS', false, 'reported', 'not_enacted'],                    // S.2296 — never law
    ['ES', false, 'passed_chamber', 'not_enacted'],
    ['EH', false, 'passed_chamber', 'not_enacted'],              // H.R. 8800 passed the House
    ['CPS', false, 'passed_chamber', 'not_enacted'],
    ['PP', false, 'other', 'not_enacted'],
  ] as const)('%s (measure became law: %s) → %s / %s', (code, law, stage, status) => {
    expect(legislativeStage(code, law)).toBe(stage);
    expect(lawStatusAtIngestion(legislativeStage(code, law), law)).toBe(status);
  });

  it('an introduced version of a bill that became law carries the MEASURE fact but is not itself law', () => {
    const docs = billVersionsToDocuments(
      { congress: 119, billType: 'S', number: '9', title: 'National Defense Authorization Act for Fiscal Year 2026', updateDate: null, originChamber: 'Senate' },
      [{ type: 'Introduced in Senate', date: '2025-03-14', formats: [] }, { type: 'Public Law', date: '2025-12-19', formats: [] }],
      { latestActionDate: '2025-12-18', latestActionText: 'Became Public Law No: 119-60.', becameLaw: true, lawNumber: '119-60' },
      '2026-09-22T00:00:00Z',
    );
    const introduced = docs.find((d) => d.documentNumber.endsWith('-IS'))!;
    const law = docs.find((d) => d.documentNumber.endsWith('-PUBLIC-LAW'))!;
    expect(introduced.sourceType).toBe('introduced_bill');
    expect(introduced.raw).toMatchObject({ becameLaw: true, lawStatusAtIngestion: 'superseded_by_enactment', legislativeStage: 'introduced' });
    expect(law.sourceType).toBe('enacted_law');
    expect(law.raw).toMatchObject({ lawStatusAtIngestion: 'enacted', lawNumber: '119-60' });
  });
});

// ── CLASSIFY: vehicle vs a bill that amends an old act ──────────────────────────
describe('measureRole: an amending bill is not that year\'s NDAA', () => {
  it.each([
    ['National Defense Authorization Act for Fiscal Year 2027', 'authorization_vehicle'],
    ['Streamlining Procurement for Effective Execution and Delivery and National Defense Authorization Act for Fiscal Year 2026', 'authorization_vehicle'],
    ['To amend title 10, United States Code, and the National Defense Authorization Act for Fiscal Year 1994, to codify and clarify gender neutral standards', 'amends_prior_act'],
    ['A bill to make technical corrections to the National Defense Authorization Act for Fiscal Year 2026.', 'amends_prior_act'],
    ['To amend the National Defense Authorization Act for Fiscal Year 2000 to modify and extend the annual report', 'amends_prior_act'],
  ])('%s → %s', (title, role) => expect(measureRole(title)).toBe(role));

  it('an amending bill records the year it AMENDS, never as its fiscal year', () => {
    const [doc] = billVersionsToDocuments(
      { congress: 119, billType: 'HR', number: '8175', title: 'To amend title 10, United States Code, and the National Defense Authorization Act for Fiscal Year 1994, to codify gender neutral standards', updateDate: null, originChamber: 'House' },
      [{ type: 'Introduced in House', date: '2026-04-02', formats: [] }],
      { latestActionDate: null, latestActionText: null, becameLaw: false, lawNumber: null },
      '2026-09-22T00:00:00Z',
    );
    expect(doc.raw).toMatchObject({ fiscalYear: null, amendsFiscalYear: 1994, measureRole: 'amends_prior_act' });
  });
});

// ── the run-level state is the CURRENT authorization's ──────────────────────────
describe('fiscalYearStates — the headline never borrows a prior year\'s enactment', () => {
  it('REGRESSION 2026-09-22: FY2026 enacted + FY2027 in progress reports FY2027 (diverging), not "enacted"', () => {
    const r = fiscalYearStates([
      { fiscalYear: 2026, role: 'authorization_vehicle', chamber: 'Senate', textVersions: 5, becameLaw: true },
      { fiscalYear: 2026, role: 'authorization_vehicle', chamber: 'Senate', textVersions: 2, becameLaw: false },
      { fiscalYear: 2027, role: 'authorization_vehicle', chamber: 'House', textVersions: 3, becameLaw: false },
      { fiscalYear: 2027, role: 'authorization_vehicle', chamber: 'Senate', textVersions: 1, becameLaw: false },
      { fiscalYear: null, role: 'amends_prior_act', chamber: 'House', textVersions: 1, becameLaw: false },
    ]);
    expect(r.current).toEqual({ fiscalYear: 2027, state: 'diverging' });
    expect(r.byFiscalYear).toEqual({ 2026: 'enacted', 2027: 'diverging' });
  });

  it('amending bills never define a fiscal year state', () => {
    expect(fiscalYearStates([{ fiscalYear: null, role: 'amends_prior_act', chamber: 'House', textVersions: 1, becameLaw: true }]).current).toBeNull();
  });
});

// ── FAILURE TRUTH: an unreachable source is never "nothing new" ─────────────────
describe('discovery failure states stay distinct', () => {
  const bills = [{ congress: 120, type: 'HR', number: '1', title: 'An unrelated measure' }];
  it('Congress unavailable → source_unavailable, not a complete empty scan', async () => {
    const res = await discoverSince({ congress: 120, since: null, fetchImpl: feed(bills, { fail: true }), maxPages: 2, budgetMs: 5_000 });
    expect(res.pollOk).toBe(false);
    expect(res.coverage).not.toBe('complete');
  });
  it('reachable, fully scanned, nothing matching → complete with zero matches (a genuine no-new-data)', async () => {
    const res = await discoverSince({ congress: 120, since: null, fetchImpl: feed(bills), maxPages: 2, budgetMs: 5_000 });
    expect(res).toMatchObject({ pollOk: true, coverage: 'complete' });
    expect(res.matched).toHaveLength(0);
  });
  it('a page ceiling below the population → partial, never complete', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ congress: 120, type: 'HR', number: String(i), title: 'x' }));
    const res = await discoverSince({ congress: 120, since: null, fetchImpl: feed(many), maxPages: 1, budgetMs: 5_000 });
    expect(res.coverage).toBe('partial');
  });
});
