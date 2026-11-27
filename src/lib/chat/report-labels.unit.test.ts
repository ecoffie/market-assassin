/**
 * Research-mode reports: framing is never shown as "Unverified: no source" (Eric's EFS demo report, 2026-11-27).
 *
 * Cause: the create_document schema offered no sub-heading (section `level`), so the model wrote sub-headings, section
 * intros, "How to read this" and coverage notes as uncited `fact` paragraphs, and demoteUncitedFacts listed each one
 * under "Unverified statements". The fix is the schema + guidance (no validator change): sub-headings are level-2
 * sections, method text is `context` in a role-'about' section, offers of help are recommendations, and open-web facts
 * cite a declared kind-'web' source. Fictional company; no customer data.
 */
import { describe, it, expect } from 'vitest';
import type { DocModel } from '@/lib/documents/model';
import { validateDocModel, demoteUncitedFacts } from '@/lib/documents/validate';
import { CREATE_DOCUMENT_TOOL_DEF } from './generate-document-tool';
import { RESEARCH_INSTRUCTIONS } from '@/lib/ask-mindy/research-mode';

const SOURCES: DocModel['sources'] = [
  { id: 's-sam', label: 'SAM.gov entity registration', kind: 'tool', recordId: 'NWD123ABC456' },
  { id: 's-award', label: 'USAspending award', kind: 'usaspending', url: 'https://www.usaspending.gov/award/CONT_AWD_EXAMPLE_0001', recordId: 'CONT_AWD_EXAMPLE_0001' },
  { id: 's-web', label: 'Company profile page', kind: 'web', url: 'https://www.linkedin.com/company/northwind-digital-media' },
];

/** The shape the demo report had: framing written as uncited fact paragraphs. */
const BEFORE: DocModel = {
  title: 'Northwind Digital Media: where to start in federal advertising',
  sources: SOURCES,
  sections: [
    { id: 'sec-read', heading: 'How to read this', blocks: [{ type: 'paragraph', id: 'b1', claim: 'fact', text: 'This report leads with the decision, then the evidence behind it.' }] },
    { id: 'sec-moves', heading: 'Priority opportunities and recommendations', blocks: [
      { type: 'paragraph', id: 'b2', claim: 'fact', text: 'Ranked moves (dollar values come from the award or notice records cited)' },
      { type: 'paragraph', id: 'b3', claim: 'recommendation', text: 'Email the outreach office about the recruiting campaign this week.' },
    ] },
    { id: 'sec-stand', heading: 'Where Northwind stands today', blocks: [
      { type: 'paragraph', id: 'b4', claim: 'fact', text: 'Registration and eligibility (Mindy SAM registration record)' },
      { type: 'paragraph', id: 'b5', claim: 'fact', text: 'The SAM registration is active.', cites: ['s-sam'] },
      { type: 'paragraph', id: 'b6', claim: 'fact', text: "The founder's profile already positions the firm for public-sector digital advertising." },
      { type: 'paragraph', id: 'b7', claim: 'fact', text: 'GovCon Giants can review the updated capability statement before it goes out.' },
    ] },
    { id: 'sec-money', heading: 'Where the money is moving', blocks: [
      { type: 'paragraph', id: 'b8', claim: 'fact', text: 'Larger national items seen (for awareness; not first targets)' },
      { type: 'paragraph', id: 'b9', claim: 'fact', text: 'A national campaign award was made in this market.', cites: ['s-award'] },
    ] },
  ],
};

/** The same content in the shape the guidance now asks for. */
const AFTER: DocModel = {
  title: 'Northwind Digital Media: where to start in federal advertising',
  sources: SOURCES,
  sections: [
    { id: 'sec-read', heading: 'How to read this', role: 'about', blocks: [{ type: 'paragraph', id: 'b1', claim: 'context', text: 'This report leads with the decision, then the evidence behind it.' }] },
    { id: 'sec-moves', heading: 'Priority opportunities and recommendations', blocks: [
      { type: 'paragraph', id: 'b3', claim: 'recommendation', text: 'Email the outreach office about the recruiting campaign this week.' },
    ] },
    { id: 'sec-stand', heading: 'Where Northwind stands today', blocks: [] },
    { id: 'sec-stand-reg', heading: 'Registration and eligibility', level: 2, blocks: [
      { type: 'paragraph', id: 'b5', claim: 'fact', text: 'The SAM registration is active.', cites: ['s-sam'] },
    ] },
    { id: 'sec-stand-ready', heading: 'Readiness checklist', level: 2, blocks: [
      { type: 'paragraph', id: 'b6', claim: 'fact', text: "The founder's profile already positions the firm for public-sector digital advertising.", cites: ['s-web'] },
      { type: 'paragraph', id: 'b7', claim: 'recommendation', text: 'GovCon Giants can review the updated capability statement before it goes out.' },
    ] },
    { id: 'sec-money', heading: 'Where the money is moving', blocks: [] },
    { id: 'sec-money-national', heading: 'Larger national items (for awareness; not first targets)', level: 2, blocks: [
      { type: 'paragraph', id: 'b9', claim: 'fact', text: 'A national campaign award was made in this market.', cites: ['s-award'] },
    ] },
    { id: 'sec-coverage', heading: 'Sources and coverage', role: 'about', blocks: [
      { type: 'paragraph', id: 'b10', claim: 'context', text: 'This report uses public federal records and the pages cited.' },
      { type: 'paragraph', id: 'b11', claim: 'fact', text: 'Registration facts come from the SAM registration record; award facts come from the award pages cited.', cites: ['s-sam', 's-award'] },
    ] },
  ],
};

describe('contacts: a citation marker, never provenance prose (Eric, 2026-11-27)', () => {
  const NOTICE: DocModel['sources'][number] = { id: 's-notice', label: 'SAM.gov notice EXAMPLE0001, base contracting office', kind: 'sam_notice', recordId: 'EXAMPLE0001' };
  const CONTACTS: DocModel = {
    title: 'Northwind Digital Media: action plan',
    sources: [...SOURCES, NOTICE],
    sections: [{ id: 'sec-who', heading: 'Who to talk to and what to say', blocks: [{
      type: 'table', id: 'b-who', claim: 'fact', cites: ['s-notice'],
      columns: [{ key: 'person', label: 'Person' }, { key: 'office', label: 'Office' }, { key: 'ask', label: 'The question to ask' }],
      rows: [{ person: 'Contracting officer (named on the notice)', office: 'Base contracting office', ask: 'When do you expect the next requirement?' }],
    }] }],
  };
  it('a contact table cites its notice source, so nothing is demoted, and no cell or line explains where it came from', () => {
    const d = demoteUncitedFacts(CONTACTS);
    expect(d.unverified).toEqual([]);
    expect(d.model.sections[0].blocks[0]).toMatchObject({ cites: ['s-notice'] });
    expect(JSON.stringify(d.model.sections)).not.toMatch(/from the (office's )?(recent )?(SAM )?notice|retrieved|last seen/i);
  });
  it('an uncited contact table is demoted: contacts are facts and must cite', () => {
    const { cites: _c, ...uncited } = CONTACTS.sections[0].blocks[0] as { cites?: string[] };
    void _c;
    expect(demoteUncitedFacts({ ...CONTACTS, sections: [{ ...CONTACTS.sections[0], blocks: [uncited as DocModel['sections'][number]['blocks'][number]] }] }).unverified).toEqual(['b-who']);
  });
});

describe('research report labels: framing never lands in "Unverified statements"', () => {
  it('BEFORE (the demo report shape): every framing line and the uncited web fact were demoted', () => {
    const d = demoteUncitedFacts(BEFORE);
    expect(d.unverified).toEqual(['b1', 'b2', 'b4', 'b6', 'b7', 'b8']);
  });

  it('AFTER (level-2 sub-headings, about/context, recommendation, cited web source): valid, zero unverified, nothing omitted', () => {
    expect(validateDocModel({ schema: 'mindy.doc/1', date: '2026-11-27', ...AFTER })).toMatchObject({ ok: true });
    const d = demoteUncitedFacts(AFTER);
    expect(d.unverified).toEqual([]);
    expect(d.omitted).toEqual([]);
    expect(d.model).toEqual(AFTER);
  });

  it('the guard still holds: a date or an award named in method text is a claim, so uncited it is demoted (validator unchanged)', () => {
    const asContext = (text: string): DocModel => ({ ...AFTER, sections: AFTER.sections.map((s) => s.id === 'sec-coverage'
      ? { ...s, blocks: [{ type: 'paragraph', id: 'b10', claim: 'context', text }] }
      : s) });
    expect(demoteUncitedFacts(asContext('Registration facts come from the SAM record dated November 2026.')).unverified).toEqual(['b10']);
    expect(demoteUncitedFacts(asContext('Award facts come from the award pages cited.')).unverified).toEqual(['b10']);
  });

  it('create_document offers sub-headings (level) and states the label rules to the model', () => {
    const fn = CREATE_DOCUMENT_TOOL_DEF.function as { description: string; parameters: { properties: { doc_model: { properties: { sections: { items: { properties: Record<string, { enum?: unknown[]; description?: string }> } } } } } } };
    const sec = fn.parameters.properties.doc_model.properties.sections.items.properties;
    expect(sec.level.enum).toEqual([1, 2]);
    expect(sec.role.description).toMatch(/How to read this.*Sources and coverage/);
    expect(fn.description).toMatch(/a heading or sub-heading is a section heading \(level 2 for a sub-heading\), never a paragraph/);
    expect(fn.description).toMatch(/an offer of help .* is a recommendation/);
    expect(fn.description).toMatch(/kind: 'web', url, label \} and cited/);
  });

  it('research-mode instructions repeat it for reports', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/sub-headings .* are level-2 sections, never paragraphs/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/declared kind 'web' with its URL/);
  });
});
