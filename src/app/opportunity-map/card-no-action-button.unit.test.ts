/**
 * The map LIST CARD has NO action buttons — it's the clickable snapshot; actions live in the drawer
 * (Eric, approved in #519). The POPUP keeps ONE "Should I bid?" that opens the drawer. PR #528 made
 * the card/popup CTA literal dynamic (`${draftCTA(o)}`) and the route's strip — which matched the OLD
 * hardcoded "Start drafting" — silently stopped firing, so the button REAPPEARED ("snuck in there",
 * Eric 2026-07-28). This test fails if the strip ever stops matching the template again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// The EXACT CTA markup the template emits (card + popup). The route must strip/replace these VERBATIM
// — a mismatch (e.g. a future label change) is exactly the bug that let the button back.
const CARD_CTA = '<a class="act pri" href="${draftURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${draftCTA(o)}</a>';
const POPUP_CTA = '<a class="pva pri" href="${draftURL(o)}" target="_blank" rel="noopener">${draftCTA(o)}</a>';

describe('map card/popup action-button stripping (approved #519 look)', () => {
  it('the template still emits the CTA markup the route expects to strip (targets stay in sync)', () => {
    expect(tmpl).toContain(CARD_CTA);
    expect(tmpl).toContain(POPUP_CTA);
  });
  it('the route STRIPS the card CTA (→ no button; the card is the clickable snapshot)', () => {
    // card strip = replace the CTA anchor with empty string
    expect(route).toContain(`repl(html, '${CARD_CTA}', '')`);
  });
  it('the card SAM.gov link becomes a "View details →" hint (not an off-site link)', () => {
    expect(route).toContain('<span class="viewdet">View details →</span>');
  });
  it('the popup CTA is REPLACED with the "Should I bid?" drawer-opener (approved treatment)', () => {
    expect(route).toContain(`repl(html, '${POPUP_CTA}',`);
    expect(route).toContain('Should I bid?</button>');
  });
  it("SIMULATE the strip: after replacing the targets, neither button survives", () => {
    const stripped = tmpl.replace(CARD_CTA, '').replace(POPUP_CTA, 'SHOULDIBID');
    expect(stripped).not.toContain(CARD_CTA);
    expect(stripped).not.toContain(POPUP_CTA);
  });
});
