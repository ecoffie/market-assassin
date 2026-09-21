import { describe, it, expect } from 'vitest';
import { guardFacts, extractOrgEntities } from '@/lib/proposal/fact-guard';

// The REAL draft text measured on prod 2026-08-18 (B149 Chiller Replacement at Pease ANGB).
const REAL_DRAFT = `### Executive Summary

The General Services Administration (GSA) is dedicated to modernizing federal facilities to enhance operational efficiency, sustainability, and resilience. This solicitation addresses the critical need for facility modernization services at the U.S. Army Capability Development Command (DEVCOM) Armaments Center, focusing on rapid response for maintenance, repair, and minor construction tasks at locations such as Picatinny Arsenal and Benet Labs.`;

// What the pursuit ACTUALLY grounds on (agency + the two real solicitation documents).
const REAL_GROUNDING = `B149 Chiller Replacement at Pease ANGB. DEPT OF DEFENSE. NAICS 238220.
Statement of Work B149 Chiller. Pease Air National Guard Base, New Hampshire.`;

describe('fact-guard: fabricated ORGANIZATION names (FM-P03)', () => {
  it('catches every fabricated org in the real measured draft', () => {
    const r = guardFacts(REAL_DRAFT, REAL_GROUNDING, { sanitize: true });
    expect(r.hasFabrication).toBe(true);
    // the four inventions must NOT survive into the sanitized text
    expect(r.text).not.toMatch(/General Services Administration/i);
    expect(r.text).not.toMatch(/Picatinny/i);
    expect(r.text).not.toMatch(/Benet/i);
    expect(r.text).not.toMatch(/\(GSA\)|\(DEVCOM\)/);
    expect(r.text).toContain('[confirm organization]');
  });

  it('does NOT bracket an org that IS in the grounding', () => {
    const draft = 'Work is performed at Pease Air National Guard Base under this contract.';
    const r = guardFacts(draft, REAL_GROUNDING, { sanitize: true });
    expect(r.text).toContain('Pease Air National Guard Base');
    expect(r.text).not.toContain('[confirm organization]');
  });

  it('does NOT treat our own section headings as organizations', () => {
    const draft = '### Executive Summary\n\nTechnical Approach\n\nPast Performance\n\nQuality Control';
    const ents = extractOrgEntities(draft);
    expect(ents.map(e => e.value)).toEqual([]);
  });

  it('never lets a candidate run bleed across a newline', () => {
    // the first probe of this fix produced "Executive Summary\nThe General Services Administration"
    const ents = extractOrgEntities('Executive Summary\nThe General Services Administration');
    expect(ents.some(e => /Executive Summary/i.test(e.value))).toBe(false);
    expect(ents.some(e => /General Services Administration/i.test(e.value))).toBe(true);
  });

  it('ignores a bare capitalized run with no org head word', () => {
    // ordinary prose must never be bracketed
    const ents = extractOrgEntities('The Offeror Will Provide Rapid Response Maintenance Services.');
    expect(ents.map(e => e.value).filter(v => /Rapid Response/i.test(v))).toEqual([]);
  });
});

/**
 * Standard proposal / contracting vocabulary is NOT an organization.
 *
 * MEASURED 2026-08-18 on a real end-to-end export (map → pursuit → draft → .docx): the
 * delivered document contained the heading "Work Breakdown Structure ([confirm organization])".
 * (WBS) is a document artifact, not an agency — the acronym rule shipped that morning treated
 * every parenthesised capital run as an org. These terms appear in nearly every federal
 * proposal, so bracketing them corrupts the deliverable in its most visible place: a heading.
 */
describe('fact-guard: proposal vocabulary is not an organization', () => {
  it('does not bracket (WBS) in a real section heading', () => {
    const draft = 'Work Breakdown Structure (WBS)\nThe project at Pease ANGB follows the WBS below.';
    const r = guardFacts(draft, 'B149 Chiller Replacement at Pease ANGB.', { sanitize: true });
    expect(r.text).toContain('(WBS)');
    expect(r.text).not.toContain('[confirm organization]');
  });

  it('leaves the other common contracting acronyms alone', () => {
    for (const a of ['PWS', 'QASP', 'CDRL', 'CLIN', 'IGCE', 'HVAC', 'NAICS', 'SDVOSB']) {
      const ents = extractOrgEntities(`The requirement (${a}) is defined below.`);
      expect(ents.map(e => e.value)).not.toContain(a);
    }
  });

  it('STILL catches a real fabricated agency acronym', () => {
    // the allow-list must not blunt the actual guard
    const ents = extractOrgEntities('issued by the agency (DEVCOM) for this work');
    expect(ents.map(e => e.value)).toContain('DEVCOM');
  });
});
