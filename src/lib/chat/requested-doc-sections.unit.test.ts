import { describe, it, expect } from 'vitest';
import { ensureRequestedSections, requestedDocSections, requestedSectionsPlannerNote, requestedSectionsMissingNote, routeSectionedReport, sectionsPackagedReportLacks, packagedReportGapNote } from './requested-doc-sections';
import { isDocumentCreationRequest } from './generate-document-tool';
import type { DocModel } from '@/lib/documents/model';

const keys = (t: string) => requestedDocSections(t).map((r) => r.key);

describe('requestedDocSections: only what the customer named', () => {
  it('reads the four sections from plain requests', () => {
    expect(keys('Write it up as a PDF with an executive summary, risks, actions and sources')).toEqual(['executive_summary', 'risks', 'actions', 'sources']);
    expect(keys('Give me a report: exec summary, key risks, next steps, citations')).toEqual(['executive_summary', 'risks', 'actions', 'sources']);
    expect(keys('BLUF first, then an action plan')).toEqual(['executive_summary', 'actions']);
    expect(keys('include references')).toEqual(['sources']);
  });

  it('award jargon is not a request for an Actions section', () => {
    expect(keys('How many contract actions did VA award last year?')).toEqual([]);
    expect(keys('Show the number of actions and the procurement actions by office')).toEqual([]);
    expect(keys('List the corrective actions in the report')).toEqual([]);
  });

  it('nothing named → nothing requested', () => {
    expect(keys('Make this a PDF')).toEqual([]);
    expect(keys('')).toEqual([]);
    expect(requestedSectionsPlannerNote([])).toBeNull();
  });

  it('the planner note names each section and says the file (not the chat) must carry it', () => {
    const note = requestedSectionsPlannerNote(requestedDocSections('executive summary, risks, actions and sources'))!;
    expect(note).toContain('Executive summary, Risks, Actions, Sources');
    expect(note).toMatch(/doc_model MUST carry each one as its own section/);
    expect(note).toMatch(/The chat answer does not count/);
    expect(note).toMatch(/Never fill it with a guess/);
  });
});

describe('ensureRequestedSections', () => {
  const doc = (sections: DocModel['sections'], sources: DocModel['sources'] = [{ id: 's1', kind: 'usaspending', label: 'USAspending' }]): DocModel =>
    ({ schema: 'mindy.doc/1', title: 'T', date: '2026-11-22', sources, sections });

  it('executive summary leads; risks and actions go before trailing about sections', () => {
    const m = doc([
      { id: 'a', heading: 'Market', blocks: [{ type: 'paragraph', id: 'p', text: 'Spend was $5M.', claim: 'fact', cites: ['s1'] }, { type: 'paragraph', id: 'q', text: 'Bid the March recompete.', claim: 'recommendation' }] },
      { id: 'b', heading: 'How to read this', role: 'about', blocks: [{ type: 'paragraph', id: 'c', text: 'Method notes.', claim: 'context' }] },
    ]);
    const r = ensureRequestedSections(m, requestedDocSections('executive summary and actions'));
    expect(r.added).toEqual(['executive_summary', 'actions']);
    expect(r.model.sections.map((s) => s.heading)).toEqual(['Executive summary', 'Market', 'Actions', 'How to read this']);
    // input is not mutated
    expect(m.sections.map((s) => s.heading)).toEqual(['Market', 'How to read this']);
  });

  it('context statements are never copied; ids stay unique', () => {
    const m = doc([
      { id: 'sec-actions', heading: 'Intro', role: 'about', blocks: [{ type: 'paragraph', id: 'blk-actions', text: 'You should read this first.', claim: 'context' }] },
      { id: 'b', heading: 'Body', blocks: [{ type: 'paragraph', id: 'p', text: 'Call the office.', claim: 'recommendation' }] },
    ]);
    const r = ensureRequestedSections(m, requestedDocSections('actions'));
    const added = r.model.sections.find((s) => s.heading === 'Actions')!;
    expect(added.id).toBe('sec-actions-2');
    expect(added.blocks[0].id).toBe('blk-actions-2');
    expect(JSON.stringify(added)).not.toContain('read this first');
  });

  it('sources are present only when a statement cites a declared source', () => {
    const cited = doc([{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'fact', cites: ['s1'] }] }]);
    expect(ensureRequestedSections(cited, requestedDocSections('sources')).present).toEqual(['sources']);
    const uncited = doc([{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'recommendation' }] }]);
    const r = ensureRequestedSections(uncited, requestedDocSections('sources'));
    expect(r.missing).toEqual(['sources']);
    expect(r.model).toBe(uncited);
    expect(requestedSectionsMissingNote(r.missing)).toMatch(/no statement in it cites a source/);
  });
});

const REPRO = 'Turn this research into a professional market intelligence report with an executive summary, agency analysis, opportunity pipeline, incumbent research, risks, recommended actions and sources.';

describe('the Claude Local repro prompt', () => {
  it('is a document request ("turn this research into ... report")', () => {
    expect(isDocumentCreationRequest(REPRO)).toBe(true);
    expect(isDocumentCreationRequest('Turn these findings into a PDF')).toBe(true);
    expect(isDocumentCreationRequest('Turn this into a report')).toBe(true);
    // still not a document request
    expect(isDocumentCreationRequest('Turn left at the research park and tell me about VA spending')).toBe(false);
  });

  it('reads every named section: the four known kinds, then the rest in the customer\'s words', () => {
    expect(requestedDocSections(REPRO)).toEqual([
      { key: 'executive_summary', label: 'Executive summary' },
      { key: 'risks', label: 'Risks' },
      { key: 'actions', label: 'Actions' },
      { key: 'sources', label: 'Sources' },
      { key: 'named', label: 'Agency analysis' },
      { key: 'named', label: 'Opportunity pipeline' },
      { key: 'named', label: 'Incumbent research' },
    ]);
  });

  it('the packaged template lacks all but the agency analysis (its Agency deep-dive covers that)', () => {
    expect(sectionsPackagedReportLacks(requestedDocSections(REPRO)).map((r) => r.label)).toEqual(['Executive summary', 'Risks', 'Actions', 'Sources', 'Opportunity pipeline', 'Incumbent research']);
  });
});

describe('routeSectionedReport', () => {
  const requested = requestedDocSections(REPRO);
  it('research in chat + document tool → document', () => {
    expect(routeSectionedReport({ requested, asksForReport: true, createAvailable: true, hasPriorResearch: true }).route).toBe('document');
  });
  it('first turn → packaged with a plain gap note; no document tool → same, different reason', () => {
    const first = routeSectionedReport({ requested, asksForReport: true, createAvailable: true, hasPriorResearch: false });
    expect(first).toMatchObject({ route: 'packaged_with_gap_note', reason: 'no_prior_research' });
    const none = routeSectionedReport({ requested, asksForReport: true, createAvailable: false, hasPriorResearch: true });
    expect(none).toMatchObject({ route: 'packaged_with_gap_note', reason: 'no_document_tool' });
    if (first.route === 'packaged_with_gap_note') expect(packagedReportGapNote(first)).toMatch(/do not include Executive summary, Risks, Actions, Sources, Opportunity pipeline, Incumbent research; never present it as the report they asked for/);
  });
  it('no report asked, no sections named, or only sections the template carries → unchanged', () => {
    expect(routeSectionedReport({ requested, asksForReport: false, createAvailable: true, hasPriorResearch: true }).route).toBe('none');
    expect(routeSectionedReport({ requested: [], asksForReport: true, createAvailable: true, hasPriorResearch: true }).route).toBe('none');
    expect(routeSectionedReport({ requested: requestedDocSections('a comprehensive market research report with competitive landscape and forecasts'), asksForReport: true, createAvailable: true, hasPriorResearch: true }).route).toBe('none');
  });
});

describe('named sections in the document', () => {
  it('a named section is present when a heading covers it, otherwise reported missing (never built)', () => {
    const m = { schema: 'mindy.doc/1', title: 'T', date: '2026-11-22', sources: [{ id: 's1', kind: 'usaspending', label: 'U' }], sections: [
      { id: 'a', heading: 'Opportunities in the pipeline', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'fact', cites: ['s1'] }] },
    ] } as DocModel;
    const r = ensureRequestedSections(m, requestedDocSections('a report with opportunity pipeline and incumbent research'));
    expect(r.present).toEqual(['Opportunity pipeline']);
    expect(r.missing).toEqual(['Incumbent research']);
    expect(r.model).toBe(m);
  });
});
