import { describe, it, expect } from 'vitest';
import CORPUS from './agency-pain-points.json';

/**
 * POTATO 0 regression guard for the SHIPPED pain-point corpus.
 *
 * 15 attribution defects were repaired on 2026-09-13 (13 de-duplications +
 * 2 moves). Each was proven because the GAO title NAMES ITS OWN SUBJECT AGENCY
 * and sat in a different bucket.
 *
 * Root cause (proven by executing the real extractAgenciesFromTitle in
 * src/lib/agency-intelligence/fetchers/govinfo.ts): unanchored substring matching
 * fanning one title out to every matching agency with no primary —
 *   "ICE" => Homeland Security matched inside "Serv-ICE-s"
 *   "EPA" => EPA              matched inside "D-epa-rtment"
 *
 * These assertions pin the REPAIRED state so a corpus refresh cannot silently
 * reintroduce the defect.
 */

const agencies = (CORPUS as { agencies: Record<string, { painPoints?: string[] }> }).agencies;
const pointsFor = (a: string) => agencies[a]?.painPoints ?? [];
const bucketsHolding = (frag: string) =>
  Object.entries(agencies).filter(([, v]) => (v.painPoints ?? []).some((p) => p.includes(frag))).map(([b]) => b);

describe('shipped pain-point corpus — agency attribution', () => {
  it.each([
    ['Department of Veterans Affairs', "Hazardous Waste: Observations on EPA's Cleanup Program"],
    ['Department of Veterans Affairs', "Air Traffic Control: Observations on FAA's"],
    ['Department of Veterans Affairs', 'Department of the Interior: Observations on Performance Plan'],
    ['Department of Homeland Security', 'Department of Health and Human Services:'],
    ['Department of Homeland Security', 'Social Security Administration:'],
    ['Department of Homeland Security', 'SSA Customer Service:'],
    ['Environmental Protection Agency', 'Department of the Interior:'],
    ['Environmental Protection Agency', 'Department of Health and Human Services:'],
    ['Securities and Exchange Commission', 'Social Security Administration: SSA Needs to Act Now'],
  ])('%s must not hold "%s"', (bucket, frag) => {
    expect(pointsFor(bucket).some((p) => p.includes(frag))).toBe(false);
  });

  it.each([
    ["Hazardous Waste: Observations on EPA's Cleanup Program", 'Environmental Protection Agency'],
    ["Air Traffic Control: Observations on FAA's Air Traffic Control Modernization", 'Department of Transportation'],
    ['Department of the Interior: Observations on Performance Plan', 'Department of the Interior'],
    ['Department of the Interior: Year 2000 Computing Crisis', 'Department of the Interior'],
    ['Department of Health and Human Services: Strategic Planning', 'Department of Health and Human Services'],
    ['Department of Health and Human Services: Management Challenges', 'Department of Health and Human Services'],
    ['Social Security Administration: SSA Needs to Act Now', 'Social Security Administration'],
    ['SSA Customer Service: Broad Service Delivery', 'Social Security Administration'],
    ['Social Security Administration: Information Technology Challenges', 'Social Security Administration'],
  ])('"%s" lives exactly once, under %s', (frag, correct) => {
    expect(bucketsHolding(frag)).toEqual([correct]);
  });

  it('the junk parse-artifact buckets hold no pain points', () => {
    // "Department of the" / "Department of Health" came from a /Department of (\w+)/
    // fallback regex, not from a real agency identity.
    expect(pointsFor('Department of the')).toHaveLength(0);
    expect(pointsFor('Department of Health')).toHaveLength(0);
  });

  it('the repair did not change corpus scale', () => {
    const total = Object.values(agencies).reduce((n, v) => n + (v.painPoints ?? []).length, 0);
    expect(total).toBe(3032); // 3,045 before − 13 de-duplications (the 2 moves are net-zero)
    expect(Object.keys(agencies)).toHaveLength(307);
  });
});
