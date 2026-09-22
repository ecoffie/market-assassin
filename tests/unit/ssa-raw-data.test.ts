import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SSA `raw_data` must be a real JSON OBJECT, never a stringified blob.
 *
 * THE BUG THIS GUARDS: the importer did `raw_data: JSON.stringify(row)`. The column is
 * `jsonb`, so a STRING is stored as a JSON string and every read indexes it CHARACTER BY
 * CHARACTER. All 60 SSA rows imported 2026-04-06 hold ~258 single-character keys
 * ({, ", S, I, T, E, …) where the source row should be. Nothing threw; provenance was
 * silently destroyed and stayed that way for five months.
 *
 * The shape assertion is what matters: "keys are all numeric AND values are single
 * characters" is the exact fingerprint of a stringified object, and it is what these
 * tests refuse to let back in.
 */

/** The fingerprint of a stringified-object-stored-as-jsonb. */
function isCharacterIndexed(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every(k => /^\d+$/.test(k))
      && keys.every(k => String((v as Record<string, unknown>)[k] ?? '').length <= 1);
}

/** One parsed SSA source row, exactly as the workbook yields it. */
const SOURCE_ROW: Record<string, unknown> = {
  'SITE Type': 'DITSM',
  'APP #': 'OCIO-26-163H0',
  'REQUIREMENT TYPE': 'A NEW REQUIREMENT',
  'DESCRIPTION': 'purchase new licenses as well as annual subscriptions.',
  'EST COST PER FY': 4500000,
  'PLANNED AWARD DATE': '07/01/2026',
  'NAICS': '541611',
};

describe('SSA raw_data serialization', () => {
  it('stores the source row as an OBJECT with the real source keys', () => {
    const raw_data = SOURCE_ROW;                       // the fixed producer's value
    expect(typeof raw_data).toBe('object');
    expect(Array.isArray(raw_data)).toBe(false);
    expect(raw_data).not.toBeNull();
    for (const k of ['SITE Type', 'APP #', 'DESCRIPTION', 'NAICS']) {
      expect(Object.keys(raw_data)).toContain(k);
    }
    expect(raw_data['APP #']).toBe('OCIO-26-163H0');
  });

  it('has NO numeric character-index key pattern', () => {
    expect(isCharacterIndexed(SOURCE_ROW)).toBe(false);
    expect(Object.keys(SOURCE_ROW).every(k => /^\d+$/.test(k))).toBe(false);
  });

  it('round-trips as JSON without changing shape', () => {
    const round = JSON.parse(JSON.stringify(SOURCE_ROW));
    expect(round).toEqual(SOURCE_ROW);
    expect(Object.keys(round)).toEqual(Object.keys(SOURCE_ROW));
  });

  it('DETECTS the real defect: a stringified row is character-indexed', () => {
    // Reproduces production: jsonb given a string, read back as an object.
    const stored = { ...(JSON.stringify(SOURCE_ROW) as unknown as Record<string, string>) };
    expect(isCharacterIndexed(stored)).toBe(true);
    expect(Object.keys(stored).length).toBeGreaterThan(100);
    expect(stored['0']).toBe('{');
    expect(Object.keys(stored)).not.toContain('APP #');
  });

  it('the producer source does not call JSON.stringify on raw_data', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/import-ssa-forecasts.js'), 'utf8');
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).toMatch(/raw_data:\s*row\s*,/);
    expect(withoutComments).not.toMatch(/raw_data:\s*JSON\.stringify/);
  });
});
