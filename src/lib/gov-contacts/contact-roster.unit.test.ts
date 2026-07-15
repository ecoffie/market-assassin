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
import { subAgencyToParent, resolveAgency } from './contact-roster';

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

describe('resolveAgency — parent department + sub_tier narrow keyword', () => {
  it('Forest Service resolves to a sub_tier narrow keyword (for bureau-specific roster)', () => {
    expect(resolveAgency('Forest Service')).toEqual({ deptKeyword: 'Agriculture', subTier: 'forest service' });
    expect(resolveAgency('USFS')).toEqual({ deptKeyword: 'Agriculture', subTier: 'forest service' });
  });
  it('IRS and FEMA carry their own sub_tier narrow keyword', () => {
    expect(resolveAgency('IRS').subTier).toBe('internal revenue');
    expect(resolveAgency('FEMA').subTier).toBe('emergency management');
  });
  it('EPA is its own department (not lumped under Energy) with no sub_tier narrow', () => {
    expect(resolveAgency('EPA')).toEqual({ deptKeyword: 'Environmental Protection' });
  });
  it('an unknown agency has a deptKeyword but no sub_tier narrow', () => {
    expect(resolveAgency('Department of Agriculture').subTier).toBeUndefined();
  });
  it('a parent-department acronym resolves to the department keyword, no sub_tier narrow', () => {
    expect(resolveAgency('USDA')).toEqual({ deptKeyword: 'Agriculture' });
    expect(resolveAgency('DHS')).toEqual({ deptKeyword: 'Homeland Security' });
    expect(resolveAgency('HHS')).toEqual({ deptKeyword: 'Health' });
  });
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
