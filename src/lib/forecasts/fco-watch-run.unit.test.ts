/**
 * FCO watch runner — clock discipline and the non-mutation guarantee.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const RUN   = strip(readFileSync(join(process.cwd(), 'src/lib/forecasts/fco-watch-run.ts'), 'utf8'));
const ROUTE = strip(readFileSync(join(process.cwd(), 'src/app/api/cron/fco-roster-watch/route.ts'), 'utf8'));

describe('the watcher can never mutate forecasts', () => {
  it('only ever WRITES data_source_instances / alert state — never agency_forecasts', () => {
    for (const [name, src] of Object.entries({ RUN, ROUTE })) {
      // agency_forecasts may be READ (the held count) but never written.
      expect(src, `${name} upserts`).not.toMatch(/\.upsert\(/);
      expect(src, `${name} inserts`).not.toMatch(/\.insert\(/);
      expect(src, `${name} deletes`).not.toMatch(/\.delete\(/);
    }
    // The single .update() in the runner targets the control-plane row, not forecasts.
    const updates = RUN.match(/from\('([a-z_]+)'\)[\s\S]{0,120}?\.update\(/g) ?? [];
    for (const u of updates) expect(u).toContain("from('data_source_instances')");
  });

  it('reads the held count with an exact head count, not a paged select', () => {
    expect(RUN).toMatch(/count: 'exact', head: true/);
  });

  it('a NULL held count is treated as UNKNOWN, never zero', () => {
    expect(RUN).toMatch(/count == null/);
    expect(RUN).not.toMatch(/count \?\? 0/);
  });
});

describe('clock semantics', () => {
  it('last_verified_ingest and last_data_advance are NEVER written by a watch', () => {
    expect(RUN).not.toContain('last_verified_ingest');
    expect(RUN).not.toContain('last_data_advance');
  });

  it('last_poll advances on every attempt; last_successful_check is conditional', () => {
    expect(RUN).toMatch(/clocks[\s\S]{0,80}last_poll/);
    expect(RUN).toMatch(/if \(result\.clocks\.lastSuccessfulCheck\)/);
  });

  it('held_population is the VERIFIED count, never aspirational', () => {
    expect(RUN).toMatch(/held_population = heldCanonical/);
    expect(RUN).not.toMatch(/held_population\s*=\s*\d{4}/);   // no hardcoded 9092 etc
  });

  it('behind upstream is content_stale — a successful watch never implies current', () => {
    expect(RUN).toMatch(/heldCanonical < census\.uniqueListingIds \? 'content_stale' : 'current'/);
  });

  it('an unreachable source is recorded as such', () => {
    expect(RUN).toMatch(/pagesFetched === 0[\s\S]{0,80}'unreachable'/);
  });
});

describe('dry mode = zero persistent writes', () => {
  it('the clock update is gated on !dry', () => {
    expect(RUN).toMatch(/if \(!dry\)[\s\S]{0,200}\.update\(clocks\)/);
  });
  it('alert send AND alert-state dedup are both gated on !dry', () => {
    expect(ROUTE).toMatch(/worth\.length && !dry/);
    // shouldSendAlert writes ops_alert_state, so it must sit inside the same guard.
    const guarded = ROUTE.slice(ROUTE.indexOf('worth.length && !dry'));
    expect(guarded).toContain('shouldSendAlert');
    expect(guarded).toContain('sendOpsAlert');
  });
});

describe('alerting reuses the shared ops stack', () => {
  it('uses sendOpsAlert + shouldSendAlert, not bespoke Slack logic', () => {
    expect(ROUTE).toContain("from '@/lib/ops-alert'");
    expect(ROUTE).toContain("from '@/lib/ops-alert-dedup'");
    expect(ROUTE).not.toMatch(/hooks\.slack\.com/);
  });
  it('info-level events do not alert — only warn/critical', () => {
    expect(ROUTE).toMatch(/severity !== 'info'/);
  });
});

describe('the canonical held count is scoped to this source only', () => {
  it('counts gsa_gateway_csv + NSF/api, excluding duplicates and NRC', () => {
    expect(RUN).toMatch(/source_type\.eq\.gsa_gateway_csv/);
    expect(RUN).toMatch(/source_agency\.eq\.NSF/);
    expect(RUN).not.toMatch(/NRC/);
  });
});
