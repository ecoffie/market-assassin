/**
 * Guards the stale-record cleanup.
 *
 * THE BUG (surfaced 2026-08-04): cleanup ran as ONE statement —
 *   UPDATE sam_opportunities SET active=false
 *   WHERE synced_at < now()-7d AND active     ... RETURNING id
 * — rewriting ~15,300 rows and returning every id inside the request. It died with
 * "canceling statement due to statement timeout".
 *
 * Why it hid for seven days: cleanup only runs after `isFullSuccess`, and no full
 * sync had succeeded since 2026-07-29 (the offset/page bug). This never regressed.
 * It simply never got to run. Fixing pagination is what exposed it — a reminder that
 * repairing one stage of a pipeline reveals whatever the next stage was hiding.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/sync-sam-opportunities/route.ts'),
  'utf8'
);

// The drain loop's shape, mirrored: keep taking chunks until a short/empty one.
function drain(total: number, chunk: number, maxChunks: number) {
  let marked = 0, chunks = 0;
  while (chunks < maxChunks) {
    const took = Math.min(chunk, total - marked);
    chunks++;
    if (took === 0) break;
    marked += took;
    if (took < chunk) break;
  }
  return { marked, chunks, hitCeiling: chunks >= maxChunks && marked < total };
}

describe('the drain terminates and is bounded', () => {
  it('clears the real backlog well inside the ceiling', () => {
    // 15,328 stale rows measured in production on 2026-08-04.
    const r = drain(15328, 500, 60);
    expect(r.marked).toBe(15328);
    expect(r.chunks).toBe(31);       // 30 full chunks + one 328-row remainder
    expect(r.hitCeiling).toBe(false);
  });

  it('stops immediately when nothing is stale', () => {
    // The steady state once drained — must not burn a single wasted UPDATE.
    const r = drain(0, 500, 60);
    expect(r.marked).toBe(0);
    expect(r.chunks).toBe(1);        // one probing SELECT that comes back empty
  });

  it('an exact multiple does not loop forever', () => {
    // 15,000 = 30 exact chunks, then a 31st select returns 0 and breaks.
    const r = drain(15000, 500, 60);
    expect(r.marked).toBe(15000);
    expect(r.chunks).toBe(31);
  });

  it('a backlog larger than the ceiling stops and leaves the rest', () => {
    // Partial progress is durable: tomorrow's run finishes it. Better than a
    // timeout that commits nothing.
    const r = drain(90000, 500, 60);
    expect(r.marked).toBe(30000);
    expect(r.hitCeiling).toBe(true);
  });
});

describe('the route chunks rather than mass-updating', () => {
  it('never issues an unbounded UPDATE ... RETURNING over the whole table', () => {
    // The original bug: .update() directly on the filter, with .select('id').
    expect(SRC).not.toMatch(/\.update\(\{ active: false \}\)\s*\.lt\('synced_at'/);
  });

  it('selects a bounded chunk of ids, then updates by id', () => {
    expect(SRC).toContain('const STALE_CHUNK = 500');
    expect(SRC).toMatch(/\.limit\(STALE_CHUNK\)/);
    expect(SRC).toMatch(/\.in\('id', batch\.map/);
  });

  it('has a ceiling so a pathological backlog cannot run forever', () => {
    expect(SRC).toContain('STALE_MAX_CHUNKS');
    expect(SRC).toMatch(/staleChunks < STALE_MAX_CHUNKS/);
  });

  it('reports partial progress when a chunk fails', () => {
    // "marked 9,000 then errored" is a different situation from "marked nothing",
    // and the error string has to say which.
    expect(SRC).toContain('Stale cleanup error after ${staleRecordsMarked} rows');
  });

  it('still only runs after a fully successful full sync', () => {
    // Load-bearing: a partial sync means many live rows look un-synced, and
    // deactivating them would hide valid opportunities.
    expect(SRC).toMatch(/if \(!dryRun && isFullSuccess && syncType === 'full'\)/);
  });
});
