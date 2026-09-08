/**
 * Agency dropdown — stay-open is the Industry gold master (Eric 2026-08-13).
 *
 * Live filtering commits on every row click (300 ms debounce). Closing the popover
 * on commit was an Apply-era habit: first select closed the menu, so a second
 * agency required reopen. Measured on prod 2026-09-08.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const start = src.indexOf('AGENCY multi-select');
const end = src.indexOf("getElementById('naicsBtn')");
const agency = src.slice(start, end);

describe('Agency popover stays open after a live commit', () => {
  it('the Agency IIFE is the slice under test', () => {
    expect(agency).toContain('function commit(){');
    expect(agency).toContain("getElementById('agencyApply')");
  });

  it('commit does not close the popover — copy Industry stay-open', () => {
    expect(agency).toContain('setLabel(); fetchView();');
    expect(agency).not.toContain('setLabel(); setOpen(false); fetchView();');
  });

  it('row clicks still debounce through commitLive', () => {
    expect(agency).toContain('syncHdr(); reflectAllRow(); commitLive();');
    expect(agency).toContain('function commitLive(){ clearTimeout(_liveT); _liveT=setTimeout(commit, 300); }');
  });

  it('outside click and Escape still close — stay-open is commit-only', () => {
    expect(agency).toContain("e.target.closest('#agencyWrap')");
    expect(agency).toContain("if(e.key==='Escape' && !pop.hidden)setOpen(false);");
  });
});
