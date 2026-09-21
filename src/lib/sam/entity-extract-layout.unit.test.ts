/**
 * SAM preservation — the source-boundary layout contract.
 *
 * THE RULE (Eric, 2026-08-24): "The importer should be lossless at its source boundary WITHOUT
 * the database being lossless." Understand all 142 source fields; materialize only the ~20-30
 * Mindy has product semantics for; keep the original evidence in the archived extract, not as
 * 910K JSON blobs in Postgres (measured ~7.5 GB even slimmed).
 */
import { describe, it, expect } from 'vitest';
import {
  SAM_EXTRACT_FIELDS, SAM_EXTRACT_FIELD_COUNT, AUDIT_CANDIDATE_FIELDS, parseSamExtractLine,
} from './entity-extract-layout';

describe('source layout', () => {
  it('knows the real record width (142 fields, measured on the Aug 2026 extract)', () => {
    expect(SAM_EXTRACT_FIELD_COUNT).toBe(142);
  });

  it('rejects BOF/EOF markers and short header lines, not real rows', () => {
    expect(parseSamExtractLine('BOF')).toBeNull();
    expect(parseSamExtractLine('')).toBeNull();
    expect(parseSamExtractLine(new Array(10).fill('x').join('|'))).toBeNull();
    expect(parseSamExtractLine(new Array(142).fill('x').join('|'))).not.toBeNull();
  });

  it('exposes every field positionally so adding field #16 needs no re-derivation', () => {
    const rec = parseSamExtractLine(new Array(142).fill('').map((_, i) => `v${i}`).join('|'))!;
    expect(rec.fieldCount).toBe(142);
    expect(rec.get(6)).toBe('v6');
    expect(rec.get(117)).toBe('v117');
  });
});

describe('audit findings — confirmed vs guessed', () => {
  it('purposeOfRegistration is CONFIRMED at index 6', () => {
    // Cross-checked at scale: Z1 has no NAICS in 99.86% of 33,541 cases; Z2 has NAICS in
    // 100% of 86,355. That correlation is what confirms the index, not the layout PDF.
    expect(AUDIT_CANDIDATE_FIELDS.purposeOfRegistrationCode).toBe(6);
  });

  it('UNCONFIRMED fields stay null rather than being guessed', () => {
    // A wrong index silently reads a neighbouring column and looks like real data — strictly
    // worse than a null, because it is confidently wrong.
    for (const k of ['naicsException', 'entityStructureCode', 'parentUei', 'certificationEntryDate']) {
      expect(AUDIT_CANDIDATE_FIELDS[k]).toBeNull();
    }
  });

  it('does not collide with the already-materialized field map', () => {
    // expirationDate is the one deliberate overlap (already stored as registration_expiry).
    expect(AUDIT_CANDIDATE_FIELDS.expirationDate).toBe(SAM_EXTRACT_FIELDS.expirationDate);
  });
});

describe('the database does NOT become lossless', () => {
  it('this module defines no raw-blob storage shape', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'src/lib/sam/entity-extract-layout.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^([^\n]*?)\/\/.*$/gm, '$1');
    // The parser representation is per-line and in-memory. If a future change starts writing
    // raw_data here, that is a storage decision that must be made deliberately, not incidentally.
    expect(code).not.toContain('raw_data');
  });
});
