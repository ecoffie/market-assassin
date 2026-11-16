// @vitest-environment jsdom
/**
 * Shared ChatWorkspace + ContextRail, extracted from Proposal Assist's Manual Drive (2026-11-16).
 * The selected opportunity is the rail's FIRST section; the components are display-only.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../authHeaders', () => ({ authedFetch: vi.fn() }));
import ChatWorkspace from './ChatWorkspace';
import ContextRail, { RailSection, ContextItem } from './ContextRail';
import ProposalChat from '../panels/ProposalChat';

function dom(html: string) { const d = document.createElement('div'); d.innerHTML = html; return d; }
const OPP = { title: 'Janitorial Services, USCG Sector Key West', agency: 'Coast Guard', deadline: '2026-12-04T17:00:00Z', noticeId: '6ba812a7e0284f79bc44c4932777c340' };

describe('ChatWorkspace', () => {
  it('two columns with a rail, one without', () => {
    const withRail = dom(renderToStaticMarkup(<ChatWorkspace main={<div id="m" />} rail={<div id="r" />} />));
    expect(withRail.querySelector('section')!.className).toContain('lg:grid-cols-[1fr_300px]');
    expect(withRail.querySelector('aside #r')).not.toBeNull();
    const noRail = dom(renderToStaticMarkup(<ChatWorkspace main={<div id="m" />} />));
    expect(noRail.querySelector('aside')).toBeNull();
    expect(noRail.querySelector('section')!.className).not.toContain('lg:grid-cols');
  });
});

describe('ContextRail', () => {
  it('the selected opportunity comes first, then the surface sections', () => {
    const d = dom(renderToStaticMarkup(<ChatWorkspace main={<div />} rail={<ContextRail opportunity={OPP}><RailSection title="Files in context"><ContextItem label="rfp.pdf" /></RailSection></ContextRail>} />));
    const sections = Array.from(d.querySelectorAll('aside > div'));
    expect(sections[0].querySelector('[data-testid="selected-opportunity"]')).not.toBeNull();
    expect(sections[0].textContent).toContain('Selected opportunity');
    expect(sections[0].textContent).toContain('Janitorial Services, USCG Sector Key West');
    expect(sections[0].textContent).toContain('Coast Guard · due 2026-12-04');
    expect(sections[1].textContent).toContain('Files in context');
  });
  it('no opportunity, no card; an opportunity title with markup is text', () => {
    expect(dom(renderToStaticMarkup(<ContextRail />)).querySelector('[data-testid="selected-opportunity"]')).toBeNull();
    const d = dom(renderToStaticMarkup(<ContextRail opportunity={{ title: '<img src=x onerror=alert(1)>' }} />));
    expect(d.querySelector('img')).toBeNull();
  });
  it('is display-only: no fetch, no storage, no document read', () => {
    for (const f of ['ContextRail.tsx', 'ChatWorkspace.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/fetch\(|authedFetch|sessionStorage|localStorage|supabase/i);
    }
  });
});

describe('ProposalChat on the shared components', () => {
  const props = { email: 'u@example.com', rfpText: '', rfpFileName: '', hasVault: true, files: [{ fileName: 'rfp.pdf' }], onAddFile: () => {}, onRemoveFile: () => {}, pipelineId: 'p-1' };
  it('shows its pursuit first in the rail, then Files and Instructions', () => {
    const d = dom(renderToStaticMarkup(<ProposalChat {...props} opportunity={OPP} />));
    const titles = Array.from(d.querySelectorAll('aside h3')).map((h) => h.textContent);
    expect(titles).toEqual(['Selected opportunity', 'Files in context', 'Instructions']);
    expect(d.textContent).toContain('Your Vault');
    expect(d.textContent).toContain('Proposal corpus');
    expect(d.querySelector('[aria-label="Remove from context"]')).not.toBeNull();
  });
  it('without an opportunity the rail is exactly Files + Instructions, as before', () => {
    const d = dom(renderToStaticMarkup(<ProposalChat {...props} />));
    expect(Array.from(d.querySelectorAll('aside h3')).map((h) => h.textContent)).toEqual(['Files in context', 'Instructions']);
  });
  it('keeps its own transport and proposal-only parts', () => {
    const src = readFileSync(join(__dirname, '../panels/ProposalChat.tsx'), 'utf8');
    expect(src).toContain("authedFetch('/api/app/proposal/chat'");
    expect(src).toContain('[Standing instructions:');
    expect(src).toContain('const STARTERS');
  });
});
