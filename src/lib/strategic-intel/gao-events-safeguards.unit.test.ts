/**
 * #2165 safeguards, without the decisions that still need approval.
 * The 278 legacy GAO strings stay served. The 51 replacement candidates are not
 * adopted. The 53 proposed event ids are not deleted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const merge = readFileSync(join(process.cwd(), 'scripts/merge-agency-intelligence.js'), 'utf8');
const pain = readFileSync(join(process.cwd(), 'src/data/agency-pain-points.json'), 'utf8');
const route = readFileSync(join(process.cwd(), 'src/app/api/cron/extract-sam-events/route.ts'), 'utf8');
const prune = readFileSync(join(process.cwd(), 'src/lib/events/extract-run.ts'), 'utf8');

describe('GAO obsolete strings cannot be reinjected', () => {
  it('merge skips gao_high_risk instead of writing (Source: GAO)', () => {
    expect(merge).toMatch(/intelligence_type === 'gao_high_risk'[\s\S]{0,900}continue;/);
    expect(merge).not.toMatch(/painPoints\.push\(painPoint\)/);
  });

  it('--merge refuses if a converted pain point still ends with (Source: GAO)', () => {
    expect(merge).toMatch(/REFUSED: converted set still contains "\(Source: GAO\)" pain points\./);
    expect(merge).toMatch(/process\.exit\(1\)/);
  });

  it('does not retire the served legacy strings in this change', () => {
    const served = (pain.match(/\(Source: GAO\)/g) || []).length;
    expect(served).toBeGreaterThan(0);
  });
});

describe('event pruning stays report-only and a missed log is visible', () => {
  it('apply is the only mode that deletes, and it is not the default', () => {
    expect(prune).toMatch(/env\.SAM_EVENTS_PRUNE === 'apply' \? 'apply' : 'report'/);
  });

  it('a failed cron_logs insert fails the job instead of returning success', () => {
    expect(route).toMatch(/prune report not recorded/);
    expect(route).toMatch(/status: 500/);
    const fail = route.slice(route.indexOf('prune report not recorded'), route.indexOf('if (Date.now() > deadline)'));
    expect(fail).toContain('ingest_broken');
    expect(fail).toContain('recorded: false');
    // A log failure must not start a delete. If apply already deleted, the count is reported, not zeroed.
    expect(fail).toContain("deleted: mode === 'apply' ? retiredCount : 0");
  });
});
