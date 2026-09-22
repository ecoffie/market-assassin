/**
 * Compliance Matrix Truth — hermetic acceptance for the deterministic source gate.
 * Every case mirrors a failure measured on the gold master (VA 36C24226Q0857);
 * the live package itself is exercised by scripts/acceptance/poteto-compliance-matrix-truth.mts.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeWithMap,
  sectionEstablished,
  unsupportedFigures,
  verifyComplianceMatrix,
  type MatrixSourceDoc,
} from './matrix-verification';

const SOLICITATION = [
  'Table of Contents',
  'SECTION B - CONTINUATION OF SF 1449 BLOCKS\t5',
  'C.1  52.212-4  CONTRACT TERMS AND CONDITIONS\t17',
  'E.1  52.212-1  INSTRUCTIONS TO OFFERORS\t48',
  '',
  '2.15   Submittals',
  '',
  'The contractor shall submit all required submittals and shop drawings for review and approval prior to the start of work.',
  'Each submittal shall include project title, location, project number,  date, subcontractor name (if applicable), specification section, product identification, and revision history.',
  '',
  'Contractors shall submit all required 10-day notifications to applicable regulatory agencies.',
  '',
  '2.16   Emergency Services',
  '',
  'Upon notification, the Contractor shall respond within thirty (30) minutes and be on-site within two (2) hours of the call.',
  'All proposals are due October 16th, 2026 at 10:00EST. Quotes shall be emailed to the Contracting Officer.',
  'The contractor shall perform demoli-',
  '   tion in accordance with the approved “work plan”.',
  '',
  'SECTION C - CONTRACT CLAUSES',
  'C.1  52.212-4  CONTRACT TERMS AND CONDITIONS',
  '(l) Termination for the Government’s convenience. The Contractor shall immediately stop all work and shall immediately cause any and all of its suppliers and subcontractors to cease work.',
].join('\n');

const WAGE = 'General Decision Number: NJ20260001. Laborers shall be paid not less than the rate listed in this wage determination.';

const DOCS: MatrixSourceDoc[] = [
  { document_id: 'doc-a', filename: '36C24226Q0857_1.docx', text: SOLICITATION, role: 'attachment' },
  { document_id: 'doc-b', filename: 'WD+Essex.docx', text: WAGE, role: 'attachment' },
  { document_id: 'doc-c', filename: 'WD+Somerset.docx', text: WAGE, role: 'attachment' },
];

const row = (o: Record<string, string>) => ({ id: 'REQ', category: 'technical', requirement: '', ...o });

describe('Compliance Matrix Truth — quote verification', () => {
  it('1+2: a verbatim quote verifies EXACT and names its document + exact char range', () => {
    const q = 'The contractor shall submit all required submittals and shop drawings for review and approval prior to the start of work.';
    const r = verifyComplianceMatrix([row({ requirement: 'Submit all required submittals and shop drawings before work starts.', source_quote: q })], DOCS);
    expect(r.requirements).toHaveLength(1);
    const v = r.requirements[0].verification;
    expect(v.quote_status).toBe('verified_exact');
    expect(r.requirements[0].source_doc).toBe('36C24226Q0857_1.docx');
    expect(SOLICITATION.slice(v.found_in[0].char_start, v.found_in[0].char_end)).toBe(q);
    expect(v.page).toBeNull(); // no manufactured page precision
  });

  it('3: whitespace, line wraps, extraction hyphenation, smart quotes and a dropped space do not create false failures', () => {
    const r = verifyComplianceMatrix(
      [
        row({ requirement: 'Include project title, location, project number and date in each submittal.', source_quote: 'Each submittal shall include project title, location, project number, date, subcontractor name' }),
        row({ requirement: 'Perform demolition per the approved work plan.', source_quote: 'The contractor shall perform demolition in accordance with the approved "work plan".' }),
        row({ requirement: 'Proposals are due October 16th, 2026 at 10:00 EST.', source_quote: 'All proposals are due October 16th, 2026 at 10:00 EST.' }),
      ],
      DOCS,
    );
    expect(r.withheld).toEqual([]);
    expect(r.requirements.map((x) => x.verification.quote_status)).toEqual(['verified_normalized', 'verified_normalized', 'verified_normalized']);
    // The normalized match still maps to the real source span.
    const loc = r.requirements[1].verification.found_in[0];
    expect(SOLICITATION.slice(loc.char_start, loc.char_end)).toContain('demoli-');
  });

  it('4: a fabricated quote is withheld as unverifiable, never trusted', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Submit a 25-page technical volume.', source_quote: 'The technical volume shall not exceed twenty-five pages in 12-point font.' })],
      DOCS,
    );
    expect(r.requirements).toEqual([]);
    expect(r.withheld[0].withheld_reason).toBe('unverifiable');
    expect(r.summary.withheld_by_reason).toEqual({ unverifiable: 1 });
  });

  it('8: source-unavailable is distinct from unverifiable when the package was not fully readable', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Submit a 25-page technical volume.', source_quote: 'The technical volume shall not exceed twenty-five pages in 12-point font.' })],
      DOCS,
      { sourceIncomplete: true },
    );
    expect(r.withheld[0].withheld_reason).toBe('source_unavailable');
    expect(r.withheld[0].verification.quote_status).toBe('source_unavailable');
  });

  it('a row with no quote at all cannot be verified and is withheld', () => {
    const r = verifyComplianceMatrix([row({ requirement: 'Register in SAM.' })], DOCS);
    expect(r.withheld[0].withheld_reason).toBe('no_source_quote');
  });

  it('6: a quote that exists in document A cannot be cited as document B', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Submit 10-day notifications to regulatory agencies.', source_quote: 'Contractors shall submit all required 10-day notifications to applicable regulatory agencies.', source_doc: 'WD+Essex.docx' })],
      DOCS,
    );
    expect(r.requirements).toEqual([]);
    expect(r.withheld[0].withheld_reason).toBe('source_mismatch');
    expect(r.withheld[0].verification.found_in[0].filename).toBe('36C24226Q0857_1.docx');
  });

  it('14: identical documents are all reported (identity preserved, not collapsed)', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Pay laborers not less than the listed wage determination rate.', source_quote: 'Laborers shall be paid not less than the rate listed in this wage determination.' })],
      DOCS,
    );
    expect(r.requirements[0].verification.found_in.map((f) => f.filename)).toEqual(['WD+Essex.docx', 'WD+Somerset.docx']);
  });

  it('7: a paraphrase never masquerades as a verbatim quote', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Respond to emergency calls within 30 minutes and be on-site within two hours.', source_quote: 'Contractor must respond to the call within thirty (30) minutes and be on-site within two (2) hours.' })],
      DOCS,
    );
    expect(r.requirements).toEqual([]);
    expect(r.interpretations).toHaveLength(1);
    const i = r.interpretations[0];
    expect(i).not.toHaveProperty('source_quote');
    expect(i.model_paraphrase).toMatch(/^Contractor must respond/);
    // The evidence IS source text, sliced from the document.
    expect(SOLICITATION).toContain(i.source_evidence);
    expect(i.verification.quote_status).toBe('paraphrase');
  });
});

describe('Compliance Matrix Truth — requirement must be supported by its quote', () => {
  it('a real sentence attached to an unrelated requirement is withheld (the 13 submittal-log rows)', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Submit Fire Safety Plan.', source_quote: 'Contractors shall submit all required 10-day notifications to applicable regulatory agencies.' })],
      DOCS,
    );
    expect(r.requirements).toEqual([]);
    expect(r.withheld[0].withheld_reason).toBe('quote_does_not_support_requirement');
    expect(r.withheld[0].verification.quote_status).toBe('verified_exact'); // the quote is real; the ROW is not
  });

  it('a figure the requirement adds that its evidence lacks is withheld', () => {
    expect(unsupportedFigures('Submit Fire Safety Plan as specified in Section 1.5.', 'Fire Safety Plan')).toEqual(['1.5']);
    expect(unsupportedFigures('Respond within 30 minutes.', 'respond within thirty (30) minutes')).toEqual([]);
    expect(unsupportedFigures('Bond projects over $35,000.00.', 'projects over $35,000.00 at the time')).toEqual([]);
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Submit required 10-day notifications as specified in Section 2.4.A.', source_quote: 'Contractors shall submit all required 10-day notifications to applicable regulatory agencies.' })],
      DOCS,
    );
    expect(r.withheld[0].withheld_reason).toBe('quote_does_not_support_requirement');
    expect(r.withheld[0].verification.unsupported_figures).toEqual(['2.4.a']);
  });
});

describe('Compliance Matrix Truth — section citations', () => {
  const q10 = 'Contractors shall submit all required 10-day notifications to applicable regulatory agencies.';
  const cite = (section: string) =>
    verifyComplianceMatrix([row({ requirement: 'Submit required 10-day notifications to regulatory agencies.', section, source_quote: q10 })], DOCS);

  it('5+13: a nonexistent "Section L" is never emitted on a trusted row', () => {
    for (const s of ['L', 'Section L', 'L.3.2']) {
      const r = cite(s);
      expect(r.requirements).toHaveLength(1); // the quote is real — the requirement survives…
      expect(r.requirements[0]).not.toHaveProperty('section'); // …the citation does not
      expect(r.requirements[0].verification.section_status).toBe('withheld_unverified');
      expect(r.requirements[0].verification.section_claimed).toBe(s);
    }
  });

  it('a clause paragraph letter (52.212-4 "(l)") is not a section', () => {
    const r = verifyComplianceMatrix(
      [row({ requirement: 'Stop all work on termination for convenience.', section: 'l', source_quote: 'The Contractor shall immediately stop all work' })],
      DOCS,
    );
    expect(r.requirements[0]).not.toHaveProperty('section');
    expect(r.summary.sections_withheld).toBe(1);
  });

  it('a model-invented prefix ("C.2.15" for the printed "2.15") is withheld; the printed label is kept', () => {
    expect(cite('C.2.15').requirements[0]).not.toHaveProperty('section');
    const ok = cite('2.15');
    expect(ok.requirements[0].section).toBe('2.15');
    expect(ok.requirements[0].verification.section_status).toBe('verified');
  });

  it('a table-of-contents entry or a different section does not establish the label', () => {
    // "C.1" is printed (TOC + real clause heading) but not above this quote.
    expect(cite('C.1').requirements[0]).not.toHaveProperty('section');
    // "2.16" is a real heading — but AFTER the quote.
    expect(cite('2.16').requirements[0]).not.toHaveProperty('section');
    const doc = DOCS[0];
    const at = SOLICITATION.indexOf('Upon notification');
    expect(sectionEstablished('2.16', doc, at)).toBe(true);
    expect(sectionEstablished('2.15', doc, at)).toBe(false);
  });
});

describe('Compliance Matrix Truth — the gate keeps the good rows', () => {
  it('11+12+15: verified rows survive and the summary reports verified vs withheld', () => {
    const rows = [
      row({ requirement: 'Submit all required submittals and shop drawings before work.', section: '2.15', source_quote: 'The contractor shall submit all required submittals and shop drawings for review and approval prior to the start of work.' }),
      row({ requirement: 'Email quotes to the Contracting Officer.', source_quote: 'Quotes shall be emailed to the Contracting Officer.' }),
      row({ requirement: 'Submit Fire Safety Plan.', section: 'C.1', source_quote: 'Contractors shall submit all required 10-day notifications to applicable regulatory agencies.' }),
      row({ requirement: 'Submit a 25-page technical volume.', section: 'L', source_quote: 'The technical volume shall not exceed twenty-five pages.' }),
    ];
    const r = verifyComplianceMatrix(rows, DOCS);
    expect(r.summary).toMatchObject({
      method: 'deterministic_source_text_match',
      candidates_total: 4,
      requirements_verified: 2,
      interpretations: 0,
      candidates_withheld: 2,
      withheld_by_reason: { quote_does_not_support_requirement: 1, unverifiable: 1 },
    });
    expect(r.requirements.map((x) => x.section)).toEqual(['2.15', undefined]);
  });

  it('normalizeWithMap maps every normalized char back into the original', () => {
    const src = 'A  “quoted”\n\n  demoli-\n tion';
    const { norm, map } = normalizeWithMap(src);
    expect(norm).toBe('a "quoted" demolition');
    expect(map).toHaveLength(norm.length);
    expect(src[map[norm.indexOf('t')]]).toBe('t');
  });
});
