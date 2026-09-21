/**
 * Network map: filter to ONE agency or buying office (Eric 2026-08-14, "you can sort people by
 * agencies or offices").
 *
 * AGENCY already worked on both sub-datasets (buyers → department_ind_agency ilike; companies →
 * the sells-to-agency scope inside searchRecipients). OFFICE did not exist at all.
 *
 * THE TRAP this locks down: `federal_contacts.office` is NULL on **all 126,097** usable rows
 * (measured 2026-08-14 — with_office = 0). So an `office ILIKE` filter returns ZERO every time,
 * which is exactly the bug that made a USACE district card fall back to dept-wide DoD. The real
 * office key is the **solicitation_number PREFIX**: W912PL by sol-number = 116 rows / 19 people,
 * by office column = 0.
 *
 * Second rule locked here: a DoDAAC is a GOVERNMENT buying-office code, so it cannot describe a
 * company. Rather than silently ignore the filter on the companies dataset (leaving every firm on
 * screen — "the filter did nothing"), the route returns an honest empty set + a `notApplicable`
 * reason. Silently dropping a filter the user set is the same class of bug as the old NAICS
 * freetext box.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const mapSrc = readFileSync(
  join(__dirname, '..', '..', '..', 'opportunity-map', 'route.ts'),
  'utf8',
);

describe('contacts-map: office filter matches the solicitation PREFIX, never the office column', () => {
  it('filters on solicitation_number, because federal_contacts.office is NULL on every row', () => {
    expect(
      /ilike\('solicitation_number',\s*`\$\{params\.office\.toUpperCase\(\)\}%`\)/.test(routeSrc),
      'office must be matched as a solicitation_number prefix',
    ).toBe(true);
    // The trap: an `office` column filter would compile fine and return 0 forever.
    expect(
      /\.ilike\('office',/.test(routeSrc),
      'must NOT filter on the office column — it is NULL on all 126,097 rows',
    ).toBe(false);
  });

  it('applies the office filter INSIDE the query, before the row limit', () => {
    // A post-filter would rank the whole corpus first and starve a single district of its people
    // (the rank-then-filter class this repo already has a gate for).
    const buyers = routeSrc.slice(routeSrc.indexOf('async function buyersPins'));
    const officeAt = buyers.indexOf("ilike('solicitation_number'");
    const limitAt = buyers.indexOf('.limit(4000)');
    expect(officeAt, 'office filter must exist in buyersPins').toBeGreaterThan(-1);
    expect(limitAt, 'the 4000 limit must exist').toBeGreaterThan(-1);
    // Both are in the same builder chain; the filter must be applied to the query object, not to
    // the returned rows — assert it appears before the rows are read back.
    const readAt = buyers.indexOf('const { data, count, error } = await q;');
    expect(officeAt).toBeLessThan(readAt);
  });

  it('only a VALID DoDAAC narrows — junk input is ignored, never an empty map', () => {
    expect(isValidDodaac('W912PL')).toBe(true);
    expect(isValidDodaac('W912BV')).toBe(true);
    expect(isValidDodaac('Navy')).toBe(false);      // an agency name is not an office code
    expect(isValidDodaac('')).toBe(false);
    expect(isValidDodaac('W912')).toBe(false);      // too short
    expect(isValidDodaac('W912PL9')).toBe(false);   // too long
  });
});

describe('contacts-map: an office filter is honest about companies', () => {
  it('returns an explicit notApplicable reason instead of silently ignoring it', () => {
    expect(routeSrc).toMatch(/officeApplied && type === 'companies'/);
    expect(routeSrc).toMatch(/notApplicable:/);
    // The empty set must be explicit — not a fall-through that leaves every firm rendered.
    const block = routeSrc.slice(routeSrc.indexOf("officeApplied && type === 'companies'"));
    expect(block.slice(0, 400)).toMatch(/pins: \[\]/);
  });
});

describe('opportunity-map: the Office control is buyers-only and reaches the API', () => {
  it('the field is scoped to the buyers view (mfv-buyers) and not to companies', () => {
    const field = mapSrc.slice(mapSrc.indexOf('id="mfOffice"') - 200, mapSrc.indexOf('id="mfOffice"') + 60);
    expect(field).toContain('mfv-buyers');
    expect(field, 'a DoDAAC has no meaning for a company pin').not.toContain('mfv-companies');
  });

  it('office is read into FILT and sent ONLY on the buyers request', () => {
    expect(mapSrc).toMatch(/FILT\.office=\(\(document\.getElementById\('mfOffice'\)/);
    expect(
      mapSrc.includes("+((t==='buyers'&&FILT.office)?'&office='+encodeURIComponent(FILT.office):'')"),
      'the companies request must not carry office (it would return the empty notApplicable set)',
    ).toBe(true);
  });

  it('office is cleared by Clear-all and counts as an active filter', () => {
    expect(mapSrc).toMatch(/'mfNaics','mfPsc','mfFsc','mfAgency','mfOffice'/);
    expect(mapSrc).toMatch(/\[FILT\.naics,FILT\.psc,FILT\.agency,FILT\.office,/);
  });
});
