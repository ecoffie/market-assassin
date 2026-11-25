import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper shared with the importer script
import { samDate, samPurpose, registrationColumns } from '../../scripts/lib/sam-registration-dates.mjs';

function record(values: Record<number, string>): string[] {
  const f = Array.from({ length: 140 }, () => '');
  for (const [i, v] of Object.entries(values)) f[Number(i)] = v;
  return f;
}

describe('SAM registration dates from the public extract', () => {
  it('reads purpose and the three dates from their extract positions', () => {
    const f = record({ 6: 'Z2', 7: '20261120', 10: '20261121', 24: '20261118' });
    expect(registrationColumns(f)).toEqual({
      purpose_of_registration: 'Z2',
      sam_registration_date: '2026-11-20',
      sam_activation_date: '2026-11-21',
      initial_registration_date: '2026-11-18',
    });
  });

  it('turns blank or malformed values into null (unknown), never a guess', () => {
    expect(samDate('')).toBeNull();
    expect(samDate('2026112')).toBeNull();
    expect(samDate('20261340')).toBeNull(); // month 13
    expect(samDate('20260230')).toBeNull(); // Feb 30
    expect(samPurpose('Z9')).toBeNull();
    expect(samPurpose('')).toBeNull();
    expect(samPurpose(' z1 ')).toBe('Z1');
  });

  it('stays in step with SAM_EXTRACT_FIELDS in entity-extract-layout.ts', () => {
    const layout = readFileSync(join(process.cwd(), 'src/lib/sam/entity-extract-layout.ts'), 'utf8');
    expect(layout).toMatch(/purposeOfRegistrationCode:\s*6,/);
    expect(layout).toMatch(/registrationDate:\s*7,/);
    expect(layout).toMatch(/activationDate:\s*10,/);
    expect(layout).toMatch(/initialRegistrationDate:\s*24,/);
  });

  it('the importer writes these columns', () => {
    const importer = readFileSync(join(process.cwd(), 'scripts/import-sam-entity-extract.mjs'), 'utf8');
    expect(importer).toContain("from './lib/sam-registration-dates.mjs'");
    expect(importer).toContain('...registrationColumns(fields)');
  });
});
