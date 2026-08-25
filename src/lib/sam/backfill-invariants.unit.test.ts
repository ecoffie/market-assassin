/**
 * BACKFILL INVARIANTS — the enrichment job must never manufacture a SAM entity.
 *
 * THE FAILURE THIS PINS (measured 2026-08-24): the first full run used
 * `upsert(..., { onConflict: 'uei' })` and wrote **ZERO** rows — all 895,429 failed with
 *     null value in column "legal_business_name" violates not-null constraint
 *
 * PostgREST's upsert sends a full INSERT and only resolves the conflict afterwards, so the
 * NOT NULL check fires on columns this backfill deliberately does not supply. Proven on a
 * single row that certainly exists: upsert FAILED, update succeeded.
 *
 * `UPDATE` is also the correct SEMANTIC, not merely the working one (Eric): this job ENRICHES
 * rows that already exist. A UEI absent from the mirror must write nothing and be counted as
 * `unmatched` — which is NOT an error. Conflating "not there" with "broken" is the same
 * evidence-vs-fact confusion as `count ?? 0`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = () => {
  const s = readFileSync(join(process.cwd(), 'scripts/backfill-sam-cert-dates.ts'), 'utf8');
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
          .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
};

describe('the job never creates an entity', () => {
  it('uses UPDATE, not upsert/insert', () => {
    const c = src();
    expect(c).toContain(".update({");
    expect(c).not.toContain('.upsert(');
    expect(c).not.toMatch(/\.insert\(/);
  });

  it('scopes every write to an existing uei', () => {
    expect(src()).toContain(".eq('uei', row.uei)");
  });

  it('counts an unmatched uei separately from a failure', () => {
    // "not in the mirror" is a fact about coverage, not an error.
    const c = src();
    expect(c).toContain('unmatched');
    expect(c).toMatch(/matched === 0/);
  });
});

describe('it writes only the two new columns', () => {
  it('never touches certifications[] — the has/had compatibility field', () => {
    const c = src();
    expect(c).toContain('certification_records');
    expect(c).toContain('purpose_of_registration');
    // A write to `certifications:` would silently rewrite history.
    expect(c).not.toMatch(/\bcertifications:\s/);
  });
});

describe('honesty of the stored status', () => {
  it('evaluates currency against the SNAPSHOT date, not today', () => {
    // Evaluating a 2026-08-02 extract against today would silently age certifications that
    // were current when the snapshot was taken.
    const c = src();
    expect(c).toContain('snapshotDateFrom');
    expect(c).toContain('AS_OF');
  });

  it('surfaces failures rather than swallowing them', () => {
    const c = src();
    expect(c).toContain('failed');
    expect(c).toMatch(/console\.error/);
  });
});
