/**
 * A2 — legacy GAO attribution evidence. Repairs nothing; pins the contract that
 * the evidence view must never GUESS an agency.
 *
 * Measured 2026-09-20: 445 rows → artifact 148 · unsupported 64 ·
 * no_title_evidence 211 · corroborated 22.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260920_agency_attribution_evidence.sql'),
  'utf8',
);

describe('the evidence view repairs nothing', () => {
  it('performs no UPDATE, DELETE or INSERT on the corpus', () => {
    const body = SQL.replace(/--.*$/gm, '');
    expect(body).not.toMatch(/\bUPDATE\s+public\.agency_intelligence\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\s+public\.agency_intelligence\b/i);
    expect(body).not.toMatch(/\bINSERT\s+INTO\s+public\.agency_intelligence\b/i);
  });

  it('creates a VIEW, not a table that could drift from the source', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.agency_intelligence_attribution/);
  });
});

describe('ambiguity is preserved, never resolved by guessing', () => {
  it('a row with no agency-shaped title prefix is no_title_evidence', () => {
    expect(SQL).toContain("'no_title_evidence'");
    // the ELSE branch must be the honest one, not a fallback agency
    expect(SQL).toMatch(/ELSE 'no_title_evidence'/);
  });

  it('all four evidence classes exist and none asserts a corrected agency', () => {
    for (const c of ['artifact_agency', 'unsupported_by_title', 'corroborated_by_title', 'no_title_evidence']) {
      expect(SQL).toContain(`'${c}'`);
    }
    expect(SQL).not.toMatch(/resolved_agency|corrected_agency|true_agency/i);
  });

  it('identity is the source-native document id, not the title or a count', () => {
    expect(SQL).toMatch(/source_document_id/);
    expect(SQL).toMatch(/regexp_replace\(ai\.source_url/);
  });

  it('the six artifact strings are enumerated, not inferred from volume', () => {
    for (const a of ['General Government', 'Department of the', 'Department of Health', 'Department of Veterans', 'for Agency', 'Governing Agency']) {
      expect(SQL).toContain(a);
    }
  });
});
