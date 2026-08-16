/**
 * GUARD — a runaway full-table scan must not be able to blind the whole project.
 *
 * WHY THIS IS ABOUT MORE THAN MONEY (measured 2026-08-15): the GCP project carries a manual
 * `QueryUsagePerDay` override of 2 TiB/day against the 200 TiB default. When that daily quota
 * is exhausted, EVERY BigQuery query in the project fails instantly at **0 bytes billed** —
 * including the awards-freshness oracle. So one runaway scan does three things at once:
 *
 *   1. costs money,
 *   2. BLINDS every data guard for the rest of the day, and
 *   3. destroys the evidence — because all the jobs that follow log 0 bytes, the actual
 *      consumer hides behind a wall of victims (118 of 120 recent jobs were `quotaExceeded`).
 *
 * Measured query costs (dry runs are free and work even while the quota is blown):
 *   contractor page by UEI (clustered)   0.00 GiB
 *   related-contractors aggregate        4.48 GiB  ← the heaviest LEGITIMATE runtime query
 *   SELECT * on awards                  41.06 GiB  ← the runaway shape; ~48 exhaust the day
 *   one full weekly ingest             ~275    GB  ← legitimately scans everything
 *
 * So the ceiling stays at 5 GiB (NOT the 2 GiB I first proposed — that would have broken the
 * related-contractors feature, whose real cost the old code comment understated as "~3GB").
 * Bulk jobs opt out explicitly by name, so a full-table scan is always a deliberate act by a
 * batch job rather than something a request path can do by accident.
 *
 * ⚠️ NOT VERIFIED HERE: that BigQuery actually REJECTS an over-ceiling query at execution.
 * `maximumBytesBilled` is not enforced during a dry run, and a real query currently fails on
 * the exhausted daily quota first — which would mask the result and produce a false pass.
 * These assertions lock the CONFIGURATION; enforcement is BigQuery's documented behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = join(process.cwd(), 'src', 'lib', 'bigquery', 'client.ts');
const src = readFileSync(CLIENT, 'utf8');

/** Comments quote the numbers while explaining them — strip before asserting on code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('every BigQuery query carries a byte ceiling', () => {
  it('a runtime ceiling is applied when the caller does not set one', () => {
    expect(code).toMatch(/maximumBytesBilled:\s*opts\.maximumBytesBilled/);
    expect(code).toMatch(/RUNTIME_MAX_BYTES/);
  });

  it('the runtime ceiling clears the heaviest legitimate query (4.48 GiB), with headroom', () => {
    const m = code.match(/const RUNTIME_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/);
    expect(m).toBeTruthy();
    const gib = Number(m![1]);
    // Below 5 GiB the related-contractors aggregate (4.48 GiB) starts failing.
    expect(gib).toBeGreaterThanOrEqual(5);
    // Above ~10 GiB it stops being a brake on the 41 GiB runaway shape.
    expect(gib).toBeLessThanOrEqual(10);
  });

  it('the runtime ceiling is well below the runaway shape it exists to stop', () => {
    const m = code.match(/const RUNTIME_MAX_BYTES\s*=\s*(\d+)\s*\*/);
    expect(Number(m![1])).toBeLessThan(41);   // SELECT * on awards = 41.06 GiB
  });

  it('bulk jobs must opt out EXPLICITLY and by name', () => {
    // An anonymous boolean would let any caller quietly buy a full-table scan.
    expect(code).toMatch(/bulkJob\?:\s*string/);
    expect(code).toMatch(/opts\.bulkJob \? BULK_MAX_BYTES : RUNTIME_MAX_BYTES/);
  });

  it('there is no unguarded path — the ceiling is never optional', () => {
    // A `?? undefined` or a bare omission would send the query with NO cap at all.
    expect(code).not.toMatch(/maximumBytesBilled:\s*opts\.maximumBytesBilled\s*,/);
    expect(code).not.toMatch(/maximumBytesBilled:\s*undefined/);
  });
});
