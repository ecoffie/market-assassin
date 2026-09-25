/**
 * Backfill safety — the writer contract (tasks/saved-search-forecast-watermark-2026-09-24.md §4b).
 * The database half (the agency_forecasts_floor_guard trigger) is executed against the real migration SQL by
 * src/lib/forecasts/floor-guard.pglite.unit.test.ts (blocking in CI and pre-push).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { guardForecastInserts, countNewForecastRows, DAILY_SYNC_WRITERS, DAILY_SYNC_MAX_NEW_ROWS, FORECAST_WRITER_HEADER } from './writer';

function floorDb(floor: { state: string } | null, error: { code?: string; message: string } | null = null) {
  return {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: floor, error });
      return q;
    },
  };
}

describe('guardForecastInserts — may the DAILY SYNC create these new rows?', () => {
  it('pre-migration (floor table absent) → allow, legacy behaviour', async () => {
    expect((await guardForecastInserts(floorDb(null, { code: '42P01', message: 'relation "forecast_publisher_alert_floor" does not exist' }), 'DHS', 5000)).allow).toBe(true);
  });
  it('no floor / suspended → allow (rows are not alertable)', async () => {
    expect((await guardForecastInserts(floorDb(null), 'SSA', 5000)).allow).toBe(true);
    expect((await guardForecastInserts(floorDb({ state: 'suspended' }), 'SSA', 5000)).allow).toBe(true);
  });
  it('active floor: ordinary daily volume is allowed', async () => {
    expect((await guardForecastInserts(floorDb({ state: 'active' }), 'DHS', 44)).allow).toBe(true);
    expect((await guardForecastInserts(floorDb({ state: 'active' }), 'DHS', DAILY_SYNC_MAX_NEW_ROWS)).allow).toBe(true);
  });
  it('active floor: a BULK of new rows from the daily sync is REFUSED (route it through a backfill)', async () => {
    const g = await guardForecastInserts(floorDb({ state: 'active' }), 'DOE', 870);
    expect(g.allow).toBe(false);
    expect(g.reason).toMatch(/--suspend/);
  });
  it('a floor read failure refuses (never guesses toward an alert burst)', async () => {
    expect((await guardForecastInserts(floorDb(null, { message: 'connection reset' }), 'DHS', 10)).allow).toBe(false);
  });
});

describe('countNewForecastRows', () => {
  it('counts ids not yet held for the publisher (the rows an upsert would CREATE)', async () => {
    const held = new Set(['A', 'B']);
    const db = {
      from: () => {
        let ids: string[] = [];
        const q: Record<string, unknown> = {};
        q.select = () => q; q.eq = () => q; q.limit = () => q;
        q.in = (_c: string, v: string[]) => { ids = v; return q; };
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: ids.filter((i) => held.has(i)).map((external_id) => ({ external_id })), error: null }).then(res);
        return q;
      },
    };
    expect(await countNewForecastRows(db, 'DHS', ['A', 'B', 'C', 'C', 'D'])).toEqual({ newRows: 2 });
  });
});

const ROOTS = ['src', 'scripts'];
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
  }
  return out;
}
const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r))).map((p) => relative(process.cwd(), p));
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('bypass detection — the daily-sync identity cannot be borrowed', () => {
  it('only the sanctioned daily crons declare the daily_sync writer', () => {
    // writer.ts defines the function (and names the call in its own docs) — it is not a caller.
    const declares = files.filter((p) => p !== 'src/lib/forecasts/writer.ts' && /forecastWriterClient\(\s*['"]daily_sync['"]\s*\)/.test(read(p)));
    expect(declares.sort()).toEqual([...DAILY_SYNC_WRITERS].sort());
  });
  it('nothing else sets the writer header or the SQL writer setting by hand', () => {
    // (Test files are not scanned: floor-guard.pglite.unit.test.ts sets the header only on its in-process database.)
    const offenders = files.filter((p) => p !== 'src/lib/forecasts/writer.ts'
      && (read(p).includes(FORECAST_WRITER_HEADER) || /app\.forecast_writer/.test(read(p))));
    expect(offenders).toEqual([]);
  });
  it('every daily writer uses the declared client — no raw createClient left to write forecasts undeclared', () => {
    for (const p of DAILY_SYNC_WRITERS) {
      expect(existsSync(join(process.cwd(), p)), p).toBe(true);
      expect(read(p), p).not.toMatch(/createClient\(/);
    }
  });
  it('the four ingest libraries run the new-row guard before inserting', () => {
    for (const lib of ['hhs', 'doj', 'nasa', 'ssa']) {
      expect(read(`src/lib/forecasts/${lib}-ingest.ts`), lib).toMatch(/applyInsertGuard\(sb, '[A-Z]+'/);
    }
    expect(read('src/app/api/cron/sync-forecasts/route.ts')).toMatch(/guardForecastInserts\(supabase, src/);
  });
  it('the database guard is in the migration (executed by floor-guard.pglite.unit.test.ts)', () => {
    const sql = read('supabase/migrations/20260924_saved_search_forecast_watermark.sql');
    expect(sql).toMatch(/CREATE TRIGGER agency_forecasts_floor_guard\s+BEFORE INSERT ON agency_forecasts/);
    expect(sql).toMatch(/IF writer = 'daily_sync' AND current_user IN \('service_role', 'postgres'\) THEN/);
  });
});
