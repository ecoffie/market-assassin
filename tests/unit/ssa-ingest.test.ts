import { describe, it, expect } from 'vitest';
import { selectCanonicalLink, normalizeSetAside, parseEstCost, mapSourceRow } from '@/lib/forecasts/ssa-ingest';

/**
 * The SSA traps, each measured on the live source.
 *
 * The link test is the important one: the page really does list a STALE workbook whose
 * filename date parses LATER than the canonical one. Any rule that sorts by filename
 * picks the wrong file, so selection must be semantic — section + explicit FY label.
 */
const PAGE = `
<section><h2>Main Menu</h2><ul>
  <li><a href="assets/docs/SBF_SSASy_Report_12112026.xlsm">FY26 SSA Contract Forecast</a></li>
</ul></section>
<section><h2>Contracting Forecast</h2><ul>
  <li><a href="assets/docs/SBF_SSASy_Report_06222026.xlsm">FY26 SSA Contract Forecast</a></li>
  <li><a href="assets/docs/SBF_SSASy_Report_07012025.xlsm">FY25 SSA Contract Forecast</a></li>
  <li><a href="assets/docs/SBF_SSASy_Report_December2023.csv">FY23 SSA Contract Forecast</a></li>
  <li><a href="assets/docs/FY2022-Forecasting-List.pdf">FY22 SSA Contract Forecast</a></li>
</ul></section>`;

describe('SSA canonical link discovery', () => {
  it('selects the highest FY link INSIDE the Contracting Forecast section', () => {
    const p = selectCanonicalLink(PAGE);
    expect(p).not.toBeNull();
    expect(p!.url).toContain('SBF_SSASy_Report_06222026.xlsm');
    expect(p!.fy).toBe(2026);
  });

  it('does NOT pick the Main Menu copy, whose filename date looks newer', () => {
    // 12112026 parses as a later date than 06222026 — filename inference is disproven.
    expect(selectCanonicalLink(PAGE)!.url).not.toContain('12112026');
  });

  it('ignores non-machine-readable formats (PDF) even with an FY label', () => {
    const onlyPdf = `<h2>Contracting Forecast</h2><ul>
      <li><a href="assets/docs/FY2022-Forecasting-List.pdf">FY22 SSA Contract Forecast</a></li></ul>`;
    expect(selectCanonicalLink(onlyPdf)).toBeNull();
  });

  it('returns null when the Contracting Forecast section is absent (discovery failure)', () => {
    expect(selectCanonicalLink('<h2>Main Menu</h2><ul><li><a href="a.xlsm">FY26 x</a></li></ul>')).toBeNull();
  });

  it('resolves relative hrefs against the discovery page', () => {
    expect(selectCanonicalLink(PAGE)!.url).toBe('https://www.ssa.gov/osdbu/assets/docs/SBF_SSASy_Report_06222026.xlsm');
  });
});

describe('SSA field conventions', () => {
  it('normalizes the raw competition phrase, and does not mirror competition_type', () => {
    expect(normalizeSetAside('an unrestricted competition')).toBe('Full and Open');
    expect(normalizeSetAside('a total small business set-aside')).toBe('Small Business');
    expect(normalizeSetAside('8(a) sole source')).toBe('8(a)');
    expect(normalizeSetAside(null)).toBeNull();
    const m = mapSourceRow({ 'TYPE OF COMPETITION': 'an unrestricted competition' });
    expect(m.set_aside_type).toBe('Full and Open');
    expect(m.competition_type).toBe('an unrestricted competition');
    expect(m.set_aside_type).not.toBe(m.competition_type);
  });

  it('rounds estimated value — the column is bigint, so cents are not churn', () => {
    expect(parseEstCost(523932.39)).toEqual({ min: 523932, max: 523932 });
    expect(parseEstCost('$523,932.39')).toEqual({ min: 523932, max: 523932 });
    expect(parseEstCost(null)).toEqual({ min: null, max: null });
    expect(parseEstCost('')).toEqual({ min: null, max: null });
  });

  it('maps raw_data-adjacent fields without inventing values', () => {
    const m = mapSourceRow({ 'SITE Type': 'DITSM', 'DESCRIPTION': 'X', 'NAICS': '541611999' });
    expect(m.bureau).toBe('DITSM');
    expect(m.contracting_office).toBe('DITSM');
    expect(m.naics_code).toBe('541611');       // 6-char truncation
    expect(m.incumbent_name).toBeNull();       // absent stays null, never ''
  });
});
