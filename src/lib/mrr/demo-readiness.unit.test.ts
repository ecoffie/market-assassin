import { describe, expect, it } from 'vitest';
import { awardAmountLabel } from './award-amount';
import { buildDecisionBrief } from './decision-brief';
import { parseSizeStandardTable } from './ecfr-size-standards';
import { evidence, unknown, value } from './grounding';
import { formatSizeStandard, resolveSizeStandard } from './sba-size-standards';
import { buildSection12, lastCompleteFiscalYear } from './section-12-rule-of-two';
import { buildSection11 } from './section-11-suppliers';
import { supplierFunnel } from './supplier-funnel';

const ev = evidence('fixture', {});

/** The live Vandenberg 236220 / CA numbers measured on 2026-10-06. */
const VANDENBERG_FUNNEL = {
  naics: '236220',
  state: 'CA',
  eligiblePopulation: value(2442, ev),
  matchingPerformers: value(96, ev),
  scoredSample: value(50, ev),
  capableInScoredSample: value(44, ev),
  returnedRows: value(15, ev),
  checkedForParent: value(15, ev),
  resolvedFamilies: value(14, ev),
  unresolvedParents: value(1, ev),
};

describe('supplier funnel — every count names its population', () => {
  it('states the Vandenberg counts with their denominators', () => {
    const f = supplierFunnel(VANDENBERG_FUNNEL);
    expect(f.ran).toBe(true);
    expect(f.summary).toBe(
      'Of 2,442 small businesses registered in SAM for NAICS 236220 in California, 96 (3.9%) have held a federal prime contract in that NAICS. ' +
        'Mindy scored 50 of them; 44 of the 50 show capable or active performance. ' +
        'The 15 highest-scoring firms are listed with full detail. They belong to 14 distinct parent companies (1 with a parent not confirmed).',
    );
    const shares = Object.fromEntries(f.steps.map((s) => [s.key, s.share]));
    expect(shares).toEqual({
      registered: null,
      performers: '3.9% of the 2,442 registered firms',
      scored: '2.0% of the 2,442 registered firms',
      capable: '88.0% of the 50 scored firms',
      returned: '30.0% of the 50 scored firms',
      families: null,
      unresolved: null,
    });
  });

  it('never prints a raw engine ratio', () => {
    const blob = JSON.stringify(supplierFunnel(VANDENBERG_FUNNEL));
    expect(blob).not.toMatch(/sample_coverage|0\.039|matching UEIs|bounded sample/);
  });

  it('missing NAICS is stated as not run — never as a failed lookup or zero', () => {
    const f = supplierFunnel({ ...VANDENBERG_FUNNEL, naics: null, notRun: 'missing_naics' });
    expect(f.ran).toBe(false);
    expect(f.steps).toEqual([]);
    expect(f.summary).toMatch(/not run because no NAICS code was provided/);
    expect(f.summary).not.toMatch(/fail|zero|0 /i);
  });
});

describe('§11/§12 with no NAICS: missing input, not a failed lookup', () => {
  it('produces no "lookup failed" or "the stated NAICS" anywhere', async () => {
    const req = {
      title: 'SABER construction at Vandenberg Space Force Base',
      agency: 'Department of the Air Force',
      keyword: 'SABER',
      description: 'SABER construction',
      office: 'FA4610 30 CONS PK',
      place_of_performance_state: 'CA',
    };
    const s11 = await buildSection11(req, undefined);
    const s12 = await buildSection12(req, undefined, s11, {
      goalingOk: true,
      goalingResult: { agency: 'Department of the Air Force', fiscal_year: 2025, goals: null, _meta: { grounded: false } },
    });
    const blob = JSON.stringify({ s11, s12 });
    expect(blob).not.toMatch(/lookup failed|the stated NAICS|parent-edge resolution failed/i);
    expect(s12.determination.state).toBe('unknown');
    expect(JSON.stringify(s12.determination)).toMatch(/no NAICS code was provided/);
    expect(JSON.stringify(s12.recommendation)).toMatch(/missing input, not a failed lookup/);
  });

  it('the decision asks for the NAICS instead of implying a failure', () => {
    const decision = buildDecisionBrief({
      determination: unknown('not determined — no NAICS code was provided'),
      recommendation: value('No set-aside conclusion: the supplier search was not run because no NAICS code was provided.', ev),
      buyerAwardCount: 25,
      buyerHistoryEmpty: false,
      buyerHistoryUnknown: false,
      installationContextPresent: true,
      pricingUnknown: true,
      pricingDegraded: false,
      naicsMissing: true,
      supplierScopeLabel: 'Supplier capacity not measured (no NAICS code was provided)',
    });
    expect(decision.state).toBe('MORE RESEARCH NEEDED');
    expect(decision.found).toMatch(/25 in-scope awards/);
    expect(decision.found).toMatch(/Supplier search was not run because no NAICS code was provided/);
    expect(decision.nextAction).toBe('Add the NAICS code for this requirement and run the research again.');
    expect(JSON.stringify(decision)).not.toMatch(/lookup failed|stated NAICS|Ralph/);
  });
});

describe('agency small-business context compares like with like', () => {
  it('uses the latest COMPLETE fiscal year (DoD 90-day publication delay)', () => {
    expect(lastCompleteFiscalYear(new Date('2026-10-07T00:00:00Z'))).toBe(2025);
    expect(lastCompleteFiscalYear(new Date('2027-02-01T00:00:00Z'))).toBe(2026);
  });

  it('shows set-aside shares without setting them against the statutory goals', async () => {
    const s11 = await buildSection11({ title: 't', agency: 'Department of the Air Force', keyword: 'k', description: 'd' }, undefined);
    const s12 = await buildSection12({ title: 't', agency: 'Department of the Air Force', keyword: 'k', description: 'd' }, undefined, s11, {
      goalingOk: true,
      goalingResult: {
        agency: 'Department of the Air Force',
        fiscal_year: 2025,
        goals: [
          { category: 'Small Business (prime)', goal_pct: 23, actual_setaside_pct: 3.2, meets_goal: false },
          { category: 'SDVOSB', goal_pct: 3, actual_setaside_pct: 0.2, meets_goal: false },
        ],
        _meta: { grounded: true, small_business_setaside_share: 4.7 },
      },
    });
    const text = s12.goalingContext.state === 'value' ? s12.goalingContext.value : '';
    expect(text).toMatch(/FY2025 \(latest complete fiscal year\): 4\.7% of contract obligations were made under small-business set-aside codes/);
    expect(text).toMatch(/general small-business set-aside 3\.2%; SDVOSB 0\.2%/);
    expect(text).toMatch(/not comparable to the government-wide small-business goals/);
    expect(text).not.toMatch(/vs goal|23%|below|meets/);
  });
});

describe('SBA size standard from 13 CFR 121.201 (eCFR)', () => {
  const XML = `
    <TR><TH>NAICS codes</TH></TR>
    <TR><TD class="l">236220</TD><TD>Commercial and Institutional Building Construction</TD><TD>$45.0</TD><TD></TD></TR>
    <TR><TD>332994</TD><TD>Small Arms, Ordnance, and Ordnance Accessories Manufacturing</TD><TD></TD><TD>1,000</TD></TR>
    <TR><TD>541330</TD><TD>Engineering Services</TD><TD>$25.5</TD><TD></TD></TR>
    <TR><TD>541330 (Exception 1)</TD><TD>Military and Aerospace Equipment and Military Weapons</TD><TD>$47.0</TD><TD></TD></TR>`;
  const table = { asOf: '2026-10-05', lastAmended: '2023-03-17', rows: parseSizeStandardTable(XML) };

  it('parses receipts, employees and exception rows', () => {
    expect(table.rows['236220']).toMatchObject({ receiptsMillions: 45, employees: null, exceptions: [] });
    expect(table.rows['332994']).toMatchObject({ receiptsMillions: null, employees: 1000 });
    expect(table.rows['541330'].exceptions).toHaveLength(1);
  });

  it('cites the regulation with its as-of and last-amended dates', async () => {
    const r = await resolveSizeStandard('236220', async () => table);
    expect(r.field.state).toBe('value');
    if (r.field.state !== 'value') return;
    expect(formatSizeStandard(r.field.value)).toBe(
      '$45.0 million in average annual receipts (13 CFR 121.201 on eCFR, current as of 2026-10-05; section last amended 2023-03-17)',
    );
    expect(r.citation).toMatch(/13 CFR 121\.201, read from eCFR \(current as of 2026-10-05; section last amended 2023-03-17\)/);
    expect(r.field.evidence.url).toBe('https://www.ecfr.gov/current/title-13/section-121.201');
  });

  it('surfaces listed exceptions instead of presenting the base threshold as the only answer', async () => {
    const r = await resolveSizeStandard('541330', async () => table);
    if (r.field.state !== 'value') throw new Error('expected value');
    expect(formatSizeStandard(r.field.value)).toMatch(/lists 1 exception\(s\).*Military and Aerospace.*\$47\.0 million.*Confirm whether one applies/);
  });

  it('a code absent from the regulation is unknown — never a sibling code', async () => {
    const r = await resolveSizeStandard('999999', async () => table);
    expect(r.field.state).toBe('unknown');
  });

  it('when eCFR is unreachable, the stored copy is used and labelled as such', async () => {
    const r = await resolveSizeStandard('541512', async () => {
      throw new Error('offline');
    });
    if (r.field.state !== 'value') throw new Error('expected value');
    expect(formatSizeStandard(r.field.value)).toMatch(/eCFR was unreachable, so the stored copy was used/);
  });
});

describe('award amounts show the dollar figure', () => {
  it('leads with the amount, then what it measures', () => {
    expect(
      awardAmountLabel(value({ value: 13639322, label: 'award lifetime total to date, as reported by USASpending' }, ev)),
    ).toBe('$13,639,322 — award lifetime total to date, as reported by USASpending');
    expect(awardAmountLabel(unknown('not reported'))).toBeNull();
  });
});
