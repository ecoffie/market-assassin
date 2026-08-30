import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE DATA CORE MUST COUNT EVERY CORPUS WE MIRROR.
 *
 * Found 2026-08-24: three datasets we own were absent or understated.
 *
 *   dibbs_rfqs                28,214  MISSING ENTIRELY — never listed
 *   grants_cache               1,972  listed as passthrough, count: null,
 *                                     "queried live per search" — but sync-grants
 *                                     mirrors it nightly
 *   aggregated_opportunities   1,134  MISSING ENTIRELY
 *
 * 31,320 records doing the work without the credit, on the page whose whole job is to state
 * what Mindy holds. The failure mode is specific: a corpus gets a sync cron and nobody adds
 * it here, so the inventory quietly drifts below reality.
 *
 * The test is source-level because the alternative — asserting live counts — would fail every
 * time the data grows, which is the wrong thing to be brittle about.
 */
const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/** Every table with a sync-* cron writing into it. Add here when a new corpus lands. */
const MIRRORED_TABLES = [
  'sam_opportunities',
  'recompete_opportunities',
  'agency_forecasts',
  'dibbs_rfqs',
  'grants_cache',
  'aggregated_opportunities',
  'federal_contacts',
  'sam_events',
  'dodaac_directory',
];

describe('Mindy Data Core inventory coverage', () => {
  it('counts every corpus we mirror', () => {
    const missing = MIRRORED_TABLES.filter((t) => !SRC.includes(`'${t}'`));
    expect(missing, `not counted by the Data Core: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not call a mirrored corpus a passthrough', () => {
    // "passthrough" means we query someone else's API live and hold nothing. A table with a
    // sync cron is ours, and labelling it passthrough understates the moat by a whole corpus.
    const grantsLine = SRC.split('\n').find((l) => l.includes("key: 'grants'")) ?? '';
    expect(grantsLine).toContain("provenance: 'curated'");
    expect(grantsLine).not.toContain('count: null');
  });

  it('reports DIBBS, which was absent entirely', () => {
    expect(SRC).toContain("key: 'dibbs'");
    expect(SRC).toContain('dibbs_rfqs');
  });

  it('keeps genuinely-live sources as passthrough with a null count', () => {
    // The distinction has to survive: pricing intel, EDGAR and Federal Register really are
    // fetched on demand, and claiming their upstream totals would be the opposite error.
    for (const k of ['pricing_intel', 'incumbent_financials', 'regulatory_demand']) {
      const line = SRC.split('\n').find((l) => l.includes(`key: '${k}'`)) ?? '';
      expect(line, k).toContain("provenance: 'passthrough'");
      expect(line, k).toContain('count: null');
    }
  });
});
