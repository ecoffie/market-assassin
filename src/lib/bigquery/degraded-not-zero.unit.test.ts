import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A BigQuery failure must never render as a measured zero.
 *
 * `queryCached` returns `[]` when BQ fails and no stale cache covers it. That `[]` is an
 * ABSENCE OF KNOWLEDGE, and callers have been rendering it as fact:
 *
 *  - market-research scored every firm registered_only -> capableDepth 0 -> ruleOfTwoMet
 *    FALSE. The file's own comment records this happening: "EVERY market reported
 *    'capable: 0, Rule of Two NOT met'." That is a set-aside determination made on a quota
 *    error, and a contracting officer could act on it.
 *  - market-scanner rendered "$0/year" and then PERSISTED the all-zero payload as its
 *    last-good snapshot, later served under an "as of {time}" trust banner — a transient
 *    429 becoming durable fabricated data.
 *
 * The 2 TiB/day custom quota makes this project-wide and day-long, not a rare blip:
 * client.ts documents that exhausting it makes EVERY query fail instantly.
 *
 * Source-level guards, because the behaviour needs a live BQ failure to reach.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('queryCached signals degradation', () => {
  const SRC = strip(read('src/lib/bigquery/cache.ts'));

  it('marks the key degraded on the empty-return path', () => {
    expect(SRC).toContain('markDegraded(key, msg)');
  });

  it('exports a reader so callers can distinguish empty from failed', () => {
    expect(SRC).toMatch(/export function bqDegraded\(/);
  });

  it('clears the mark on a later success, so it cannot stick', () => {
    expect(SRC).toContain('DEGRADED.delete(key)');
  });

  it('keeps the T[] return type — 14 callers must not need edits to stay safe', () => {
    // A signature change would require touching every call site, and a partial migration
    // leaves the dangerous ones silently unconverted. Same failure as the 5-digit NAICS fix
    // landing on 1 of 3 lines earlier today.
    expect(SRC).toMatch(/Promise<T\[\]>/);
  });
});

describe('Rule of Two refuses to assert on degraded data', () => {
  const SRC = strip(read('src/lib/gov-buyer/market-research.ts'));

  it('returns null, not false, when award history was unavailable', () => {
    // null, not false. A CO reading `false` acts on it; `null` asks again.
    expect(SRC).toMatch(/ruleOfTwoMet:\s*activityDegraded\s*\?\s*null\s*:/);
  });

  it('adds a caveat that says this is NOT a finding', () => {
    expect(SRC).toContain('NOT a finding that the market lacks capable firms');
  });
});

describe('consumers never coerce unknown into "not met"', () => {
  it('the MCP tool passes null through instead of ?? false', () => {
    const SRC = strip(read('src/mcp/tools/market-depth.ts'));
    expect(SRC).not.toMatch(/ruleOfTwoMet\s*\?\?\s*false/);
    expect(SRC).toMatch(/ruleOfTwoMet\s*\?\?\s*null/);
    // And the silent (non-throwing) degradation must flip the tool's own degraded flag.
    expect(SRC).toContain('if (res?.dataDegraded) degraded = true');
  });

  it('the CO-facing page shows UNAVAILABLE, not NOT MET', () => {
    const SRC = read('src/app/gov/market-research/page.tsx');
    expect(SRC).toContain("'UNAVAILABLE'");
    expect(SRC).toContain('this is not a finding');
  });

  it('the agency page does not paint unknown as the not-met colour', () => {
    const SRC = read('src/app/agency/page.tsx');
    expect(SRC).toContain('ruleOfTwoMet === null');
  });
});
