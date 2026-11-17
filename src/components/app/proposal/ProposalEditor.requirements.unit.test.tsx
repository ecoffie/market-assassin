// @vitest-environment jsdom
/** The editor's "X of Y requirements covered" counter (owner, 2026-11-17: "12 of 12 or 1 of 4"). */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProposalEditor, { type EditorRequirement } from './ProposalEditor';

const base = {
  email: 'a@b.com', title: 'T', rfpText: '', rfpFileName: '', saveFileName: 'f',
  sections: [{ id: 'technical', label: 'Technical', targetWords: 600 }], drafts: {},
  onSectionChange: () => {}, canDraft: false, onClose: () => {},
};
const chip = (html: string) => new DOMParser().parseFromString(html, 'text/html').querySelector('[data-testid="requirements-covered"]');
const reqs = (statuses: EditorRequirement['status'][]) => statuses.map((status, i) => ({ id: `r${i}`, text: `Req ${i}`, status }));

describe('requirements covered counter', () => {
  it('counts done of all requirements, leaving out N/A', () => {
    expect(chip(renderToStaticMarkup(<ProposalEditor {...base} requirements={reqs(['done', 'open', 'in_progress', 'n_a', 'done'])} />))?.textContent)
      .toBe('2 of 4 requirements covered');
  });
  it('12 of 12 reads as all covered', () => {
    expect(chip(renderToStaticMarkup(<ProposalEditor {...base} requirements={reqs(Array(12).fill('done'))} />))?.textContent)
      .toBe('12 of 12 requirements covered');
  });
  it('no requirements yet: offers to find them only when there is a solicitation to read', () => {
    expect(chip(renderToStaticMarkup(<ProposalEditor {...base} onFindRequirements={() => {}} />))?.textContent).toBe('Find RFP requirements');
    expect(chip(renderToStaticMarkup(<ProposalEditor {...base} />))).toBeNull();
  });
});
