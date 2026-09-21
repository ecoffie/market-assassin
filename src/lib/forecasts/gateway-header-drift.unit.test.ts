/**
 * Gateway export header drift.
 *
 * THE BUG (measured 2026-09-14 against a live 47-column export): the Gateway renamed
 *   `Agency`       -> `Funding Department / Ind. Agency`
 *   `Organization` -> `Funding Organization`   (+ a new `Funding Office`)
 * `gwFieldFor` matched the old names with `===`, so all three returned null and the DEPARTMENT,
 * BUREAU and OFFICE were silently dropped on every ingest — no error, no warning. That is why the
 * held canonical `bureau` column holds a CONSTANT (the department's own name) rather than a real
 * bureau, and why the FAS/PBS/FWS/NPS/Forest-Service subagency identities can only anchor on the
 * retired duplicate `api` rows.
 */
import { describe, it, expect } from 'vitest';
import { gwFieldFor, assertGatewayHeaders, GATEWAY_CRITICAL_FIELDS } from './gateway-forecast';

/** The exact header row of the live export downloaded 2026-09-14. */
const LIVE_HEADERS = [
  'Node_ID','Listing ID','Title','Description','Body','Funding Department / Ind. Agency',
  'Funding Organization','Funding Office','Contracting Department/Ind. Agency',
  'Contracting Office / Organization','Region','Place of Performance City',
  'Place of Performance State','Place of Performance Country','NAICS Code','Requirement Status',
  'Basic Exercised Value','Basic Exercised Options','Acquisition Phase','Estimated Contract Value',
  'Delivery Order Value','Current Fiscal Year Projected Obligation','Funding Source',
  'Estimated Award FY-QTR','Estimated Award FY','Estimated Solicitation Date','Solicitation Link',
  'Period of Performance','Ultimate Completion Date','Set Aside Type','Contract Type',
  'Procurement Method','Extent Competed','Additional Information','Contractor Name',
  'Type of Awardee','Award Type','Awarded Contract Order','Content: Point of Contact (Name) For',
  'Point of Contact (Email)','Current Completion Date','Content: Small Business Specialist Email',
  'Content: Small Business Specialist Name','Content: Small Business Specialist Info (Phone)',
  'CreatedDate','ChangedDate','Published',
];

describe('current export headers map', () => {
  const CASES: Array<[string, string]> = [
    ['Funding Department / Ind. Agency', 'agency'],
    ['Funding Organization', 'organization'],
    ['Funding Office', 'office'],
    ['ChangedDate', 'changedDate'],
    ['Solicitation Link', 'sourceUrl'],
    ['Listing ID', 'listingId'],
    ['Point of Contact (Email)', 'pocEmail'],
    ['NAICS Code', 'naics'],
  ];
  for (const [header, field] of CASES) {
    it(`"${header}" -> ${field}`, () => expect(gwFieldFor(header)).toBe(field));
  }

  it('the OLD spellings still map, so exports already on disk keep parsing', () => {
    expect(gwFieldFor('Agency')).toBe('agency');
    expect(gwFieldFor('Organization')).toBe('organization');
  });
});

describe('header-drift guard', () => {
  it('accepts the live 47-column export with no missing critical field', () => {
    const r = assertGatewayHeaders(LIVE_HEADERS);
    expect(r.missing).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.mapped.organization).toBe('Funding Organization');
    expect(r.mapped.agency).toBe('Funding Department / Ind. Agency');
  });

  it('FAILS LOUDLY when a critical column is renamed again', () => {
    // Simulate the next rename: `Funding Organization` -> something new.
    const drifted = LIVE_HEADERS.filter((h) => h !== 'Funding Organization' && h !== 'Organization');
    const r = assertGatewayHeaders(drifted);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('organization');
  });

  it('every critical field is genuinely satisfiable by the live export', () => {
    const r = assertGatewayHeaders(LIVE_HEADERS);
    for (const f of GATEWAY_CRITICAL_FIELDS) expect(r.mapped[f], `${f} unmapped`).toBeTruthy();
  });

  it('bureau is a CRITICAL field — it anchors subagency identity', () => {
    expect(GATEWAY_CRITICAL_FIELDS as readonly string[]).toContain('organization');
  });
});
