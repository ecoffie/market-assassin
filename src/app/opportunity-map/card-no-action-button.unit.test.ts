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

// The EXACT CARD CTA markup the template emits. The route must strip it VERBATIM — a mismatch
// (e.g. a future label change) is exactly the bug that let the button back onto the card face.
const CARD_CTA = '<a class="act pri" href="${draftURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${draftCTA(o)}</a>';

describe('map card/popup action-button stripping (approved #519 look)', () => {
  it('the template still emits the CARD CTA markup the route expects to strip (targets stay in sync)', () => {
    expect(tmpl).toContain(CARD_CTA);
  });
  it('the route STRIPS the card CTA (→ no button; the card is the clickable snapshot)', () => {
    // card strip = replace the CTA anchor with empty string
    expect(route).toContain(`repl(html, '${CARD_CTA}', '')`);
  });
  it('the card SAM.gov link becomes a "View details →" hint (not an off-site link)', () => {
    expect(route).toContain('<span class="viewdet">Review Opportunity →</span>');
  });
  it("SIMULATE the strip: after replacing the card CTA target, the button doesn't survive", () => {
    const stripped = tmpl.replace(CARD_CTA, '');
    expect(stripped).not.toContain(CARD_CTA);
  });
  // POPUP (Expanded Decision Card, 2026-08-04): the popup CTA is now emitted DIRECTLY in popupHTML
  // as a lifecycle-labeled drawer-opener BUTTON (not an <a> the route rewrites) — it stays ON-MAP
  // (opens the drawer, never leaks to claude.ai), preserving the flywheel. The old
  // draftURL→"Should I bid?" route rewrite is gone (nothing to strip).
  it('the popup CTA is an on-map drawer-opener emitted by popupHTML (no off-site link, no route rewrite)', () => {
    const popupFn = tmpl.slice(tmpl.indexOf('function popupHTML(o){'), tmpl.indexOf('// ---------- listing card ----------'));
    expect(popupFn).toContain('class="pva pri pv-cta"');
    expect(popupFn).toContain('openOppDrawer');
    expect(popupFn).not.toContain('draftURL(o)');       // never leaks off-site
    expect(route).not.toContain('Should I bid?</button>'); // the old popup rewrite is gone
  });
  it('the popup keeps the 1-click Favorites heart (top-right)', () => {
    const popupFn = tmpl.slice(tmpl.indexOf('function popupHTML(o){'), tmpl.indexOf('// ---------- listing card ----------'));
    expect(popupFn).toContain('class="pv-heart"');
    expect(popupFn).toContain('toggleFav(this)');
  });
});
