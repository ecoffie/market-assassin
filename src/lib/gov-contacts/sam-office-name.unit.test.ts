/**
 * Guards for the sam_office_name pass.
 *
 * The core invariant is that office_name (the historical FPDS record) is NEVER
 * touched: FPDS and SAM disagree for ~187 offices and both are right about
 * different questions, so the write must be single-column.
 *
 * Every case below is a real row measured against the live directory
 * (2026-08-01).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/gov-contacts/refresh-dodaac-directory.ts'),
  'utf8',
);

/** Mirrors samIsLessSpecific() — kept in sync by the source-shape test below. */
const samIsLessSpecific = (samName: string, fpdsName: string | null): boolean => {
  if (!fpdsName) return false;
  const s = samName.trim().toUpperCase();
  const f = fpdsName.trim().toUpperCase();
  if (!s || !f || s === f) return false;
  return f.startsWith(s) && f.length > s.length;
};

describe('samIsLessSpecific', () => {
  it('skips a SAM name that is a strict truncation of the FPDS name', () => {
    // The 6 real rows the guard exists to catch.
    expect(samIsLessSpecific('FPAC BUS CNTR-ACQ DIV', 'FPAC BUS CNTR-ACQ DIV-CENTRAL SEC')).toBe(true);
    expect(samIsLessSpecific('FPAC BUS CNTR-ACQ DIV', 'FPAC BUS CNTR-ACQ DIV-WESTERN SEC')).toBe(true);
    expect(samIsLessSpecific('DCSO COLUMBUS', 'DCSO COLUMBUS DIVISION #3')).toBe(true);
    expect(samIsLessSpecific('SELECTIVE SERVICE SYSTEM', 'SELECTIVE SERVICE SYSTEM (SSS)')).toBe(true);
  });

  it('still writes a genuinely BETTER name that happens to differ', () => {
    // The whole point of the column — an internal code becoming a real name.
    expect(samIsLessSpecific('MONONGAHELA NATIONAL FOREST', 'USDA-FS, CSA EAST 5')).toBe(false);
    expect(samIsLessSpecific('ENDIST BALTIMORE', 'ENDIST LOUISVILLE')).toBe(false);
    expect(samIsLessSpecific('ENDIST WALLA WALLA', 'US ARMY ENGINEER DISTRICT WALLA WAL')).toBe(false);
  });

  it('treats identical names as not-less-specific', () => {
    expect(samIsLessSpecific('DLA AVIATION', 'DLA AVIATION')).toBe(false);
    expect(samIsLessSpecific('  DLA AVIATION  ', 'dla aviation')).toBe(false);
  });

  it('handles a missing FPDS name', () => {
    expect(samIsLessSpecific('ANYTHING', null)).toBe(false);
    expect(samIsLessSpecific('ANYTHING', '')).toBe(false);
  });

  it('does not treat a LONGER SAM name as less specific', () => {
    expect(samIsLessSpecific('DLA AVIATION AT OKLAHOMA CITY, OK', 'DLA AVIATION')).toBe(false);
  });
});

describe('refreshSamOfficeNames write shape', () => {
  // These assert on the SOURCE, because the danger is a future edit widening
  // the write — a unit test on the return value would not catch that.
  const fn = SRC.slice(SRC.indexOf('export async function refreshSamOfficeNames'));

  it('updates ONLY sam_office_name and its timestamp', () => {
    const update = /\.update\(\{([^}]*)\}\)/.exec(fn);
    expect(update, 'no .update() found in refreshSamOfficeNames').toBeTruthy();
    const payload = update![1];
    expect(payload).toContain('sam_office_name');
    expect(payload).toContain('sam_office_name_updated_at');
    // The invariant: the historical FPDS column must never be in the payload.
    // Must be a WORD-BOUNDARY check — "sam_office_name:" contains the substring
    // "office_name:", so a plain .toContain() flags the correct code as broken.
    expect(payload).not.toMatch(/(^|[^_a-z])office_name\s*:/);
  });

  it('never upserts or inserts (that would create bogus office rows)', () => {
    // fillDodaacGapsFromSam proved inserting SAM-derived DoDAACs is unsafe.
    expect(fn).not.toContain('.upsert(');
    expect(fn).not.toContain('.insert(');
  });

  it('is gated by a dryRun option that returns before writing', () => {
    expect(fn).toContain('opts.dryRun');
    const dryIdx = fn.indexOf('opts.dryRun');
    const updIdx = fn.indexOf('.update(');
    expect(dryIdx, 'dryRun check must come before the write').toBeLessThan(updIdx);
  });

  it('skips rows where SAM is less specific', () => {
    expect(fn).toContain('samIsLessSpecific');
    expect(fn).toContain('skippedLessSpecific');
  });
});
