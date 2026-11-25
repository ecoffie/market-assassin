import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRegistrantRange, toRegistrantCsv, MAX_RANGE_DAYS } from './new-registrants';

describe('new SAM registrants — date range', () => {
  it('defaults to the last 7 days ending today (inclusive)', () => {
    expect(resolveRegistrantRange(null, null, '2026-11-23')).toEqual({ from: '2026-11-17', to: '2026-11-23' });
  });
  it('rejects bad, reversed or oversized ranges instead of guessing', () => {
    expect(resolveRegistrantRange('2026-02-30', '2026-03-01', '2026-11-23')).toHaveProperty('error');
    expect(resolveRegistrantRange('2026-11-20', '2026-11-10', '2026-11-23')).toHaveProperty('error');
    expect(resolveRegistrantRange('2026-01-01', '2026-11-23', '2026-11-23')).toHaveProperty('error');
    expect(MAX_RANGE_DAYS).toBe(92);
  });
});

describe('new SAM registrants — CSV', () => {
  const csv = toRegistrantCsv([
    {
      legal_business_name: 'Acme, "Federal" LLC', uei: 'ABC123DEF456', physical_state: 'VA',
      naics_codes: ['541512', '541611'], certifications: [], initial_registration_date: '2026-11-20',
      purpose_of_registration: 'Z2',
    },
    { legal_business_name: '=HYPERLINK("x")', uei: 'ZZZ', purpose_of_registration: null },
  ]);
  const lines = csv.replace('﻿', '').trim().split('\r\n');

  it('has a header plus one line per row, CRLF, UTF-8 BOM', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"First SAM registration"');
  });
  it('quotes commas and quotes, joins arrays, labels purpose', () => {
    expect(lines[1]).toContain('"Acme, ""Federal"" LLC"');
    expect(lines[1]).toContain('"541512; 541611"');
    expect(lines[1]).toContain('"All awards (contracts + grants)"');
  });
  it('unknown purpose reads Unknown, never assumed contract-eligible', () => {
    expect(lines[2]).toContain('"Unknown"');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('admin route wiring', () => {
  const route = readFileSync(join(process.cwd(), 'src/app/api/admin/new-sam-registrants/route.ts'), 'utf8');
  it('is admin-password gated', () => {
    expect(route).toContain('verifyAdminPassword');
  });
  it('excludes grants-only (Z1) but keeps unknown purpose', () => {
    expect(route).toContain("purpose_of_registration.is.null,purpose_of_registration.neq.Z1");
  });
  it('reads every page (no silent 1,000-row cap)', () => {
    expect(route).toContain('fetchAllPaged');
  });
});
