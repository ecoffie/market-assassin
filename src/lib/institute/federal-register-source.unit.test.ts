import { describe, it, expect } from 'vitest';
import { decideAdmission, toInstituteDocument, fetchFederalRegisterSince, type FederalRegisterApiItem } from './federal-register-source';

const doc = (o: Partial<FederalRegisterApiItem> = {}): FederalRegisterApiItem => ({
  document_number: '2026-18839', type: 'Notice', title: 'A Title',
  abstract: null, publication_date: '2026-09-14',
  html_url: 'https://www.federalregister.gov/documents/2026/09/14/2026-18839/a-title',
  action: null, significant: null, topics: [], docket_ids: [], cfr_references: [],
  agencies: [{ name: 'Department of Defense' }], ...o,
});

/**
 * THREE OUTCOMES, NEVER TWO. The gate must distinguish "evaluated and irrelevant"
 * from "could not evaluate" — collapsing them is how a parser failure becomes
 * "0 relevant documents today".
 */
describe('admission gate — the three outcomes', () => {
  it('UNRESOLVED when a field the decision rests on is missing', () => {
    for (const missing of [{ document_number: null }, { title: '' }, { type: null }]) {
      const d = decideAdmission(doc(missing as Partial<FederalRegisterApiItem>));
      expect(d.outcome).toBe('unresolved');
      expect(d.category).toBe('insufficient_metadata');
    }
  });

  it('UNRESOLVED is never reported as NOT_RELEVANT', () => {
    const d = decideAdmission(doc({ title: '' }));
    expect(d.outcome).not.toBe('not_relevant');
  });

  it('NOT_RELEVANT for the FR’s recurring administrative furniture', () => {
    for (const t of ['Sunshine Act Meeting', 'Information Collection Being Reviewed by the FCC',
      'Board of Visitors, United States Military Academy', 'Airworthiness Directives; Airbus SAS Airplanes']) {
      const d = decideAdmission(doc({ title: t }));
      expect(d.outcome).toBe('not_relevant');
      expect(d.category).toBe('routine_notice');
    }
  });

  it('NOT_RELEVANT for real regulation that is not federal DEMAND', () => {
    // Measured: an unfiltered "admit every Rule" pulled these in.
    for (const t of ['Fisheries of the Northeastern United States; Atlantic Bluefish Fishery',
      'Safety Zone; Lake Erie, Oregon, OH',
      'Approval and Promulgation of State Air Quality Plans',
      'Modifying the Scope of Products of Canada Subject to the Additional Duties']) {
      const d = decideAdmission(doc({ type: 'Rule', title: t }));
      expect(d.outcome).toBe('not_relevant');
    }
  });

  it('ADMITS explicit acquisition / procurement policy', () => {
    const d = decideAdmission(doc({ title: 'Promoting Fair and Open Competitive Bidding in the E-Rate Program' }));
    expect(d.outcome).toBe('admitted');
    expect(d.category).toBe('acquisition_policy');
  });

  it('ADMITS funding / program authority', () => {
    const d = decideAdmission(doc({ title: 'Notice of Funding Opportunity for the Affordable Rural Cooperative Program' }));
    expect(d.outcome).toBe('admitted');
    expect(d.category).toBe('program_or_funding');
  });

  it('ADMITS industry engagement with market implications', () => {
    const d = decideAdmission(doc({ title: 'Request for Information on Test Methods for Evaluating Solid Waste' }));
    expect(d.outcome).toBe('admitted');
    expect(d.category).toBe('industry_engagement');
  });

  it('ADMITS a Rule/Proposed Rule that touches federal demand', () => {
    const d = decideAdmission(doc({ type: 'Rule', title: 'Amendment to the International Traffic in Arms Regulations' }));
    expect(d.outcome).toBe('admitted');
    expect(d.category).toBe('regulatory_requirement');
  });

  it('ADMITS a publisher-flagged significant action regardless of type', () => {
    const d = decideAdmission(doc({ significant: true, title: 'Anything At All' }));
    expect(d.outcome).toBe('admitted');
    expect(d.category).toBe('significant_action');
  });

  /**
   * "solicitation" alone is NOT an acquisition signal — measured, it matched
   * committee-nomination notices three times in one real batch.
   */
  it('does not admit "Solicitation for Nominations" as acquisition', () => {
    const d = decideAdmission(doc({ title: 'Solicitation for Nominations To Serve on the Family Caregiving Advisory Council' }));
    expect(d.category).not.toBe('acquisition_policy');
  });

  it('every decision carries a checkable basis', () => {
    for (const t of ['Sunshine Act Meeting', 'Notice of Funding Opportunity for X', 'Some Other Notice']) {
      expect(decideAdmission(doc({ title: t })).basis.length).toBeGreaterThan(10);
    }
  });
});

describe('Institute mapping — provenance survives', () => {
  it('maps onto the SHARED InstituteDocument shape with document_number as identity', () => {
    const d = toInstituteDocument(doc({ abstract: 'An abstract.', action: 'Final rule.' }), '2026-09-14');
    expect(d.sourceType).toBe('federal_register');
    expect(d.sourceOrg).toBe('Federal Register');
    expect(d.documentNumber).toBe('2026-18839');          // stable + unique = idempotency key
    expect(d.url).toContain('federalregister.gov');
    expect(d.publicationDate).toBe('2026-09-14');
    expect(d.sourceWatermark).toBe('2026-09-14');
    expect(d.abstract).toContain('An abstract.');
    expect(d.abstract).toContain('ACTION: Final rule.');   // admission basis is retained
    expect(d.abstract).toContain('AGENCY: Department of Defense');
  });

  it('falls back to a canonical URL when html_url is absent', () => {
    expect(toInstituteDocument(doc({ html_url: null }), null).url).toBe('https://www.federalregister.gov/d/2026-18839');
  });
});

describe('fetch — a source failure is never an empty result', () => {
  it('throws on a non-200 rather than returning []', async () => {
    await expect(fetchFederalRegisterSince('2026-09-11',
      (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch)).rejects.toThrow(/503/);
  });

  it('throws when the response has no results array (malformed)', async () => {
    await expect(fetchFederalRegisterSince('2026-09-11',
      (async () => ({ ok: true, json: async () => ({ unexpected: true }) })) as unknown as typeof fetch))
      .rejects.toThrow(/no results array/);
  });

  it('requests a BOUNDED forward window, never the full history', async () => {
    let url = '';
    await fetchFederalRegisterSince('2026-09-11', (async (u: string) => {
      url = u; return { ok: true, json: async () => ({ results: [] }) };
    }) as unknown as typeof fetch);
    expect(url).toContain('conditions%5Bpublication_date%5D%5Bgte%5D=2026-09-11');
    expect(url).toContain('per_page=200');
  });
});
