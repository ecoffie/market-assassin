/**
 * The forecast cron runs MULTIPLE sources, and the way they interact is the
 * whole point.
 *
 * Context: a sweep on 2026-08-01 found 15 of 17 forecast sources last synced
 * 36+ days ago. The scrapers had rotted — they loaded the page, extracted 0
 * rows, and the job reported success. Nothing surfaced it. These guards exist
 * so that shape can't come back as sources are added.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('source isolation', () => {
  it('runs each source in its own try/catch', () => {
    // One rotted portal must not stop the others — that is how a single
    // failure quietly ages the whole table.
    const loop = SRC.slice(SRC.indexOf('for (const s of sources)'));
    expect(loop).toContain('try {');
    expect(loop).toContain('catch');
    expect(loop).toContain('failures.push');
  });

  it('only returns 500 when EVERY source failed', () => {
    // A partial success must still land the good data.
    expect(SRC).toContain('if (rows.length === 0)');
    expect(SRC).toMatch(/All forecast sources failed/);
  });

  it('alerts on a partial failure, not just a total one', () => {
    // The blind spot being closed: one source silently dropping out while the
    // job still reports success.
    expect(SRC).toContain('if (failures.length)');
    expect(SRC).toMatch(/source\(s\) FAILED/);
  });

  it('reports a partial run as error so the watchdog sees it', () => {
    expect(SRC).toMatch(/reportCronOutcome\(JOB_NAME, failures\.length \? 'error' : 'success'/);
  });

  it('returns per-source counts in the response body', () => {
    // A signal that lives only inside an alert is invisible when the alert is
    // what broke — the counts must be queryable from the response too.
    expect(SRC).toContain('perSource');
    expect(SRC).toMatch(/perSource,\s*\n\s*failures,/);
  });
});

describe('zero-record guard', () => {
  it('treats a below-floor fetch as a failure, not a quiet success', () => {
    // Government portals change without notice; the failure mode is always
    // "still returns 200, now parses to nothing".
    expect(SRC).toContain('SOURCE_FLOOR');
    expect(SRC).toMatch(/got\.length < \(SOURCE_FLOOR\[s\.name\] \?\? 1\)/);
    expect(SRC).toMatch(/parsed to nothing/);
  });
});

describe('DOE source', () => {
  it('fails loudly when the monthly file moves', () => {
    // DOE republishes under a DATED directory, so a moved file 404s. That is
    // the one predictable way this source breaks.
    const fn = SRC.slice(SRC.indexOf('async function fetchDOE'));
    expect(fn).toContain('if (!res.ok)');
    expect(fn).toMatch(/likely moved/);
  });

  it('throws when the layout changes rather than importing nothing', () => {
    const fn = SRC.slice(SRC.indexOf('async function fetchDOE'));
    expect(fn).toMatch(/no header row found/);
  });

  it('carries the incumbent fields that make a forecast actionable', () => {
    const fn = SRC.slice(SRC.indexOf('async function fetchDOE'));
    expect(fn).toContain('incumbent_name');
    expect(fn).toContain('incumbent_contract_number');
  });

  it('upserts on the composite key, matching the table constraint', () => {
    // The real unique constraint is (source_agency, external_id) — targeting
    // external_id alone throws "no unique or exclusion constraint matching".
    expect(SRC).toContain("onConflict: 'source_agency,external_id'");
  });
});

describe('documented scope', () => {
  it('records WHY the other sources are absent', () => {
    // The next person to add a source needs to know these were checked and
    // blocked, not merely forgotten.
    expect(SRC).toMatch(/login-gated/);
    expect(SRC).toMatch(/Akamai WAF/);
    expect(SRC).toMatch(/USACE/);
  });
});
