import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// STATIC import on purpose: one test below vi.doMock's './direct' to drive ingest, and a
// dynamic import here would hand the Monday assertions that mock instead of the real
// window logic (it did, on the first run).
import { recentIndexFiles, indexFileName } from './direct';

/**
 * DIBBS — "job completed" and "data advanced" were the SAME NUMBER.
 *
 * MEASURED ON PRODUCTION 2026-09-21 (70 run rows, 2026-07-01 → 2026-09-21):
 *
 *   dibbs_rfqs                     57,816 rows
 *   columns that record arrival    NONE  (scraped_at + synced_at are both last-touch)
 *   rows able to say when they     0 of 57,816
 *     first appeared
 *   dibbs_*_advancement()          did not exist, while
 *                                  sam_opportunities_advancement() and
 *                                  research_source_advancement() both did
 *
 * `upsertDibbsRfqs` conflicts on solicitation_number and re-stamps `synced_at` on
 * every row it touches. So a run that re-reads the same daily DLA index file and adds
 * NOTHING NEW still reports a large `upserted` and still drives max(synced_at) to now.
 * Both readings present as a healthy, advancing feed — the same conflation that let
 * darpa_baa and nsf_sbir bank 60 green checkmarks over two dead sources
 * (20260920_specialty_source_advancement.sql).
 *
 * The control plane had already inherited the error: data_source_instances
 * .dibbs_dla_flat_files was registered source_state='current',
 * intervention_state='none_required', last_data_advance=NULL — asserted healthy on a
 * quantity nothing had ever measured.
 *
 * These pin the oracle that closes it. Fetching, routing, the cost guard and the
 * STARVED verdict are all deliberately UNCHANGED — see the route comment.
 */

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260921_dibbs_advancement_oracle.sql'), 'utf8',
);
const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/sync-dibbs/route.ts'), 'utf8',
);

// ── a Supabase stub shaped like the three calls upsertDibbsRfqs actually makes ──
// select('first_seen_at')                                   -> the advancement MARK
// upsert(rows, { onConflict })                              -> the write
// select('solicitation_number', { count, head }) .gt/.not   -> the advancement COUNT
type Stub = {
  mark?: string | null;
  markError?: string;
  count?: number | null;
  countError?: string;
};

function makeSb(stub: Stub, calls: string[] = []) {
  const sb = {
    from() {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) {
            const res = stub.countError
              ? { count: null, error: { message: stub.countError } }
              : { count: stub.count === undefined ? 0 : stub.count, error: null };
            const term = {
              not: () => { calls.push('count'); return Promise.resolve(res); },
              gt: () => { calls.push('count'); return Promise.resolve(res); },
            };
            return term;
          }
          const res = stub.markError
            ? { data: null, error: { message: stub.markError } }
            : { data: stub.mark === undefined ? null : { first_seen_at: stub.mark }, error: null };
          const chain: Record<string, unknown> = {};
          chain.not = () => chain;
          chain.order = () => chain;
          chain.limit = () => chain;
          chain.maybeSingle = () => { calls.push('mark'); return Promise.resolve(res); };
          return chain;
        },
        upsert: async () => { calls.push('upsert'); return { error: null }; },
      };
    },
  };
  return sb as never;
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ solicitationNumber: `SPE1C126Q${1000 + i}` }));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('advancement is a SEPARATE number from the upsert touch count', () => {
  it('reports inserted from first_seen_at, NOT the payload length', async () => {
    const { upsertDibbsRfqs } = await import('./ingest');
    // 2,400 rows re-upserted, only 137 of them genuinely new. Before this change the
    // only number available was 2400, and it read as 2,400 rows of fresh intel.
    const r = await upsertDibbsRfqs(makeSb({ mark: '2026-09-20T08:00:00Z', count: 137 }), rows(2400));
    expect(r.upserted).toBe(2400);
    expect(r.inserted).toBe(137);
  });

  it('THE FALSE-GREEN SHAPE: a full re-read that adds nothing reports inserted 0', async () => {
    const { upsertDibbsRfqs } = await import('./ingest');
    const r = await upsertDibbsRfqs(makeSb({ mark: '2026-09-20T08:00:00Z', count: 0 }), rows(2400));
    // Completed, touched 2,400 rows, advanced not at all. Both facts, separately.
    expect(r.upserted).toBe(2400);
    expect(r.inserted).toBe(0);
  });

  it('reads the mark BEFORE the write and counts AFTER it', async () => {
    // Order is load-bearing: counting past a mark read after the upsert would count
    // this run's own inserts as pre-existing and always report 0.
    const calls: string[] = [];
    const { upsertDibbsRfqs } = await import('./ingest');
    await upsertDibbsRfqs(makeSb({ mark: '2026-09-20T08:00:00Z', count: 5 }, calls), rows(10));
    expect(calls).toEqual(['mark', 'upsert', 'count']);
  });
});

describe('UNKNOWN IS NOT ZERO (Bug Prevention Rule #11)', () => {
  it('inserted is null — never 0 — when the mark cannot be read', async () => {
    const { upsertDibbsRfqs } = await import('./ingest');
    // 42703 undefined_column, i.e. the migration has not been applied yet.
    const r = await upsertDibbsRfqs(
      makeSb({ markError: 'column dibbs_rfqs.first_seen_at does not exist' }), rows(50),
    );
    expect(r.upserted).toBe(50);
    expect(r.inserted).toBeNull();
    expect(r.inserted).not.toBe(0);
  });

  it('inserted is null when the COUNT query errors', async () => {
    const { upsertDibbsRfqs } = await import('./ingest');
    const r = await upsertDibbsRfqs(
      makeSb({ mark: '2026-09-20T08:00:00Z', countError: 'statement timeout' }), rows(50),
    );
    expect(r.inserted).toBeNull();
  });

  it('inserted is null when the count comes back null with no error', async () => {
    // The measured trap: a missing relation returns count=null, error=null, HTTP 204.
    // `count ?? 0` there would report "the corpus did not advance".
    const { upsertDibbsRfqs } = await import('./ingest');
    const r = await upsertDibbsRfqs(makeSb({ mark: null, count: null }), rows(50));
    expect(r.inserted).toBeNull();
  });

  it('but an EMPTY payload is genuinely 0, not unknown', async () => {
    // Nothing was offered, so there is nothing the database could have failed to say.
    const { upsertDibbsRfqs } = await import('./ingest');
    const r = await upsertDibbsRfqs(makeSb({}), []);
    expect(r).toEqual({ upserted: 0, inserted: 0 });
  });

  it('counts every stamped row when nothing has ever been stamped', async () => {
    // mark === null is the first post-migration run: no prior first_seen_at exists, so
    // every stamped row is new. It must NOT be treated the same as an unreadable mark.
    const { upsertDibbsRfqs } = await import('./ingest');
    const r = await upsertDibbsRfqs(makeSb({ mark: null, count: 2400 }), rows(2400));
    expect(r.inserted).toBe(2400);
  });

  it('never prints a null advancement as 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.APIFY_TOKEN = 't';
    vi.doMock('./direct', () => ({ fetchDibbsDirect: vi.fn().mockResolvedValue(rows(10)) }));

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(makeSb({ markError: 'nope' }), { maxItems: 2500 });

    expect(r.inserted).toBeNull();
    const line = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes('[dibbs] paths:'));
    expect(line).toContain('inserted=unknown');
    expect(line).not.toMatch(/inserted=0\b/);
  });
});

describe('the migration does not fabricate a history it never had', () => {
  it('adds first_seen_at WITHOUT backfilling the existing corpus', () => {
    // ADD COLUMN ... DEFAULT NOW() would stamp all 57,816 pre-existing rows with the
    // migration timestamp and claim the whole corpus arrived that day — a fabricated
    // advancement, which is the failure class being closed. So: add bare, then default.
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;/);
    expect(MIGRATION).not.toMatch(/ADD COLUMN[^;]*first_seen_at[^;]*DEFAULT/i);
    expect(MIGRATION).toMatch(/ALTER COLUMN first_seen_at SET DEFAULT NOW\(\)/);
  });

  it('keeps the touch clock and the advancement clock as SEPARATE outputs', () => {
    // Merging them into one "freshness" number is the whole bug.
    expect(MIGRATION).toMatch(/last_touch\s+timestamptz/);
    expect(MIGRATION).toMatch(/last_data_advance\s+timestamptz/);
    expect(MIGRATION).toMatch(/max\(d\.synced_at\)/);
    expect(MIGRATION).toMatch(/max\(d\.first_seen_at\)/);
  });

  it('reports UNMEASURED, never current, when there is no advancement clock yet', () => {
    // A healthy last_touch is precisely the signal that has been misread as health,
    // so it must not be able to produce 'current' on its own.
    expect(MIGRATION).toMatch(/WHEN max\(d\.first_seen_at\) IS NULL\s+THEN 'unmeasured'/);
  });

  it('exposes the blind window as a population instead of hiding it in a state', () => {
    expect(MIGRATION).toMatch(/rows_unmeasured\s+bigint/);
    expect(MIGRATION).toMatch(/FILTER \(WHERE d\.first_seen_at IS NULL\)/);
  });

  it('is idempotent — guarded so a re-apply is safe', () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS');
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION');
  });
});

describe('the route separates completed from advanced, and changes no verdict', () => {
  it('surfaces the advancement, printing unknown as the word', () => {
    expect(ROUTE).toMatch(/result\.inserted === null \? 'unknown'/);
    expect(ROUTE).toMatch(/inserted \$\{advancement\}/);
  });

  it('warns when a run completes without advancing', () => {
    expect(ROUTE).toContain('COMPLETED WITHOUT ADVANCING');
  });

  it('does NOT write a healthy statistic into cron_job_runs.error', () => {
    // reportCronOutcome's third argument lands in the `error` column. Putting an
    // advancement count there would corrupt the one field a postmortem uses to
    // classify failures — and it is unnecessary: first_seen_at is the durable record.
    expect(ROUTE).toMatch(/reportCronOutcome\('sync-dibbs', 'success'\);/);
    expect(ROUTE).not.toMatch(/reportCronOutcome\('sync-dibbs', 'success',/);
  });

  it('does not turn inserted===0 into a failure yet', () => {
    // How often a real business day legitimately adds nothing has never been measured
    // (there was no column to measure it with). Thresholding on zero observations is
    // how the STARVED check spent three Sundays paging over a healthy weekend.
    expect(ROUTE).toContain('DELIBERATELY NOT A VERDICT YET');
    expect(ROUTE).not.toMatch(/inserted === 0[\s\S]{0,400}status: 500/);
  });

  it('leaves the STARVED verdict and the cost guard untouched', () => {
    expect(ROUTE).toMatch(/const starved = result\.fetched <= 1 && !noDataWindow;/);
    expect(ROUTE).toMatch(/noBusinessDayInWindow/);
  });
});

describe('MEASURED 2026-09-21 — the Monday window gap (documented, NOT silenced)', () => {
  it('on a Monday at daysBack=2 the direct fetcher requests only TODAY, which DLA has not published', () => {
    // The cron is `0 8 * * *` with daysBack=2, i.e. 08:00 UTC / 04:00 ET.
    const mon = new Date(Date.UTC(2026, 8, 21, 8, 0, 0)); // 2026-09-21, a Monday
    const files = recentIndexFiles(2, mon);
    // Sunday is filtered as a weekend, leaving exactly one filename: today's own,
    // which does not exist at 04:00 ET. So direct can only ever return 0 on a Monday.
    expect(files).toEqual([indexFileName(mon)]);

    // CONFIRMED against production: across all 10 Mondays on record, the direct path
    // produced 0 rows every single time (6,700 Monday rows, 100% of them from Apify).
    // 2 of those 10 Mondays paged as STARVED (2026-08-24, 2026-09-21) when Apify also
    // under-delivered; the other 8 were masked by Apify happening to succeed at
    // ~$16-19 a run.
    //
    // This is asserted, not fixed, ON PURPOSE. Whether a starved Monday actually loses
    // records was UNMEASURABLE before first_seen_at existed — Apify delivers 1,100-2,100
    // Monday rows and nothing could say whether any were new. Suppressing the alarm now
    // would be turning UNKNOWN into healthy. Decide it from real advancement values.
    const tue = new Date(Date.UTC(2026, 8, 22, 8, 0, 0));
    expect(recentIndexFiles(2, tue)).toHaveLength(2); // Tue-Fri get yesterday's real file
  });

  it('a Sunday window is empty, which is why the weekend suppression exists at all', () => {
    expect(recentIndexFiles(2, new Date(Date.UTC(2026, 8, 20, 8, 0, 0)))).toEqual([]);
  });

  it('AT daysBack=2 THERE IS NO RETRY — every index file gets exactly ONE chance', () => {
    // The answer to "do later runs recover the records a failed run missed?": no.
    // The lookback window advances exactly as fast as the daily schedule, so each
    // business day's file is requestable on exactly one scheduled run. A single
    // failed run therefore loses ONE BUSINESS DAY of DLA RFQs permanently — there is
    // no mechanism that would ever ask for that file again.
    //
    // Measured over 40 consecutive scheduled runs from Mon 2026-08-03. Today's own
    // file is excluded from the count: it is requested but never published at
    // 08:00 UTC / 04:00 ET, so requesting it cannot ingest anything.
    const chances = (daysBack: number) => {
      const base = Date.UTC(2026, 7, 3, 8, 0, 0);
      const counts = new Map<string, number>();
      for (let i = 0; i < 40; i++) {
        const runAt = new Date(base + i * 86_400_000);
        for (const f of recentIndexFiles(daysBack, runAt)) {
          if (f === indexFileName(runAt)) continue; // not yet published at run time
          counts.set(f, (counts.get(f) ?? 0) + 1);
        }
      }
      return [...counts.values()];
    };

    const at2 = chances(2);
    expect(at2).toHaveLength(29);
    expect(Math.max(...at2)).toBe(1); // ← every file: one shot, no retry
    expect(Math.min(...at2)).toBe(1);

    // Widening the window is what would buy a retry — 28 of 29 files get a second
    // chance at daysBack=3. NOT changed here: the cron row carries daysBack=2 in
    // production, and widening it raises the Apify item count on days the direct
    // path fails, so it is a costed decision, not a drive-by edit.
    const at3 = chances(3);
    expect(at3.filter((n) => n >= 2)).toHaveLength(28);
  });
});
