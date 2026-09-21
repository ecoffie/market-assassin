import { describe, it, expect } from 'vitest';
import {
  discoverSince,
  mergeMeasures,
  knownMeasures,
  encodeDiscoveryCursor,
  decodeDiscoveryCursor,
  watermarkFor,
} from './legislation-discovery';
import { currentCongress, type BillRef } from './legislation';

/** A fake feed of N bills with an NDAA-titled measure planted at `plantAt`. */
function fakeFeed(total: number, plantAt: number, opts: { reportTotal?: number | null } = {}) {
  const bills = Array.from({ length: total }, (_, i) => ({
    congress: 119,
    type: 'HR',
    number: String(1000 + i),
    title: `An unrelated bill number ${i}`,
    updateDate: '2026-09-20',
    originChamber: 'House',
  }));
  bills[plantAt] = {
    congress: 119, type: 'S', number: '4784',
    title: 'National Defense Authorization Act for Fiscal Year 2027',
    updateDate: '2026-09-18', originChamber: 'Senate',
  };
  const reported = opts.reportTotal === undefined ? total : opts.reportTotal;
  return (async (u: string) => {
    const url = new URL(u);
    const limit = Number(url.searchParams.get('limit') ?? 250);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({
        bills: bills.slice(offset, offset + limit),
        pagination: reported === null ? {} : { count: reported },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/**
 * ── THE PRODUCTION DEFECT (2026-09-20) ──────────────────────────────────────
 * S.4784 sat at feed position 2948. A 6-page (1500-row) scan returned 5 documents,
 * silently omitting it AND S. Rept. 119-127, while reporting pollOk:true,
 * collectFailures:0, partial:false, discoveryState:'introduced'.
 */
describe('REGRESSION: a valid NDAA measure beyond position 1,500', () => {
  it('is FOUND when the window is fully covered', async () => {
    const res = await discoverSince({
      congress: 119, since: null, maxPages: 40, pageSize: 250,
      fetchImpl: fakeFeed(3000, 2948),
    });
    expect(res.coverage).toBe('complete');
    expect(res.matched.map((m) => `${m.billType}${m.number}`)).toContain('S4784');
    expect(res.scanned).toBe(3000);
    expect(res.nextWatermark).not.toBeNull();
  });

  it('NEVER silently disappears: an under-covered scan reports partial, not success', async () => {
    // Exactly the production shape: read 1500 of 3000, measure sits past the ceiling.
    const res = await discoverSince({
      congress: 119, since: null, maxPages: 6, pageSize: 250,
      fetchImpl: fakeFeed(3000, 2948),
    });
    expect(res.matched).toHaveLength(0);           // it genuinely was not seen
    expect(res.coverage).toBe('partial');          // and we SAY SO
    expect(res.scanned).toBe(1500);
    expect(res.reportedTotal).toBe(3000);          // the API's own denominator
    expect(res.nextWatermark).toBeNull();          // watermark must NOT advance
    expect(res.error).toBe('page_ceiling_before_full_coverage');
  });

  it('a ceiling can never produce a confident completeness claim', async () => {
    const res = await discoverSince({
      congress: 119, since: null, maxPages: 1, pageSize: 250,
      fetchImpl: fakeFeed(3000, 2948),
    });
    expect(res.pollOk).toBe(true);                 // the poll DID succeed...
    expect(res.coverage).not.toBe('complete');     // ...but coverage did not
  });

  it('refuses to claim coverage when the API gives no total to measure against', async () => {
    const res = await discoverSince({
      congress: 119, since: null, maxPages: 40, pageSize: 250,
      fetchImpl: fakeFeed(100, 50, { reportTotal: null }),
    });
    // We may have read everything — but we cannot PROVE it, so we do not claim it.
    expect(res.reportedTotal).toBeNull();
    expect(res.coverage).toBe('partial');
    expect(res.nextWatermark).toBeNull();
  });
});

describe('tracking survives the discovery window entirely', () => {
  const s4784: BillRef = { congress: 119, billType: 'S', number: '4784', title: 'NDAA FY2027', updateDate: null, originChamber: 'Senate' };
  const hr8800: BillRef = { congress: 119, billType: 'HR', number: '8800', title: 'NDAA FY2027', updateDate: '2026-09-15', originChamber: 'House' };

  it('a known measure is tracked even when discovery does not see it at all', () => {
    // Discovery returns nothing (measure drifted out); tracking still yields it.
    expect(mergeMeasures([], [s4784]).map((m) => m.billType + m.number)).toEqual(['S4784']);
  });

  it('merges without duplicating an identity found by BOTH paths', () => {
    const merged = mergeMeasures([hr8800], [hr8800, s4784]);
    expect(merged).toHaveLength(2);
    expect(merged.filter((m) => m.billType === 'HR' && m.number === '8800')).toHaveLength(1);
  });

  it('prefers the richer discovery record when identities collide', () => {
    const stale: BillRef = { ...hr8800, updateDate: null };
    const merged = mergeMeasures([hr8800], [stale]);
    expect(merged[0].updateDate).toBe('2026-09-15');
  });

  it('a NEW measure (e.g. H.R. 8559) is still discovered automatically', async () => {
    const res = await discoverSince({
      congress: 119, since: null, maxPages: 40, pageSize: 250,
      fetchImpl: (async () => ({
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          bills: [{ congress: 119, type: 'HR', number: '8559', title: 'National Defense Authorization Act for Fiscal Year 2027', updateDate: '2026-04-28', originChamber: 'House' }],
          pagination: { count: 1 },
        }),
      })) as unknown as typeof fetch,
    });
    expect(res.coverage).toBe('complete');
    expect(res.matched.map((m) => m.billType + m.number)).toEqual(['HR8559']);
  });

  it('a corpus read failure is UNKNOWN, never "nothing is tracked"', async () => {
    const db = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }) }) };
    const r = await knownMeasures(db as never, 119);
    expect(r.error).toBe('connection reset');
    expect(r.measures).toEqual([]);   // paired with error — the caller must not stamp
  });

  it('reconstructs identities from institute_sources.raw, with no new table', async () => {
    const rows = [
      { title: 'NDAA [S 4784 — Reported to Senate]', raw: { congress: 119, billType: 'S', billNumber: '4784' } },
      { title: 'NDAA [S 4784 — dup version]', raw: { congress: 119, billType: 'S', billNumber: '4784' } },
      { title: 'H. Rept. 119-698', raw: { congress: 119, reportType: 'HRPT' } },     // no bill -> skipped
      { title: 'NDAA [HR 8800 — IH]', raw: { congress: 119, billType: 'HR', billNumber: '8800' } },
    ];
    const db = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) }) };
    const r = await knownMeasures(db as never, 119);
    expect(r.measures.map((m) => m.billType + m.number).sort()).toEqual(['HR8800', 'S4784']);
  });
});

describe('watermark: complete vs incomplete coverage is persisted honestly', () => {
  it('round-trips and does not collide with the clocks sentinel', () => {
    const c = { lastCompleteDiscoveryAt: '2026-09-20T12:00:00Z', congress: 119, reportedTotal: 2812, scanned: 2812 };
    const notes = encodeDiscoveryCursor('human notes', c);
    expect(notes).toContain('human notes');
    expect(decodeDiscoveryCursor(notes)).toEqual(c);
    expect(decodeDiscoveryCursor('[legislation-ingest-clocks:v1]\n{}\n[/legislation-ingest-clocks]')).toBeNull();
  });

  it('re-encoding replaces the block rather than stacking duplicates', () => {
    const a = encodeDiscoveryCursor(null, { lastCompleteDiscoveryAt: '2026-09-20T12:00:00Z', congress: 119, reportedTotal: 1, scanned: 1 });
    const b = encodeDiscoveryCursor(a, { lastCompleteDiscoveryAt: '2026-09-21T12:00:00Z', congress: 119, reportedTotal: 2, scanned: 2 });
    expect(b.match(/legislation-discovery-cursor:v1/g)).toHaveLength(1);
    expect(decodeDiscoveryCursor(b)!.lastCompleteDiscoveryAt).toBe('2026-09-21T12:00:00Z');
  });

  it('a watermarked pass narrows the window it asks for', async () => {
    const urls: string[] = [];
    await discoverSince({
      congress: 119, since: '2026-09-19T00:00:00Z', maxPages: 1,
      fetchImpl: (async (u: string) => {
        urls.push(String(u));
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ bills: [], pagination: { count: 0 } }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    expect(urls[0]).toContain('fromDateTime=');
    expect(urls[0]).toContain('sort=updateDate+desc');
    expect(urls[0]).not.toContain('%2B');
  });

  it('rewinds the watermark so a boundary update cannot slip through a gap', async () => {
    const urls: string[] = [];
    await discoverSince({
      congress: 119, since: '2026-09-20T12:00:00Z', maxPages: 1,
      fetchImpl: (async (u: string) => {
        urls.push(String(u));
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ bills: [], pagination: { count: 0 } }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const from = new URL(urls[0]).searchParams.get('fromDateTime')!;
    expect(Date.parse(from)).toBeLessThan(Date.parse('2026-09-20T12:00:00Z'));
  });

  it('a source failure never advances the watermark', async () => {
    const res = await discoverSince({
      congress: 119, since: '2026-09-19T00:00:00Z',
      fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch,
    });
    expect(res.coverage).toBe('source_unavailable');
    expect(res.pollOk).toBe(false);
    expect(res.nextWatermark).toBeNull();
  });
});

/**
 * A new Congress convenes every odd January and the bill feed resets. Carrying the
 * prior cursor forward would ask "what changed since last week" of a corpus that did
 * not exist, and the tiny result would look complete while covering nothing.
 */
describe('new-Congress transition needs no code change', () => {
  it('discards a cursor from a different Congress, forcing a full first pass', () => {
    const cursor = { lastCompleteDiscoveryAt: '2026-12-20T00:00:00Z', congress: 119, reportedTotal: 100, scanned: 100 };
    expect(watermarkFor(cursor, 119)).toBe('2026-12-20T00:00:00Z');
    expect(watermarkFor(cursor, 120)).toBeNull();   // FY28 cycle -> full scan
    expect(watermarkFor(null, 120)).toBeNull();
  });

  it('the sitting Congress is derived from the date, never hardcoded', () => {
    expect(currentCongress(new Date('2026-09-20T00:00:00Z'))).toBe(119);
    expect(currentCongress(new Date('2027-06-01T00:00:00Z'))).toBe(120);  // FY28
    expect(currentCongress(new Date('2029-06-01T00:00:00Z'))).toBe(121);  // FY30
  });

  it('discovers a FY2028 measure in the 120th Congress with no hardcoded identifiers', async () => {
    const res = await discoverSince({
      congress: 120, since: null, maxPages: 2,
      fetchImpl: (async () => ({
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({
          bills: [{ congress: 120, type: 'HR', number: '9911', title: 'National Defense Authorization Act for Fiscal Year 2028', updateDate: '2027-05-20', originChamber: 'House' }],
          pagination: { count: 1 },
        }),
      })) as unknown as typeof fetch,
    });
    expect(res.coverage).toBe('complete');
    expect(res.matched[0].congress).toBe(120);
    expect(res.matched[0].number).toBe('9911');
  });

  it('no hardcoded bill numbers or fiscal years in the discovery source', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./legislation-discovery.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of ['8800', '4784', '8559', '1071', '2027', '2028']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

/**
 * ROUTE WIRING. The library can be perfect and the defect still ship if the route
 * forgets to poll known measures. This pins the two-job contract at the call site.
 */
describe('the cron route wires discovery AND tracking', () => {
  const routeSrc = async () => {
    const fs = await import('node:fs');
    const raw = fs.readFileSync(new URL('../../app/api/cron/institute-legislation-sync/route.ts', import.meta.url), 'utf8');
    return raw.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  };

  it('merges known measures into the tracked set (never rediscover-only)', async () => {
    expect(await routeSrc()).toContain('mergeMeasures(discovery.matched, known.measures)');
  });

  it('uses the watermarked discoverSince, not the superseded fixed-page scan', async () => {
    const code = await routeSrc();
    expect(code).toContain('discoverSince(');
    expect(code).not.toContain('discoverBills(');
  });

  it('advances the watermark ONLY on proven complete coverage', async () => {
    const code = await routeSrc();
    expect(code).toMatch(/watermarkAdvanced[\s\S]{0,200}coverage === 'complete'/);
  });

  it('a ceiling cannot report not_yet_introduced', async () => {
    const code = await routeSrc();
    // The empty-result branch must gate its absence claim on complete coverage.
    expect(code).toMatch(/completelyScanned \? 'not_yet_introduced' : 'unknown_incomplete_scan'/);
  });
});

/**
 * PostgREST hard-caps a response at 1,000 rows. A single .limit(2000) silently
 * returns 1,000, and the caller cannot distinguish truncation from a small corpus —
 * so a measure whose row fell off page one would stop being tracked, with no error.
 * (Caught by the pre-push oversized-limit gate while building this fix.)
 */
describe('the corpus read is paged, never silently truncated', () => {
  const mkDb = (total: number) => {
    const rows = Array.from({ length: total }, (_, i) => ({
      title: `NDAA v${i}`,
      raw: { congress: 119, billType: 'HR', billNumber: String(1000 + i) },
    }));
    return {
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => ({
              range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
            }),
          }),
        }),
      }),
    };
  };

  it('reads EVERY measure past the 1,000-row PostgREST cap', async () => {
    const r = await knownMeasures(mkDb(2500) as never, 119);
    expect(r.error).toBeUndefined();
    expect(r.measures).toHaveLength(2500);      // not 1000
  });

  it('stops cleanly on a short final page', async () => {
    const r = await knownMeasures(mkDb(1500) as never, 119);
    expect(r.measures).toHaveLength(1500);
  });

  it('an unfinished read is an ERROR, never a partial tracking set', async () => {
    // A corpus larger than MAX_PAGES*PAGE must not quietly return a truncated list.
    const endless = {
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => ({
              range: async () => ({
                data: Array.from({ length: 1000 }, (_, i) => ({ title: 't', raw: { congress: 119, billType: 'HR', billNumber: String(i) } })),
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    const r = await knownMeasures(endless as never, 119);
    expect(r.error).toMatch(/corpus_read_incomplete/);
    expect(r.measures).toEqual([]);
  });
});
