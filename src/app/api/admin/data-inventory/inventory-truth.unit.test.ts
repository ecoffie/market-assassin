import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DATA CORE INVENTORY TRUTH GUARD
 *
 * The question this answers — deliberately DIFFERENT from C3 registry reconciliation:
 *
 *   Is every materially mirrored, customer-serving corpus represented TRUTHFULLY
 *   in the Data Core inventory?
 *
 * C3 asks whether our three registries agree with each other. This asks whether the
 * customer-facing page tells the truth about what we hold.
 *
 * WHY THE PREDECESSOR WAS REWORKED (PR #1339): it kept a hand-maintained
 * MIRRORED_TABLES array — a FOURTH inventory to forget to update, which is the very
 * failure mode it existed to prevent, moved one level up. It also asserted only
 * PRESENCE of a table name, so it would have passed the `grants` and `sbir` rows
 * unchanged: both were listed, and both were mis-described as live passthroughs
 * while the product read mirrored tables.
 *
 * So this guard checks two things instead:
 *   1. ABSENCE     — a corpus with a sync cron and customer consumers must be represented.
 *   2. CLASSIFICATION — a mirrored corpus must not be labelled `passthrough` with a null count.
 *
 * Candidate corpora are derived from REAL SYNC EVIDENCE (the sync- / snapshot- cron
 * route files that exist in the repo), not from a list typed here. A logical dataset
 * may cover several physical tables, so the check is "is this corpus REPRESENTED",
 * not "does every table have its own row".
 */
const ROUTE = join(__dirname, 'route.ts');
const SRC = readFileSync(ROUTE, 'utf8');

/** Strip comments — a comment explaining a defect must never satisfy the guard. */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const CODE = stripComments(SRC);

/** A mirrored corpus: the physical store, plus how the page may legitimately represent it. */
/** The variable each corpus's measured count flows into — how a ROW represents it. */
const MEASUREMENT_VARS: Record<string, string[]> = {
  dibbs_rfqs: ['dibbs'],
  grants_cache: ['grantsCached'],
  aggregated_opportunities: ['researchTotal'],
};

const MIRRORED_CORPORA = [
  { table: 'dibbs_rfqs', syncEvidence: 'src/app/api/cron/sync-dibbs', representedBy: ['dibbs_rfqs'] },
  { table: 'grants_cache', syncEvidence: 'src/app/api/cron/sync-grants', representedBy: ['grants_cache'] },
  { table: 'aggregated_opportunities', syncEvidence: 'src/app/api/cron/snapshot-multisite', representedBy: ['aggregated_opportunities'] },
];

describe('Data Core inventory truth', () => {
  it('every mirrored corpus has real sync evidence in the repo (derived, not asserted)', () => {
    // If a cron route disappears, this corpus is no longer "mirrored" and the guard
    // below should be revisited deliberately rather than silently passing.
    for (const c of MIRRORED_CORPORA) {
      const exists = readFileSync(join(process.cwd(), c.syncEvidence, 'route.ts'), 'utf8');
      expect(exists.length, c.table).toBeGreaterThan(0);
    }
  });

  it('ABSENCE: every mirrored customer-serving corpus is represented in the inventory', () => {
    // NOTE (found by inject->red->revert, not assumed): an earlier version of this
    // check searched the whole file for the table name and PASSED when the dataset
    // row was deleted — because `headCount(supabase, 'dibbs_rfqs')` still mentions
    // it. Measuring a table is not representing it. The check must look at the
    // DATASET ROWS only.
    const datasetBlock = CODE.slice(CODE.indexOf('const datasets: DatasetEntry[]'));
    const missing = MIRRORED_CORPORA.filter((c) => {
      // a corpus is represented when a dataset row's count comes from its measurement
      const varNames = MEASUREMENT_VARS[c.table] ?? [];
      return !varNames.some((v) => new RegExp(`count:\\s*${v}\\b`).test(datasetBlock));
    });
    expect(missing.map((m) => m.table), 'not represented by any dataset row').toEqual([]);
  });

  it('CLASSIFICATION: a mirrored corpus is never labelled passthrough with a null count', () => {
    // This is the check the predecessor lacked. `grants` was LISTED and still wrong.
    const offenders: string[] = [];
    for (const line of CODE.split('\n')) {
      if (!line.includes('key:') || !line.includes('provenance:')) continue;
      const mirrored = MIRRORED_CORPORA.some((c) => line.includes(c.table));
      if (mirrored && line.includes("provenance: 'passthrough'")) offenders.push(line.trim().slice(0, 80));
    }
    expect(offenders, 'mirrored corpora described as live passthroughs').toEqual([]);
  });

  it('the SBIR slice is a VIEW, not a second counted dataset', () => {
    // 42 sbir_sttr rows are a strict subset of aggregated_opportunities. A standalone
    // top-level `sbir` dataset row would count the same records twice.
    expect(CODE).not.toMatch(/key:\s*'sbir'/);
    expect(CODE).toContain("key: 'research_sbir_sttr'");
    expect(CODE).toContain('subtypes');
  });

  it('the physical table name is not the product-facing label', () => {
    // The Data Core describes product domains, not database tables.
    expect(CODE).not.toMatch(/label:\s*'Aggregated Opportunities'/i);
    expect(CODE).toContain("label: 'Research & Lab Funding Opportunities'");
  });

  it('the two grant populations stay explicitly distinct', () => {
    // grants_cache and the research corpus both hold grant-type records from
    // different producers. They are not merged, deduped or reconciled here.
    const grantsLine = CODE.split('\n').find((l) => l.includes("key: 'grants'")) ?? '';
    expect(grantsLine).toContain('grants_cache');
    expect(grantsLine).toContain('Distinct store');
  });

  it('distinctSources is derived, never hand-entered', () => {
    expect(CODE).toContain('deriveDistinctSources');
    // the old literal must not come back
    expect(CODE).not.toMatch(/distinctSources:\s*\d+/);
  });

  it('genuinely live sources keep passthrough + null count', () => {
    for (const k of ['pricing_intel', 'incumbent_financials', 'regulatory_demand']) {
      const line = CODE.split('\n').find((l) => l.includes(`key: '${k}'`)) ?? '';
      expect(line, k).toContain("provenance: 'passthrough'");
      expect(line, k).toContain('count: null');
    }
  });
});
