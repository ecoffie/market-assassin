/**
 * Workstream E — the 212 quarantined legacy GAO rows are a PRESERVED HISTORICAL
 * SOURCE ERROR. No deterministic repair exists from held evidence.
 *
 * This test pins the DISPOSITION so a future session cannot quietly turn a guess
 * into an assertion about a federal agency. It is deliberately a source-level
 * test: the claim it guards ("nothing here is auto-correctable") is a property of
 * the migration's own logic, and must survive even when no database is reachable.
 *
 * ── MEASURED ON PRODUCTION 2026-09-21 (denominator: 445 gao_high_risk rows) ──
 *   SOURCE-PROVEN         0   <- nothing eligible for automatic correction
 *   TITLE-CORROBORATED    0   <- the 22 corroborated rows were never quarantined
 *   AMBIGUOUS           130   <- 64 unsupported_by_title + 66 artifact_agency
 *   NO EVIDENCE          82
 *                       ---
 *                       212   = 148 artifact_agency + 64 unsupported_by_title
 *
 * Exact-DDL validated against the real database (BEGIN -> verbatim file -> probe
 * -> ROLLBACK): base table 556 -> 556, gao_high_risk 445 -> 445, the customer
 * quarantine `agency_intelligence_agency_safe` 344 -> 344, evidence classes
 * unchanged, `repairability` appended after `attribution_evidence` with every
 * pre-existing column keeping its name and ordinal position.
 *
 * ── WHY SOURCE-PROVEN IS 0 (both candidate holders tested, both empty) ──────
 * (a) `institute_sources` holds 49 gao_report rows, published 2026-07-22 ..
 *     2026-09-18. This corpus is 1993-10-06 .. 2000-09-27. Document overlap: 0.
 * (b) The GovInfo record each row already cites exposes only `governmentAuthor1`
 *     = 'Government Accountability Office' (the PUBLISHER, 1 distinct value) and
 *     `governmentAuthor2` = GAO's own internal division. 0 of 45 records sampled
 *     name an agency UNDER REVIEW.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = 'supabase/migrations/20260921_gao_attribution_preserved_source_error.sql';
const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
const code = sql.replace(/--.*$/gm, ''); // strip comments: they QUOTE the patterns they explain

describe('the disposition migration mutates nothing', () => {
  it('creates only a view — no table column can be silently backfilled', () => {
    expect(code).toMatch(/CREATE OR REPLACE VIEW public\.agency_intelligence_attribution/);
    // The fabrication class caught in a prior workstream: ADD COLUMN ... DEFAULT NOW()
    // backfilled 57,816 rows and claimed the corpus arrived today. A view cannot.
    expect(code).not.toMatch(/ALTER\s+TABLE/i);
    expect(code).not.toMatch(/ADD\s+COLUMN/i);
    expect(code).not.toMatch(/DEFAULT\s+NOW\(\)/i);
  });

  it('issues no DELETE, no UPDATE on the corpus, and drops nothing', () => {
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+(public\.)?agency_intelligence\b/i);
    expect(code).not.toMatch(/\bDROP\s+(TABLE|VIEW)\b/i);
  });

  it('leaves the customer read quarantine INTACT — it is not even referenced', () => {
    expect(code).not.toMatch(/agency_intelligence_agency_safe/i);
  });

  it('preserves every pre-existing attribution column, appending repairability last', () => {
    const existing = [
      'id', 'source_document_id', 'agency_name', 'title_prefix', 'title', 'source_url',
      'rows_for_document', 'agencies_for_document', 'stored_agency_is_artifact',
      'attribution_evidence',
    ];
    // Match the final projection only: `c.<col>,` / `c.<col>\n` — a bare
    // lastIndexOf would match `c.title` inside `c.title_names_an_agency`, which
    // lives further down in the repairability CASE and would fake the ordering.
    const projection = code.slice(code.lastIndexOf('FROM classified c') - 2000);
    const positions = existing.map((c) => projection.search(new RegExp(`c\\.${c}\\s*,`)));
    // every pre-existing column still projected, and in its original order
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // repairability is projected after the last pre-existing column
    expect(projection.indexOf('AS repairability')).toBeGreaterThan(Math.max(...positions));
  });
});

describe('no row is proposed for automatic correction', () => {
  it('SOURCE-PROVEN is unreachable — the classifier can never emit it', () => {
    // The CASE arms are the whole value set. If a future edit adds a SOURCE-PROVEN
    // arm, it must come with new held evidence and a human decision, not a regex.
    const arms = [...code.matchAll(/(?:THEN|ELSE)\s+'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(arms).toContain('AMBIGUOUS');
    expect(arms).toContain('NO_EVIDENCE');
    expect(arms).not.toContain('SOURCE_PROVEN');
    expect(code).not.toMatch(/THEN\s+'SOURCE-PROVEN'/);
  });

  it('classifies ONLY the two quarantined evidence classes, leaving the rest NULL', () => {
    expect(code).toMatch(/NOT IN \('artifact_agency', 'unsupported_by_title'\)[\s\S]{0,40}THEN NULL/);
  });

  it('records the measured disposition on the view so it cannot be re-derived', () => {
    expect(sql).toMatch(/COMMENT ON VIEW public\.agency_intelligence_attribution/);
    expect(sql).toMatch(/SOURCE-PROVEN 0/);
    expect(sql).toMatch(/AMBIGUOUS 130/);
    expect(sql).toMatch(/NO_EVIDENCE 82/);
    expect(sql).toMatch(/PRESERVED HISTORICAL SOURCE ERROR/);
  });
});

describe('the root cause stays documented where the next reader will look', () => {
  it('names the title-keyword matcher, not a data problem', () => {
    expect(sql).toMatch(/extractAgenciesFromTitle/);
    expect(sql).toMatch(/General Government/);
  });

  it('records that BOTH evidence holders were tested and found empty', () => {
    expect(sql).toMatch(/institute_sources/);
    expect(sql).toMatch(/governmentAuthor1/);
    expect(sql).toMatch(/governmentAuthor2/);
  });
});
