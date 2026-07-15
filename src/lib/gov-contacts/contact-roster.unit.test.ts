/**
 * subAgencyToParent — bureau → parent-department resolution.
 *
 * federal_contacts tags civilian contacts only at the parent-department level
 * (empty sub_agency). So a bureau name like "Forest Service" must resolve to a
 * keyword that matches department_ind_agency ("Department of Agriculture"),
 * else the roster query returns zero and the tool falls back to just the single
 * OSBP contact. These tests lock the mapping in.
 */
import { describe, it, expect } from 'vitest';
import { subAgencyToParent } from './contact-roster';

describe('subAgencyToParent — civilian bureau aliases', () => {
  const cases: Array<[string, string]> = [
    ['Forest Service', 'Agriculture'],
    ['US Forest Service', 'Agriculture'],
    ['USFS', 'Agriculture'],
    ['NRCS', 'Agriculture'],
    ['IRS', 'Treasury'],
    ['Internal Revenue Service', 'Treasury'],
    ['FBI', 'Justice'],
    ['Bureau of Prisons', 'Justice'],
    ['FEMA', 'Homeland Security'],
    ['Customs and Border Protection', 'Homeland Security'],
    ['National Park Service', 'Interior'],
    ['Bureau of Land Management', 'Interior'],
    ['CDC', 'Health'],
    ['FDA', 'Health'],
    ['FAA', 'Transportation'],
    ['NOAA', 'Commerce'],
    ['Veterans Health Administration', 'Veterans'],
  ];
  for (const [input, parent] of cases) {
    it(`"${input}" → ${parent}`, () => {
      expect(subAgencyToParent(input)).toBe(parent);
    });
  }
});

describe('subAgencyToParent — non-bureau fallback (filler-word strip)', () => {
  it('a full department name reduces to its distinctive keyword', () => {
    // "Department of Agriculture" → strips "department"/"of" → "Agriculture"
    expect(subAgencyToParent('Department of Agriculture')).toBe('Agriculture');
  });
  it('an unknown agency keeps its meaningful words (still ilike-matchable)', () => {
    expect(subAgencyToParent('National Aeronautics and Space Administration')).toMatch(/National Aeronautics and Space/i);
  });
});
