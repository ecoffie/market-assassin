import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOW_THEY_BUY_NOW, REPORT_SHIP_CHECKS, HOW_THEY_BUY_NOW_RULES } from './how-they-buy-now';
import { RESEARCH_INSTRUCTIONS } from './research-mode';
import { NO_DATA_DATES } from './outreach-rules';
import { CREATE_DOCUMENT_TOOL_DEF } from '@/lib/chat/generate-document-tool';

const DOC = (CREATE_DOCUMENT_TOOL_DEF.function as { description: string }).description;

describe('How They Buy Now (Eric, 2026-11-27)', () => {
  it('all eight doors are named and each must be marked fit, possible or not applicable', () => {
    expect(HOW_THEY_BUY_NOW).toMatch(/mark ALL EIGHT as fit, possible or not applicable/);
    for (const door of ['market research (sources sought, RFIs)', 'vehicles (IDIQ', 'open calls', 'R&D (SBIR/STTR, BAAs', 'OTAs', 'consortia', 'CSOs and rapid capabilities offices', 'PAEs']) {
      expect(HOW_THEY_BUY_NOW, door).toContain(door);
    }
    expect(DOC).toMatch(/all eight doors marked fit, possible or not applicable/);
  });
  it('the consortium decision is one line in a fixed format, and service firms do not join', () => {
    expect(HOW_THEY_BUY_NOW).toContain('"Join <consortium> (sponsor: <command>) because <capability match>; first move: <team with X / answer the next project call>" or "No consortium: <reason>; your doors are <Y>"');
    expect(HOW_THEY_BUY_NOW).toMatch(/Service firms \(staffing, janitorial, advertising, consulting\) do not join one/);
    expect(HOW_THEY_BUY_NOW).toMatch(/never quote a membership fee the consortium's own site does not confirm/);
    expect(DOC).toMatch(/plus one consortium line/);
  });
  it('Block 2 is required for any DoW buyer, or explicitly not applicable', () => {
    expect(HOW_THEY_BUY_NOW).toMatch(/Block 2, the new DoW acquisition structure, REQUIRED for any Department of War buyer/);
    expect(HOW_THEY_BUY_NOW).toMatch(/When PAEs do not own the client's work, say so/);
    expect(HOW_THEY_BUY_NOW).toMatch(/A report with no DoW buyer says Block 2 is not applicable/);
    expect(DOC).toMatch(/required for any DoW buyer, or say Portfolio Acquisition Executives do not own this work/);
  });
  it('every shift is cited and tied to the client; no promises of awards, revenue or dates', () => {
    expect(HOW_THEY_BUY_NOW).toMatch(/each naming the shift, its citation and what it means here/);
    for (const cite of ['EO 14275', 'RFO Part 19 deviation', 'EO 14271', 'OMB M-25-31', 'FY26 NDAA Sec. 1802']) expect(HOW_THEY_BUY_NOW).toContain(cite);
    expect(HOW_THEY_BUY_NOW).toMatch(/never promise awards, revenue or dates/);
    expect(DOC).toMatch(/Never promise awards, revenue or dates/);
  });
  it('the guidance has no em dashes and no client names (public repository)', () => {
    expect(HOW_THEY_BUY_NOW_RULES).not.toMatch(/—/);
    expect(HOW_THEY_BUY_NOW_RULES).not.toMatch(/Jordon|Konvivial|EFS|Tech Pros|Vertek|TextClock|Morehouse/i);
    const doc = readFileSync(join(process.cwd(), 'docs/knowledge/market-report-section-how-they-buy-now-template.md'), 'utf8');
    expect(doc).not.toMatch(/Jordon|Konvivial|EFS|Tech Pros|Vertek|TextClock/i);
    expect(doc).toMatch(/Mark all EIGHT fit, possible or not applicable/);
  });
});

describe('report ship checks (Fixes 2 and 3)', () => {
  it('swap test', () => {
    expect(REPORT_SHIP_CHECKS).toMatch(/Swap test: swap in another client's name\. Any sentence still true after the swap is boilerplate/);
    expect(DOC).toMatch(/swap test/);
  });
  it('not applicable needs a client-tied reason, and thin prime history is not a reason', () => {
    expect(REPORT_SHIP_CHECKS).toMatch(/Not applicable always carries a one-sentence reason tied to this client/);
    expect(REPORT_SHIP_CHECKS).toMatch(/never a bare "N\/A"/);
    expect(REPORT_SHIP_CHECKS).toMatch(/Never mark a door not applicable because prime history is thin: check subcontracts, joint ventures, mentor-protege, commercial and state work first/);
  });
  it('cut from the top when long', () => {
    expect(REPORT_SHIP_CHECKS).toMatch(/cut from the top: Blocks 1 and 4 \(briefing\) go before Blocks 3 and 5 \(decisions\)/);
  });
  it('contact rules: source and date, 180-day re-check, no reuse, published inbox, never an inferred email', () => {
    expect(REPORT_SHIP_CHECKS).toMatch(/every named contact carries its source \(which SAM notice or official page\) and when it was retrieved/);
    expect(REPORT_SHIP_CHECKS).toMatch(/older than 180 days is marked "last seen on <notice> dated <date>, confirm before use"/);
    expect(REPORT_SHIP_CHECKS).toMatch(/no contact is reused from an earlier report without a re-check/);
    expect(REPORT_SHIP_CHECKS).toMatch(/give the office's published inbox/);
    expect(REPORT_SHIP_CHECKS).toMatch(/never infer an email from a name pattern/);
    // Contact provenance dates are not data-freshness dates.
    expect(NO_DATA_DATES).toMatch(/A named contact's source and retrieval date are provenance, not freshness, and stay/);
  });
});

describe('wired into research mode', () => {
  it('instructions carry the section and the ship checks; a written report follows its order', () => {
    expect(RESEARCH_INSTRUCTIONS).toContain(HOW_THEY_BUY_NOW_RULES);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/A written market or company report follows the HOW THEY BUY NOW order below/);
  });
});
