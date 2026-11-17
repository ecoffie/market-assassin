// @vitest-environment jsdom
/** The proposal page's three steps + one primary button (owner, 2026-11-17: "make it simpler"). */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProposalStepTracker, proposalStep } from './ProposalSteps';

describe('proposal steps', () => {
  it('derives the step from what exists', () => {
    expect(proposalStep({ hasSource: false, hasDraft: false })).toBe(1);
    expect(proposalStep({ hasSource: true, hasDraft: false })).toBe(2);
    expect(proposalStep({ hasSource: true, hasDraft: true })).toBe(3);
    // A restored draft with no source loaded is still "review and download".
    expect(proposalStep({ hasSource: false, hasDraft: true })).toBe(3);
  });

  it('marks earlier steps done and the current one active', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<ProposalStepTracker step={2} />), 'text/html');
    const items = Array.from(doc.querySelectorAll('li button'));
    expect(items.map(b => b.textContent)).toEqual(['Pick your solicitation', '2Mindy drafts it', '3Review and download']);
    expect(items[1].getAttribute('aria-current')).toBe('step');
  });

  it('the panel header has ONE primary button and a More menu, not three buttons', () => {
    const panel = readFileSync(join(__dirname, '../panels/ProposalsPanel.tsx'), 'utf8');
    expect(panel).toContain('data-testid="proposal-primary-action"');
    expect(panel).toContain('<MoreMenu items={moreMenuItems} />');
    expect(panel).toContain('<ProposalStepTracker step={currentStep}');
    expect(panel).not.toContain("'Refresh Pursuits'");
  });
});
