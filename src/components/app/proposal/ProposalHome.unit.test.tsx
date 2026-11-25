// @vitest-environment jsdom
/** The simple Proposals page: home list → new (step 1) → ready (step 2) → editor tabs (owner, 2026-11-18). */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProposalsHome, NewProposalStart, NewProposalReady, dueLabel, sortPursuits } from './ProposalHome';
import ProposalEditor, { SIDE_TABS } from './ProposalEditor';

const dom = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const noop = () => {};
const pursuits = [
  { id: 'a', title: 'Grounds Maintenance', agency: 'Forest Service', stage: 'tracking', notice_type: 'Solicitation', response_deadline: '2027-01-09T00:00:00Z' },
  { id: 'b', title: 'Janitorial Services', agency: 'VA', stage: 'bidding', notice_type: 'Solicitation', response_deadline: '2026-12-04T00:00:00Z' },
  { id: 'c', title: 'Award to Acme', agency: 'GSA', stage: 'tracking', notice_type: 'Award Notice' },
];

describe('Proposals home', () => {
  it('lists respondable pursuits, actively-worked first, with one New proposal button', () => {
    const d = dom(renderToStaticMarkup(<ProposalsHome pursuits={pursuits} loading={false} onNew={noop} onOpenPursuit={noop} onAllTools={noop} />));
    const titles = Array.from(d.querySelectorAll('section li button span span:first-child')).map(e => e.textContent);
    expect(titles).toEqual(['Janitorial Services', 'Grounds Maintenance']); // award notice has nothing to submit
    expect(d.querySelectorAll('[data-testid="new-proposal"]')).toHaveLength(1);
  });

  it('offers to continue the last draft only when there is one', () => {
    const without = renderToStaticMarkup(<ProposalsHome pursuits={[]} loading={false} onNew={noop} onOpenPursuit={noop} onAllTools={noop} />);
    expect(without).not.toContain('Continue your last draft');
    const withDraft = renderToStaticMarkup(<ProposalsHome pursuits={[]} loading={false} lastDraftName="rfp.pdf" onContinueDraft={noop} onNew={noop} onOpenPursuit={noop} onAllTools={noop} />);
    expect(withDraft).toContain('Continue your last draft');
  });

  it('sorts and labels due dates honestly', () => {
    expect(sortPursuits(pursuits).map(p => p.id)[0]).toBe('b');
    const now = new Date('2026-11-17T00:00:00Z');
    expect(dueLabel('2026-12-04T00:00:00Z', now)).toEqual({ text: expect.stringContaining('17 days'), urgent: false });
    expect(dueLabel('2026-11-20T00:00:00Z', now).urgent).toBe(true);
    expect(dueLabel('2026-11-01T00:00:00Z', now).text).toContain('closed');
    expect(dueLabel(undefined, now).text).toBe('No due date');
  });
});

describe('New proposal steps', () => {
  it('step 1 asks one question: drop the RFP or pick a pursuit', () => {
    const html = renderToStaticMarkup(<NewProposalStart pursuits={pursuits} uploading={false} onFiles={noop} onPickPursuit={noop} onBack={noop} />);
    expect(html).toContain('What are you responding to?');
    expect(html).toContain('Drop your RFP here');
  });

  const ready = (over: Partial<Parameters<typeof NewProposalReady>[0]> = {}) => renderToStaticMarkup(
    <NewProposalReady title="Janitorial" documentNames={['rfp.pdf']} loadingDocs={false} sectionLabels={['Executive summary', 'Technical approach']}
      requirementCount={0} hasSource canDraft drafting={false} elapsedSec={0}
      onDraft={noop} onStop={noop} onOpenEditor={noop} onAddFiles={noop} onBack={noop} onAllTools={noop} {...over} />,
  );

  it('step 2 shows what Mindy will write and one Draft button', () => {
    const html = ready();
    expect(html).toContain('Mindy read rfp.pdf');
    expect(html).toContain('Executive summary, Technical approach');
    expect(html).toContain('data-testid="draft-my-proposal"');
  });

  it('step 2 lists the documents Mindy read and links the SAM.gov solicitation, so the source can be checked', () => {
    const d = dom(ready({
      documentNames: ['RFP.pdf', 'SOW.docx', 'notes.pdf'],
      documents: [{ name: 'RFP.pdf', docId: 'd1' }, { name: 'SOW.docx', docId: 'd2' }, { name: 'notes.pdf' }],
      samUrl: 'https://sam.gov/opp/abc123/view',
      onOpenDoc: noop,
    }));
    const box = d.querySelector('[data-testid="source-documents"]')!;
    expect(box.querySelector('summary')!.textContent).toContain('Mindy read 3 documents');
    const rows = Array.from(box.querySelectorAll('li')).map(li => li.textContent);
    expect(rows[0]).toContain('RFP.pdf'); expect(rows[0]).toContain('Open');
    expect(rows[2]).toContain('Uploaded by you');
    const sam = box.querySelector('a[href="https://sam.gov/opp/abc123/view"]')!;
    expect(sam.getAttribute('target')).toBe('_blank');
    expect(sam.textContent).toContain('View the solicitation on SAM.gov');
  });

  it('no SAM.gov link when the proposal has no notice', () => {
    expect(ready({ documents: [{ name: 'rfp.pdf' }] })).not.toContain('sam.gov');
  });

  it('step 2 without a source asks for the RFP instead of a dead Draft button', () => {
    const html = ready({ documentNames: [], hasSource: false, canDraft: false });
    expect(html).not.toContain('draft-my-proposal');
    expect(html).toContain('Add the RFP');
  });

  it('while drafting, the bar never claims done', () => {
    const html = ready({ drafting: true, elapsedSec: 600 });
    expect(html).toContain('width:92%');
  });
});

describe('editor side panel', () => {
  it('has Ask Mindy, Requirements, Documents and Check tabs', () => {
    expect(SIDE_TABS.map(t => t.label)).toEqual(['Ask Mindy', 'Requirements', 'Documents', 'Check']);
    const html = renderToStaticMarkup(
      <ProposalEditor email="a@b.com" title="T" rfpText="" rfpFileName="" saveFileName="f"
        sections={[{ id: 'technical', label: 'Technical', targetWords: 600 }]} drafts={{}}
        onSectionChange={noop} canDraft={false} onClose={noop} documents={[{ name: 'rfp.pdf' }]} />,
    );
    const tabs = Array.from(dom(html).querySelectorAll('[data-testid="editor-side-tabs"] [role="tab"]')).map(b => b.textContent);
    expect(tabs).toEqual(['Ask Mindy', 'Requirements', 'Documents', 'Check']);
  });
});
