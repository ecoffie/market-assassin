/**
 * Per-section filter audit fixes (Eric 2026-07-28: "did you fix the filters 1 by 1 for each section").
 * A data-layer verification of every filter section (with-vs-without each filter on the real tables)
 * caught two dead/misleading controls the Zillow redesign didn't cause but surfaced:
 *   1. Open · Agency: `department` holds only the TOP tier ("DEPT OF DEFENSE"), so "Navy"/"Army"/"Air
 *      Force" matched 0 rows — those branches live in `sub_tier` (verified: sub_tier ILIKE '%navy%' =
 *      3,852 active opps vs department = 0). The filter now matches department OR sub_tier.
 *   2. Recompete · Set-aside: recompete_opportunities.set_aside_type is 100% NULL (143,882/143,882),
 *      so the Set-aside section was a DEAD control on that dataset. It no longer shows on recompete.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const dashSrc = readFileSync(join(__dirname, '../api/mi-dashboard/route.ts'), 'utf8');

describe('Open Agency filter matches sub-tier (service branches like Navy)', () => {
  it('mi-dashboard agency filter ORs department + sub_tier (not department-only)', () => {
    // The old `query.ilike('department', ...)` returned 0 for Navy/Army/Air Force.
    expect(dashSrc).toContain('department.ilike.%${a}%,sub_tier.ilike.%${a}%');
    // metachars stripped so the OR expression can't be broken by user input.
    expect(dashSrc).toContain("agency.replace(/[%,()]/g, '')");
  });
  it('the old department-only agency filter is gone', () => {
    expect(dashSrc).not.toContain("query = query.ilike('department', `%${agency}%`);");
  });
});

describe('Set-aside section is NOT shown on the Recompete dataset (dead control removed)', () => {
  it('the setaside section header + checks drop the mfv-recompete class', () => {
    const header = routeSrc.match(/<div class="([^"]*)" data-mfsec="setaside">Set-aside/);
    expect(header, 'set-aside section header must exist').toBeTruthy();
    expect(header![1]).toContain('mfv-open');
    expect(header![1]).toContain('mfv-companies');
    expect(header![1]).not.toContain('mfv-recompete'); // set_aside_type is 100% NULL on recompetes
    // the checks container likewise.
    const checks = routeSrc.match(/<div class="mf-checks ([^"]*)" data-mfsec="setaside">/);
    expect(checks![1]).not.toContain('mfv-recompete');
  });
});
